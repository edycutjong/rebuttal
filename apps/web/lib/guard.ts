import { existsSync } from "node:fs";
import { join } from "node:path";
import { CachedNansenClient, fixtureStore, listFixtures, readFixture, rebut, type Fixture, type RebutOptions, type Verdict } from "@rebuttal/core";

/**
 * Spend guard for the public routes. The key is server-only and every rebuttal costs real Nansen credits (≤ 15), the
 * agent button 200, so an unattended loop against the URL could drain the account. Ceilings, no new services:
 *
 *   1. per-IP:  IP_PER_MIN rebuttals per rolling minute → 429 with Retry-After;
 *   2. global:  DAILY_CREDITS live credits per UTC day, counted from each verdict's own provenance;
 *   3. degrade: past the daily ceiling a claim with a recorded fixture replays it offline (0 credits, labelled), one
 *      without gets a 503 that says so;
 *   4. agent:   AGENT_IP_PER_DAY runs per IP per day and AGENT_PER_DAY runs per day in total (200 credits each).
 *
 * Counters live in instance memory: a ceiling, not accounting. Vercel may run several instances, so the true daily
 * spend is bounded by the ceilings × instances — still two orders of magnitude under the balance.
 */
export const IP_PER_MIN = Number(process.env.GUARD_IP_PER_MIN ?? 10); // 0-credit refusals count too, and a judge who types garbage five times still deserves a live run
export const DAILY_CREDITS = Number(process.env.GUARD_DAILY_CREDITS ?? 2000);
export const AGENT_IP_PER_DAY = Number(process.env.GUARD_AGENT_IP_PER_DAY ?? 2);
export const AGENT_PER_DAY = Number(process.env.GUARD_AGENT_PER_DAY ?? 4);
/** a rebuttal never costs more than this (6 checks + holders) */
export const MAX_VERDICT_CREDITS = 15;
const WINDOW_MS = 60_000;

const hits = new Map<string, number[]>();

export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || headers.get("x-real-ip")?.trim() || "unknown";
}

export function ipAllowed(ip: string, now = Date.now()): { ok: true } | { ok: false; retryAfter: number } {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= IP_PER_MIN) {
    hits.set(ip, recent);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((recent[0] + WINDOW_MS - now) / 1000)) };
  }
  recent.push(now);
  if (hits.size >= 5000) hits.clear(); // bound memory under a distributed scan; a cleared window only errs toward allowing
  hits.set(ip, recent);
  return { ok: true };
}

let day = "";
let spent = 0;
let agentRuns = 0;
const agentByIp = new Map<string, number>();
function roll(now: number) {
  const d = new Date(now).toISOString().slice(0, 10);
  if (d !== day) {
    day = d;
    spent = 0;
    agentRuns = 0;
    agentByIp.clear();
  }
}
export function creditsLeft(now = Date.now()): number {
  roll(now);
  return Math.max(0, DAILY_CREDITS - spent);
}
export function recordSpend(credits: number, now = Date.now()): void {
  roll(now);
  spent += Math.max(0, credits);
}
/** true when the day's budget cannot cover one more worst-case rebuttal */
export function budgetExhausted(now = Date.now()): boolean {
  return creditsLeft(now) < MAX_VERDICT_CREDITS;
}
/** The agent button: reserves one run; returns why it cannot run, or null. */
export function agentAllowed(ip: string, now = Date.now()): string | null {
  roll(now);
  if (agentRuns >= AGENT_PER_DAY)
    return `Nansen's agent has been asked ${AGENT_PER_DAY} times today already (${AGENT_PER_DAY * 200} credits) — come back tomorrow, or run it yourself: npm run rebuttal -- "<claim>" --ask-nansen`;
  if ((agentByIp.get(ip) ?? 0) >= AGENT_IP_PER_DAY) return `You have asked Nansen's agent ${AGENT_IP_PER_DAY} times today from this address — run it yourself: npm run rebuttal -- "<claim>" --ask-nansen`;
  agentRuns++;
  agentByIp.set(ip, (agentByIp.get(ip) ?? 0) + 1);
  return null;
}
/** test hook */
export function resetGuard(): void {
  hits.clear();
  day = "";
  spent = 0;
  agentRuns = 0;
  agentByIp.clear();
}

export const BUDGET_MESSAGE = "Today's live Nansen budget is used up — this is a replay of a recorded run.";
export const NO_FIXTURE_MESSAGE = "Today's live Nansen budget is used up and this claim has no recorded run. Try one of the example claims, or come back tomorrow.";

function fixturesDir(): string | undefined {
  for (const c of [join(process.cwd(), "fixtures"), join(process.cwd(), "..", "..", "fixtures")]) if (existsSync(c)) return c;
  return undefined;
}

let fixtureIndex: Fixture[] | undefined;
export function fixtures(): Fixture[] {
  if (fixtureIndex) return fixtureIndex;
  const dir = fixturesDir();
  fixtureIndex = dir ? listFixtures(dir).map(readFixture) : [];
  return fixtureIndex;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
/** A recorded fixture whose input is this exact claim (case- and whitespace-insensitive), if any. */
export function fixtureFor(q: string): Fixture | undefined {
  return fixtures().find((f) => norm(f.input) === norm(q));
}

/** The offline fallback: the fixture's recorded responses under the same engine and clock, labelled as a replay. */
export async function replayFixture(q: string, opts: Pick<RebutOptions, "onProgress"> = {}): Promise<{ verdict: Verdict; oldestHit?: string } | undefined> {
  const f = fixtureFor(q);
  if (!f) return undefined;
  const c = new CachedNansenClient("nsn_offline_replay_no_network", { store: fixtureStore(f), offline: true });
  const onProgress: RebutOptions["onProgress"] = (e) => {
    if (e.type === "verdict" && !e.verdict.warnings.includes(BUDGET_MESSAGE)) e.verdict.warnings.push(BUDGET_MESSAGE);
    opts.onProgress?.(e);
  };
  const verdict = await rebut(c, f.input, { now: f.now, chain: f.options.chain, claim: f.claim, llm: null, onProgress });
  if (!verdict.warnings.includes(BUDGET_MESSAGE)) verdict.warnings.push(BUDGET_MESSAGE);
  return { verdict, oldestHit: c.oldestHit ?? f.recordedAt };
}
