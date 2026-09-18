# DX report — building Rebuttal on the Nansen API (2026-09-18)

What we hit, in the order we hit it. Every item is from a live call; the raw responses are in `fixtures/` or the kitchen's spike logs. Written for the Nansen API team as much as for the judge.

## Frictions

1. **`tgm/who-bought-sold` is per-address, not per-class.** The docs describe "an aggregated summary of trade volumes in USD for addresses"; the label-*class* aggregate we expected there is `tgm/flow-intelligence`. Both ended up in the product (flow decides, who-bought-sold names the wallets), but a first-time reader plans the wrong call. A `group_by: label` option on who-bought-sold, or a cross-link in the docs, would save the round trip.
2. **Bridged copies carry the canonical market cap in `search/general`.** PEPE on arbitrum: `market_cap` $1.553B, `volume_24h` $847, rank 6120; ethereum: $1.552B, $1.77M, rank 370. Picking by cap picks the bridge. We resolve by `volume_24h` among tokens ranked within `2 × best + 50`. A `canonical: true` flag, or a `bridged_from` field, would make this unnecessary.
3. **Search rank puts a same-symbol copy one rank above the native coin.** HYPE: solana `98sMhv…` rank 317, hyperevm `0xeeee…` rank 318 (market cap $68M vs $19.8B). We keep a native-coin map (ETH → WETH, BTC → WBTC, SOL, HYPE) as a workaround.
4. **The Whale label is sparse and the `whale_*` flow columns are DEX-only.** `tgm/flow-intelligence` 1d on WETH: `whale_wallet_count = 0`. `tgm/holders label_type=whale` on the same token: 38 holders, and their `balance_change_24h` (transfers included) agreed with the flow column wherever both existed (UNI: −$502K vs −$474K). We use holders' balance change × last close as the whale signal. It would help if the docs defined "Whale" (top-N holders of the token? a portfolio threshold?) — we could not find a definition in `llms-full.txt`.
5. **Two endpoints disagree about the same 24 h.** HYPE on hyperevm: `tgm/flow-intelligence` 1d → `smart_trader_net_flow_usd` +$291,049 over 263 wallets; `smart-money/netflow` filtered to the same `token_address` → `net_flow_24h_usd` +$207 over 109 traders. Different Smart Money definitions (the table's `SmartMoneyFilterType` lacks Public Figure/Whale; "1d" vs a rolling 24 h?) or different pricing — the docs do not say. We treat flow-intelligence as primary and print both.
6. **`0xeeee…` is the native-token placeholder on every chain** (`search/general` returns it for hyperevm HYPE; the spike's ETH claim also resolved to it on ethereum via a chain hint). It works on flow-intelligence, who-bought-sold, holders and ohlcv, but it is undocumented; a stranger would assume WETH.
7. **`smart-money/netflow`'s `token_address` filter accepts one address, but the response can still be empty for a token that flow-intelligence shows Smart Trader activity on** (EDEL on base: table row present with 2 traders and $0; MEME on ethereum: absent). "Not on the table" is therefore only a context line, never decisive.
8. **`tgm/token-ohlcv` returns 25 candles for a 24 h window** (inclusive bounds). Fine, but the count surprised the first assertion.
9. **Fresh-wallet and exchange flows dwarf every labelled class.** VVV: fresh wallets +$73.9M vs Smart Trader +$100K in 24 h. Any threshold that scales with total flow reads real Smart Money activity as noise; ours scales with the labelled classes only. Worth a sentence in the flow-intelligence docs: the six columns are not comparable in magnitude.
10. **`account` is GET-only** (`405` on POST) while everything else is POST; the OpenAPI file says so, the credits page's "all endpoints are POST" phrasing does not.
11. **`agent/fast` emits `tool_call` per unique tool and repeats the list in `finish.tool_calls`** — as documented; first byte took 3.5 s and the run 8.0 s on the PEPE claim. It would be a stronger comparison artifact if the events carried the tool *arguments* (which token, which window), not only the names.
12. **Two different "24 h" in one trace.** `flow-intelligence 1d` is Nansen's rolling window; our who-bought-sold and ohlcv windows end at the floor of the hour (so the cache key is stable within the hour) and can lag it by up to 59 minutes. Stated here because it is one more reason the numbers on the same card need not agree to the dollar.
13. **The hourly cache on our side needs the request window floored to the hour** (who-bought-sold `date`, ohlcv `date`), otherwise every call has a unique body and never hits. Documenting the server-side cache windows (who-bought-sold: 5 min for ranges including today) helped choose ours.

## Not Nansen, but found on the way

- Groq retired `llama-3.3-70b-versatile` (`model_not_found`) — `openai/gpt-oss-120b` tool-calls in ~0.8 s with `reasoning_effort: low`; 5 of 10 keys answered `400 "Organization has been restricted"`, which the client now rotates past.
- The LLM narration once disputed a CONFIRMED verdict by comparing Nansen's $532K to the post's $5.1M ("not supported"). The prompt now states the verdict as a fact and forbids comparing the claim's own figures; prose that still disputes the label is discarded for the template (`proseConsistent`).
- The LLM guessed `chain: "ethereum"` for a HYPE claim that named no chain; a chain from the model is accepted only when the word appears in the text.

## Wishes

1. A documented definition of each label class (Smart Trader tiers, Fund, Whale, Public Figure, Fresh Wallet) on one page, linked from every endpoint that returns them.
2. `canonical` / `bridged_from` on `search/general` tokens.
3. A per-class aggregate option on `who-bought-sold` (or a note pointing to flow-intelligence).
4. One "Smart Money" definition shared by `smart-money/netflow` and `tgm/flow-intelligence`, or a doc sentence explaining why the two 24 h numbers differ.
5. Tool arguments in `agent/fast` events.
