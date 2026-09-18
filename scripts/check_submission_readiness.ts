/**
 * Submission readiness: the repo a judge clones must have no placeholders, a README whose claims match the tree
 * (test count, fixture count, proof numbers), every mandatory file, no kitchen file or key anywhere in the history,
 * and the judge's reproduce command must be the live path. Exit 1 on any failure.
 *
 *   npm run check
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fails: string[] = [];
const ok = (cond: unknown, msg: string) => {
  if (!cond) fails.push(msg);
  else console.log(`✔ ${msg}`);
};
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

const MUST = [
  "README.md",
  "DEMO.md",
  "ARCHITECTURE.md",
  "JUDGE.md",
  "LICENSE",
  ".env.example",
  "docs/SCORING.md",
  "docs/BENCH.md",
  "docs/DX-REPORT.md",
  "docs/assets/icon.svg",
  "docs/assets/icon-animated.svg",
  "docs/assets/readme-hero-animated.svg",
  ".github/workflows/ci.yml",
  ".github/dependabot.yml",
  ".github/SECURITY.md",
  ".github/CONTRIBUTING.md",
  ".github/CODE_OF_CONDUCT.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
  "scripts/spike.ts",
  "scripts/seed.ts",
  "scripts/verify.ts",
  "scripts/bench.ts",
  "packages/core/src/decide.ts",
  "packages/core/src/rebut.ts",
  "packages/core/test/property.test.ts",
  "packages/core/test/guard.test.ts",
  "packages/cli/src/cli.ts",
  "apps/web/app/page.tsx",
  "apps/web/app/judge/page.tsx",
  "apps/web/app/api/rebut/route.ts",
  "apps/web/app/api/agent/route.ts",
  "apps/web/app/api/og/route.tsx",
  "apps/web/lib/guard.ts",
];
for (const f of MUST) ok(existsSync(f), `exists: ${f}`);

const readme = read("README.md");
for (const bad of ["TODO", "TBD", "lorem", "xxx", "PLACEHOLDER", "<your", "coming soon"]) ok(!new RegExp(bad, "i").test(readme), `README has no "${bad}"`);
for (const section of ["Run it in under 10 minutes", "Nansen Integration", "Honesty", "Why only Nansen", "Honest limits"]) ok(readme.includes(section), `README section: ${section}`);

// test count claimed in README = tests vitest actually runs, taken from vitest's JSON reporter
const claimed = Number((readme.match(/tests-(\d+)%20passing/) ?? [])[1] ?? 0);
const report = join(tmpdir(), `rebuttal-vitest-${process.pid}.json`);
let actual = -1;
let passed = -2;
try {
  execSync(`npx vitest run --reporter=json --outputFile=${report}`, { stdio: "ignore" });
  const vitest = JSON.parse(readFileSync(report, "utf8")) as { numTotalTests: number; numPassedTests: number };
  actual = vitest.numTotalTests;
  passed = vitest.numPassedTests;
} catch (e) {
  fails.push(`vitest JSON report could not be produced/parsed: ${(e as Error).message.slice(0, 120)}`);
}
ok(passed === actual, `all ${actual} tests pass`);
ok(claimed === actual, `README badge claims ${claimed} tests; vitest runs ${actual}`);
ok(readme.includes(`**${actual} tests**`), `README prose states ${actual} tests`);
ok(read("JUDGE.md").includes(`**${actual} tests**`), `JUDGE.md states ${actual} tests`);
ok(read("apps/web/lib/proof.ts").includes(`tests: ${actual},`), `apps/web/lib/proof.ts states ${actual} tests`);

const fixtures = readdirSync("fixtures").filter((f) => f.endsWith(".json")).length;
// the offline replay must be green — a rule change without `verify --update` is exactly the drift this gate exists for (review finding #2)
try {
  const out = execSync("npx tsx scripts/verify.ts", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  ok(out.includes(`${fixtures}/${fixtures} verdicts reproduced offline`), `verify: ${fixtures}/${fixtures} reproduced offline`);
} catch {
  fails.push("verify: the offline replay is not green — run `npm run verify` (and `-- --update` after an intentional rule change)");
}
ok(readme.includes(`${fixtures}%2F${fixtures}`), `README badge says ${fixtures}/${fixtures} fixtures`);
ok(read("apps/web/lib/proof.ts").includes(`fixtures: ${fixtures},`), `proof.ts says ${fixtures} fixtures`);

// the judge's reproduce command is the live path — the offline flag may appear only in the verify line
for (const f of ["JUDGE.md", "apps/web/app/judge/page.tsx"]) {
  const lines = read(f).split("\n").filter((l) => /NANSEN_OFFLINE/.test(l));
  ok(lines.every((l) => /verify/.test(l)), `${f}: NANSEN_OFFLINE only next to verify (${lines.length} mention(s))`);
}

// kitchen and secrets never in the tree that is committed
const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n");
for (const bad of ["CLAUDE.md", "AGENTS.md", ".claude/", "specs/", "PROGRESS.md", "DEVIATIONS.md", "project.json", ".env", ".cache/", ".vercel/", "spike-raw"])
  ok(!tracked.filter((f) => f !== ".env.example").some((f) => f === bad || f.startsWith(bad) || f.includes(`/${bad}`)), `not tracked: ${bad}`);
const leaks = execSync("git log -p --all | grep -c 'nsn_[A-Za-z0-9]\\{20,\\}\\|gsk_[A-Za-z0-9]\\{20,\\}' || true", { encoding: "utf8" }).trim();
ok(leaks === "0", `no Nansen or Groq key in git history (${leaks} hits)`);
for (const f of readdirSync("fixtures")) ok(!/nsn_[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}/.test(read(`fixtures/${f}`)), `fixture clean: ${f}`);
const kitchenInHistory = execSync("git log --all --name-only --pretty=format: | sort -u | grep -E '^(specs/|PROGRESS|DEVIATIONS|CLAUDE|AGENTS|project.json|\\.claude/)' || true", { encoding: "utf8" }).trim();
ok(kitchenInHistory === "", `no kitchen file ever committed (${kitchenInHistory.split("\n").filter(Boolean).length} hits)`);

// screenshots and assets referenced by the README exist
for (const m of readme.matchAll(/docs\/(screenshots|assets)\/([\w.-]+)/g)) ok(existsSync(`docs/${m[1]}/${m[2]}`), `file: docs/${m[1]}/${m[2]}`);

// links resolve (network; CHECK_LINKS=1)
if (process.env.CHECK_LINKS === "1") {
  const links = [...new Set([...readme.matchAll(/\]\((https?:[^)\s]+)\)/g)].map((m) => m[1]))];
  for (const url of links) {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow" });
      ok(res.status < 400, `link ${res.status}: ${url}`);
    } catch (e) {
      fails.push(`link failed: ${url} (${(e as Error).message})`);
    }
  }
}

console.log(fails.length ? `\n✖ ${fails.length} problem(s):\n${fails.map((f) => `  - ${f}`).join("\n")}` : `\nready: ${MUST.length} files, ${actual} tests, ${fixtures} fixtures, history clean`);
process.exit(fails.length ? 1 : 0);
