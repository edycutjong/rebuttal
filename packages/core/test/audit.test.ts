import { describe, it, expect } from "vitest";
import { extractClaim, mergeClaims, validClaim, findType, findToken } from "../src/claim.js";
import { resolveToken } from "../src/resolve.js";
import { decide } from "../src/decide.js";
import { rebut } from "../src/rebut.js";
import { fakeClient, pepeRoutes, searchTokens, evidence, claim, snap, PEPE_ETH } from "./helpers.js";

/** Independent audit, 2026-09-19 — defects found on the live site with unseen claims. Each test is the live input that broke. */

describe("audit · negated claims are refused, never checked as their positive form", () => {
  const NEGATED = [
    "Smart Money is NOT buying $PEPE",
    "Smart money isn't buying $LINK anymore",
    "Smart money never bought $PEPE",
    "Smart money stopped buying $PEPE",
    "Whales haven't bought $UNI this week",
    "Smart Money doesn't accumulate $AERO",
    "Whales are no longer selling $HYPE",
  ];
  for (const text of NEGATED)
    it(`"${text}" → UNVERIFIABLE with the positive form named`, () => {
      const c = extractClaim(text);
      expect(c.negated).toBe(true);
      expect(c.type).toBeUndefined();
      expect(validClaim(c)).toBe(false);
      expect(c.problem).toMatch(/negated claim/);
      expect(c.problem).toMatch(/\$(PEPE|LINK|UNI|AERO|HYPE)/);
    });
  it("the live case: 'Smart Money is NOT buying $PEPE' answered CONTRADICTED / C-NOBODY (no Smart Money wallet traded) — the inverse of what the post said", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "Smart Money is NOT buying $PEPE", { llm: null });
    expect(v.label).toBe("UNVERIFIABLE");
    expect(v.ruleId).toBe("U-CLAIM");
    expect(v.credits).toBe(0);
    expect(v.calls).toBe(0);
    expect(v.reasons[0]).toMatch(/Smart Money is buying \$PEPE/);
  });
  it("the LLM cannot un-negate it: a 'selling' (or 'buying') read of a denial stays a refusal", () => {
    const r = extractClaim("Smart Money is NOT buying $PEPE");
    for (const type of ["selling", "buying", "holding"] as const) {
      const m = mergeClaims(r, { token: "PEPE", type, subject: "smart_money" });
      expect(m.type).toBeUndefined();
      expect(validClaim(m)).toBe(false);
      expect(m.problem).toMatch(/negated claim/);
    }
  });
  it("a negated verb followed by a positive one: the positive verb decides", () => {
    expect(extractClaim("Smart Money is NOT buying $PEPE — they're dumping it").type).toBe("selling");
    expect(extractClaim("Whales didn't sell $UNI, they bought more").type).toBe("buying");
  });
  it("the holding idioms are not negations: 'hasn't sold' is holding, and a negator far from the verb does not count", () => {
    expect(extractClaim("Smart Money hasn't sold a single $UNI").type).toBe("holding");
    expect(extractClaim("Not financial advice, but Smart Money is buying $PEPE").type).toBe("buying");
    expect(findType("never seen smart money buying like this: $PEPE")).toBe("buying");
    expect(extractClaim("Smart Money is NOT buying $PEPE").negated).toBe(true);
  });
});

describe("audit · two tokens: the bare word nearest the verb is the subject", () => {
  it("'sold 602 BTC to purchase ETH' is about BTC (the rules used to skip BTC and check ETH's book — a Groq outage changed the verdict)", () => {
    const c = extractClaim("Smart Money sold 602 BTC to purchase ETH");
    expect(c.token).toBe("BTC");
    expect(c.type).toBe("selling");
    expect(c.tokenSource).toBe("bare");
    expect(findToken("A group of whale addresses sold 602 BTC and rebalanced their positions to purchase 18,780 ETH.")).toBe("BTC");
  });
  it("…and refuses at 0 credits on the rules path exactly like the LLM path (U-CHAIN)", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "Smart Money sold 602 BTC to purchase ETH", { llm: null });
    expect(v.ruleId).toBe("U-CHAIN");
    expect(v.calls).toBe(0);
  });
  it("the object after the verb wins a tie: 'bought ETH after the BTC dip' is about ETH; 'as BTC rips, whales loading WIF' is about WIF", () => {
    expect(extractClaim("Whales bought 12K ETH after the BTC dip").token).toBe("ETH");
    expect(extractClaim("as BTC rips, whales are loading WIF").token).toBe("WIF");
    expect(extractClaim("BTC dominance up while Smart Money accumulates BONK").token).toBe("BONK");
  });
  it("a $TICKER still beats every bare word", () => {
    expect(extractClaim("Smart Money sold BTC to buy $ETH").token).toBe("ETH");
  });
});

describe("audit · the chain named in the claim is the question, not a tiebreak", () => {
  const BASE_PEPE = "0x52b492a33e447cdb854c7fc19f1e57e8bfa1777d";
  it("'$PEPE on base': base PEPE ranks 2741 against ethereum's 374 and used to lose to the rank window silently (live 2026-09-19)", async () => {
    const c = fakeClient((endpoint, body) =>
      endpoint === "search/general"
        ? searchTokens([
            { chain: "ethereum", address: PEPE_ETH, rank: 374, volume_24h: 1_664_374 },
            { chain: "bnb", address: "0xbnb", rank: 375, volume_24h: 27_601 },
            { chain: "base", address: BASE_PEPE, name: "BasedPepe", rank: 2741, volume_24h: 2303 },
            { chain: "base", address: "0xbase2", rank: 6817, volume_24h: 489 },
          ])
        : pepeRoutes()(endpoint, body),
    );
    const r = await resolveToken(c, "PEPE", "base");
    expect(r).toMatchObject({ chain: "base", address: BASE_PEPE, by: "chain hint (base)" });
    expect(c.calls).toHaveLength(1);
  });
  it("when the unfiltered search never reached that chain, a chain-filtered search (0 credits) is asked before giving up", async () => {
    const c = fakeClient((endpoint, body) => {
      if (endpoint !== "search/general") return pepeRoutes()(endpoint, body);
      return body.chain === "base" ? searchTokens([{ chain: "base", address: BASE_PEPE, name: "BasedPepe", rank: 2741, volume_24h: 2303 }]) : searchTokens([{ chain: "ethereum", address: PEPE_ETH, rank: 374, volume_24h: 1_664_374 }]);
    });
    const r = await resolveToken(c, "PEPE", "base");
    expect(r).toMatchObject({ chain: "base", address: BASE_PEPE, by: "chain hint (base)", sameName: 2 });
    expect(c.calls.map((x) => x.body.chain)).toEqual([undefined, "base"]);
    expect(c.creditsSpent).toBe(0);
  });
  it("end to end: the verdict names the chain it could not find instead of checking another chain's book", async () => {
    const c = fakeClient((endpoint, body) => (endpoint === "search/general" && body.chain === "solana" ? searchTokens([]) : pepeRoutes()(endpoint, body)));
    const v = await rebut(c, "Smart Money buying $PEPE on Solana", { llm: null });
    expect(v.ruleId).toBe("U-TOKEN");
    expect(v.reasons[0]).toBe("no token named PEPE on Nansen (solana)");
    expect(v.credits).toBe(0);
  });
});

describe("audit · a flat verdict names the who-bought-sold rows the flow row hid", () => {
  it("ONDO live: flow-intelligence said 0 wallets while who-bought-sold named one Smart Money seller ($8K) — the reason now says so", () => {
    const e = evidence({
      flow1d: snap({ smart_trader: { net: 0, wallets: 0 }, top_pnl: { net: 13_024, wallets: 3 } }),
      flow7d: snap({ smart_trader: { net: 0, wallets: 0 } }),
      named: { buyUsd: 0, sellUsd: 8470, buyRows: 0, sellRows: 1, buyers: [], sellers: [{ address: "0x1", label: "Fund", usd: 8470 }] },
      table: { inTable: true, net24: 0, net7d: 0, traders: 2 },
    });
    const d = decide(claim({ raw: "Insiders buying $ONDO on ethereum", token: "ONDO" }), e);
    expect(d.ruleId).toBe("O-FLAT");
    expect(d.reasons).toContain("who-bought-sold names 0 Smart Money buyers ($0) and 1 seller ($8K) in 24 h");
  });
  it("with no named rows the line is absent (C-NOBODY stays C-NOBODY)", () => {
    const d = decide(claim(), evidence({ flow7d: snap({ smart_trader: { net: 4611, wallets: 53 } }) }));
    expect(d.ruleId).toBe("C-NOBODY");
    expect(d.reasons.some((r) => r.startsWith("who-bought-sold names"))).toBe(false);
  });
});

describe("audit · the Smart Money table line is the token's own row or nothing", () => {
  it("a netflow response whose rows are other tokens (filter ignored) reads 'not on the table', never another token's numbers", async () => {
    const c = fakeClient((endpoint, body) => {
      if (endpoint === "smart-money/netflow") return { data: [{ token_address: "0xsomeoneelse", token_symbol: "WIF", chain: "ethereum", net_flow_1h_usd: 0, net_flow_24h_usd: 9_999_999, net_flow_7d_usd: 0, net_flow_30d_usd: 0, trader_count: 500, token_age_days: 1, market_cap_usd: 1 }] };
      return pepeRoutes()(endpoint, body);
    });
    const v = await rebut(c, "Smart Money is aping $PEPE", { llm: null });
    expect(v.evidence.table).toEqual({ inTable: false, net24: null, net7d: null, traders: null });
    expect(v.reasons.join(" ")).not.toContain("500 traders");
  });
});
