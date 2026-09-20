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
  it("a native coin absent from the same-name matches is still found by its known placeholder address among the raw search hits", async () => {
    const c = fakeClient(() =>
      searchTokens([{ chain: "hyperevm", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", symbol: "WEIRD", name: "Weird Token", rank: 5 }]),
    );
    const r = await resolveToken(c, "HYPE");
    expect(r).toMatchObject({ chain: "hyperevm", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", by: "only match" });
  });
  it("byCap ties on volume fall through to market cap, an undefined cap losing to a defined one", async () => {
    // built by hand (not the searchTokens() helper, which defaults volume/cap/rank) so market_cap is genuinely absent
    const raw = (tokens: Array<Record<string, unknown>>) => ({ tokens, total_results: tokens.length });
    const c = fakeClient(() => raw([
      { name: "Pepe", symbol: "PEPE", chain: "ethereum", address: "0x1", rank: 10, volume_24h: 5, market_cap: 500 },
      { name: "Pepe", symbol: "PEPE", chain: "base", address: "0x2", rank: 11, volume_24h: 5 }, // no market_cap at all
    ]));
    const r = await resolveToken(c, "PEPE");
    expect(r).toMatchObject({ chain: "ethereum", address: "0x1" });
  });
  it("byCap ties on both volume and market cap fall through to rank — with no rank on either side, the fallback runs both times", async () => {
    const raw = (tokens: Array<Record<string, unknown>>) => ({ tokens, total_results: tokens.length });
    const c = fakeClient(() => raw([
      { name: "Pepe", symbol: "PEPE", chain: "ethereum", address: "0x1", volume_24h: 5, market_cap: 500 },
      { name: "Pepe", symbol: "PEPE", chain: "base", address: "0x2", volume_24h: 5, market_cap: 500 },
    ]));
    const r = await resolveToken(c, "PEPE");
    expect(["0x1", "0x2"]).toContain(r!.address);
  });
  it("a chain hint with several matches already in the initial search is tiebroken there (volume ties → rank, some sides missing)", async () => {
    const raw = (tokens: Array<Record<string, unknown>>) => ({ tokens, total_results: tokens.length });
    const c = fakeClient(() => raw([
      { name: "Pepe", symbol: "PEPE", chain: "ethereum", address: "0x1", rank: 10, market_cap: 500 }, // no volume_24h
      { name: "Pepe", symbol: "PEPE", chain: "ethereum", address: "0x2" }, // no volume_24h, no rank, no market_cap at all
      { name: "Pepe", symbol: "PEPE", chain: "ethereum", address: "0x3", rank: 20 }, // no volume_24h, no market_cap
      { name: "Pepe", symbol: "PEPE", chain: "ethereum", address: "0x4", rank: 30 }, // no volume_24h, no market_cap
    ]));
    const r = await resolveToken(c, "PEPE", "ethereum");
    expect(r).toMatchObject({ chain: "ethereum", address: "0x1", by: "chain hint (ethereum)", sameName: 4 });
    // the rankless 0x2 sorts last among "others", on both sides of pairwise comparisons (three others, not just two)
    expect(r!.others.map((o) => o.address)).toEqual(["0x3", "0x4", "0x2"]);
    expect(r!.others.find((o) => o.address === "0x2")!.marketCap).toBeNull();
  });
  it("a chain hint with no same-name match anywhere in the initial search falls back to a per-chain search, filtering out wrong names and wrong chains, tiebroken by volume then rank (neither reported, so both fall back)", async () => {
    const raw = (tokens: Array<Record<string, unknown>>) => ({ tokens, total_results: tokens.length });
    const c = fakeClient((endpoint, body) => {
      if (endpoint === "search/general" && body.chain === "solana")
        return raw([
          { name: "Pepe", symbol: "PEPE", chain: "solana", address: "solA" }, // no volume_24h, no rank
          { name: "Pepe", symbol: "PEPE", chain: "solana", address: "solB" }, // no volume_24h, no rank
          { name: "Not Pepe", symbol: "NOTPEPE", chain: "solana", address: "solC", volume_24h: 999 }, // wrong name
          { name: "Pepe", symbol: "PEPE", chain: "bnb", address: "bnbX", volume_24h: 999 }, // wrong chain
        ]);
      return pepeRoutes()(endpoint, body);
    });
    const r = await resolveToken(c, "PEPE", "solana");
    expect(r?.chain).toBe("solana");
    expect(["solA", "solB"]).toContain(r!.address);
    expect(r).toMatchObject({ by: "chain hint (solana)" });
  });
  it("lists the coins whose home chain Nansen does not index", () => {
    expect(NOT_A_NANSEN_CHAIN.ZEC).toBe("Zcash");
    expect(NOT_A_NANSEN_CHAIN.BTC).toBe("Bitcoin");
    expect(NOT_A_NANSEN_CHAIN.PEPE).toBeUndefined();
  });
});
