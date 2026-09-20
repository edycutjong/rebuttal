import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CachedNansenClient, MemoryCache, DiskCache, cacheKey, cachedClientFromEnv } from "../src/cache";

// A footgun fix: a real shell with NANSEN_OFFLINE=1 exported must not change what this suite asserts — every
// test below that needs the "live" path builds its own client without an explicit `offline` option, so the
// ambient env is neutralized around the whole file; the offline-specific test still passes `offline: true` itself.
const REAL_NANSEN_OFFLINE = process.env.NANSEN_OFFLINE;
beforeEach(() => {
  delete process.env.NANSEN_OFFLINE;
});
afterEach(() => {
  if (REAL_NANSEN_OFFLINE === undefined) delete process.env.NANSEN_OFFLINE;
  else process.env.NANSEN_OFFLINE = REAL_NANSEN_OFFLINE;
});

const KEY = "nsn_test_key_0000000000000000000000";
function cached(routes: () => unknown, opts: Partial<ConstructorParameters<typeof CachedNansenClient>[1]> = {}) {
  let hits = 0;
  const fetchImpl: typeof fetch = async () => {
    hits++;
    return new Response(JSON.stringify(routes()), { status: 200 });
  };
  const store = new MemoryCache();
  const c = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store, ...opts });
  return { c, store, network: () => hits };
}

describe("CachedNansenClient", () => {
  it("cacheKey is stable across body key order", () => {
    expect(cacheKey("tgm/holders", { a: 1, b: 2 })).toBe(cacheKey("tgm/holders", { b: 2, a: 1 }));
    expect(cacheKey("tgm/holders", { a: 1 })).not.toBe(cacheKey("tgm/flows", { a: 1 }));
  });
  it("second identical call is served from cache at 0 credits with the same response hash", async () => {
    const { c, network } = cached(() => ({ data: [1] }));
    await c.post("tgm/holders", { chain: "ethereum", token_address: "0x1" });
    await c.post("tgm/holders", { token_address: "0x1", chain: "ethereum" });
    expect(network()).toBe(1);
    expect(c.calls.map((x) => x.cached)).toEqual([false, true]);
    expect(c.calls[0].responseHash).toBe(c.calls[1].responseHash);
    expect(c.creditsSpent).toBe(5);
    expect(c.oldestHit).toBeDefined();
  });
  it("expired entries are refetched", async () => {
    const { c, store, network } = cached(() => ({ v: 1 }), { ttlMs: 1 });
    await c.post("tgm/holders", { a: 1 });
    const key = cacheKey("tgm/holders", { a: 1 });
    store.set(key, { ...store.get(key)!, storedAt: new Date(Date.now() - 10_000).toISOString() });
    await c.post("tgm/holders", { a: 1 });
    expect(network()).toBe(2);
  });
  it("offline mode serves stale entries and errors on a miss instead of touching the network", async () => {
    const { c, store, network } = cached(() => ({ v: 1 }));
    await c.post("tgm/holders", { a: 1 });
    const key = cacheKey("tgm/holders", { a: 1 });
    store.set(key, { ...store.get(key)!, storedAt: "2000-01-01T00:00:00.000Z" });
    const off = new CachedNansenClient(KEY, {
      fetchImpl: async () => {
        throw new Error("network!");
      },
      store,
      offline: true,
    });
    expect(await off.post("tgm/holders", { a: 1 })).toEqual({ v: 1 });
    await expect(off.post("tgm/holders", { a: 2 })).rejects.toThrow(/NANSEN_OFFLINE/);
    expect(network()).toBe(1);
  });
});

describe("review fixes (2026-09-16)", () => {
  it("F1: nested bodies with different pagination get different keys", () => {
    const a = cacheKey("tgm/holders", { chain: "ethereum", token_address: "0x1", pagination: { page: 1, per_page: 20 } });
    const b = cacheKey("tgm/holders", { chain: "ethereum", token_address: "0x1", pagination: { page: 1, per_page: 100 } });
    const c = cacheKey("tgm/holders", { chain: "ethereum", token_address: "0x1", pagination: { per_page: 20, page: 1 } });
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });
  it("F2: ttlMs 0 (--no-cache) bypasses reads even when a fresh entry exists", async () => {
    const store = new MemoryCache();
    let hits = 0;
    const fetchImpl: typeof fetch = async () => {
      hits++;
      return new Response('{"v":1}', { status: 200 });
    };
    const normal = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store });
    await normal.post("tgm/holders", { a: 1 });
    const bypass = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store, ttlMs: 0 });
    await bypass.post("tgm/holders", { a: 1 });
    expect(hits).toBe(2);
    expect(bypass.calls[0].cached).toBe(false);
    // and the entry it wrote does not poison the next normal read
    const again = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store });
    await again.post("tgm/holders", { a: 1 });
    expect(hits).toBe(2);
    expect(again.calls[0].cached).toBe(true);
  });
});

describe("review round 2: creditsSpent on the cached client", () => {
  it("R2-2: failed calls are not charged", async () => {
    const store = new MemoryCache();
    const c = new CachedNansenClient(KEY, { fetchImpl: async () => new Response("x", { status: 503 }), rps: 1000, store });
    await expect(c.post("tgm/holders", { a: 1 }, [], { retries: 0 })).rejects.toThrow();
    expect(c.calls[0]).toMatchObject({ ok: false, credits: 0 });
    expect(c.creditsSpent).toBe(0);
  });
});

describe("header-reported credits on the cached client", () => {
  it("a live call records the header-reported credit cost, not the table price", async () => {
    const store = new MemoryCache();
    const c = new CachedNansenClient(KEY, {
      fetchImpl: async () => new Response('{"v":1}', { status: 200, headers: { "x-nansen-credits-used": "9" } }),
      rps: 1000,
      store,
    });
    await c.post("tgm/holders", { a: 1 });
    expect(c.calls[0].credits).toBe(9);
  });
  it("a live call to an endpoint outside the CREDITS table with no reported cost falls back to 1 credit", async () => {
    const store = new MemoryCache();
    const c = new CachedNansenClient(KEY, { fetchImpl: async () => new Response('{"v":1}', { status: 200 }), rps: 1000, store });
    await c.post("totally/unknown-endpoint", { a: 1 });
    expect(c.calls[0].credits).toBe(1);
  });
});

describe("DiskCache", () => {
  it("round-trips an entry, misses cleanly, and survives a corrupt file on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "rebuttal-cache-"));
    const d = new DiskCache(dir);
    d.set("k", { storedAt: "x", ttlMs: 1, endpoint: "e", body: {}, text: "{}" });
    expect(d.get("k")?.text).toBe("{}");
    expect(d.get("missing")).toBeUndefined();
    writeFileSync(join(dir, "corrupt.json"), "{not json");
    expect(d.get("corrupt")).toBeUndefined();
  });
  it("defaults to a `.cache` directory under cwd when none is given", () => {
    const d = new DiskCache();
    d.set("rebuttal-cache-default-test", { storedAt: "x", ttlMs: 1, endpoint: "e", body: {}, text: "{}" });
    expect(d.get("rebuttal-cache-default-test")?.text).toBe("{}");
  });
});

describe("cachedClientFromEnv", () => {
  it("builds a client from NANSEN_API_KEY", () => {
    const prev = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    try {
      expect(cachedClientFromEnv()).toBeInstanceOf(CachedNansenClient);
    } finally {
      if (prev === undefined) delete process.env.NANSEN_API_KEY;
      else process.env.NANSEN_API_KEY = prev;
    }
  });
  it("falls back to an empty key when NANSEN_API_KEY is unset, which the client rejects", () => {
    const prev = process.env.NANSEN_API_KEY;
    delete process.env.NANSEN_API_KEY;
    try {
      expect(() => cachedClientFromEnv()).toThrow(/NANSEN_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.NANSEN_API_KEY = prev;
    }
  });
});
