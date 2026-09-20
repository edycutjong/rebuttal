import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NansenClient, summarizeParams, type CallEvent } from "../src/client";
import { CachedNansenClient, MemoryCache } from "../src/cache";
import { fakeClient } from "./helpers";

// A real shell with NANSEN_OFFLINE=1 exported must not change what this suite asserts — the CachedNansenClient
// built below relies on the default (live) path, so the ambient env is neutralized around this file.
const REAL_NANSEN_OFFLINE = process.env.NANSEN_OFFLINE;
beforeEach(() => {
  delete process.env.NANSEN_OFFLINE;
});
afterEach(() => {
  if (REAL_NANSEN_OFFLINE === undefined) delete process.env.NANSEN_OFFLINE;
  else process.env.NANSEN_OFFLINE = REAL_NANSEN_OFFLINE;
});

const KEY = "nsn_test_key_0000000000000000000000";
const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";

describe("the live call feed (onCall) — what the page's Nansen rail prints", () => {
  it("emits start before the request leaves and end with the very Call object that entered provenance", async () => {
    const events: CallEvent[] = [];
    const c = fakeClient(() => ({ data: [] }), { onCall: (e) => events.push(e) });
    await c.post("tgm/flow-intelligence", { chain: "ethereum", token_address: PEPE, timeframe: "7d" }, [], { tag: "flow7d" });
    expect(events.map((e) => e.phase)).toEqual(["start", "end"]);
    const [start, end] = events;
    if (start.phase !== "start" || end.phase !== "end") throw new Error("phases");
    expect(start).toMatchObject({ type: "call", seq: 1, endpoint: "tgm/flow-intelligence", params: "ethereum · 0x6982…1933 · 7d", credits: 1, tag: "flow7d" });
    expect(end.seq).toBe(1);
    expect(end.call).toBe(c.calls[0]); // identity, not a copy: the rail and the trace print the same record
    expect(end.call).toMatchObject({ ok: true, cached: false, credits: 1, status: 200 });
  });
  it("numbers calls in order so parallel rows can be matched start↔end; a failed call ends with ok=false and 0 credits", async () => {
    const events: CallEvent[] = [];
    const c = fakeClient((ep) => (ep === "tgm/holders" ? new Response("nope", { status: 422 }) : { data: [] }), { onCall: (e) => events.push(e) });
    await Promise.all([c.post("tgm/token-ohlcv", { chain: "base", token_address: PEPE, timeframe: "1h" }), c.post("tgm/holders", { chain: "base", token_address: PEPE, label_type: "whale" }, [], { retries: 0 }).catch(() => null)]);
    const starts = events.filter((e) => e.phase === "start").map((e) => e.seq);
    const ends = events.filter((e) => e.phase === "end");
    expect(starts).toEqual([1, 2]);
    expect(ends.map((e) => e.seq).sort()).toEqual([1, 2]);
    const failed = ends.find((e) => e.phase === "end" && e.call.endpoint === "tgm/holders");
    if (!failed || failed.phase !== "end") throw new Error("no end for the failed call");
    expect(failed.call).toMatchObject({ ok: false, status: 422, credits: 0 });
    expect(failed.call.error).toMatch(/422/);
  });
  it("a cache hit is announced and recorded in one breath as cached · 0 credits (a grey row, never pending)", async () => {
    const events: CallEvent[] = [];
    let network = 0;
    const fetchImpl: typeof fetch = async () => {
      network++;
      return new Response('{"data":[1]}', { status: 200 });
    };
    const c = new CachedNansenClient(KEY, { fetchImpl, rps: 1000, store: new MemoryCache(), onCall: (e) => events.push(e) });
    await c.post("smart-money/netflow", { chains: ["ethereum"], filters: { token_address: PEPE } });
    await c.post("smart-money/netflow", { chains: ["ethereum"], filters: { token_address: PEPE } });
    expect(network).toBe(1);
    expect(events.map((e) => `${e.phase}${e.seq}`)).toEqual(["start1", "end1", "start2", "end2"]);
    const hit = events[3];
    if (hit.phase !== "end") throw new Error("phase");
    expect(hit.call).toMatchObject({ cached: true, credits: 0, ok: true });
    expect(hit.call).toBe(c.calls[1]);
  });
  it("an observer that throws never breaks the call", async () => {
    const c = fakeClient(() => ({ data: [] }), {
      onCall: () => {
        throw new Error("ui bug");
      },
    });
    await expect(c.post("search/general", { search_query: "PEPE", result_type: "token" })).resolves.toEqual({ data: [] });
    expect(c.calls).toHaveLength(1);
  });
  it("without an observer nothing changes: calls are recorded exactly as before", async () => {
    const c = new NansenClient(KEY, { fetchImpl: async () => new Response("{}", { status: 200 }) });
    await c.post("tgm/token-ohlcv", { chain: "ethereum", token_address: PEPE, timeframe: "1h" });
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).not.toHaveProperty("seq");
  });
});

describe("summarizeParams — one scannable line, never the request body", () => {
  it("search: the query and the result type", () => {
    expect(summarizeParams("search/general", { search_query: "PEPE", result_type: "token", limit: 50 })).toBe('"PEPE" · token');
    expect(summarizeParams("search/general", { search_query: "PEPE", result_type: "token", chain: "base" })).toBe('"PEPE" · base · token');
  });
  it("token endpoints: chain · short address · window; date ranges become hours or days", () => {
    expect(summarizeParams("tgm/flow-intelligence", { chain: "ethereum", token_address: PEPE, timeframe: "1d" })).toBe("ethereum · 0x6982…1933 · 1d");
    expect(summarizeParams("tgm/who-bought-sold", { chain: "ethereum", token_address: PEPE, buy_or_sell: "BUY", date: { from: "2026-09-17T10:00:00.000Z", to: "2026-09-18T10:00:00.000Z" }, filters: { include_smart_money_labels: ["Fund"] } })).toBe(
      "ethereum · 0x6982…1933 · BUY · 1d",
    );
    expect(summarizeParams("tgm/token-ohlcv", { chain: "ethereum", token_address: PEPE, timeframe: "1h", date: { from: "2026-09-18T04:00:00.000Z", to: "2026-09-18T10:00:00.000Z" } })).toBe("ethereum · 0x6982…1933 · 1h · 6h");
    expect(summarizeParams("tgm/holders", { chain: "solana", token_address: "So11111111111111111111111111111111111111112", label_type: "whale" })).toBe("solana · So1111…1112 · whale");
    expect(summarizeParams("smart-money/netflow", { chains: ["ethereum"], filters: { token_address: PEPE, include_stablecoins: true }, pagination: { page: 1 } })).toBe("ethereum · 0x6982…1933 · token filter");
  });
  it("never leaks the label filters, pagination or ordering, and has a fallback for an unknown body", () => {
    const line = summarizeParams("tgm/who-bought-sold", { chain: "ethereum", token_address: PEPE, buy_or_sell: "SELL", filters: { include_smart_money_labels: ["Smart Trader", "Fund"] }, order_by: [{ field: "sold_volume_usd" }] });
    expect(line).not.toMatch(/Smart Trader|Fund|order_by|sold_volume/);
    expect(summarizeParams("account", { foo: 1, bar: 2 })).toBe("foo, bar");
    expect(summarizeParams("agent/fast", { text: "Smart Money is aping $PEPE hard today — is it really, though?" })).toBe('"Smart Money is aping $PEPE hard today — …"');
  });
});
