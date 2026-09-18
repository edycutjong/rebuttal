import type { NansenClient, Call } from "./client";
import { sha256 } from "./client";
import { canonicalize } from "./cache";
import { extractClaim, mergeClaims, validClaim, SCORABLE_CHAINS, type Claim } from "./claim";
import { resolveToken, NOT_A_NANSEN_CHAIN, type Resolved } from "./resolve";
import { runChecks, planChecks, type Check, type CheckEvent } from "./checks";
import { decide, RULES, fmtUsd, subjectName, type Decision, type Evidence, type Label, type Rules } from "./decide";
import { extractWithLlm, narrateWithLlm, type LlmOptions, type LlmStatus } from "./llm";
import { isTweetUrl, fetchTweetText } from "./tweet";
import type { AgentRun } from "./agent";

export type Prose = { text: string; source: "llm" | "template"; ms: number };

export type Verdict = {
  input: string;
  claim: Claim;
  resolved: Resolved | null;
  label: Label;
  ruleId: string;
  reasons: string[];
  threshold: number;
  evidence: Evidence;
  checks: Check[];
  prose: Prose;
  provenance: Call[];
  credits: number;
  calls: number;
  ms: number;
  /** sha256 of the canonical evidence record (see `verdictHash`) */
  hash: string;
  warnings: string[];
  llm: { extract: LlmStatus | null; narrate: LlmStatus | null };
  agent?: AgentRun;
  rules: Rules;
  now: number;
};

export type RebutEvent =
  | { type: "input"; text: string; fromUrl: boolean; author?: string }
  | { type: "claim"; claim: Claim; plan: ReturnType<typeof planChecks> | null }
  | { type: "resolved"; resolved: Resolved | null; plan: ReturnType<typeof planChecks> | null }
  | CheckEvent
  | { type: "verdict"; verdict: Verdict }
  | { type: "prose"; prose: Prose };

export type RebutOptions = {
  chain?: string;
  now?: number;
  /** null → rules extractor + template prose only (verify, tests); undefined → from env */
  llm?: LlmOptions | null;
  /** a pre-extracted claim (fixture replay): skips both extractors */
  claim?: Claim;
  rules?: Rules;
  /** false → skip the two-sentence narration (the OG card never shows prose); extraction still runs so the label matches the page */
  narrate?: boolean;
  fetchImpl?: typeof fetch;
  onProgress?: (e: RebutEvent) => void;
};

/** The evidence record that is hashed: the numbers that decided the label, rounded so cents never change a hash. */
export function hashRecord(claim: Claim, resolved: Resolved | null, d: Decision, e: Evidence) {
  const r = (n: number | null | undefined) => (n == null ? null : Math.round(n));
  const cls = claim.subject === "whales" ? "whale" : "smart_trader";
  return {
    token: claim.token ?? null,
    type: claim.type ?? null,
    subject: claim.subject ?? "smart_money",
    chain: resolved?.chain ?? null,
    address: resolved?.address?.toLowerCase() ?? null,
    label: d.label,
    ruleId: d.ruleId,
    net1d: r(e.flow1d?.[cls]?.net),
    wallets1d: e.flow1d?.[cls]?.wallets ?? null,
    net7d: r(e.flow7d?.[cls]?.net),
    fresh1d: r(e.flow1d?.fresh_wallets.net),
    buyUsd: r(e.named?.buyUsd),
    sellUsd: r(e.named?.sellUsd),
    inTable: e.table?.inTable ?? null,
    px24: e.price ? Number(e.price.change.toFixed(3)) : null,
    holders: e.holders?.count ?? null,
    holdersDelta24: r(e.holders?.delta24),
    holdersDelta7d: r(e.holders?.delta7d),
    /** the whale primary is delta24 × close; the close enters at 6 significant digits so a cent tick cannot move the hash */
    pxClose: e.price ? Number(e.price.close.toPrecision(6)) : null,
  };
}

export function verdictHash(claim: Claim, resolved: Resolved | null, d: Decision, e: Evidence): string {
  return sha256(JSON.stringify(canonicalize(hashRecord(claim, resolved, d, e))));
}

/** The deterministic prose: what the LLM paraphrases, and what ships when it can't. */
export function templateProse(claim: Claim, resolved: Resolved | null, d: Decision): string {
  const who = subjectName(claim.subject);
  const tok = resolved ? `${resolved.symbol} on ${resolved.chain}` : (claim.token ?? "this token");
  const verb = claim.type === "selling" ? "selling" : claim.type === "holding" ? "holding" : "buying";
  const head = { CONFIRMED: `Nansen agrees: ${who} are ${verb} ${tok}.`, OVERSTATED: `Nansen only partly agrees that ${who} are ${verb} ${tok}.`, CONTRADICTED: `Nansen disagrees that ${who} are ${verb} ${tok}.`, UNVERIFIABLE: `This claim about ${tok} cannot be checked against Nansen.` }[d.label];
  return `${head} ${d.reasons[0] ? d.reasons[0][0].toUpperCase() + d.reasons[0].slice(1) : ""}${d.reasons[1] ? ` — ${d.reasons[1]}` : ""}.`.replace(/\.\.$/, ".");
}

function summaryForLlm(claim: Claim, resolved: Resolved | null, d: Decision): string {
  return [
    `Verdict (fixed, do not change): ${d.label}`,
    `Claim: "${claim.raw}"`,
    `Token: ${resolved ? `${resolved.symbol} (${resolved.name}) on ${resolved.chain}` : claim.token}`,
    `Subject: ${subjectName(claim.subject)}; claim type: ${claim.type}`,
    `Evidence lines: ${d.reasons.join(" | ")}`,
    `Meaning of the verdict: ${{ CONFIRMED: "Nansen's numbers support the claim's direction", OVERSTATED: "Nansen partly supports it — say what is real and what is not", CONTRADICTED: "Nansen shows the opposite of the claim", UNVERIFIABLE: "the claim cannot be checked against Nansen — say why" }[d.label]}.`,
    "Write two sentences for a reader who has 30 seconds.",
  ].join("\n");
}

const unverifiable = (claim: Claim, reason: string, ruleId: string): Decision => ({ label: "UNVERIFIABLE", ruleId, reasons: [reason], threshold: 0 });

/**
 * The whole product: text → claim → token → checks → verdict → prose. Every Nansen call goes through `client` so the
 * provenance and the credit count are exact. Never throws for bad input; throws only if `search/general` itself fails.
 */
export async function rebut(client: NansenClient, input: string, opts: RebutOptions = {}): Promise<Verdict> {
  const t0 = Date.now();
  const now = opts.now ?? Date.now();
  const rules = opts.rules ?? RULES;
  const warnings: string[] = [];
  const emit = opts.onProgress ?? (() => {});
  const llmOpts = opts.llm === undefined ? envLlm() : opts.llm;
  const llm: Verdict["llm"] = { extract: null, narrate: null };
  const firstCall = client.calls.length;

  // 1 · input: a tweet URL becomes its text (0 credits); anything else is the claim
  let text = input.trim().replace(/\s+/g, " ").slice(0, 600);
  let fromUrl = false;
  let author: string | undefined;
  if (opts.claim) text = opts.claim.raw;
  else if (isTweetUrl(text)) {
    const t = await fetchTweetText(text, { fetchImpl: opts.fetchImpl });
    if (t) {
      text = t.text.slice(0, 600);
      fromUrl = true;
      author = t.author;
    } else warnings.push("could not fetch that tweet — paste its text instead");
  }
  emit({ type: "input", text, fromUrl, author });

  // 2 · claim: rules first (always), LLM when allowed, merged so a `$TICKER` in the text can never be overridden
  let claim: Claim;
  if (opts.claim) claim = opts.claim;
  else {
    const rulesClaim = extractClaim(text);
    if (llmOpts && !rulesClaim.problem?.startsWith("that is an address") && text) {
      const r = await extractWithLlm(text, llmOpts);
      llm.extract = r.status;
      claim = mergeClaims(rulesClaim, r.claim);
      if (!r.claim) claim.extractor = "rules";
    } else claim = rulesClaim;
  }
  if (opts.chain) claim.chain = opts.chain;
  if (claim.chain && !SCORABLE_CHAINS.has(claim.chain)) {
    warnings.push(`chain "${claim.chain}" is not a Nansen token chain — ignored`);
    claim.chain = undefined;
  }
  if (!claim.subject) claim.subject = "smart_money";

  /** Build the verdict with the template prose (no LLM in its path); the narration is patched in afterwards. */
  const finish = (resolved: Resolved | null, d: Decision, evidence: Evidence, checks: Check[]): Verdict => {
    const provenance = client.calls.slice(firstCall);
    return {
      input,
      claim,
      resolved,
      label: d.label,
      ruleId: d.ruleId,
      reasons: d.reasons,
      threshold: d.threshold,
      evidence,
      checks,
      prose: { text: templateProse(claim, resolved, d), source: "template", ms: 0 },
      provenance,
      credits: provenance.reduce((n, c) => n + c.credits, 0),
      calls: provenance.length,
      ms: Date.now() - t0,
      hash: verdictHash(claim, resolved, d, evidence),
      warnings,
      llm,
      rules,
      now,
    };
  };
  const empty: Evidence = { flow1d: null, flow7d: null, named: null, table: null, price: null, holders: null, checksOk: 0, checksTotal: 0 };

  if (!validClaim(claim)) {
    emit({ type: "claim", claim, plan: null });
    const v = finish(null, unverifiable(claim, claim.problem ?? "could not read a checkable claim", "U-CLAIM"), empty, []);
    emit({ type: "verdict", verdict: v });
    emit({ type: "prose", prose: v.prose });
    return v;
  }

  // 3 · token
  if (!claim.chain && NOT_A_NANSEN_CHAIN[claim.token]) {
    emit({ type: "claim", claim, plan: null });
    const d = unverifiable(claim, `${NOT_A_NANSEN_CHAIN[claim.token]} is not a chain Nansen indexes — only bridged copies of ${claim.token} exist here, and they are not what the post is about (name a chain to check one)`, "U-CHAIN");
    const v = finish(null, d, empty, []);
    emit({ type: "verdict", verdict: v });
    emit({ type: "prose", prose: v.prose });
    return v;
  }
  const resolved = await resolveToken(client, claim.token, claim.chain);
  const plan = resolved ? planChecks(claim, resolved) : null;
  emit({ type: "claim", claim, plan });
  emit({ type: "resolved", resolved, plan });
  if (!resolved) {
    const d = unverifiable(claim, `no token named ${claim.token} on Nansen${claim.chain ? ` (${claim.chain})` : ""}`, "U-TOKEN");
    const v = finish(null, d, empty, []);
    emit({ type: "verdict", verdict: v });
    emit({ type: "prose", prose: v.prose });
    return v;
  }
  if (resolved.sameName > 1) warnings.push(`${resolved.sameName} tokens named ${claim.token} on Nansen — checked the ${resolved.by}`);

  // 4 · checks (parallel) → 5 · verdict
  const { evidence, checks } = await runChecks(client, claim, resolved, now, emit);
  const d = decide(claim, evidence, rules);
  for (const c of checks) if (!c.ok) warnings.push(`${c.endpoint} (${c.window}) unavailable: ${c.error}`);

  // 5 · the verdict goes out the moment the rule fires — the narration must never hold the card (pass-2 finding #2)
  const v = finish(resolved, d, evidence, checks);
  emit({ type: "verdict", verdict: v });
  // 6 · prose: the LLM paraphrases the decided record within its budget, else the template already on the verdict
  if (llmOpts && opts.narrate !== false) {
    const r = await narrateWithLlm(summaryForLlm(claim, resolved, d), { ...llmOpts, label: d.label });
    llm.narrate = r.status;
    if (r.text) v.prose = { text: r.text, source: "llm", ms: r.status.ms };
    else v.prose = { ...v.prose, ms: r.status.ms };
  }
  emit({ type: "prose", prose: v.prose });
  return v;
}

export function envLlm(env: NodeJS.ProcessEnv = process.env): LlmOptions | null {
  const keys = (env.GROQ_API_KEYS ?? env.GROQ_API_KEY ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  return keys.length ? { keys } : null;
}

/** The paragraph the reply-guy pastes: verdict, the numbers, the hash. */
export function rebuttalText(v: Verdict, permalink?: string): string {
  const tok = v.resolved ? `$${v.resolved.symbol} (${v.resolved.chain})` : v.claim.token ? `$${v.claim.token}` : "this";
  const lines = [`${v.label} — "${v.claim.raw.slice(0, 120)}${v.claim.raw.length > 120 ? "…" : ""}"`, `${tok}: ${v.reasons.join("; ")}.`, `Checked on Nansen: ${v.checks.filter((c) => c.ok).length}/${v.checks.length} calls, ${v.credits} credits · ${v.hash.slice(0, 12)}${permalink ? ` · ${permalink}` : ""}`];
  return lines.join("\n");
}

export { fmtUsd };
