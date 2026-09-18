/**
 * Replay every fixture with the network disabled (NANSEN_OFFLINE=1) and no LLM, through the same rebut() the CLI and the
 * web use, and assert that the label, the rule and the hash come out identical. 0 credits, 0 network.
 * `npm run verify` · `npm run verify -- --update` rewrites each fixture's verdict from its untouched recorded responses
 * (for output-only engine changes; the responses are never modified).
 */
import { CachedNansenClient, rebut, listFixtures, readFixture, fixtureStore, writeFixture } from "@rebuttal/core";

process.env.NANSEN_OFFLINE = "1";
const update = process.argv.includes("--update");
const files = listFixtures();
if (files.length === 0) {
  console.error("no fixtures — run `npm run seed` first");
  process.exit(1);
}
let ok = 0;
let network = 0;
const fetchImpl: typeof fetch = async () => {
  network++;
  throw new Error("network disabled");
};
for (const path of files) {
  const f = readFixture(path);
  const client = new CachedNansenClient("nsn_offline_replay_no_network", { store: fixtureStore(f), offline: true, fetchImpl });
  const v = await rebut(client, f.input, { llm: null, now: f.now, chain: f.options.chain, claim: f.claim, fetchImpl });
  const same = v.label === f.verdict.label && v.ruleId === f.verdict.ruleId && v.hash === f.verdict.hash;
  const liveCalls = v.provenance.filter((c) => !c.cached).length;
  if (same && liveCalls === 0) ok++;
  else if (update) {
    writeFixture({ ...f, verdict: v });
    console.log(`  updated ${f.slug}: ${f.verdict.label}/${f.verdict.ruleId} ${f.verdict.hash.slice(0, 12)} → ${v.label}/${v.ruleId} ${v.hash.slice(0, 12)}`);
    ok++;
  }
  console.log(`${same && liveCalls === 0 ? "✔" : "✖"} ${f.slug.padEnd(28)} ${v.label.padEnd(13)} ${v.ruleId.padEnd(10)} ${v.hash.slice(0, 12)} ${v.provenance.length} cached calls · 0 credits${same ? "" : ` (recorded ${f.verdict.label}/${f.verdict.ruleId} ${f.verdict.hash.slice(0, 12)})`}`);
}
console.log(`\n${ok}/${files.length} verdicts reproduced offline · network calls attempted: ${network}`);
process.exit(ok === files.length && network === 0 ? 0 : 1);
