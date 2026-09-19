// smoke.mjs — end-to-end smoke of the built web app. Node only, no deps, no browser.
//
//   npm run e2e                       build → `next start` on a free port → hit every route → stop   (no key: asserts the honest no-key path)
//   npm run e2e -- --url https://…    the same checks against a running deployment (nothing is started)
//   … --live                          also runs the hero claim through /api/rebut and checks the verdict shape (10–15 credits, 0 on a warm cache)
//
// Routes and what "green" means without a key: `/` and `/judge` render (200, the brand + the footer version), `/api/og`
// is a PNG (the data-free card), `/c?q=` renders the shell, `/api/rebut` answers 400 without a claim and a JSON error —
// never a stack trace — without a key, `/api/agent` refuses GET (405). With `--live` the hero claim must come back as a
// verdict: one of the four labels, a 64-hex hash, numeric credits and calls, and at least one check row. The hero claim
// runs FIRST so the OG card (same claim) is a cache hit — one live rebuttal per cold instance, not two.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import process from "node:process";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const HERO = "Smart Money is aping $PEPE hard today 🐋";
const LABELS = new Set(["CONFIRMED", "OVERSTATED", "CONTRADICTED", "UNVERIFIABLE"]);
const version = `v${JSON.parse(readFileSync("package.json", "utf8")).version}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function freePort() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}
const get = async (base, path, init = {}) => {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60_000);
  try {
    const r = await fetch(base + path, { redirect: "manual", signal: ac.signal, ...init });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get("content-type") ?? "", buf, text: buf.toString("utf8") };
  } finally {
    clearTimeout(t);
  }
};
async function waitFor(base, ms = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await get(base, "/judge")).status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${base} did not answer within ${ms} ms`);
}

async function run(base, { live, hasKey }) {
  if (live) {
    const t0 = Date.now();
    const r = await get(base, `/api/rebut?q=${encodeURIComponent(HERO)}`);
    let v = {};
    try {
      v = JSON.parse(r.text);
    } catch {
      /* not JSON */
    }
    const ok = r.status === 200 && LABELS.has(v.label) && /^[0-9a-f]{64}$/.test(v.hash ?? "") && typeof v.credits === "number" && typeof v.calls === "number" && Array.isArray(v.checks) && v.checks.length > 0;
    check("hero claim → verdict (live)", ok, `${r.status} ${v.label ?? v.error ?? ""} ${v.ruleId ?? ""} · ${v.credits ?? "?"} credits · ${v.calls ?? "?"} calls · ${v.checks?.length ?? 0} checks · ${Date.now() - t0} ms`);
  }
  const home = await get(base, "/");
  check("GET / renders", home.status === 200 && /rebuttal/i.test(home.text), `${home.status}`);
  check("GET / footer shows the package version", home.text.includes(version), version);
  // the Nansen call rail is server-rendered with the recorded example's calls (replayed · 0 cr) — the empty page already shows the shape
  const railRows = (home.text.match(/class="rail-row replayed call"/g) ?? []).length;
  check("GET / serves the Nansen call rail with the example's replayed calls", home.text.includes('aria-label="Nansen API calls"') && railRows >= 6, `${railRows} replayed rows`);
  const judge = await get(base, "/judge");
  check("GET /judge renders", judge.status === 200 && /judge/i.test(judge.text), `${judge.status}`);
  const og = await get(base, `/api/og?q=${encodeURIComponent(HERO)}`);
  check("GET /api/og is a PNG", og.status === 200 && og.type.startsWith("image/png") && og.buf.length > 1000, `${og.status} ${og.type} ${og.buf.length} B`);
  const c = await get(base, `/c?q=${encodeURIComponent(HERO)}`);
  check("GET /c?q= renders", c.status === 200 && /rebuttal/i.test(c.text), `${c.status}`);
  const noq = await get(base, "/api/rebut");
  check("GET /api/rebut without a claim is 400 JSON", noq.status === 400 && noq.type.includes("json"), `${noq.status}`);
  const agent = await get(base, "/api/agent");
  check("GET /api/agent is 405 (POST only)", agent.status === 405, `${agent.status}`);
  if (!hasKey) {
    const r = await get(base, `/api/rebut?q=${encodeURIComponent(HERO)}`);
    let body = {};
    try {
      body = JSON.parse(r.text);
    } catch {
      /* not JSON */
    }
    check("GET /api/rebut without a key is an honest JSON 500", r.status === 500 && /NANSEN_API_KEY/.test(body.error ?? ""), `${r.status} ${body.error ?? r.text.slice(0, 80)}`);
  }
}

const main = async () => {
  const live = flag("--live");
  const url = opt("--url");
  let child;
  let base = url;
  if (!base) {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn("npx", ["next", "start", "-p", String(port)], { cwd: "apps/web", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PORT: String(port) } });
    child.stdout.on("data", () => {});
    child.stderr.on("data", (d) => process.stderr.write(d));
    await waitFor(base);
  }
  try {
    await run(base, { live, hasKey: url ? true : Boolean(process.env.NANSEN_API_KEY) });
  } finally {
    child?.kill("SIGTERM");
  }
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n✖ ${failed.length} of ${results.length} checks failed` : `\nsmoke: ${results.length}/${results.length} green at ${base}`);
  process.exit(failed.length ? 1 : 0);
};
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
