# Architecture — Rebuttal (as shipped)

Regenerated from the code on 2026-09-18. One engine (`packages/core`), two views (CLI, web), no database.

## The one flow

```mermaid
sequenceDiagram
  participant U as user / judge
  participant W as apps/web · /api/rebut (NDJSON)
  participant E as core · rebut()
  participant G as Groq (optional)
  participant N as Nansen API
  U->>W: claim text or x.com URL
  W->>E: rebut(client, text, {onProgress})
  E->>E: x.com URL → oEmbed text (0 cr) · extractClaim() rules
  E->>G: extract_claim tool call (3 s budget)
  G-->>E: {token, type, subject, chain?} · merged, never overriding $TICKER
  E-->>W: {type:"claim"}
  E->>N: search/general (0 cr)
  E-->>W: {type:"resolved", plan}
  par six checks, 5 rps bucket
    E->>N: flow-intelligence 1d · 7d
    E->>N: who-bought-sold BUY · SELL (SM labels, 24 h)
    E->>N: smart-money/netflow (token filter)
    E->>N: token-ohlcv 1h × 24
    E->>N: holders (whale / holding claims only)
  end
  N-->>E: raw JSON · sha256 recorded per call
  E-->>W: {type:"check"} × N as each lands
  E->>E: decide(claim, evidence) → label · ruleId · reasons · verdictHash
  E-->>W: {type:"verdict"}
  E->>G: narrate the decided record (4 s budget; disputing prose discarded)
  E-->>W: {type:"prose"}
  W-->>U: trace rows land, verdict card, copy / permalink / "Ask Nansen's agent (200)"
```

## Modules (`packages/core/src`)

| File | Role | Key exports |
|---|---|---|
| `client.ts` | `NansenClient`: fetch + `apikey`, 5 rps token bucket, 8 s timeout, 1 retry on 429/5xx/timeout, every call recorded (`Call`: endpoint, body, credits — from `X-Nansen-Credits-Used` when Nansen sends it, else the table —, ms, status, fieldsUsed, sha256 responseHash, attempts, ok/error, tag); a check finds its own call by `tag`, never by position | `NansenClient`, `CREDITS`, `sha256` |
| `cache.ts` | `CachedNansenClient`: read-through cache keyed by `sha256(endpoint + canonical body)`, TTL 1 h, hits recorded at 0 credits, `NANSEN_OFFLINE=1` refuses the network; `DiskCache` / `MemoryCache` | `CachedNansenClient`, `cacheKey` |
| `nansen.ts` | zod-validated wrappers: `searchTokens`, `flowIntelligence`, `whoBoughtSold` (24 h floored to the hour, `include_smart_money_labels` per subject), `smartMoneyNetflow`, `tokenOhlcv`, `holders` | + `SUBJECT_LABELS`, `NETFLOW_CHAINS` |
| `claim.ts` | the deterministic extractor and the merge rule with the LLM | `extractClaim`, `mergeClaims`, `validClaim`, `SCORABLE_CHAINS` |
| `resolve.ts` | which token the claim means: same-name on scorable chains → chain hint → most traded of the top-ranked; native map; non-Nansen chains | `resolveToken`, `NOT_A_NANSEN_CHAIN` |
| `checks.ts` | the plan per claim type and the parallel runner turning responses into `Evidence` (+ one `Check` per call for the trace) | `planChecks`, `runChecks` |
| `decide.ts` | `RULES`, the threshold, `decide()` — pure; selling mirrors buying; holding rules; `presence()` | `decide`, `RULES`, `threshold`, `fmtUsd` |
| `rebut.ts` | the orchestrator: input → claim → token → checks → decision → hash → prose; `RebutEvent`s; `rebuttalText` (the copy paragraph) | `rebut`, `verdictHash`, `templateProse`, `envLlm` |
| `llm.ts` | Groq OpenAI-compatible chat: key rotation on 429 / 401 / 403 / restricted-400, budgets, `extractWithLlm` (validated), `narrateWithLlm` (+ `proseConsistent` guard) | |
| `agent.ts` | `agent/fast` SSE parser: deltas, unique tool_calls, finish, error, 60 s cap that also cuts a trickling stream | `askNansenAgent`, `AGENT_CREDITS` |
| `tweet.ts` | x.com / twitter.com status URL → text via the public oEmbed endpoint (4 s, no key) | `isTweetUrl`, `fetchTweetText` |
| `fixtures.ts` | recorded runs: raw responses by cache key, the claim as extracted, the clock, the verdict | `writeFixture`, `readFixture`, `fixtureStore` |

## Web (`apps/web`)

| Route | What | Guard |
|---|---|---|
| `/` | the ONE flow; idle state shows the recorded hero fixture (0 credits, labelled) | — |
| `/api/rebut?q=[&chain=][&stream=1]` | JSON verdict, or NDJSON `input · claim · resolved · check×N · verdict · prose · asOf` | 400 on bad input before any fetch; 10 / IP / min → 429; 2,000 live credits / day then a labelled fixture replay or 503 |
| `/c?q=` | the permalink: server-rendered verdict (cache → live → replay) with Open Graph tags; `React.cache` so metadata and page share one run | same daily ceiling |
| `/api/og?q=` | 1200×630 card: claim, verdict word in its colour, two reasons, hash; edge-cached 30 min | never 4xx — falls back to a replay or a data-free card |
| `/api/agent` (POST) | NDJSON relay of `agent/fast`: tool_call · delta · finish · done | 2 / IP / day, 4 / day; GET → 405 |
| `/judge` | static page for one reader, mirrored in `JUDGE.md` | — |

Cache: `DiskCache` in `.cache/` locally and `/tmp` on Vercel (per instance). Counters in `lib/guard.ts` are per instance — ceilings, not accounting.

## Data (no database)

```ts
Claim    { raw, token?, chain?, type?: buying|selling|holding, subject?: smart_money|whales, extractor: llm|rules, problem? }
Resolved { chain, address, symbol, name, marketCap, sameName, by, others[] }
Evidence { flow1d, flow7d: FlowSnapshot|null; named: {buyUsd, sellUsd, buyRows, sellRows, buyers[3], sellers[3]}|null;
           table: {inTable, net24, net7d, traders}|null; price: {open, close, change, candles}|null;
           holders: {count, delta24, delta7d, valueUsd, top[3]}|null; checksOk; checksTotal }
Verdict  { input, claim, resolved, label, ruleId, reasons[], threshold, evidence, checks[], prose: {text, source, ms},
           provenance: Call[], credits, calls, ms, hash, warnings[], llm: {extract, narrate}, agent?, rules, now }
Fixture  { slug, edge, input, source, claim, options, now, recordedAt, live: {calls, credits, ms}, responses: {cacheKey → CacheEntry}, verdict }
```

## Trust boundaries

- The Nansen key is read from `process.env` on the server (CLI process or Vercel function) and only ever sent as the `apikey` header. Tests assert nothing key-shaped appears in a verdict, an event, the provenance, a cache key or an error.
- Groq keys likewise; the LLM receives the claim text and the decided evidence lines, never the key, never the raw Nansen responses.
- `NANSEN_OFFLINE=1` appears only in `scripts/verify.ts` and the fixture replay path; the CLI and the default web path are live.

## Residual risks

- Nansen latency swings by the minute (bench: 4.0 s p50, 5.4 s max; earlier in the day a WETH holders call took 8 s) — a cold run on camera is a pacing coin-flip; record on a warm cache or accept a 5 s wait.
- Per-instance guards on Vercel: the true daily ceiling is `2,000 × instances`; still two orders of magnitude under the balance.
- Ambiguous tickers (`MEME`) resolve to the most-traded same-symbol token; the claim card names the pick and how many share the name.
