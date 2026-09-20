import { describe, it, expect } from "vitest";
import { NansenClient, summarizeParams, clientFromEnv, CREDITS } from "../src/client";
import { fakeClient } from "./helpers";

describe("NansenClient", () => {
  it("rejects a missing or malformed key", () => {
    expect(() => new NansenClient("")).toThrow(/NANSEN_API_KEY/);
    expect(() => new NansenClient("abc")).toThrow(/nsn_/);
  });
  it("sends the apikey header and records credits, status and a sha256 of the raw body", async () => {
    let headers: Record<string, string> = {};
    const fetchImpl: typeof fetch = async (_u, init) => {
      headers = init!.headers as Record<string, string>;
      return new Response('{"data":[]}', { status: 200 });
    };
    const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl });
    await c.post("tgm/holders", { chain: "ethereum", token_address: "0x1" }, ["data[].address_label"]);
    expect(headers.apikey).toMatch(/^nsn_/);
    expect(c.calls[0]).toMatchObject({ endpoint: "tgm/holders", credits: 5, status: 200, cached: false, fieldsUsed: ["data[].address_label"] });
    expect(c.calls[0].responseHash).toHaveLength(64);
    expect(c.creditsSpent).toBe(5);
  });
  it("retries once on 429 then succeeds; the failed attempt is not recorded", async () => {
    let n = 0;
    const c = fakeClient(() => (n++ === 0 ? new Response("slow down", { status: 429 }) : { ok: true }));
    const out = await c.post("tgm/flow-intelligence", {});
    expect(out).toEqual({ ok: true });
    expect(n).toBe(2);
    expect(c.calls).toHaveLength(1);
  });
  it("throws NansenError with status on 4xx without retry", async () => {
    let n = 0;
    const c = fakeClient(() => {
      n++;
      return new Response('{"error":"Missing field"}', { status: 422 });
    });
    await expect(c.post("tgm/token-information", {})).rejects.toThrow(/HTTP 422/);
    expect(n).toBe(1);
    // the failure is recorded in provenance at 0 credits, with the real attempt count
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ ok: false, status: 422, credits: 0, attempts: 1 });
    expect(c.calls[0].error).toMatch(/HTTP 422/);
  });
  it("gives up after the second 5xx and records attempts=2", async () => {
    const c = fakeClient(() => new Response("boom", { status: 503 }));
    await expect(c.post("tgm/holders", {})).rejects.toThrow(/HTTP 503/);
    expect(c.calls[0]).toMatchObject({ ok: false, status: 503, attempts: 2 });
    expect(c.calls[0].totalMs).toBeGreaterThanOrEqual(700);
  });
});

describe("review fix F5: retried attempts are visible", () => {
  it("records attempts=2 and totalMs ≥ the retry backoff when the first attempt fails", async () => {
    let n = 0;
    const c = fakeClient(() => (n++ === 0 ? new Response("x", { status: 503 }) : { ok: 1 }));
    await c.post("tgm/holders", {});
    expect(c.calls[0].attempts).toBe(2);
    expect(c.calls[0].totalMs).toBeGreaterThanOrEqual(700);
    expect(c.calls[0].ms).toBeLessThan(700);
  });
  it("a first-attempt timeout is retried and counted", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async (_u, init) => {
      if (n++ === 0)
        await new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      return new Response('{"ok":1}', { status: 200 });
    };
    const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, timeoutMs: 30, rps: 1000 });
    await c.post("tgm/holders", {});
    expect(c.calls[0].attempts).toBe(2);
  });
});

describe("summarizeParams", () => {
  it("a short address is not truncated", () => {
    expect(summarizeParams("tgm/holders", { chain: "ethereum", token_address: "0x1", label_type: "whale" })).toBe("ethereum · 0x1 · whale");
  });
  it("an unparsable date range is dropped from the line, not shown as NaN", () => {
    expect(summarizeParams("tgm/token-ohlcv", { chain: "ethereum", token_address: "0x1", timeframe: "1h", date: { from: "not-a-date", to: "also-not" } })).toBe("ethereum · 0x1 · 1h");
  });
  it("agent/expert is summarized the same way as agent/fast, long text is ellipsized, short text and a missing text both print cleanly", () => {
    expect(summarizeParams("agent/expert", { text: "x".repeat(50) })).toBe(`"${"x".repeat(40)}…"`);
    expect(summarizeParams("agent/fast", { text: "short" })).toBe('"short"');
    expect(summarizeParams("agent/fast", {})).toBe('""');
  });
  it("search/general with no query or result_type still prints a scannable (empty) line", () => {
    expect(summarizeParams("search/general", {})).toBe('"" · all');
  });
  it("a body with none of the known shape falls back to its first keys", () => {
    expect(summarizeParams("account", { foo: 1, bar: 2, baz: 3, qux: 4 })).toBe("foo, bar, baz");
  });
});

describe("clientFromEnv", () => {
  it("reads NANSEN_API_KEY from the environment", () => {
    const prev = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = "nsn_test_key_0000000000000000000000";
    try {
      expect(clientFromEnv()).toBeInstanceOf(NansenClient);
    } finally {
      if (prev === undefined) delete process.env.NANSEN_API_KEY;
      else process.env.NANSEN_API_KEY = prev;
    }
  });
  it("falls back to an empty string when NANSEN_API_KEY is unset, which the client rejects", () => {
    const prev = process.env.NANSEN_API_KEY;
    delete process.env.NANSEN_API_KEY;
    try {
      expect(() => clientFromEnv()).toThrow(/NANSEN_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.NANSEN_API_KEY = prev;
    }
  });
});

describe("credits fallback chain", () => {
  it("begin() prices an unlisted endpoint's start event at 1 credit", async () => {
    const events: Array<{ phase: string; credits?: number }> = [];
    const c = fakeClient(() => ({ ok: 1 }), { onCall: (e) => events.push(e.phase === "start" ? { phase: e.phase, credits: e.credits } : { phase: e.phase }) });
    expect(CREDITS["totally/unknown-endpoint"]).toBeUndefined();
    await c.post("totally/unknown-endpoint", {});
    expect(events[0]).toEqual({ phase: "start", credits: 1 });
  });
  it("a live call to an unlisted endpoint with no reported cost is recorded at 1 credit", async () => {
    const c = fakeClient(() => ({ ok: 1 }));
    await c.post("totally/unknown-endpoint", {});
    expect(c.calls[0].credits).toBe(1);
  });
});

describe("RateLimiter", () => {
  it("a second call beyond the per-second cap waits for the window to roll over", async () => {
    const c = fakeClient(() => ({ ok: 1 }), { rps: 1 });
    const t0 = Date.now();
    await c.post("tgm/holders", {});
    await c.post("tgm/holders", {});
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  }, 10_000);
});

describe("per-call options", () => {
  it("retries: 0 fails fast on a 5xx with attempts=1", async () => {
    let n = 0;
    const c = fakeClient(() => {
      n++;
      return new Response("x", { status: 503 });
    });
    await expect(c.post("tgm/token-information", {}, [], { retries: 0 })).rejects.toThrow(/503/);
    expect(n).toBe(1);
    expect(c.calls[0].attempts).toBe(1);
  });
  it("a per-call timeoutMs overrides the client default", async () => {
    const fetchImpl: typeof fetch = async (_u, init) =>
      new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const c = new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, timeoutMs: 60_000, rps: 1000 });
    const t0 = Date.now();
    await expect(c.post("tgm/token-information", {}, [], { timeoutMs: 20, retries: 0 })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(c.calls[0]).toMatchObject({ ok: false, error: "timeout", attempts: 1 });
  });
});
