/**
 * Record the fixture set live: every raw Nansen response the rebuttal touched (byte-for-byte), the claim as extracted
 * (LLM if available — replay never needs it), the clock, and the verdict. `npm run seed [-- slug…]`.
 * Costs ≤ 15 credits per fixture. Responses are never edited.
 */
import { CachedNansenClient, MemoryCache, rebut, writeFixture, envLlm, type Fixture } from "@rebuttal/core";
import { FIXTURE_SET } from "./fixture-set";

const key = process.env.NANSEN_API_KEY ?? "";
if (!key) {
  console.error("NANSEN_API_KEY is not set");
  process.exit(2);
}
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const set = only.length ? FIXTURE_SET.filter((f) => only.includes(f.slug)) : FIXTURE_SET;
const llm = envLlm();
let credits = 0;
let calls = 0;
for (const f of set) {
  const store = new MemoryCache();
  const client = new CachedNansenClient(key, { store, ttlMs: 0 }); // ttl 0: always live, but every response is captured in the store
  const now = Date.now();
  const v = await rebut(client, f.input, { llm, now, chain: f.chain });
  const fixture: Fixture = {
    slug: f.slug,
    edge: f.edge,
    input: f.input,
    source: f.source,
    claim: v.claim,
    options: f.chain ? { chain: f.chain } : {},
    now,
    recordedAt: new Date(now).toISOString(),
    live: { calls: v.calls, credits: v.credits, ms: v.ms },
    responses: store.entries(),
    verdict: v,
  };
  const path = writeFixture(fixture);
  credits += v.credits;
  calls += v.calls;
  console.log(`${f.slug.padEnd(28)} ${v.label.padEnd(13)} ${v.ruleId.padEnd(10)} ${String(v.credits).padStart(3)} cr ${String(v.calls).padStart(2)} calls ${String(v.ms).padStart(5)} ms  ${v.hash.slice(0, 12)}  → ${path}`);
}
console.log(`\n${set.length} fixtures · ${credits} credits · ${calls} calls`);
