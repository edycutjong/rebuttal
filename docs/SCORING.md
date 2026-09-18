# SCORING — how a rebuttal is decided

Every input below is a Nansen response field. The LLM never sees this function's inputs as a question. Constants live in one object, `RULES` in `packages/core/src/decide.ts`, and `--explain` prints them.

## 1 · The claim

`{token, chain?, type ∈ buying | selling | holding, subject ∈ smart_money | whales}`. The rules extractor reads `$TICKER` first, then `(TICKER)`, then a short name map, then bare upper-case words that are not on a stop list; the first verb in reading order decides the type ("sold 602 BTC to purchase ETH" is about selling BTC; a deposit to an exchange reads as selling, a withdrawal as buying); the earliest subject keyword decides the subject. The LLM (Groq, tool call) runs before token resolution with a 3 s budget and may fill or correct what the rules only guessed: a `$TICKER`/`(TICKER)` and a strong verb (buy/sell/dump/accumulate/deposit/withdraw…) are final; a name-map or bare-word token may be corrected only with a token that literally appears in the text; a weak verb (surged, closed, added…) yields to the model; a subject keyword in the text beats its guess; a chain it names must appear in the text; chain names are stripped before the token pass so "PEPE on Ethereum" is about PEPE.

## 2 · The token

`search/general` (0 credits) → tokens whose symbol or name equals the ticker, on a chain `tgm/flow-intelligence` accepts → the chain named in the text, else **the most-traded (`volume_24h`) among those ranked within `2 × best rank + 50`**. Native coins map to a home chain (ETH → ethereum `0xeeee…`, SOL, HYPE → hyperevm `0xeeee…`). Coins whose home chain Nansen does not index (BTC, ZEC, XRP, ADA, DOGE, …) are refused at 0 credits unless a chain is named (`U-CHAIN`).

Why not market cap or rank alone (seen live 2026-09-18): bridged PEPE on arbitrum reports $1.553B vs ethereum $1.552B; HYPE on solana ranks 317 vs hyperevm 318. Volume within the rank window picks ethereum PEPE ($1.77M/24 h vs $79K bnb vs $847 arbitrum).

## 3 · The evidence

| Field | Endpoint | Used as |
|---|---|---|
| `net1d`, `wallets1d` | `tgm/flow-intelligence` 1d — `smart_trader_*` or `whale_*` | the primary signal (Smart Money) |
| `net7d` | `tgm/flow-intelligence` 7d | blip or trend |
| `fresh1d`, `exchange1d`, `top_pnl1d`, `public_figure1d` | same rows | threshold scale (labelled classes only) and context lines |
| `buyUsd`, `sellUsd`, top-3 rows | `tgm/who-bought-sold` BUY / SELL, 24 h floored to the hour, `include_smart_money_labels` | the names in the trace; the primary signal if flow-intelligence failed |
| `inTable`, `tableNet24`, `traders` | `smart-money/netflow` filtered to the token | context line; presence of the class |
| `px24` | `tgm/token-ohlcv` 1h × 24: (last close − first open) / first open | staleness |
| `holders.count`, `delta24`, `delta7d` | `tgm/holders` `label_type: whale` (whale claims) or `smart_money` (holding claims) | **whale claims' primary signal: `delta24 × last close`**; holding claims |

## 4 · The threshold

```
T   = max(RULES.floorUsd = $5,000, RULES.shareOfFlow = 1% × Σ |net1d| over Smart Trader, Whale, Top PnL, Public Figure)
T7  = the same over the 7 d row
```
Fresh-wallet and exchange volume are excluded from the scale on purpose: on VVV fresh wallets moved $74M against $100K of Smart Money — with them in, a #2-on-the-table inflow read as "noise".

## 5 · The rules (buying; selling flips the sign once and mirrors every rule)

| Order | Condition | Verdict · rule |
|---|---|---|
| 0 | fewer than `minChecks = 2` checks answered | UNVERIFIABLE `U-CHECKS` |
| 0 | no flow row and no who-bought-sold rows | UNVERIFIABLE `U-FLOW` |
| 1 | `net ≤ −T` | CONTRADICTED `C-SIGN` |
| 2 | `|net| < floor ∧ wallets = 0 ∧ no named rows` and the class is present somewhere (1 d / 7 d wallets, holders, or SM table traders for Smart Money) | CONTRADICTED `C-NOBODY` |
| 2′ | …and the class is absent everywhere | UNVERIFIABLE `U-NOCLASS` |
| 3 | `0 < net < T` | OVERSTATED `O-SMALL` |
| 4 | `net ≥ T ∧ net7d ≤ −T7` | OVERSTATED `O-7D` |
| 5 | `net ≥ T ∧ px24 ≥ staleMove = 20 %` (selling: `≤ −20 %`) | OVERSTATED `O-STALE` |
| 6 | `net ≥ T ∧ wallets < minWallets = 3` (whales: `minWhales = 1`) | OVERSTATED `O-FEW` |
| 7 | `net ≥ T` | CONFIRMED `A-FLOW` |
| 8 | `−T < net ≤ 0` with the class present (a sub-dollar net counts as 0) | OVERSTATED `O-FLAT` |

Holding claims: no holders and no 7 d row → `U-HOLD`; `holders < minHolders = 5` → `O-HOLDERS`; `net7d ≤ −T7 ∧ delta7d < 0` → CONTRADICTED `C-EXIT`; either one alone → `O-TRIM`; else CONFIRMED `A-HOLD`.

Fresh-wallet flow is a **context line, never a verdict**: on a hot token retail always out-buys every labelled class; "Smart Money is buying" is literally true when Smart Money is buying.

## 6 · The hash

`sha256` of the canonical JSON of `{token, type, subject, chain, address, label, ruleId, net1d, wallets1d, net7d, fresh1d, buyUsd, sellUsd, inTable, px24 (3 dp), pxClose (6 s.f.), holders, holdersDelta24, holdersDelta7d}` with every USD rounded to an integer — every number a rule can read, including the whale primary (`holdersDelta24 × pxClose`). A fixture replay reproduces it exactly; a live re-run reproduces the label and usually the hash (flows are priced at current rates).

## 7 · The 13 recorded rebuttals (2026-09-18, `fixtures/`)

| fixture | claim | chain | verdict | first reason | cr |
|---|---|---|---|---|---|
| `pepe-aping` | smart_money · buying | ethereum | **CONTRADICTED** `C-NOBODY` | no Smart Money wallet traded this token in the last 24 h (net $0) | 0 |
| `vvv-sm-buying` | smart_money · buying | base | **CONFIRMED** `A-FLOW` | Smart Money net bought $100K in 24 h (flow-intelligence 1d, 4 wallets; threshold $17K) | 0 |
| `uni-whale-sold` | whales · selling | ethereum | **CONFIRMED** `A-FLOW` | Whales net sold $548K in 24 h (whale holders' 24 h balance change × price, 10 wallets; threshold $77K) | 0 |
| `hype-whale-falconx` | whales · selling | hyperevm | **OVERSTATED** `O-FLAT` | Whales net sold $0 in 24 h (whale holders' 24 h balance change × price, 7 wallets; threshold $5K) | 0 |
| `uni-sm-holding` | smart_money · holding | ethereum | **OVERSTATED** `O-TRIM` | 59 Smart Money holders on page 1, $383.92M held, 7 d balance change -5691 tokens | 0 |
| `ai-robinhood-chain` | whales · selling | robinhood | **OVERSTATED** `O-FLAT` | Whales net sold $0 in 24 h (whale holders' 24 h balance change × price, 1 wallet; threshold $31K) | 0 |
| `meme-whale-position` | whales · buying | robinhood | **UNVERIFIABLE** `U-NOCLASS` | Nansen tags no wallet as Whales in this token (24 h, 7 d, holders) — the wallet in the post is not one Nansen labels | 0 |
| `uni-sm-buying-after-rally` | smart_money · buying | ethereum | **OVERSTATED** `O-SMALL` | Smart Money net bought $17K in 24 h (flow-intelligence 1d, 2 wallets; threshold $77K) | 0 |
| `hype-sm-bought` | smart_money · buying | hyperevm | **CONFIRMED** `A-FLOW` | Smart Money net bought $291K in 24 h (flow-intelligence 1d, 263 wallets; threshold $5K) | 0 |
| `edel-tweet-url` | whales · buying | base | **UNVERIFIABLE** `U-NOCLASS` | Nansen tags no wallet as Whales in this token (24 h, 7 d, holders) — the wallet in the post is not one Nansen labels | 0 |
| `xqzplm-unknown` | smart_money · buying | — | **UNVERIFIABLE** `U-TOKEN` | no token named XQZPLM on Nansen | 0 |
| `pepe-not-a-flow-claim` | smart_money ·  | — | **UNVERIFIABLE** `U-CLAIM` | not a flow claim — nothing about buying, selling or holding | 0 |
| `zec-not-a-nansen-chain` | whales · buying | — | **UNVERIFIABLE** `U-CHAIN` | Zcash is not a chain Nansen indexes — only bridged copies of ZEC exist here, and they are not what the post is about (na | 0 |

Thresholds were calibrated on the day-one spike (10 real posts, three runs): `shareOfFlow` 2 % → 1 % after a $474K whale sale on UNI read as noise against a $530K threshold dominated by fresh-wallet flow; `minWhales = 1` because "a whale" is singular; `U-NOCLASS` and `U-CHAIN` added after run 1 said CONTRADICTED on three claims whose class or chain Nansen simply does not have.
