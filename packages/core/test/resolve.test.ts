import { describe, it, expect } from "vitest";
import { resolveToken, NOT_A_NANSEN_CHAIN } from "../src/resolve";
import { fakeClient, pepeRoutes, searchTokens, PEPE_ETH } from "./helpers";

describe("resolveToken", () => {
  it("PEPE: the most-traded token among the top-ranked, not the bridge with the bigger cap, not the perp market", async () => {
    const c = fakeClient(pepeRoutes());
    const r = await resolveToken(c, "PEPE");
    expect(r).toMatchObject({ chain: "ethereum", address: PEPE_ETH, sameName: 3, by: "most traded of the top-ranked" });
    expect(r!.others.map((o) => o.chain)).toEqual(["bnb", "arbitrum"]);
    expect(c.creditsSpent).toBe(0);
  });
  it("HYPE: a native coin resolves to its home chain even when a copy ranks higher", async () => {
    const c = fakeClient(() =>
      searchTokens([
        { chain: "hyperliquid", address: "HYPE", symbol: "HYPE", name: "HYPE", rank: 25 },
        { chain: "solana", address: "98sMhv", symbol: "HYPE", name: "HYPE", rank: 317, market_cap: 6.8e7, volume_24h: 9e6 },
        { chain: "hyperevm", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", symbol: "HYPE", name: "HYPE", rank: 318, market_cap: 1.98e10, volume_24h: 5e6 },
      ]),
    );
    expect(await resolveToken(c, "HYPE")).toMatchObject({ chain: "hyperevm", sameName: 1 });
  });
  it("ETH resolves to native ETH (0xeeee…) on ethereum, not the robinhood copy that trades more (live search 2026-09-18)", async () => {
    const c = fakeClient(() =>
      searchTokens([
        { chain: "hyperliquid", address: "ETH", symbol: "ETH", name: "ETH", rank: 23 },
        { chain: "base", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", symbol: "ETH", name: "Ethereum", rank: 313, volume_24h: 2.9e7 },
        { chain: "ethereum", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", symbol: "ETH", name: "Ethereum", rank: 314, volume_24h: 1.99e8 },
        { chain: "robinhood", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", symbol: "ETH", name: "Ether", rank: 604, volume_24h: 2.78e8 },
      ]),
    );
    expect(await resolveToken(c, "ETH")).toMatchObject({ chain: "ethereum", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" });
  });
  it("falls back to the known address when search has no same-name native", async () => {
    const c = fakeClient(() => searchTokens([]));
    expect(await resolveToken(c, "HYPE")).toMatchObject({ chain: "hyperevm", symbol: "HYPE", by: "only match" });
  });
  it("a chain hint wins over volume", async () => {
    const r = await resolveToken(fakeClient(pepeRoutes()), "PEPE", "bnb");
    expect(r).toMatchObject({ chain: "bnb", by: "chain hint (bnb)" });
  });
  it("a chain hint with no match on that chain is null (U-TOKEN with the chain), never a silent pick of another chain's book", async () => {
    // the unfiltered search has no solana PEPE; the chain-filtered follow-up (0 credits) finds none either
    const c = fakeClient((endpoint, body) => (endpoint === "search/general" && body.chain === "solana" ? searchTokens([]) : pepeRoutes()(endpoint, body)));
    expect(await resolveToken(c, "PEPE", "solana")).toBeNull();
    expect(c.calls.map((x) => x.body.chain)).toEqual([undefined, "solana"]);
    expect(c.creditsSpent).toBe(0);
  });
  it("null when Nansen knows no token by that name", async () => {
    expect(await resolveToken(fakeClient(() => searchTokens([])), "XQZPLM")).toBeNull();
  });
  it("fuzzy hits and non-scorable chains are ignored", async () => {
    const c = fakeClient(() => searchTokens([{ chain: "hyperliquid", address: "X", symbol: "PEPE" }, { chain: "solana", address: "F", symbol: "PEPEX", name: "Pepe X" }]));
    expect(await resolveToken(c, "PEPE")).toBeNull();
  });
  it("the rank window excludes far-down copies even if they trade more", async () => {
    const c = fakeClient(() =>
      searchTokens([
        { chain: "ethereum", address: "0x1", rank: 100, market_cap: 1e9, volume_24h: 1e5 },
        { chain: "base", address: "0x2", rank: 5000, market_cap: 1e9, volume_24h: 1e9 },
      ]),
    );
    expect(await resolveToken(c, "PEPE")).toMatchObject({ address: "0x1" });
  });
  it("lists the coins whose home chain Nansen does not index", () => {
    expect(NOT_A_NANSEN_CHAIN.ZEC).toBe("Zcash");
    expect(NOT_A_NANSEN_CHAIN.BTC).toBe("Bitcoin");
    expect(NOT_A_NANSEN_CHAIN.PEPE).toBeUndefined();
  });
});
