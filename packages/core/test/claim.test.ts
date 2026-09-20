import { describe, it, expect } from "vitest";
import { extractClaim, findChain, findToken, findType, findSubject, mergeClaims, validClaim, negatedProblem } from "../src/claim";

/** The ten spike claims (specs/spike-claims.md) plus the hero phrasing: what the rules extractor must read. */
const SPIKE: Array<[string, string, string, string | undefined]> = [
  ["Smart Money is aping $PEPE hard today 🐋", "PEPE", "buying", "smart_money"],
  ["The top 100 addresses increased holdings by 6.07% over 30 days, smart money positions surged 307%. $PEPE", "PEPE", "buying", "smart_money"],
  ["The 820 million unlocked on September 6 was silently absorbed, and Hyperliquid Strategies just bought another 29.65 million $HYPE", "HYPE", "buying", undefined],
  ["UNI has rallied 2.7-fold from its lows, with smart money logging gains of nearly 1000%.", "UNI", "holding", "smart_money"],
  ["A whale sold 600,000 UNI tokens, valued at approximately $5.1 million.", "UNI", "selling", "whales"],
  ["Whale Deposits 440K $HYPE ($36M) into FalconX, Withdraws 12.25K $ETH ($30M)", "HYPE", "selling", "whales"],
  ["A whale has purchased 6,972 ETH over the past 9 hours, worth approximately $17.15 million.", "ETH", "buying", "whales"],
  ["$EDEL Surges After Edel Joins DTC Digital Asset Working Group as Whales Accumulate Nearly 8M $EDEL", "EDEL", "buying", "whales"],
  ["A whale built a $1.04 million position in MEME, claiming the top spot on the token's holder list.", "MEME", "buying", "whales"],
  ["Artificial Inu (AI) whale sells off holdings at a high price, pushing the token price down over 12% in a short time", "AI", "selling", "whales"],
  ["Zcash whales accumulate: three fresh wallets pull 28,759 $ZEC ($41.43M) from Binance and other exchanges", "ZEC", "buying", "whales"],
];

describe("extractClaim on the spike claims", () => {
  for (const [text, token, type, subject] of SPIKE) {
    it(`${token} · ${type} · ${subject ?? "(no subject)"}`, () => {
      const c = extractClaim(text);
      expect(c.token).toBe(token);
      expect(c.type).toBe(type);
      expect(c.subject).toBe(subject);
      expect(c.extractor).toBe("rules");
      expect(c.problem).toBeUndefined();
    });
  }
});

describe("findToken precedence", () => {
  it("$TICKER beats everything, case-normalised", () => {
    expect(findToken("whales buying $pepe while UNI dumps")).toBe("PEPE");
  });
  it("(TICKER) in parentheses comes second", () => {
    expect(findToken("Artificial Inu (AI) whale sells")).toBe("AI");
  });
  it("names map to tickers, longest name first", () => {
    expect(findToken("smart money loading pudgy penguins")).toBe("PENGU");
    expect(findToken("whales are accumulating ethereum")).toBe("ETH");
  });
  it("bare upper-case words that are not tickers are skipped", () => {
    expect(findToken("BREAKING: SM is loading USDT into a CEX")).toBeUndefined();
    expect(findToken("BREAKING: SM is loading BONK")).toBe("BONK");
  });
  it("AI is only a token as $AI or (AI)", () => {
    expect(findToken("AI agents are buying")).toBeUndefined();
    expect(findToken("whales buying $AI")).toBe("AI");
  });
  it("numbers with K/M suffix are not tickers", () => {
    expect(findToken("bought 12M of it")).toBeUndefined();
  });
  it("among two bare candidates, the one before the verb and the one after are both weighed — the closer one (here, after) wins", () => {
    expect(findToken("ABC is up, smart money bought DEF")).toBe("DEF");
  });
});

describe("findChain", () => {
  it("reads 'on <chain>' and aliases", () => {
    expect(findChain("SM loading $WIF on Solana")).toBe("solana");
    expect(findChain("aping $X on the BSC chain")).toBe("bnb");
    expect(findChain("$AI on Robinhood Chain")).toBe("robinhood");
    expect(findChain("smart money on base is buying")).toBe("base");
    expect(findChain("#sol whales")).toBe("solana");
  });
  it("a trailing word after the chain name does not get pulled into the match", () => {
    expect(findChain("SM buying $X on ethereum classic")).toBe("ethereum");
  });
  it("reads a bare '<chain> chain' phrase with no preceding 'on'", () => {
    expect(findChain("PEPE, arbitrum chain deployment, is pumping")).toBe("arbitrum");
  });
  it("returns undefined when no chain is named ('on' + something else)", () => {
    expect(findChain("bought it on Monday")).toBeUndefined();
    expect(findChain("whales are on fire")).toBeUndefined();
  });
});

describe("findType: the first verb in reading order wins", () => {
  it("'sold X to purchase Y' is a selling claim about X", () => {
    expect(findType("A group of whale addresses sold 602 BTC and rebalanced their positions to purchase 18,780 ETH.")).toBe("selling");
  });
  it("deposits to an exchange read as selling, withdrawals as buying", () => {
    expect(findType("whale deposited 1M $X into Binance")).toBe("selling");
    expect(findType("whale withdrew 1M $X from Binance")).toBe("buying");
  });
  it("holding phrases", () => {
    expect(findType("smart money hasn't sold a single $X")).toBe("holding");
    expect(findType("SM still holding $X through the dip")).toBe("holding");
  });
  it("no verb → undefined", () => {
    expect(findType("$X to the moon 🚀")).toBeUndefined();
  });
});

describe("findSubject", () => {
  it("earliest mention wins when both appear", () => {
    expect(findSubject("whales and smart money are buying")).toBe("whales");
    expect(findSubject("smart money (not whales) is buying")).toBe("smart_money");
  });
  it("funds and insiders count as smart money", () => {
    expect(findSubject("funds are loading $X")).toBe("smart_money");
  });
  it("none → undefined", () => {
    expect(findSubject("everyone is buying $X")).toBeUndefined();
  });
});

describe("extractClaim problems (never throws, always says why)", () => {
  it("empty", () => {
    expect(extractClaim("   ").problem).toMatch(/empty/);
  });
  it("an EVM address", () => {
    expect(extractClaim("0x6982508145454ce325ddbe47a25d4ec3d2311933").problem).toMatch(/address/);
  });
  it("a Solana address", () => {
    expect(extractClaim("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263").problem).toMatch(/address/);
  });
  it("no token", () => {
    expect(extractClaim("smart money is buying everything today").problem).toMatch(/no token/);
  });
  it("not a flow claim", () => {
    expect(extractClaim("$ABC will 10x after the listing").problem).toMatch(/not a flow claim/);
  });
  it("garbage", () => {
    const c = extractClaim("qwerty ;;; !!! 12345");
    expect(c.problem).toBeDefined();
    expect(validClaim(c)).toBe(false);
  });
  it("collapses whitespace and keeps the raw text", () => {
    expect(extractClaim("  SM   buying\n$X  ").raw).toBe("SM buying $X");
  });
});

describe("mergeClaims (LLM never overrides a $TICKER, chain must be in the text)", () => {
  const rules = extractClaim("Whale Deposits 440K $HYPE ($36M) into FalconX, Withdraws 12.25K $ETH ($30M)");
  it("null LLM → rules unchanged", () => {
    expect(mergeClaims(rules, null)).toBe(rules);
  });
  it("LLM token is ignored when the text carries a $TICKER", () => {
    const m = mergeClaims(rules, { token: "ETH", type: "buying", subject: "whales" });
    expect(m.token).toBe("HYPE");
    expect(m.type).toBe("selling"); // the rules read "deposits into FalconX" — the model's verb only fills a gap
    expect(m.extractor).toBe("llm");
  });
  it("LLM chain is dropped unless the chain word appears in the text", () => {
    expect(mergeClaims(rules, { token: "HYPE", chain: "ethereum" }).chain).toBeUndefined();
    const r2 = extractClaim("whales buying HYPE on hyperevm");
    expect(mergeClaims(r2, { token: "HYPE", chain: "hyperevm" }).chain).toBe("hyperevm");
  });
  it("LLM fills a token the rules could not find", () => {
    const r = extractClaim("smart money is loading the frog coin");
    expect(r.token).toBeUndefined();
    const m = mergeClaims(r, { token: "pepe", type: "buying" });
    expect(m.token).toBe("PEPE");
    expect(validClaim(m)).toBe(true);
  });
  it("subject defaults to smart_money", () => {
    expect(mergeClaims(extractClaim("everyone buying $X"), { token: "X", type: "buying" }).subject).toBe("smart_money");
  });
  it("a subject keyword in the text beats the model's subject", () => {
    expect(mergeClaims(extractClaim("Whales have been accumulating $EDEL"), { token: "EDEL", type: "buying", subject: "smart_money" }).subject).toBe("whales");
    expect(mergeClaims(extractClaim("everyone buying $X"), { token: "X", type: "buying", subject: "whales" }).subject).toBe("whales");
  });
  it("the negated fallback verb, when the model gives none, is read from the rules' own text", () => {
    const r = extractClaim("Smart Money is NOT buying $PEPE");
    const m = mergeClaims(r, { token: "PEPE" });
    expect(m.problem).toMatch(/Smart Money is buying \$PEPE/);
  });
  it("no token from either side → problem is the missing-token message", () => {
    const r = extractClaim("smart money is loading up hard");
    expect(r.token).toBeUndefined();
    const m = mergeClaims(r, { type: "buying" });
    expect(m.token).toBeUndefined();
    expect(m.problem).toMatch(/no token found/);
  });
  it("a token but no verb on either side → problem is the not-a-flow-claim message", () => {
    const r = extractClaim("$PEPE was mentioned by whales");
    expect(r.type).toBeUndefined();
    const m = mergeClaims(r, { token: "PEPE" });
    expect(m.type).toBeUndefined();
    expect(m.problem).toMatch(/not a flow claim/);
  });
});

describe("negatedProblem", () => {
  it("names the token when there is one, and falls back to a placeholder when there isn't", () => {
    expect(negatedProblem({ raw: "x", subject: "smart_money", extractor: "rules", token: "PEPE" }, "buying")).toMatch(/Smart Money is buying \$PEPE/);
    expect(negatedProblem({ raw: "x", extractor: "rules" })).toMatch(/Smart Money is buying \$X/);
  });
});
