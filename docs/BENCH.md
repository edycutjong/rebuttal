# Benchmark — Rebuttal

Live run started 2026-09-18T10:25:07.709Z · `npm run bench -- --runs 2` · 13 claims × 2 cold runs + 1 warm pass · LLM on (Groq gpt-oss-120b).
Cold = empty cache, every Nansen call live (`ttlMs: 0`). Warm = second pass on the same in-memory cache, no LLM (what a permalink or a repeat query costs).

| | p50 | p95 | max | mean credits | mean calls | failed calls | n |
|---|---|---|---|---|---|---|---|
| cold, all 13 claims | 3991 ms | 5029 ms | 5407 ms | 10.0 | 5.9 | 0 / 154 | 26 |
| cold, claims that reach Nansen | 4124 ms | 5029 ms | 5407 ms | 11.8 | 7.0 | — | 22 |
| warm (cache hit) | 2 ms | 9 ms | 9 ms | 0 | 5.9 | 0 | 13 |

LLM share of a cold rebuttal (extract + narrate, sequential): p50 1653 ms · extraction by LLM 26/26 · prose by LLM 14/26. Total credits this bench: **260**.

## Per claim (cold, last run)
| claim | label | ms | credits | calls | failed | extractor | prose |
|---|---|---|---|---|---|---|---|
| pepe-aping | CONTRADICTED | 3768 | 10 | 7 | 0 | llm | llm |
| vvv-sm-buying | CONFIRMED | 4300 | 10 | 7 | 0 | llm | template |
| uni-whale-sold | CONFIRMED | 4010 | 15 | 8 | 0 | llm | llm |
| hype-whale-falconx | OVERSTATED | 3852 | 15 | 8 | 0 | llm | llm |
| uni-sm-holding | OVERSTATED | 3991 | 15 | 8 | 0 | llm | llm |
| ai-robinhood-chain | OVERSTATED | 3956 | 15 | 8 | 0 | llm | llm |
| meme-whale-position | UNVERIFIABLE | 3373 | 15 | 8 | 0 | llm | llm |
| uni-sm-buying-after-rally | OVERSTATED | 4980 | 10 | 7 | 0 | llm | template |
| hype-sm-bought | CONFIRMED | 4634 | 10 | 7 | 0 | llm | llm |
| xqzplm-unknown | UNVERIFIABLE | 1185 | 0 | 1 | 0 | llm | template |
| pepe-not-a-flow-claim | UNVERIFIABLE | 884 | 0 | 0 | 0 | llm | template |
| edel-tweet-url | UNVERIFIABLE | 5407 | 15 | 8 | 0 | llm | llm |
| zec-not-a-nansen-chain | UNVERIFIABLE | 1508 | 0 | 0 | 0 | llm | template |

Reproduce: `export NANSEN_API_KEY=… && npm run bench` (≈ 130 credits per run). Numbers move with Nansen's latency by the minute; the credits do not.
