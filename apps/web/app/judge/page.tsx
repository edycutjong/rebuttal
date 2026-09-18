import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/Shell";
import { PROOF } from "@/lib/proof";

/**
 * /judge — a page built for exactly one reader. No auth, no cookies, no API call, no key: prerendered at build time and
 * mirrored verbatim in JUDGE.md at the repo root. Every number below is a real-run receipt with its source next to it.
 */
export const metadata: Metadata = {
  title: "Rebuttal — for judges",
  description: "The claim, the 30-second path, the receipts, the real reproduce command, and the honest limitations.",
};

const SITE = "https://rebuttal-edycutjong.vercel.app";
const REPO = "https://github.com/edycutjong/rebuttal";
const HERO = "Smart Money is aping $PEPE hard today 🐋";
const heroUrl = `${SITE}/?q=${encodeURIComponent(HERO)}`;

export default function Judge() {
  return (
    <>
      <SiteHeader current="judge" />
      <main className="wrap judge">
        <p className="judge-kicker">
          <Link href="/">← the tool</Link> · for judges · no login, no key, no setup
        </p>
        <h1>Paste “Smart Money is buying $X”. Six Nansen calls decide whether it&apos;s true — and show their work.</h1>
        <p className="judge-lede">
          One sentence in → one of four words out (CONFIRMED · OVERSTATED · CONTRADICTED · UNVERIFIABLE) with the numbers that fired the rule, a sha256 of
          the evidence, and the full tool trace. The verdict is arithmetic over Nansen label-class flows; an LLM only reads the claim and writes two
          sentences, and a rules extractor plus a template take over when it is down. This is not a wrapper around Nansen&apos;s agent — the button that
          runs <code>agent/fast</code> prints its 200-credit price and shows the two traces side by side.
        </p>

        <h2>The 30-second path</h2>
        <ol>
          <li>
            Open{" "}
            <a href={heroUrl}>
              <code>{SITE}/?q=Smart Money is aping $PEPE…</code>
            </a>
            . The claim card reads <b>Smart Money · buying · PEPE (ethereum, most traded of the same-name tokens — 14 at the recording, 13 on 2026-09-19)</b>, six trace rows land as each call returns, and
            the verdict card turns red: <b>CONTRADICTED · C-NOBODY</b> — no Smart Money wallet traded PEPE in 24 h while 89 Smart Money traders sit on its
            table. Cold ≈ 4 s, cached ≈ 0 s.
          </li>
          <li>
            Press <b>Ask Nansen&apos;s agent</b> (200 credits, printed on the button): Nansen&apos;s own <code>agent/fast</code> streams its <code>tool_calls</code>{" "}
            into the violet panel beside our trace. Two agents, same claim, two traces.
          </li>
          <li>
            Open{" "}
            <a href={`${SITE}/?q=${encodeURIComponent("A whale sold 600,000 UNI tokens, valued at approximately $5.1 million.")}`}>
              <code>{SITE}/?q=A whale sold 600,000 UNI…</code>
            </a>
            — a claim the tool <b>CONFIRMS</b> (whale holders&apos; balances fell $548K in 24 h at the recording (fixtures/uni-whale-sold.json; $532K on the DEMO run — flows are priced live)), so it is seen agreeing, not just contradicting.
          </li>
          <li>
            Open{" "}
            <a href={`${SITE}/api/rebut?q=${encodeURIComponent(HERO)}`}>
              <code>{SITE}/api/rebut?q=…</code>
            </a>{" "}
            — the same verdict as JSON, same hash as the CLI prints.
          </li>
        </ol>

        <h2>Receipts</h2>
        <table className="judge-table">
          <tbody>
            <tr>
              <th>Hero claim, live</th>
              <td>
                <code>{HERO}</code>: <b>10 credits · 7 calls · 3.5 s cold</b> · 2026-09-18 · CONTRADICTED / C-NOBODY · hash <code>e21a8a19ae59</code> (recorded fixture; the DEMO run
                printed <code>4f3cce391567</code> before the hash record gained the whale fields) — output verbatim in <a href={`${REPO}/blob/main/DEMO.md`}>DEMO.md</a>, recorded in{" "}
                <code>fixtures/pepe-aping.json</code>
              </td>
            </tr>
            <tr>
              <th>Spike, 10 real claims</th>
              <td>
                Posts from Lookonchain / OKX feeds, 2026-09-14 → 18: <b>7/10 decisive</b>; the three UNVERIFIABLE are refusals with a reason (Zcash is not a
                Nansen chain; EDEL and MEME have no Whale-labelled wallet at all). Extraction: LLM 10/10, rules 10/10, agreeing on token and type 10/10.
              </td>
            </tr>
            <tr>
              <th>Benchmark, live</th>
              <td>
                13 claims × 2 cold runs: <b>cold p50 {PROOF.p50} · p95 5.0 s · warm p50 {PROOF.warm} · mean 10.0 credits, max 15</b> per rebuttal; 0 of 154 live
                calls failed — <a href={`${REPO}/blob/main/docs/BENCH.md`}>docs/BENCH.md</a> is the script&rsquo;s output
              </td>
            </tr>
            <tr>
              <th>Nansen endpoints</th>
              <td>
                <code>search/general</code> · <code>tgm/flow-intelligence</code> (1d + 7d) · <code>tgm/who-bought-sold</code> (BUY + SELL, Smart Money label
                filter) · <code>smart-money/netflow</code> · <code>tgm/token-ohlcv</code> · <code>tgm/holders</code> · <code>agent/fast</code> (button only) —
                every rule input is one of their response fields
              </td>
            </tr>
            <tr>
              <th>Tests</th>
              <td>
                <b>{PROOF.tests} tests</b> (vitest): the extractor on every spike claim, every rule with live-shaped evidence, the client&apos;s retry and cache,
                the SSE parser, the oEmbed path, a route boundary suite · <b>23,000 generated cases</b> on <code>decide()</code> and <code>extractClaim()</code>{" "}
                (fast-check: purity, the buying/selling mirror, never-throws)
              </td>
            </tr>
            <tr>
              <th>Determinism</th>
              <td>
                {PROOF.fixtures} recorded rebuttals replay offline with the same label, rule and hash, zero network, zero credits, zero LLM (
                <code>npm run verify</code>)
              </td>
            </tr>
            <tr>
              <th>Spend guard</th>
              <td>
                10 checks per IP per minute, 2,000 live credits per day, then recorded replays (labelled); the agent button 2 per IP and 4 per day (
                <code>apps/web/lib/guard.ts</code>)
              </td>
            </tr>
          </tbody>
        </table>

        <h2>Reproduce (real Nansen calls, one env var)</h2>
        <pre>
          <code>{`git clone ${REPO}.git && cd rebuttal
npm install
export NANSEN_API_KEY=nsn_…            # https://app.nansen.ai/api — the only required key
npm run rebuttal -- "${HERO}" --explain   # ≤ 15 credits, ~4 s
npm run verify                          # 13/13 recorded rebuttals replayed offline, 0 credits, 0 network
npm test                                # ${PROOF.tests} tests`}</code>
        </pre>
        <p>
          Optional: <code>export GROQ_API_KEY=…</code> turns on the LLM extractor and the two-sentence prose (Groq, <code>openai/gpt-oss-120b</code>); without
          it the rules extractor and the template run and the output says so. <code>--ask-nansen</code> adds the agent/fast comparison (200 credits).
        </p>

        <h2>Three limitations, stated</h2>
        <ul>
          <li>
            <b>“Smart Money” means Nansen&apos;s Smart Trader flow columns plus the Fund / Smart Trader rows named in the trace.</b> Funds have no separate
            flow-intelligence column; the who-bought-sold filter covers them.
          </li>
          <li>
            <b>Nansen&apos;s Whale label is sparse.</b> A post&apos;s “whale” is often a big wallet Nansen does not tag; when no Whale-labelled wallet exists in the
            token the tool says UNVERIFIABLE rather than pretending a CONTRADICTED.
          </li>
          <li>
            <b>Net flows are priced at current rates and drift by the minute.</b> The hash covers integers of the numbers that decided the label; a fixture
            replay always matches, a live re-run usually does, and the label holds.
          </li>
        </ul>

        <h2>Links</h2>
        <ul>
          <li>
            Repo: <a href={REPO}>{REPO}</a> (public at submission)
          </li>
          <li>
            Rules: <a href={`${REPO}/blob/main/docs/SCORING.md`}>docs/SCORING.md</a> · Architecture: <a href={`${REPO}/blob/main/ARCHITECTURE.md`}>ARCHITECTURE.md</a> · DX
            report: <a href={`${REPO}/blob/main/docs/DX-REPORT.md`}>docs/DX-REPORT.md</a>
          </li>
          <li>
            Built by <a href="https://x.com/edycutjong">@edycutjong</a> for the Nansen Meridian Buildathon, September 2026.
          </li>
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
