import { describe, it, expect } from "vitest";
import { rebut, verdictHash, hashRecord, templateProse, rebuttalText, type RebutEvent } from "../src/rebut";
import { fakeClient, pepeRoutes, searchTokens, claim, evidence, snap } from "./helpers";

const NOW = Date.UTC(2026, 8, 18, 12, 30);

describe("rebut — end to end on a fake network", () => {
  it("the hero claim: CONTRADICTED/C-NOBODY at 10 credits with a 64-hex hash and 7 provenance rows", async () => {
    const c = fakeClient(pepeRoutes());
    const v = await rebut(c, "Smart Money is aping $PEPE hard today 🐋", { llm: null, now: NOW });
    expect(v.label).toBe("CONTRADICTED");
    expect(v.ruleId).toBe("C-NOBODY");
    expect(v.claim).toMatchObject({ token: "PEPE", type: "buying", subject: "smart_money", extractor: "rules" });
    expect(v.resolved?.chain).toBe("ethereum");
    expect(v.credits).toBe(10);
    expect(v.calls).toBe(7);
    expect(v.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(v.prose.source).toBe("template");
    expect(v.warnings.join(" ")).toMatch(/3 tokens named PEPE/);
  });
  it("the same inputs give the same hash; a different label gives a different one", async () => {
    const a = await rebut(fakeClient(pepeRoutes()), "SM aping $PEPE", { llm: null, now: NOW });
    const b = await rebut(fakeClient(pepeRoutes()), "SM aping $PEPE", { llm: null, now: NOW });
    expect(a.hash).toBe(b.hash);
    const c = await rebut(fakeClient(pepeRoutes({ flow1d: { smart_trader_net_flow_usd: -300_000, smart_trader_wallet_count: 9 } })), "SM aping $PEPE", { llm: null, now: NOW });
    expect(c.label).toBe("CONTRADICTED");
    expect(c.ruleId).toBe("C-SIGN");
    expect(c.hash).not.toBe(a.hash);
  });
  it("cents never change the hash", () => {
    const d = { label: "CONFIRMED" as const, ruleId: "A-FLOW", reasons: [], threshold: 5000 };
    const e1 = evidence({ flow1d: snap({ smart_trader: { net: 120_000.12, wallets: 5 } }) });
    const e2 = evidence({ flow1d: snap({ smart_trader: { net: 120_000.49, wallets: 5 } }) });
    expect(verdictHash(claim(), null, d, e1)).toBe(verdictHash(claim(), null, d, e2));
    expect(hashRecord(claim(), null, d, e1).net1d).toBe(120_000);
  });
  it("streams events in order: input → claim → resolved → 6 checks → verdict → prose", async () => {
    const types: string[] = [];
    await rebut(fakeClient(pepeRoutes()), "SM aping $PEPE", { llm: null, now: NOW, onProgress: (e: RebutEvent) => types.push(e.type) });
    expect(types.slice(0, 3)).toEqual(["input", "claim", "resolved"]);
    expect(types.filter((t) => t === "check")).toHaveLength(6);
    expect(types.slice(-2)).toEqual(["verdict", "prose"]);
  });
  it("a forced --chain overrides the text", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "SM aping $PEPE", { llm: null, now: NOW, chain: "bnb" });
    expect(v.resolved?.chain).toBe("bnb");
  });
  it("a pre-extracted claim (fixture replay) skips extraction", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "ignored", { llm: null, now: NOW, claim: claim({ extractor: "llm" }) });
    expect(v.claim.extractor).toBe("llm");
    expect(v.label).toBe("CONTRADICTED");
  });
});

describe("rebut — UNVERIFIABLE paths spend nothing they need not", () => {
  it("empty input", async () => {
    const c = fakeClient(pepeRoutes());
    const v = await rebut(c, "   ", { llm: null });
    expect(v).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-CLAIM", credits: 0, calls: 0 });
    expect(v.reasons[0]).toMatch(/empty/);
  });
  it("an address instead of a claim", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "0x6982508145454ce325ddbe47a25d4ec3d2311933", { llm: null });
    expect(v).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-CLAIM", calls: 0 });
    expect(v.reasons[0]).toMatch(/address/);
  });
  it("not a flow claim", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "$PEPE will 10x after the listing 🚀", { llm: null });
    expect(v).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-CLAIM", calls: 0 });
  });
  it("a coin whose chain Nansen does not index (0 credits, no search)", async () => {
    const c = fakeClient(pepeRoutes());
    const v = await rebut(c, "Zcash whales accumulate $ZEC", { llm: null });
    expect(v).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-CHAIN", calls: 0 });
    expect(v.reasons[0]).toMatch(/Zcash/);
  });
  it("…unless a chain is named", async () => {
    const c = fakeClient((e, b) => (e === "search/general" ? searchTokens([{ chain: "bnb", address: "0x1ba4", symbol: "ZEC", name: "Zcash Token", rank: 316 }]) : pepeRoutes()(e, b)));
    const v = await rebut(c, "whales accumulate $ZEC on bnb", { llm: null, now: NOW });
    expect(v.resolved?.chain).toBe("bnb");
  });
  it("no token by that name on Nansen (search is free)", async () => {
    const c = fakeClient(() => searchTokens([]));
    const v = await rebut(c, "SM is loading $XQZPLM", { llm: null });
    expect(v).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-TOKEN", credits: 0, calls: 1 });
  });
  it("garbage and a non-EVM string never throw", async () => {
    for (const s of ["qwerty ;;; !!! 12345", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "🐋🐋🐋", "SELECT * FROM claims;"]) {
      const v = await rebut(fakeClient(pepeRoutes()), s, { llm: null });
      expect(v.label).toBe("UNVERIFIABLE");
    }
  });
  it("fewer than 2 checks answering → U-CHECKS, failed rows listed in warnings", async () => {
    const c = fakeClient((e, b) => (e === "search/general" ? pepeRoutes()(e, b) : new Response("down", { status: 503 })), { timeoutMs: 300 });
    const v = await rebut(c, "SM aping $PEPE", { llm: null, now: NOW });
    expect(v).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-CHECKS" });
    expect(v.warnings.filter((w) => /unavailable/.test(w))).toHaveLength(6);
    expect(v.checks.every((k) => !k.ok)).toBe(true);
  });
});

describe("prose and the copy text", () => {
  it("template prose names the verdict, the token and the first reason", () => {
    const t = templateProse(claim(), { chain: "ethereum", address: "0x", symbol: "PEPE", name: "Pepe", marketCap: null, sameName: 1, by: "", others: [] }, { label: "CONTRADICTED", ruleId: "C-SIGN", reasons: ["smart money net sold $212K in 24 h"], threshold: 5000 });
    expect(t).toBe("Nansen disagrees that Smart Money are buying PEPE on ethereum. Smart money net sold $212K in 24 h.");
  });
  it("rebuttalText carries the label, the reasons, the credits and the hash prefix", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "SM aping $PEPE", { llm: null, now: NOW });
    const t = rebuttalText(v, "https://x/r/abc");
    expect(t).toMatch(/^CONTRADICTED — "SM aping \$PEPE"/);
    expect(t).toMatch(/6\/6 calls, 10 credits · [0-9a-f]{12} · https:\/\/x\/r\/abc/);
  });
});
