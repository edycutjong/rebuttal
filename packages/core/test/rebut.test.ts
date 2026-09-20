import { describe, it, expect } from "vitest";
import { rebut, verdictHash, hashRecord, templateProse, rebuttalText, summaryForLlm, envLlm, type RebutEvent } from "../src/rebut";
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
  it("hashRecord defaults an absent subject to smart_money, same as the rest of the engine", () => {
    const d = { label: "CONFIRMED" as const, ruleId: "A-FLOW", reasons: [], threshold: 5000 };
    const withoutSubject = { raw: "x", token: "PEPE", type: "buying" as const, extractor: "rules" as const };
    expect(hashRecord(withoutSubject, null, d, evidence()).subject).toBe("smart_money");
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
  it("a chain hint Nansen does not accept is dropped with a warning, not passed through to resolveToken", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "SM aping $PEPE", { llm: null, now: NOW, chain: "not-a-real-chain" });
    expect(v.claim.chain).toBeUndefined();
    expect(v.warnings.join(" ")).toMatch(/not-a-real-chain.*not a Nansen token chain/);
    expect(v.resolved?.chain).toBe("ethereum"); // resolved on the default rank/volume rule, not the rejected hint
  });
  it("with no `llm` option given at all, it reads the environment (empty here, so no key and the template prose)", async () => {
    const prevKeys = process.env.GROQ_API_KEYS;
    const prevKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEYS;
    delete process.env.GROQ_API_KEY;
    try {
      const v = await rebut(fakeClient(pepeRoutes()), "SM aping $PEPE", { now: NOW });
      expect(v.prose.source).toBe("template");
      expect(v.llm.extract).toBeNull();
    } finally {
      if (prevKeys === undefined) delete process.env.GROQ_API_KEYS;
      else process.env.GROQ_API_KEYS = prevKeys;
      if (prevKey === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = prevKey;
    }
  });
  it("a pre-extracted claim that is invalid but carries no `problem` still gets a readable U-CLAIM reason", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "ignored", { llm: null, now: NOW, claim: { raw: "ignored", extractor: "rules" } });
    expect(v).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-CLAIM" });
    expect(v.reasons[0]).toBe("could not read a checkable claim");
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
  const resolved = { chain: "ethereum", address: "0x", symbol: "PEPE", name: "Pepe", marketCap: null, sameName: 1, by: "", others: [] };
  it("template prose names the verdict, the token and the first reason", () => {
    const t = templateProse(claim(), resolved, { label: "CONTRADICTED", ruleId: "C-SIGN", reasons: ["smart money net sold $212K in 24 h"], threshold: 5000 });
    expect(t).toBe("Nansen disagrees that Smart Money are buying PEPE on ethereum. Smart money net sold $212K in 24 h.");
  });
  it("names the 'holding' verb, and a single reason ends the sentence cleanly with no dangling em dash", () => {
    const t = templateProse(claim({ type: "holding" }), resolved, { label: "CONFIRMED", ruleId: "A-HOLD", reasons: ["Smart Money holds 38 wallets worth $12M"], threshold: 5000 });
    expect(t).toBe("Nansen agrees: Smart Money are holding PEPE on ethereum. Smart Money holds 38 wallets worth $12M.");
    expect(t).not.toMatch(/—\s*\./);
  });
  it("no reasons at all: both reason slots are empty (only the head sentence, plus the trailing period)", () => {
    const t = templateProse(claim(), resolved, { label: "UNVERIFIABLE", ruleId: "U-CLAIM", reasons: [], threshold: 0 });
    expect(t).toBe("This claim about PEPE on ethereum cannot be checked against Nansen. .");
  });
  it("summaryForLlm names the claim's own token when nothing resolved on Nansen", () => {
    const s = summaryForLlm(claim({ token: "XQZPLM" }), null, { label: "UNVERIFIABLE", ruleId: "U-TOKEN", reasons: ["no token named XQZPLM on Nansen"], threshold: 0 });
    expect(s).toMatch(/Token: XQZPLM/);
  });
  it("rebuttalText carries the label, the reasons, the credits and the hash prefix", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "SM aping $PEPE", { llm: null, now: NOW });
    const t = rebuttalText(v, "https://x/r/abc");
    expect(t).toMatch(/^CONTRADICTED — "SM aping \$PEPE"/);
    expect(t).toMatch(/6\/6 calls, 10 credits · [0-9a-f]{12} · https:\/\/x\/r\/abc/);
  });
  it("rebuttalText with no permalink omits the trailing separator, and truncates a raw claim over 120 chars", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "Smart Money is absolutely definitely for sure without a doubt aping the frog coin $PEPE so hard right now, today, this very minute", { llm: null, now: NOW });
    const t = rebuttalText(v);
    expect(v.claim.raw.length).toBeGreaterThan(120);
    expect(t).toMatch(/…"/);
    expect(t.split("\n")[2]).toMatch(/credits · [0-9a-f]{12}$/); // ends right after the hash — no " · permalink" tail
  });
  it("rebuttalText falls back to the claim's own token when nothing resolved, and to 'this' when there is no token either", async () => {
    const noToken = await rebut(fakeClient(pepeRoutes()), "smart money is loading up hard", { llm: null, now: NOW });
    expect(noToken.resolved).toBeNull();
    expect(rebuttalText(noToken)).toMatch(/^UNVERIFIABLE — .*\nthis: /);
    const noNansen = await rebut(fakeClient(() => searchTokens([])), "SM is loading $XQZPLM", { llm: null, now: NOW });
    expect(noNansen.resolved).toBeNull();
    expect(rebuttalText(noNansen)).toMatch(/^UNVERIFIABLE — .*\n\$XQZPLM: /);
  });
});

describe("envLlm", () => {
  it("prefers GROQ_API_KEYS, trims and drops blanks", () => {
    expect(envLlm({ GROQ_API_KEYS: " a, b ,,c ", GROQ_API_KEY: "unused" })).toEqual({ keys: ["a", "b", "c"] });
  });
  it("falls back to the single GROQ_API_KEY", () => {
    expect(envLlm({ GROQ_API_KEY: "z" })).toEqual({ keys: ["z"] });
  });
  it("neither set → null (no key at all)", () => {
    expect(envLlm({})).toBeNull();
  });
});
