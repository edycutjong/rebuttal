/** Regression tests named for the second independent review (2026-09-18): findings #1, #2, #3, #4, #8, #9, #11. */
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { extractClaim, mergeClaims, findToken } from "../src/claim.js";
import { rebut, type RebutEvent } from "../src/rebut.js";
import { fmtValue } from "../src/format.js";
import { runChecks } from "../src/checks.js";
import { askNansenAgent } from "../src/agent.js";
import { decide } from "../src/decide.js";
import { fakeClient, pepeRoutes, claim, evidence, snap, PEPE_ETH } from "./helpers.js";
import { POST as agentPost } from "@/app/api/agent/route";
import { fmt } from "@/components/Cards";
import { resetGuard } from "@/lib/guard";
import type { Resolved } from "../src/resolve.js";

describe("#1 a chain name is never the token", () => {
  it("'Smart Money is buying PEPE on Ethereum' is about PEPE on ethereum", () => {
    const c = extractClaim("Smart Money is buying PEPE on Ethereum");
    expect(c.token).toBe("PEPE");
    expect(c.chain).toBe("ethereum");
    expect(c.tokenSource).toBe("name"); // "pepe" is on the name map; the chain phrase was stripped first
  });
  it("'Whales bought PENGU on Solana' → PENGU · 'LINK on Arbitrum' → LINK · '#sol whales loading BONK' → BONK", () => {
    expect(findToken("Whales bought PENGU on Solana")).toBe("PENGU");
    expect(findToken("Smart Money accumulating LINK on Arbitrum")).toBe("LINK");
    expect(findToken("#sol whales loading BONK")).toBe("BONK");
  });
  it("the chain's own coin still resolves when the text names nothing else", () => {
    expect(findToken("smart money is buying ethereum")).toBe("ETH");
    expect(extractClaim("whales accumulating solana").token).toBe("SOL");
  });
  it("the model may correct a name-map / bare-word token, but only with a token that is in the text", () => {
    const r = extractClaim("Smart money loading UNI and DEGEN today");
    expect(r.token).toBe("UNI");
    expect(mergeClaims(r, { token: "DEGEN", type: "buying" }).token).toBe("DEGEN");
    expect(mergeClaims(r, { token: "BTC", type: "buying" }).token).toBe("UNI");
    expect(mergeClaims(extractClaim("smart money loading $UNI, the token is DEGEN"), { token: "DEGEN" }).token).toBe("UNI");
  });
});

describe("#3 a weak verb is a hint, a strong verb is final", () => {
  it("'surged … dumped' lets the model say selling; 'closing in … keeps buying' lets it say buying", () => {
    const a = extractClaim("$PEPE surged 40% today while smart money dumped into the rally");
    expect(a.typeStrength).toBe("weak"); // "surged" won in reading order and it is a weak verb — the model may correct it
    const b = extractClaim("$PEPE is closing in on a new ATH as retail piles in");
    expect(b.type).toBe("selling");
    expect(b.typeStrength).toBe("weak");
    expect(mergeClaims(b, { token: "PEPE", type: "buying" }).type).toBe("buying");
    const c = extractClaim("whales sold $UNI");
    expect(mergeClaims(c, { token: "UNI", type: "buying" }).type).toBe("selling");
  });
});

describe("#2 the verdict event never waits for the narration", () => {
  it("verdict is emitted before the LLM answers, then prose patches it", async () => {
    const order: string[] = [];
    let llmCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      llmCalls++;
      if (llmCalls === 1) return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "extract_claim", arguments: JSON.stringify({ token: "PEPE", type: "buying", subject: "smart_money" }) } }] } }] }), { status: 200 });
      await new Promise((r) => setTimeout(r, 300));
      return new Response(JSON.stringify({ choices: [{ message: { content: "Nobody labelled Smart Money touched PEPE today, so the claim finds no support in the flows." } }] }), { status: 200 });
    };
    const t: Record<string, number> = {};
    const v = await rebut(fakeClient(pepeRoutes()), "Smart Money is aping $PEPE", { llm: { keys: ["a"], fetchImpl }, now: 0, onProgress: (e: RebutEvent) => { order.push(e.type); t[e.type] = Date.now(); } });
    expect(order.indexOf("verdict")).toBeLessThan(order.indexOf("prose"));
    expect(t.prose - t.verdict).toBeGreaterThanOrEqual(250);
    expect(v.prose.source).toBe("llm");
  });
});

describe("#4 trace values are formatted by field, not by magnitude", () => {
  it("token amounts, prices, percentages, counts, USD", () => {
    expect(fmtValue("balance_change_24h", -58694)).toBe("−58.7K tokens");
    expect(fmtValue("bought_volume_usd", 99681)).toBe("$100K");
    expect(fmtValue("open", 0.0000034636)).toBe("0.00000346");
    expect(fmtValue("close", 8.56)).toBe("8.56");
    expect(fmtValue("change_24h", 0.0791)).toBe("+7.9%");
    expect(fmtValue("trader_count", 1234)).toBe("1234");
    expect(fmtValue("holders", 38)).toBe("38");
    expect(fmtValue("in_table", "yes")).toBe("yes");
    expect(fmtValue("x", null)).toBe("—");
  });
  it("the web copy equals core's", () => {
    for (const [k, v] of [["balance_change_7d", -55117], ["sold_volume_usd", 3.8], ["open", 2460.69], ["change_24h", -0.3], ["rows", 2]] as const) expect(fmt(k, v)).toBe(fmtValue(k, v));
  });
});

describe("#8 an agent refusal or a dead stream costs 0 credits", () => {
  it("HTTP 402 → credits 0; timeout before the first byte → credits 0", async () => {
    const a = await askNansenAgent("nsn_x", "x", { fetchImpl: async () => new Response("no credits", { status: 402 }) });
    expect(a.credits).toBe(0);
    const hang: typeof fetch = async (_u, init) => new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const b = await askNansenAgent("nsn_x", "x", { fetchImpl: hang, timeoutMs: 100 });
    expect(b.credits).toBe(0);
    expect(b.timedOut).toBe(true);
  });
});

describe("#9 /api/agent serves only our own page", () => {
  it("a cross-site text/plain POST is refused before any quota is used", async () => {
    resetGuard();
    process.env.NANSEN_API_KEY = "nsn_test_key_0000000000000000000000";
    const res = await agentPost(new NextRequest("http://localhost:3400/api/agent", { method: "POST", body: JSON.stringify({ q: "SM aping $PEPE" }), headers: { "content-type": "text/plain", origin: "https://evil.example", "sec-fetch-site": "cross-site" } }));
    expect(res.status).toBe(403);
  });
});

describe("#11 runChecks never rejects, even on a non-Error throw", () => {
  it("a string thrown by fetch becomes an ok=false check", async () => {
    const resolved: Resolved = { chain: "ethereum", address: PEPE_ETH, symbol: "PEPE", name: "Pepe", marketCap: null, sameName: 1, by: "t", others: [] };
    const c = fakeClient((e, b) => { if (e === "tgm/token-ohlcv") throw "boom"; return pepeRoutes()(e, b); }, { timeoutMs: 300 });
    const { checks } = await runChecks(c, claim(), resolved, 0);
    const price = checks.find((k) => k.id === "price")!;
    expect(price.ok).toBe(false);
    expect(price.error).toMatch(/boom|fetch|failed/i);
  });
});

describe("holding: C-EXIT needs the holders row, flow alone is O-TRIM (SCORING §5)", () => {
  it("net7d ≤ −T7 with no holders → O-TRIM", () => {
    const d = decide(claim({ type: "holding" }), evidence({ holders: null, flow7d: snap({ smart_trader: { net: -90_000, wallets: 20 } }) }));
    expect(d.ruleId).toBe("O-TRIM");
  });
});

describe("pass 3: the verb that won decides the strength; 'on ETH' keeps its token", () => {
  it("'surged … dumped' is a weak buying the model may flip to selling", () => {
    const a = extractClaim("$PEPE surged 40% today while smart money dumped into the rally");
    expect(a.type).toBe("buying");
    expect(a.typeStrength).toBe("weak");
    expect(mergeClaims(a, { token: "PEPE", type: "selling" }).type).toBe("selling");
  });
  it("'loading up on ETH' / 'bidding on SOL' / 'buying the dip on ETH' keep the coin without the model", () => {
    expect(extractClaim("Smart Money is loading up on ETH").token).toBe("ETH");
    expect(extractClaim("Whales are bidding on SOL").token).toBe("SOL");
    expect(extractClaim("smart money buying the dip on ETH").token).toBe("ETH");
    expect(extractClaim("Smart Money is buying PEPE on Ethereum").token).toBe("PEPE");
  });
  it("narrate: false skips the LLM prose but keeps the extraction", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: "extract_claim", arguments: JSON.stringify({ token: "PEPE", type: "buying", subject: "smart_money" }) } }] } }] }), { status: 200 });
    };
    const v = await rebut(fakeClient(pepeRoutes()), "Smart Money is aping $PEPE", { llm: { keys: ["a"], fetchImpl }, now: 0, narrate: false });
    expect(calls).toBe(1);
    expect(v.claim.extractor).toBe("llm");
    expect(v.prose.source).toBe("template");
  });
});
