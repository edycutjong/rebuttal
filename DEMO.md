# DEMO — Rebuttal

Real output, real credits. Everything below was produced by the commands shown, against the live Nansen API, on 2026-09-18 10:46 UTC. (The trace-row value formatting changed later that day after code review — token amounts now print as `−58.7K tokens`, prices with three significant digits, changes as `+7.9%` — the numbers themselves are the run's.)

## 1 · The hero rebuttal (live, `--no-cache`, 10 credits, 3.5 s)

```
$ npm run rebuttal -- "Smart Money is aping $PEPE hard today 🐋" --explain --no-cache
claim  Smart Money buying · token PEPE · extracted by llm
token  PEPE · ethereum 0x6982508145454ce325ddbe47a25d4ec3d2311933 · most traded of the top-ranked of 14 same-name · plan: 6 checks, 10 credits
  ✔ tgm/flow-intelligence  1d             1 cr   333 ms  smart_trader_net_flow_usd=0 smart_trader_wallet_count=0 fresh_wallets_net_flow_usd=$1.14M exchange_net_flow_usd=$1.10M
  ✔ tgm/flow-intelligence  7d             1 cr   346 ms  smart_trader_net_flow_usd=$5K smart_trader_wallet_count=53
  ✔ tgm/who-bought-sold    BUY 24h        1 cr   349 ms  bought_volume_usd=0 rows=0 top=null
  ✔ tgm/who-bought-sold    SELL 24h       1 cr   710 ms  sold_volume_usd=0 rows=0 top=null
  ✔ smart-money/netflow    token filter   5 cr   884 ms  in_table=yes net_flow_24h_usd=0 net_flow_7d_usd=$5K trader_count=89
  ✔ tgm/token-ohlcv        1h × 24        1 cr  1400 ms  candles=25 open=0.00000346515471648103 close=0.00000373934937582565 change_24h=0.0791

 CONTRADICTED  C-NOBODY
  · no Smart Money wallet traded this token in the last 24 h (net $0)
  · 7 d: $5K
  · on the Smart Money net-flow table (24 h $0, 89 traders)
  No Smart Money wallet bought PEPE in the past 24 hours, showing a net flow of $0 despite 89 traders listed. Over the last seven days the total Smart Money net flow was only $5 K, far below “hard aping.” (llm)
  ⚠ 14 tokens named PEPE on Nansen — checked the most traded of the top-ranked
  10 credits · 7 calls · 3.5 s · hash 4f3cce391567

rules
  threshold T = max($5K, 1% × Σ|labelled net flow 1d|) = $5K · stale ≥ 20% · min wallets 3 (whales 1) · min holders 5 · min checks 2
provenance
  ✔ search/general           0 cr   560 ms live   9a1883269608  tokens[].symbol, tokens[].name, tokens[].chain
  ✔ tgm/flow-intelligence    1 cr   328 ms live   430f72cc0b4e  data[0].smart_trader_net_flow_usd (1d), data[0].smart_trader_wallet_count (1d), data[0].whale_net_flow_usd (1d)
  ✔ tgm/flow-intelligence    1 cr   343 ms live   370d912b7b78  data[0].smart_trader_net_flow_usd (7d), data[0].smart_trader_wallet_count (7d), data[0].whale_net_flow_usd (7d)
  ✔ tgm/who-bought-sold      1 cr   346 ms live   d751e140bcfb  data[].bought_volume_usd (BUY 24h), data[].address (BUY 24h), data[].address_label (BUY 24h)
  ✔ tgm/who-bought-sold      1 cr   707 ms live   d751e140bcfb  data[].sold_volume_usd (SELL 24h), data[].address (SELL 24h), data[].address_label (SELL 24h)
  ✔ smart-money/netflow      5 cr   445 ms live   54864281a630  data[].net_flow_24h_usd, data[].net_flow_7d_usd, data[].trader_count
  ✔ tgm/token-ohlcv          1 cr   372 ms live   a198fbb80d47  data[].open, data[].close, data[].interval_start

copy this
CONTRADICTED — "Smart Money is aping $PEPE hard today 🐋"
$PEPE (ethereum): no Smart Money wallet traded this token in the last 24 h (net $0); 7 d: $5K; on the Smart Money net-flow table (24 h $0, 89 traders).
Checked on Nansen: 6/6 calls, 10 credits · 4f3cce391567
```

Same engine on the web: <https://rebuttal.edycu.dev/?q=Smart%20Money%20is%20aping%20%24PEPE%20hard%20today%20%F0%9F%90%8B> — the six rows land one by one, then the verdict card turns red. JSON: `/api/rebut?q=…`. The permalink `/c?q=…` renders the same verdict server-side with an Open Graph card (`/api/og?q=…`).

## 2 · A claim the tool CONFIRMS (live, 15 credits, 3.8 s)

```
$ npm run rebuttal -- "A whale sold 600,000 UNI tokens, valued at approximately $5.1 million." --no-cache
claim  Whales selling · token UNI · extracted by llm
token  UNI · ethereum 0x1f9840a85d5af5bf1d1762f925bdaddc4201f984 · most traded of the top-ranked of 9 same-name · plan: 7 checks, 15 credits
  ✔ tgm/flow-intelligence  1d             1 cr   343 ms  whale_net_flow_usd=−$476K whale_wallet_count=2 fresh_wallets_net_flow_usd=$15.19M exchange_net_flow_usd=−$2.19M
  ✔ tgm/who-bought-sold    BUY 24h        1 cr   347 ms  bought_volume_usd=0 rows=0 top=null
  ✔ tgm/who-bought-sold    SELL 24h       1 cr   420 ms  sold_volume_usd=$447K rows=2 top=recv.eth 268387
  ✔ tgm/token-ohlcv        1h × 24        1 cr   891 ms  candles=25 open=6.88611329825717 close=9.07133245929344 change_24h=0.3173
  ✔ tgm/flow-intelligence  7d             1 cr   995 ms  whale_net_flow_usd=−$460K whale_wallet_count=2
  ✔ smart-money/netflow    token filter   5 cr  1424 ms  in_table=yes net_flow_24h_usd=$17K net_flow_7d_usd=−$38K trader_count=13
  ✔ tgm/holders            whale          5 cr  1733 ms  holders=10 value_usd=$29.94M balance_change_7d=−$55K balance_change_24h=−$59K

 CONFIRMED  A-FLOW
  · Whales net sold $532K in 24 h (whale holders' 24 h balance change × price, 10 wallets; threshold $77K)
  · 7 d agrees: −$460K
  · on the Smart Money net-flow table (24 h $17K, 13 traders)
  · fresh wallets net bought $15.19M
  · price +31.7% over the last 24 h
  The data show whale activity net‑selling only $532 K worth of UNI in the past 24 hours and $460 K over seven days, far below the claimed $5.1 M. Thus the reported 600,000‑token sale is not supported. (llm)
  ⚠ 9 tokens named UNI on Nansen — checked the most traded of the top-ranked
  15 credits · 8 calls · 3.8 s · hash 0815c33aed48
```

(The two-sentence prose above was the first live run; the narration guard that discards prose disputing the verdict was added after this run — see `docs/DX-REPORT.md`. The label, the rules and the hash do not involve the LLM. Hashes in this section are from the live runs of 10:46 UTC; the hash record later gained the whale-primary fields, so the recorded fixtures carry the hashes shown in the verify block below.)

## 3 · Nansen's own agent on the same claim (`--ask-nansen`, 200 credits)

Run once in the spike (2026-09-18, claim: the PEPE post from OKX Insight): **first byte 3.5 s, finished 8.0 s**, `tool_calls` = `token_current_top_holders`, `token_recent_flows_summary`, `token_technical_indicators`, 868 chars of prose that read the same flow numbers ("smart traders showed only $4.6K net inflow … the strongest recent accumulation appears to be from fresh wallets") — the same direction as our CONTRADICTED, in prose, with no threshold and no hash. On the site the button prints the price and streams the tool list into the violet panel beside our trace.

## 4 · Offline replay (0 credits, 0 network)

```
$ npm run verify
✔ ai-robinhood-chain           OVERSTATED    O-FLAT     49f0e6ee2b59 8 cached calls · 0 credits
✔ edel-tweet-url               UNVERIFIABLE  U-NOCLASS  a914a08a79c6 8 cached calls · 0 credits
✔ hype-sm-bought               CONFIRMED     A-FLOW     2274034ebea8 7 cached calls · 0 credits
✔ hype-whale-falconx           OVERSTATED    O-FLAT     c27dfe3faa49 8 cached calls · 0 credits
✔ meme-whale-position          UNVERIFIABLE  U-NOCLASS  cb7dc25419d0 8 cached calls · 0 credits
✔ pepe-aping                   CONTRADICTED  C-NOBODY   e21a8a19ae59 7 cached calls · 0 credits
✔ pepe-not-a-flow-claim        UNVERIFIABLE  U-CLAIM    d5c87bc9b865 0 cached calls · 0 credits
✔ uni-sm-buying-after-rally    OVERSTATED    O-SMALL    af11018db8bb 7 cached calls · 0 credits
✔ uni-sm-holding               OVERSTATED    O-TRIM     62e68c0786ea 8 cached calls · 0 credits
✔ uni-whale-sold               CONFIRMED     A-FLOW     6007ef858809 8 cached calls · 0 credits
✔ vvv-sm-buying                CONFIRMED     A-FLOW     1dfd89ee2c77 7 cached calls · 0 credits
✔ xqzplm-unknown               UNVERIFIABLE  U-TOKEN    8c925fff55ab 1 cached calls · 0 credits
✔ zec-not-a-nansen-chain       UNVERIFIABLE  U-CHAIN    11d641446a9d 0 cached calls · 0 credits

13/13 verdicts reproduced offline · network calls attempted: 0
```

## 5 · Benchmark (live, 13 claims × 2 cold runs + 1 warm pass, 260 credits)

| | p50 | p95 | max | mean credits | mean calls | failed calls |
|---|---|---|---|---|---|---|
| cold, all 13 claims | 3,991 ms | 5,029 ms | 5,407 ms | 10.0 | 5.9 | 0 / 154 |
| cold, claims that reach Nansen (22 runs) | 4,124 ms | 5,029 ms | 5,407 ms | 11.8 | 7.0 | — |
| warm (cache hit) | 2 ms | 9 ms | 9 ms | 0 | 5.9 | 0 |

LLM share of a cold rebuttal (extract + narrate, sequential): p50 1,653 ms. Full table: [docs/BENCH.md](docs/BENCH.md).

## 6 · Reproduce

```bash
git clone https://github.com/edycutjong/rebuttal.git && cd rebuttal && npm install
export NANSEN_API_KEY=nsn_…                                   # https://app.nansen.ai/api
npm run rebuttal -- "Smart Money is aping \$PEPE hard today" --explain   # 10 credits, live
npm run verify                                                # 13/13, 0 credits
npm test                                                      # 216 tests
npm run bench -- --runs 1                                     # ≈ 130 credits, rewrites docs/BENCH.md
```

The numbers move with the market and with Nansen's latency by the minute; the label for a given fixture, its rule and its hash do not — that is what `verify` proves.
