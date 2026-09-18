/**
 * Day-one spike (specs/spike.md): the 10 real claims in specs/spike-claims.md through the full engine, live.
 * Records: label + rule per claim (decisive = not UNVERIFIABLE), LLM vs rules extraction agreement, credits, latency.
 * `--agent` additionally runs agent/fast ONCE on the first claim (200 credits) and records its stream timing.
 * Output: spike-raw.json in the cwd (copied to the kitchen by hand), summary on stdout.
 */
import { writeFileSync } from "node:fs";
import { cachedClientFromEnv, rebut, extractClaim, extractWithLlm, envLlm, askNansenAgent } from "@rebuttal/core";

export const CLAIMS: Array<{ n: number; text: string; source: string; expect: string }> = [
  { n: 1, text: "The top 100 addresses increased holdings by 6.07% over 30 days, smart money positions surged 307%. $PEPE", source: "OKX Orbit Insight 87337914594080 · 2026-09-14", expect: "PEPE smart_money buying" },
  { n: 2, text: "The 820 million unlocked on September 6 was silently absorbed, and Hyperliquid Strategies just bought another 29.65 million $HYPE", source: "OKX Orbit Insight 87337914594080 · 2026-09-14", expect: "HYPE smart_money buying" },
  { n: 3, text: "UNI has rallied 2.7-fold from its lows, with smart money logging gains of nearly 1000%.", source: "Lookonchain 73026 · 2026-09-18", expect: "UNI smart_money holding" },
  { n: 4, text: "A whale sold 600,000 UNI tokens, valued at approximately $5.1 million.", source: "x.com/OnchainLens/status/2100824200957366630 · 2026-09-18", expect: "UNI whales selling" },
  { n: 5, text: "Whale Deposits 440K $HYPE ($36M) into FalconX, Withdraws 12.25K $ETH ($30M)", source: "Lookonchain 72984 · 2026-09-18", expect: "HYPE whales selling" },
  { n: 6, text: "A whale has purchased 6,972 ETH over the past 9 hours, worth approximately $17.15 million.", source: "x.com/ai_9684xtpa/status/2100781924218532239 · 2026-09-18", expect: "ETH whales buying" },
  { n: 7, text: "$EDEL Surges After Edel Joins DTC Digital Asset Working Group as Whales Accumulate Nearly 8M $EDEL", source: "x.com/lookonchain/status/2099673587125014572 · 2026-09-15", expect: "EDEL whales buying" },
  { n: 8, text: "A whale built a $1.04 million position in MEME, claiming the top spot on the token's holder list.", source: "x.com/lookonchain/status/2099323718443163694 · 2026-09-14", expect: "MEME whales buying" },
  { n: 9, text: "Artificial Inu (AI) whale sells off holdings at a high price, pushing the token price down over 12% in a short time", source: "Lookonchain 72973 (Robinhood chain) · 2026-09-18", expect: "AI whales selling" },
  { n: 10, text: "Zcash whales accumulate: three fresh wallets pull 28,759 $ZEC ($41.43M) from Binance and other exchanges", source: "Lookonchain 72956 · 2026-09-18", expect: "ZEC whales buying → UNVERIFIABLE (no chain)" },
];

const withAgent = process.argv.includes("--agent");
const llm = envLlm();
const out: Record<string, unknown>[] = [];
let credits = 0;
for (const c of CLAIMS) {
  const client = cachedClientFromEnv({ ttlMs: 0 });
  const rules = extractClaim(c.text);
  const llmR = llm ? await extractWithLlm(c.text, llm) : { claim: null, status: { used: false, ms: 0, error: "no key", model: "-" } };
  const v = await rebut(client, c.text, { llm });
  credits += v.credits;
  const rec = {
    n: c.n,
    text: c.text,
    source: c.source,
    expect: c.expect,
    rules: { token: rules.token, type: rules.type, subject: rules.subject, chain: rules.chain, problem: rules.problem },
    llm: { ...llmR.claim, used: llmR.status.used, ms: llmR.status.ms, error: llmR.status.error },
    claimUsed: { token: v.claim.token, type: v.claim.type, subject: v.claim.subject, chain: v.claim.chain, extractor: v.claim.extractor },
    resolved: v.resolved ? { symbol: v.resolved.symbol, chain: v.resolved.chain, address: v.resolved.address, by: v.resolved.by, sameName: v.resolved.sameName } : null,
    label: v.label,
    ruleId: v.ruleId,
    reasons: v.reasons,
    threshold: v.threshold,
    evidence: v.evidence,
    checks: v.checks.map((k) => ({ id: k.id, ok: k.ok, ms: k.ms, error: k.error, values: k.values })),
    credits: v.credits,
    calls: v.calls,
    ms: v.ms,
    hash: v.hash,
    prose: v.prose,
    warnings: v.warnings,
  };
  out.push(rec);
  console.log(`${String(c.n).padStart(2)} ${v.label.padEnd(13)} ${v.ruleId.padEnd(9)} ${(v.claim.token ?? "?").padEnd(6)} ${(v.claim.subject ?? "?").padEnd(11)} ${(v.claim.type ?? "?").padEnd(8)} ${v.resolved ? `${v.resolved.chain}`.padEnd(9) : "-".padEnd(9)} ${String(v.credits).padStart(3)} cr ${String(v.ms).padStart(6)} ms  llm=${llmR.claim ? `${llmR.claim.token}/${llmR.claim.type}/${llmR.claim.subject}` : `miss(${llmR.status.error})`} rules=${rules.token}/${rules.type}/${rules.subject}`);
  for (const r of v.reasons) console.log(`      · ${r}`);
}
const decisive = out.filter((o) => o.label !== "UNVERIFIABLE").length;
const llmHits = out.filter((o) => (o.llm as { used: boolean }).used).length;
const rulesHits = out.filter((o) => (o.rules as { token?: string; type?: string }).token && (o.rules as { type?: string }).type).length;
const agree = out.filter((o) => {
  const l = o.llm as { token?: string; type?: string };
  const r = o.rules as { token?: string; type?: string };
  return l.token && l.token === r.token && l.type === r.type;
}).length;
const ms = out.map((o) => o.ms as number).sort((a, b) => a - b);
console.log(`\ndecisive: ${decisive}/10 · LLM extraction hits: ${llmHits}/10 · rules hits: ${rulesHits}/10 · agree on token+type: ${agree}/10 · credits: ${credits} · p50 ${ms[5]} ms · max ${ms[9]} ms`);

let agent: unknown = null;
if (withAgent) {
  const c = CLAIMS[0];
  console.log(`\nagent/fast on claim 1 (200 credits)…`);
  const marks: string[] = [];
  const a = await askNansenAgent(process.env.NANSEN_API_KEY as string, c.text, { onEvent: (e) => marks.push(`${Date.now()}:${e.type}${e.type === "tool_call" ? ":" + e.name : ""}`) });
  agent = { claim: c.text, ms: a.ms, firstByteMs: a.firstByteMs, timedOut: a.timedOut, error: a.error, toolCalls: a.toolCalls, textLength: a.text.length, text: a.text, marks };
  credits += 200;
  console.log(`agent: ${a.ms} ms, first byte ${a.firstByteMs} ms, timedOut=${a.timedOut}, tools=[${a.toolCalls.join(", ")}], text ${a.text.length} chars${a.error ? `, error: ${a.error}` : ""}`);
}
writeFileSync("spike-raw.json", JSON.stringify({ ranAt: new Date().toISOString(), decisive, llmHits, rulesHits, agree, credits, claims: out, agent }, null, 2));
console.log(`total credits this run: ${credits} → spike-raw.json`);
