// release.mjs [--dry-run] — the same algorithm as .github/workflows/release.yml, run from a laptop.
//
// Exists because GitHub Actions can be unavailable to a repo (billing hold, private-repo minutes) while a release
// still has to be cut. Steps, identical to the workflow:
//   1. last `v*` tag (none → 0.0.0, all commits count)
//   2. Conventional Commits since that tag: "!" / "BREAKING CHANGE" → major · feat → minor · fix/perf → patch · else none
//   3. node scripts/bump-version.mjs <x.y.z>  (root + every workspace package.json + the lockfile entries)
//   4. npm ci --ignore-scripts               (proves the lockfile still satisfies npm ci)
//   5. commit "chore(release): vX.Y.Z [skip ci]", annotated tag, push both, `gh release create --generate-notes`
// Requires: clean working tree, on main, main == origin/main, `gh` authenticated. No deps.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

const dryRun = process.argv.includes("--dry-run");
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
const git = (...args) => sh("git", args);
const fail = (msg) => {
  process.stderr.write(`release: ${msg}\n`);
  process.exit(1);
};

// preconditions
if (!existsSync("package.json") || !existsSync("scripts/bump-version.mjs")) fail("run from the repo root");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "main") fail(`on ${branch}, releases are cut from main`);
if (!dryRun) {
  if (git("status", "--porcelain") !== "") fail("working tree is not clean");
  git("fetch", "origin", "main", "--tags");
  if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) fail("main != origin/main — push or pull first");
}

// 1 · last tag
let last = "";
try {
  last = git("describe", "--tags", "--abbrev=0", "--match", "v*");
} catch {
  last = "";
}
const cur = last ? last.slice(1) : "0.0.0";
const range = last ? [`${last}..HEAD`] : [];

// 2 · bump from Conventional Commits (same regexes as the workflow, applied line by line to the full bodies)
const log = git("log", "--format=%B", ...range);
if (log.replace(/\s/g, "") === "") {
  console.log(`No commits since ${last || "the beginning"} — nothing to release.`);
  process.exit(0);
}
const lines = log.split("\n");
const has = (re) => lines.some((l) => re.test(l));
let bump = "none";
if (has(/^[a-z]+(\(.+\))?!:/) || has(/^BREAKING CHANGE:/)) bump = "major";
else if (has(/^feat(\(.+\))?:/)) bump = "minor";
else if (has(/^(fix|perf)(\(.+\))?:/)) bump = "patch";
if (bump === "none") {
  console.log(`No releasable commits since ${last || "the beginning"} (feat/fix/perf/BREAKING) — nothing to release.`);
  process.exit(0);
}
let [ma, mi, pa] = cur.split(".").map(Number);
if (bump === "major") [ma, mi, pa] = [ma + 1, 0, 0];
else if (bump === "minor") [mi, pa] = [mi + 1, 0];
else pa += 1;
const next = `v${ma}.${mi}.${pa}`;
console.log(`Bump: ${bump}  ${last || "none"} -> ${next}`);
const releasable = lines.filter((l) => /^([a-z]+(\(.+\))?!?:|BREAKING CHANGE:)/.test(l));
console.log(releasable.map((l) => `  ${l}`).join("\n"));

if (dryRun) {
  console.log(`\n--dry-run: would bump every package.json + lockfile to ${next.slice(1)}, run npm ci --ignore-scripts,`);
  console.log(`commit "chore(release): ${next} [skip ci]", tag ${next}, push, and gh release create ${next} --generate-notes.`);
  process.exit(0);
}

// 3 · bump versions offline
process.stdout.write(sh("node", ["scripts/bump-version.mjs", next.slice(1)]) + "\n");

// 4 · prove the lockfile
sh("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { stdio: ["ignore", "ignore", "inherit"] });
console.log(git("diff", "--stat", "--", "package.json", "package-lock.json", "apps/*/package.json", "packages/*/package.json"));

// 5 · commit, tag, push, publish
git("add", "-A");
git("commit", "-q", "-m", `chore(release): ${next} [skip ci]`);
git("tag", "-a", next, "-m", next);
git("push", "origin", "HEAD:main");
git("push", "origin", next);
sh("gh", ["release", "create", next, "--generate-notes", "--title", next], { stdio: ["ignore", "inherit", "inherit"] });
console.log(`Released ${next} (${bump})`);
