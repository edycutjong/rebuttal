/**
 * Spend-guard + route-boundary tests for the public routes (apps/web/lib/guard.ts, app/api/*): the server key spends
 * real credits, so the routes must (1) reject bad input before any network call, (2) rate-limit an address, (3) stop
 * going live once the day's ceiling is reached and degrade to a labelled fixture replay, (4) never let the key or
 * anything key-shaped reach a client, and (5) never run the 200-credit agent on a GET or past its own ceilings.
 * Routes are driven directly with NextRequest; the fixture replay reads the real fixtures/ directory.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { NextRequest } from "next/server";
import { GET as rebutRoute } from "@/app/api/rebut/route";
import { GET as agentGet, POST as agentPost } from "@/app/api/agent/route";
import { cleanClaim, MAX_CLAIM } from "@/lib/engine";
import { ipAllowed, creditsLeft, recordSpend, budgetExhausted, resetGuard, replayFixture, fixtureFor, agentAllowed, clientIp, IP_PER_MIN, DAILY_CREDITS, MAX_VERDICT_CREDITS, AGENT_PER_DAY, AGENT_IP_PER_DAY, BUDGET_MESSAGE, NO_FIXTURE_MESSAGE } from "@/lib/guard";
import { rebut, type RebutEvent } from "../src/index.js";
import { fakeClient, pepeRoutes } from "./helpers.js";

const KEY = "nsn_test_key_0000000000000000000000";
const KEY_SHAPE = /nsn_[A-Za-z0-9_]{8,}/;
const HERO = "Smart Money is aping $PEPE hard today 🐋";
const req = (q: string, extra = "", ip = "203.0.113.7") => new NextRequest(`http://localhost:3400/api/rebut?q=${encodeURIComponent(q)}${extra}`, { headers: { "x-forwarded-for": ip } });

describe("guard counters", () => {
  beforeEach(resetGuard);
  it("clientIp prefers the first x-forwarded-for hop, then x-real-ip, then 'unknown'", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });
  it(`an address gets ${IP_PER_MIN} checks a minute, then a Retry-After, then the window slides`, () => {
    const t0 = 1_000_000;
    for (let i = 0; i < IP_PER_MIN; i++) expect(ipAllowed("a", t0 + i)).toEqual({ ok: true });
    const r = ipAllowed("a", t0 + 100);
    expect(r.ok).toBe(false);
    expect((r as { retryAfter: number }).retryAfter).toBeGreaterThanOrEqual(59);
    expect(ipAllowed("b", t0 + 100)).toEqual({ ok: true });
    expect(ipAllowed("a", t0 + 60_001)).toEqual({ ok: true });
  });
  it("the daily ceiling counts spend, rolls at UTC midnight, and is exhausted below one worst-case rebuttal", () => {
    const day1 = Date.UTC(2026, 8, 18, 12);
    expect(creditsLeft(day1)).toBe(DAILY_CREDITS);
    recordSpend(DAILY_CREDITS - MAX_VERDICT_CREDITS, day1);
    expect(budgetExhausted(day1)).toBe(false);
    recordSpend(1, day1);
    expect(budgetExhausted(day1)).toBe(true);
    expect(creditsLeft(Date.UTC(2026, 8, 19, 0, 1))).toBe(DAILY_CREDITS);
  });
  it(`the agent button: ${AGENT_IP_PER_DAY} per IP, ${AGENT_PER_DAY} per day, reset at midnight`, () => {
    const t = Date.UTC(2026, 8, 18, 12);
    expect(agentAllowed("a", t)).toBeNull();
    expect(agentAllowed("a", t)).toBeNull();
    expect(agentAllowed("a", t)).toMatch(/from this address/);
    expect(agentAllowed("b", t)).toBeNull();
    expect(agentAllowed("c", t)).toBeNull();
    expect(agentAllowed("d", t)).toMatch(/times today already/);
    expect(agentAllowed("a", Date.UTC(2026, 8, 19, 0, 1))).toBeNull();
  });
});

describe("fixture replay", () => {
  it("finds the hero fixture by its input text, case- and space-insensitive, and replays it labelled at 0 credits", async () => {
    expect(fixtureFor("  smart money IS aping $pepe hard today 🐋 ")?.slug).toBe("pepe-aping");
    const r = await replayFixture(HERO);
    expect(r?.verdict.label).toBe("CONTRADICTED");
    expect(r?.verdict.credits).toBe(0);
    expect(r?.verdict.warnings).toContain(BUDGET_MESSAGE);
    expect(r?.verdict.hash).toBe(fixtureFor(HERO)!.verdict.hash);
  });
  it("returns undefined for a claim with no recording", async () => {
    expect(await replayFixture("SM is aping $NOTRECORDED")).toBeUndefined();
  });
});

describe("cleanClaim", () => {
  it("strips control characters, collapses whitespace, bounds the length", () => {
    expect(cleanClaim(" ab  c ")).toBe("ab c");
    expect(cleanClaim("")).toBeNull();
    expect(cleanClaim("x".repeat(MAX_CLAIM + 1))).toBeNull();
    expect(cleanClaim("x".repeat(MAX_CLAIM))).toHaveLength(MAX_CLAIM);
  });
});

describe("/api/rebut boundary", () => {
  const fetchSpy = vi.fn<typeof fetch>();
  let savedKey: string | undefined;
  beforeEach(() => {
    resetGuard();
    savedKey = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    vi.stubGlobal("fetch", fetchSpy);
    fetchSpy.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedKey === undefined) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = savedKey;
  });
  it("an empty or oversized claim is a 400 with zero fetches", async () => {
    for (const q of ["", "   ", "x".repeat(MAX_CLAIM + 1)]) {
      const res = await rebutRoute(req(q));
      expect(res.status).toBe(400);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("a missing server key is a 500 that does not say what a key looks like", async () => {
    delete process.env.NANSEN_API_KEY;
    const res = await rebutRoute(req(HERO));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(KEY_SHAPE);
  });
  it("the per-IP gate answers 429 with Retry-After and spends nothing", async () => {
    for (let i = 0; i < IP_PER_MIN; i++) ipAllowed("203.0.113.7");
    const res = await rebutRoute(req(HERO));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("past the daily ceiling a recorded claim replays offline (degraded, labelled, 0 credits, zero fetches)", async () => {
    recordSpend(DAILY_CREDITS);
    const res = await rebutRoute(req(HERO));
    expect(res.status).toBe(200);
    const v = (await res.json()) as { label: string; credits: number; degraded: boolean; warnings: string[] };
    expect(v).toMatchObject({ label: "CONTRADICTED", credits: 0, degraded: true });
    expect(v.warnings).toContain(BUDGET_MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("past the daily ceiling an unrecorded claim is an honest 503", async () => {
    recordSpend(DAILY_CREDITS);
    const res = await rebutRoute(req("SM is aping $NOTRECORDED"));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe(NO_FIXTURE_MESSAGE);
  });
  it("the stream past the ceiling ends with the fixture verdict and a degraded asOf line", async () => {
    recordSpend(DAILY_CREDITS);
    const res = await rebutRoute(req(HERO, "&stream=1"));
    expect(res.headers.get("content-type")).toMatch(/x-ndjson/);
    const lines = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; degraded?: boolean });
    expect(lines.filter((l) => l.type === "check")).toHaveLength(6);
    expect(lines.map((l) => l.type)).toContain("verdict");
    expect(lines[lines.length - 1]).toMatchObject({ type: "asOf", degraded: true });
    expect(JSON.stringify(lines)).not.toMatch(KEY_SHAPE);
  });
  it("10,000 generated bad inputs: never a fetch, always a clean 400", async () => {
    recordSpend(DAILY_CREDITS); // no live path
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.constant(""), fc.string({ maxLength: 3 }).map((s) => s.replace(/\S/g, " ")), fc.stringMatching(/^[a-z$0-9]{601,640}$/)), async (q) => {
        const res = await rebutRoute(req(q, "", "198.51.100.1"));
        expect(res.status).toBe(400);
      }),
      { numRuns: 10_000 },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("/api/agent boundary", () => {
  beforeEach(() => {
    resetGuard();
    process.env.NANSEN_API_KEY = KEY;
  });
  it("GET never runs the agent (405)", () => {
    expect(agentGet().status).toBe(405);
  });
  it("POST past the per-day ceiling is a 429 with the price and no fetch", async () => {
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    for (let i = 0; i < AGENT_PER_DAY; i++) agentAllowed(`ip${i}`);
    const res = await agentPost(new NextRequest("http://localhost:3400/api/agent", { method: "POST", body: JSON.stringify({ q: HERO }), headers: { "x-forwarded-for": "9.9.9.9", "content-type": "application/json", "sec-fetch-site": "same-origin" } }));
    expect(res.status).toBe(429);
    expect((await res.json()) as { credits: number }).toMatchObject({ credits: 200 });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("POST with no claim is a 400", async () => {
    const res = await agentPost(new NextRequest("http://localhost:3400/api/agent", { method: "POST", body: "{}", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" } }));
    expect(res.status).toBe(400);
  });
});

describe("the key never leaves the server", () => {
  it("a full rebuttal, every stream event and the provenance carry nothing key-shaped", async () => {
    const client = fakeClient(pepeRoutes());
    const events: RebutEvent[] = [];
    const v = await rebut(client, HERO, { llm: null, now: 0, onProgress: (e) => events.push(e) });
    for (const payload of [v, ...events, client.calls]) {
      const text = JSON.stringify(payload);
      expect(text).not.toContain(KEY);
      expect(text).not.toMatch(KEY_SHAPE);
    }
  });
});

describe("the web copy text equals core's rebuttalText (the browser bundle cannot import core)", () => {
  it("same paragraph", async () => {
    const { rebuttalText: web } = await import("@/components/Rebuttal");
    const { rebuttalText: core } = await import("../src/rebut.js");
    const v = await rebut(fakeClient(pepeRoutes()), HERO, { llm: null, now: 0 });
    expect(web(v, "https://x/c?q=1")).toBe(core(v, "https://x/c?q=1"));
  });
});
