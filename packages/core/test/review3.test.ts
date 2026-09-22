import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { findChain, extractClaim, CHAIN_ALIAS_KEYS } from "../src/claim";
import { mkdirSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskCache, type CacheEntry } from "../src/cache";
import { NansenClient, RateLimiter } from "../src/client";
import { CachedNansenClient } from "../src/cache";

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

describe("a2a r01 · one rate limiter can pace several clients", () => {
  it("clients sharing a limiter do not exceed rps across them", async () => {
    const limiter = new RateLimiter(2);
    const t0 = Date.now();
    // 4 takes at 2 rps: the 3rd and 4th must wait out the first rolling second
    await Promise.all([limiter.take(), limiter.take(), limiter.take(), limiter.take()]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });

  it("an injected limiter is used instead of a fresh one", async () => {
    const limiter = new RateLimiter(5);
    const take = vi.spyOn(limiter, "take");
    const fetchImpl = (async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
    const a = new NansenClient("nsn_test_key", { limiter, fetchImpl });
    const b = new NansenClient("nsn_test_key", { limiter, fetchImpl });
    await a.post("tgm/holders", {});
    await b.post("tgm/holders", {});
    expect(take).toHaveBeenCalledTimes(2); // both clients went through the same bucket
  });
});

describe("a2a r01 · a caller that hangs up stops the spend", () => {
  const key = "nsn_test_key";

  it("an already-aborted signal makes no network call at all", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
    const c = new NansenClient(key, { fetchImpl, signal: ctrl.signal });
    await expect(c.post("tgm/holders", {})).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(c.calls.at(-1)!.ok).toBe(false); // the abandoned call still appears in provenance
    expect(c.creditsSpent).toBe(0);
  });

  it("an abort mid-flight is not retried — the retry is exactly the spend the signal exists to stop", async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      ctrl.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError", signal: init?.signal });
    }) as unknown as typeof fetch;
    const c = new NansenClient(key, { fetchImpl, signal: ctrl.signal });
    await expect(c.post("tgm/holders", {})).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // one attempt, not two
  });

  it("without a caller signal a timeout still gets its one retry", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    const c = new NansenClient(key, { fetchImpl, timeoutMs: 20 });
    await expect(c.post("tgm/holders", {})).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a live signal that never fires changes nothing", async () => {
    const ctrl = new AbortController();
    const fetchImpl = (async () => new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
    const c = new CachedNansenClient(key, { fetchImpl, signal: ctrl.signal, store: { get: () => undefined, set: () => {} } });
    await expect(c.post("tgm/holders", {})).resolves.toEqual({ ok: true });
  });
});
