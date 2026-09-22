import { describe, it, expect } from "vitest";
import { findChain, extractClaim, CHAIN_ALIAS_KEYS } from "../src/claim";

/**
 * Outside architecture review, round 3 (2026-09-23) — findings verified against the code, then fixed.
 * Each test is written so it fails against the code as it was.
 */

describe("a2a r01 · multi-word chain names survive the `on <chain>` match", () => {
  // the `on (…)` regex is lazy: it stopped at "binance", which is not an alias, so the chain hint was dropped and
  // CHAIN_ALIASES["binance smart chain"] was unreachable.
  it.each([
    ["Smart Money is buying $CAKE on binance smart chain", "bnb"],
    ["whales are loading $CAKE on the binance smart chain today", "bnb"],
    ["Smart Money is buying $CAKE on bnb chain", "bnb"],
    ["Smart Money is aping $PEPE on ethereum", "ethereum"],
    ["Smart Money is buying $X on the base network", "base"],
    ["Smart Money is buying $WIF on solana", "solana"],
    ["Smart Money is buying $HYPE on hyperliquid", "hyperevm"],
  ])("%s → %s", (text, chain) => {
    expect(findChain(text)).toBe(chain);
  });

  it("a claim on BSC still resolves its token, not the chain word", () => {
    const c = extractClaim("Smart Money is buying $CAKE on binance smart chain");
    expect(c.chain).toBe("bnb");
    expect(c.token).toBe("CAKE");
  });

  it("no multi-word alias contains another, so the first match is the only match", () => {
    // findChain takes the first multi-word alias that matches; that is only safe while none nests inside another
    const multi = CHAIN_ALIAS_KEYS.filter((k) => k.includes(" "));
    for (const a of multi) for (const b of multi) if (a !== b) expect(b.includes(a)).toBe(false);
  });

  it("no chain phrase → no chain", () => {
    expect(findChain("Smart Money is buying $PEPE")).toBeUndefined();
  });
});
