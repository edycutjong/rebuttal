import { describe, it, expect } from "vitest";
import { resolveToken, NOT_A_NANSEN_CHAIN } from "../src/resolve.js";
import { fakeClient, pepeRoutes, searchTokens, PEPE_ETH } from "./helpers.js";

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
  it("ETH resolves to WETH on ethereum via the native map", async () => {
    const c = fakeClient(() => searchTokens([{ chain: "ethereum", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", name: "Wrapped Ether", rank: 3 }]));
    expect(await resolveToken(c, "ETH")).toMatchObject({ chain: "ethereum", symbol: "WETH" });
  });
  it("falls back to the known address when search has no same-name native", async () => {
    const c = fakeClient(() => searchTokens([]));
    expect(await resolveToken(c, "BTC")).toMatchObject({ chain: "ethereum", symbol: "WBTC", by: "only match" });
  });
  it("a chain hint wins over volume", async () => {
    const r = await resolveToken(fakeClient(pepeRoutes()), "PEPE", "bnb");
    expect(r).toMatchObject({ chain: "bnb", by: "chain hint (bnb)" });
  });
  it("a chain hint with no match on that chain falls back to the default pick", async () => {
    const r = await resolveToken(fakeClient(pepeRoutes()), "PEPE", "solana");
    expect(r).toMatchObject({ chain: "ethereum" });
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
    expect(NOT_A_NANSEN_CHAIN.PEPE).toBeUndefined();
  });
});
