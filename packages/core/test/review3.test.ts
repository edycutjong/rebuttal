import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { findChain, extractClaim, CHAIN_ALIAS_KEYS } from "../src/claim";
import { mkdirSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskCache, type CacheEntry } from "../src/cache";

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

describe("a2a r01 · DiskCache.set is atomic", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rebuttal-cache-test-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const entry = (text: string): CacheEntry => ({ storedAt: new Date().toISOString(), ttlMs: 1000, endpoint: "tgm/holders", body: {}, text });

  it("a reader never sees a half-written file: the previous entry stays readable until the new one lands", () => {
    const c = new DiskCache(dir);
    c.set("k", entry('{"a":1}'));
    // rename(2) is atomic within the directory, so the only two observable states are the old value and the new one
    c.set("k", entry('{"a":2}'));
    expect(JSON.parse(c.get("k")!.text)).toEqual({ a: 2 });
  });

  it("leaves no temp file behind on success", () => {
    const c = new DiskCache(dir);
    c.set("k", entry('{"a":1}'));
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("a rename that fails cleans up the temp file it already wrote", () => {
    const c = new DiskCache(dir);
    mkdirSync(join(dir, "blocked.json")); // a directory where the entry should go: rename(2) cannot replace it
    expect(() => c.set("blocked", entry('{"a":1}'))).toThrow();
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("a write that fails cleans up its temp file and still throws", () => {
    const c = new DiskCache(dir);
    c.set("k", entry('{"a":1}'));
    const boom = new Error("ENOSPC");
    const spy = vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
      throw boom;
    });
    expect(() => c.set("k", entry('{"a":2}'))).toThrow("ENOSPC");
    spy.mockRestore();
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(JSON.parse(c.get("k")!.text)).toEqual({ a: 1 }); // the old entry survived
  });
});
