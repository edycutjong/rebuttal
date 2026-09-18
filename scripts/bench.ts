/**
 * Latency + credits per rebuttal, live. `npm run bench [-- --runs 3]` runs the fixture set cold (no cache, every call
 * live) N times and warm (second pass on the same in-memory cache) once, and writes docs/BENCH.md. Costs runs × Σ credits.
 */
import { writeFileSync } from "node:fs";
import { CachedNansenClient, MemoryCache, rebut, envLlm } from "@rebuttal/core";
import { FIXTURE_SET } from "./fixture-set";

const key = process.env.NANSEN_API_KEY ?? "";
if (!key) {
  console.error("NANSEN_API_KEY is not set");
  process.exit(2);
}
const runsArg = process.argv.indexOf("--runs");
const RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 2;
const llm = envLlm();
const p = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};

type Row = { slug: string; label: string; ms: number; credits: number; calls: number; failed: number; extractor: string; prose: string; llmMs: number };
const cold: Row[] = [];
const warm: Row[] = [];
const started = new Date().toISOString();
for (let r = 0; r < RUNS; r++) {
  for (const f of FIXTURE_SET) {
    const store = new MemoryCache();
    const c1 = new CachedNansenClient(key, { store, ttlMs: 0 });
    const v = await rebut(c1, f.input, { llm, chain: f.chain });
    cold.push({ slug: f.slug, label: v.label, ms: v.ms, credits: v.credits, calls: v.calls, failed: v.provenance.filter((x) => !x.ok).length, extractor: v.claim.extractor, prose: v.prose.source, llmMs: (v.llm.extract?.ms ?? 0) + (v.llm.narrate?.ms ?? 0) });
    if (r === 0) {
      const c2 = new CachedNansenClient(key, { store }); // same store, default TTL → every call is a hit
      const w = await rebut(c2, f.input, { llm: null, chain: f.chain, claim: v.claim });
      warm.push({ slug: f.slug, label: w.label, ms: w.ms, credits: w.credits, calls: w.calls, failed: 0, extractor: w.claim.extractor, prose: w.prose.source, llmMs: 0 });
    }
    process.stdout.write(`${f.slug.padEnd(28)} run ${r + 1} ${v.label.padEnd(13)} ${String(v.ms).padStart(5)} ms ${String(v.credits).padStart(3)} cr\n`);
  }
}
const live = cold.filter((x) => x.calls > 0);
const totalCredits = cold.reduce((n, x) => n + x.credits, 0);
const lines = [
  `# Benchmark — Rebuttal`,
  ``,
  `Live run started ${started} · \`npm run bench -- --runs ${RUNS}\` · ${FIXTURE_SET.length} claims × ${RUNS} cold runs + 1 warm pass · LLM ${llm ? "on (Groq gpt-oss-120b)" : "off"}.`,
  `Cold = empty cache, every Nansen call live (\`ttlMs: 0\`). Warm = second pass on the same in-memory cache, no LLM (what a permalink or a repeat query costs).`,
  ``,
  `| | p50 | p95 | max | mean credits | mean calls | failed calls | n |`,
  `|---|---|---|---|---|---|---|---|`,
  `| cold, all ${FIXTURE_SET.length} claims | ${p(cold.map((x) => x.ms), 0.5)} ms | ${p(cold.map((x) => x.ms), 0.95)} ms | ${Math.max(...cold.map((x) => x.ms))} ms | ${(totalCredits / cold.length).toFixed(1)} | ${(cold.reduce((n, x) => n + x.calls, 0) / cold.length).toFixed(1)} | ${cold.reduce((n, x) => n + x.failed, 0)} / ${cold.reduce((n, x) => n + x.calls, 0)} | ${cold.length} |`,
  `| cold, claims that reach Nansen | ${p(live.map((x) => x.ms), 0.5)} ms | ${p(live.map((x) => x.ms), 0.95)} ms | ${Math.max(...live.map((x) => x.ms))} ms | ${(live.reduce((n, x) => n + x.credits, 0) / live.length).toFixed(1)} | ${(live.reduce((n, x) => n + x.calls, 0) / live.length).toFixed(1)} | — | ${live.length} |`,
  `| warm (cache hit) | ${p(warm.map((x) => x.ms), 0.5)} ms | ${p(warm.map((x) => x.ms), 0.95)} ms | ${Math.max(...warm.map((x) => x.ms))} ms | 0 | ${(warm.reduce((n, x) => n + x.calls, 0) / warm.length).toFixed(1)} | 0 | ${warm.length} |`,
  ``,
  `LLM share of a cold rebuttal (extract + narrate, sequential): p50 ${p(cold.map((x) => x.llmMs), 0.5)} ms · extraction by LLM ${cold.filter((x) => x.extractor === "llm").length}/${cold.length} · prose by LLM ${cold.filter((x) => x.prose === "llm").length}/${cold.length}. Total credits this bench: **${totalCredits}**.`,
  ``,
  `## Per claim (cold, last run)`,
  `| claim | label | ms | credits | calls | failed | extractor | prose |`,
  `|---|---|---|---|---|---|---|---|`,
  ...cold.slice(-FIXTURE_SET.length).map((x) => `| ${x.slug} | ${x.label} | ${x.ms} | ${x.credits} | ${x.calls} | ${x.failed} | ${x.extractor} | ${x.prose} |`),
  ``,
  `Reproduce: \`export NANSEN_API_KEY=… && npm run bench\` (≈ ${totalCredits / RUNS} credits per run). Numbers move with Nansen's latency by the minute; the credits do not.`,
  ``,
];
writeFileSync("docs/BENCH.md", lines.join("\n"));
console.log(lines.slice(4, 12).join("\n"));
console.log(`\n→ docs/BENCH.md · ${totalCredits} credits`);
