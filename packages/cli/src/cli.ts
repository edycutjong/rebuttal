#!/usr/bin/env tsx
import { cachedClientFromEnv, rebut, rebuttalText, askNansenAgent, AGENT_CREDITS, fmtUsd, envLlm, type RebutEvent, type Verdict } from "@rebuttal/core";

const USAGE = `rebuttal — fact-check "Smart Money is buying $X" against Nansen

  npm run rebuttal -- "<claim text or x.com URL>" [--chain ethereum] [--json] [--explain] [--no-cache] [--no-llm] [--ask-nansen]

  --chain <id>   force the chain (ethereum, solana, base, bnb, arbitrum, polygon, hyperevm, robinhood, …)
  --json         print the full Verdict JSON (claim, evidence, checks, provenance, hash)
  --explain      print every Nansen call and the rule arithmetic
  --no-cache     ignore the 1-hour cache (every call is live and costs credits)
  --no-llm       rules extractor + template prose only (what verify/CI use)
  --ask-nansen   also run the claim through Nansen's own agent/fast (${AGENT_CREDITS} credits) and print its tool list

Env: NANSEN_API_KEY (required) · GROQ_API_KEYS or GROQ_API_KEY (optional; without it the rules extractor decides)`;

const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const val = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--chain");
const input = positional.join(" ").trim();
if (!input || flag("--help") || flag("-h")) {
  console.log(USAGE);
  process.exit(input ? 0 : 1);
}
if (!process.env.NANSEN_API_KEY) {
  console.error("NANSEN_API_KEY is not set — get one at https://app.nansen.ai/api and `export NANSEN_API_KEY=nsn_…`");
  process.exit(2);
}

const json = flag("--json");
const explain = flag("--explain");
const client = cachedClientFromEnv({ ttlMs: flag("--no-cache") ? 0 : undefined });
const llm = flag("--no-llm") ? null : envLlm();
const color = process.stdout.isTTY && !json;
const paint = (s: string, code: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const LABEL_COLOR: Record<string, string> = { CONFIRMED: "32", OVERSTATED: "33", CONTRADICTED: "31", UNVERIFIABLE: "90" };

const onProgress = (e: RebutEvent) => {
  if (json) return;
  if (e.type === "input" && e.fromUrl) console.log(paint(`tweet by @${e.author}: `, "90") + e.text);
  if (e.type === "claim") {
    const c = e.claim;
    console.log(paint("claim  ", "90") + `${c.subject === "whales" ? "Whales" : "Smart Money"} ${c.type ?? "?"} · token ${c.token ?? "?"}${c.chain ? ` · chain ${c.chain}` : ""} · extracted by ${c.extractor}${c.problem ? ` · ${c.problem}` : ""}`);
  }
  if (e.type === "resolved" && e.resolved) {
    const r = e.resolved;
    console.log(paint("token  ", "90") + `${r.symbol} · ${r.chain} ${r.address} · ${r.by}${r.sameName > 1 ? ` of ${r.sameName} same-name` : ""} · plan: ${e.plan?.length ?? 0} checks, ${e.plan?.reduce((n, p) => n + p.credits, 0) ?? 0} credits`);
  }
  if (e.type === "check") {
    const c = e.check;
    const vals = Object.entries(c.values)
      .map(([k, v]) => `${k}=${typeof v === "number" && Math.abs(v) >= 1000 ? fmtUsd(v) : String(v)}`)
      .join(" ");
    console.log(`  ${c.ok ? paint("✔", "32") : paint("✖", "31")} ${c.endpoint.padEnd(22)} ${c.window.padEnd(12)} ${String(c.credits).padStart(3)} cr ${String(c.ms).padStart(5)} ms${c.cached ? " cached" : ""}  ${c.ok ? vals : paint(c.error ?? "failed", "31")}`);
  }
};

let v: Verdict;
try {
  v = await rebut(client, input, { chain: val("--chain"), llm, onProgress });
} catch (e) {
  // rebut() throws only when search/general itself fails — say so in one line instead of a stack trace
  console.error(paint(`Nansen search failed: ${(e as Error).message.slice(0, 160)} — try again in a minute`, "31"));
  process.exit(3);
}
if (flag("--ask-nansen") && v.resolved) {
  if (!json) console.log(paint(`\nasking Nansen's agent (agent/fast, ${AGENT_CREDITS} credits)…`, "90"));
  v.agent = await askNansenAgent(process.env.NANSEN_API_KEY as string, v.claim.raw, {
    onEvent: (e) => {
      if (!json && e.type === "tool_call") console.log(paint(`  agent tool_call: ${e.name}`, "35"));
    },
  });
}

if (json) {
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}
console.log();
console.log(paint(` ${v.label} `, `1;${LABEL_COLOR[v.label]};7`) + ` ${paint(v.ruleId, "90")}`);
for (const r of v.reasons) console.log(`  · ${r}`);
console.log(`  ${paint(v.prose.text, "1")} ${paint(`(${v.prose.source})`, "90")}`);
for (const w of v.warnings) console.log(paint(`  ⚠ ${w}`, "33"));
console.log(paint(`  ${v.credits} credits · ${v.calls} calls · ${(v.ms / 1000).toFixed(1)} s · hash ${v.hash.slice(0, 12)}`, "90"));
if (v.agent) {
  const a = v.agent;
  console.log(paint(`\nNansen's agent (${a.credits} credits, ${(a.ms / 1000).toFixed(1)} s${a.timedOut ? ", timed out" : ""}${a.error ? `, ${a.error}` : ""})`, "35"));
  console.log(`  tools: ${a.toolCalls.length ? a.toolCalls.join(", ") : "(none reported)"}`);
  if (a.text) console.log(`  ${a.text.replace(/\s+/g, " ").slice(0, 600)}${a.text.length > 600 ? "…" : ""}`);
}
if (explain) {
  console.log(paint("\nrules", "90"));
  console.log(`  threshold T = max(${fmtUsd(v.rules.floorUsd)}, ${v.rules.shareOfFlow * 100}% × Σ|labelled net flow 1d|) = ${fmtUsd(v.threshold)} · stale ≥ ${v.rules.staleMove * 100}% · min wallets ${v.rules.minWallets} (whales ${v.rules.minWhales}) · min holders ${v.rules.minHolders} · min checks ${v.rules.minChecks}`);
  console.log(paint("provenance", "90"));
  for (const c of v.provenance)
    console.log(`  ${c.ok ? "✔" : "✖"} ${c.endpoint.padEnd(22)} ${String(c.credits).padStart(3)} cr ${String(c.ms).padStart(5)} ms ${c.cached ? "cached" : "live  "} ${c.responseHash.slice(0, 12) || "-"}  ${c.fieldsUsed.slice(0, 3).join(", ")}${c.error ? ` · ${c.error}` : ""}`);
  console.log(paint("\ncopy this", "90"));
  console.log(rebuttalText(v));
}
