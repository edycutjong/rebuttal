# For the judge

Mirror of <https://rebuttal.edycu.dev/judge> — no login, no key, no setup.

**Paste "Smart Money is buying $X". Six Nansen calls decide whether it's true — and show their work.**

One sentence in → one of four words out (CONFIRMED · OVERSTATED · CONTRADICTED · UNVERIFIABLE) with the numbers that fired the rule, a sha256 of the evidence, and the full tool trace. The verdict is arithmetic over Nansen label-class flows; an LLM only reads the claim and writes two sentences, and a rules extractor plus a template take over when it is down. This is not a wrapper around Nansen's agent — the button that runs `agent/fast` prints its 200-credit price and shows the two traces side by side.

## The 30-second path

1. Open <https://rebuttal.edycu.dev/?q=Smart%20Money%20is%20aping%20%24PEPE%20hard%20today%20%F0%9F%90%8B>. The claim card reads **Smart Money · buying · PEPE (ethereum, most traded of the same-name tokens — 14 at the recording, 13 on 2026-09-19)**, six trace rows land as each call returns, and the verdict card turns red: **CONTRADICTED · C-NOBODY** — no Smart Money wallet traded PEPE in 24 h while 89 Smart Money traders sit on its table. Cold ≈ 4 s, cached ≈ 0 s.
2. Press **Ask Nansen's agent** (200 credits, printed on the button): Nansen's own `agent/fast` streams its `tool_calls` into the violet panel beside our trace. Two agents, same claim, two traces.
3. Open <https://rebuttal.edycu.dev/?q=A%20whale%20sold%20600%2C000%20UNI%20tokens%2C%20valued%20at%20approximately%20%245.1%20million.> — a claim the tool **CONFIRMS** (whale holders' balances fell $548K in 24 h at the recording (fixtures/uni-whale-sold.json; $532K on the DEMO run — flows are priced live)), so it is seen agreeing, not just contradicting.
4. Open <https://rebuttal.edycu.dev/api/rebut?q=Smart%20Money%20is%20aping%20%24PEPE%20hard%20today%20%F0%9F%90%8B> — the same verdict as JSON, same hash as the CLI prints.

## Receipts

| | |
|---|---|
| Hero claim, live | `Smart Money is aping $PEPE hard today 🐋`: **10 credits · 7 calls · 3.5 s cold** · 2026-09-18 · CONTRADICTED / C-NOBODY · hash `e21a8a19ae59` (recorded fixture; the DEMO run printed `4f3cce391567` before the hash record gained the whale fields) — output verbatim in [DEMO.md](DEMO.md), recorded in `fixtures/pepe-aping.json` |
| Spike, 10 real claims | Posts from Lookonchain / OKX feeds, 2026-09-14 → 18: **7/10 decisive**; the three UNVERIFIABLE are refusals with a reason (Zcash is not a Nansen chain; EDEL and MEME have no Whale-labelled wallet at all). Extraction: LLM 10/10, rules 10/10, agreeing on token and type 10/10 |
| Benchmark, live | 13 claims × 2 cold runs: **cold p50 4.0 s · p95 5.0 s · warm p50 2 ms · mean 10.0 credits, max 15** per rebuttal; 0 of 154 live calls failed — [docs/BENCH.md](docs/BENCH.md) is the script's output |
| Nansen endpoints | `search/general` · `tgm/flow-intelligence` (1d + 7d) · `tgm/who-bought-sold` (BUY + SELL, Smart Money label filter) · `smart-money/netflow` · `tgm/token-ohlcv` · `tgm/holders` · `agent/fast` (button only) — every rule input is one of their response fields |
| Tests | **339 tests** (vitest): the extractor on every spike claim, every rule with live-shaped evidence, the client's retry and cache, the SSE parser, the oEmbed path, a route boundary suite · **100% statements/branches/functions/lines** on `packages/core/src` (enforced by `vitest.config.ts` coverage thresholds) · **23,000 generated cases** on `decide()` and `extractClaim()` (fast-check: purity, the buying/selling mirror, never-throws) |
| Determinism | 13 recorded rebuttals replay offline with the same label, rule and hash, zero network, zero credits, zero LLM (`npm run verify`) |
| Spend guard | 10 checks per IP per minute, 2,000 live credits per day, then recorded replays (labelled); the agent button 2 per IP and 4 per day (`apps/web/lib/guard.ts`) |

## Reproduce (real Nansen calls, one env var)

```bash
git clone https://github.com/edycutjong/rebuttal.git && cd rebuttal
npm install
export NANSEN_API_KEY=nsn_…            # https://app.nansen.ai/api — the only required key
npm run rebuttal -- "Smart Money is aping \$PEPE hard today 🐋" --explain   # ≤ 15 credits, ~4 s
npm run verify                          # 13/13 recorded rebuttals replayed offline, 0 credits, 0 network
npm test                                # 339 tests
```

Optional: `export GROQ_API_KEY=…` turns on the LLM extractor and the two-sentence prose (Groq, `openai/gpt-oss-120b`); without it the rules extractor and the template run and the output says so. `--ask-nansen` adds the agent/fast comparison (200 credits).

## Three limitations, stated

- **"Smart Money" means Nansen's Smart Trader flow columns plus the Fund / Smart Trader rows named in the trace.** Funds have no separate flow-intelligence column; the who-bought-sold filter covers them.
- **Nansen's Whale label is sparse.** A post's "whale" is often a big wallet Nansen does not tag; when no Whale-labelled wallet exists in the token the tool says UNVERIFIABLE rather than pretending a CONTRADICTED.
- **Net flows are priced at current rates and drift by the minute.** The hash covers integers of the numbers that decided the label; a fixture replay always matches, a live re-run usually does, and the label holds.

## Links

- Repo: <https://github.com/edycutjong/rebuttal> (public at submission)
- Rules: [docs/SCORING.md](docs/SCORING.md) · Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) · DX report: [docs/DX-REPORT.md](docs/DX-REPORT.md)
- Built by [@edycutjong](https://x.com/edycutjong) for the Nansen Meridian Buildathon, September 2026.
