import { describe, it, expect } from "vitest";
import { runChecks, planChecks, snapshot } from "../src/checks";
import { NansenClient, type CallOptions } from "../src/client";
import { fakeClient, pepeRoutes, claim, PEPE_ETH } from "./helpers";
import type { Resolved } from "../src/resolve";

const resolved: Resolved = { chain: "ethereum", address: PEPE_ETH, symbol: "PEPE", name: "Pepe", marketCap: 1.5e9, sameName: 3, by: "test", others: [] };
const NOW = Date.UTC(2026, 8, 18, 12, 30);

describe("planChecks", () => {
  it("a Smart Money buying claim plans 6 checks for 10 credits on a netflow chain", () => {
    const p = planChecks(claim(), resolved);
    expect(p.map((x) => x.id)).toEqual(["flow1d", "flow7d", "buyers", "sellers", "table", "price"]);
    expect(p.reduce((n, x) => n + x.credits, 0)).toBe(10);
  });
  it("holding and whale claims add the holders check (15 credits)", () => {
    expect(planChecks(claim({ type: "holding" }), resolved).map((x) => x.id)).toContain("holders");
    expect(planChecks(claim({ subject: "whales" }), resolved).reduce((n, x) => n + x.credits, 0)).toBe(15);
  });
  it("chains outside smart-money/netflow skip the table check", () => {
    const p = planChecks(claim(), { ...resolved, chain: "near" });
    expect(p.map((x) => x.id)).not.toContain("table");
  });
});

describe("runChecks", () => {
  it("turns the six responses into evidence and marks every check ok", async () => {
    const c = fakeClient(pepeRoutes({ buyers: [12_000, 3_000], sellers: [500] }));
    const { evidence, checks } = await runChecks(c, claim(), resolved, NOW);
    expect(checks.every((k) => k.ok)).toBe(true);
    expect(evidence.checksOk).toBe(6);
    expect(evidence.flow7d?.smart_trader).toEqual({ net: 4_611, wallets: 53 });
    expect(evidence.named).toMatchObject({ buyUsd: 15_000, sellUsd: 500, buyRows: 2, sellRows: 1 });
    expect(evidence.named?.buyers[0]).toMatchObject({ label: "Smart Trader", usd: 12_000 });
    expect(evidence.table).toMatchObject({ inTable: true, traders: 89 });
    expect(evidence.price?.change).toBeCloseTo(0.0694, 3);
    expect(c.creditsSpent).toBe(10);
  });
  it("a check's ms is its own Call's time — network time when clean, the whole wall time when an attempt was retried", async () => {
    let ohlcvHits = 0;
    const routes = pepeRoutes();
    const c = fakeClient((e, b) => (e === "tgm/token-ohlcv" && ohlcvHits++ === 0 ? new Response("busy", { status: 503 }) : routes(e, b)));
    const { checks } = await runChecks(c, claim(), resolved, NOW);
    const price = checks.find((k) => k.id === "price")!;
    const call = c.calls.find((x) => x.tag === "price")!;
    expect(call.attempts).toBe(2);
    expect(price.ok).toBe(true);
    expect(price.ms).toBe(call.totalMs); // the hidden 750 ms retry wait stays visible in the trace row and the rail
    expect(price.ms).toBeGreaterThanOrEqual(700);
    const flow = checks.find((k) => k.id === "flow1d")!;
    expect(flow.ms).toBe(c.calls.find((x) => x.tag === "flow1d")!.ms);
  });
  it("the who-bought-sold window is the last 24 h floored to the hour, with the subject's labels", async () => {
    const bodies: Record<string, unknown>[] = [];
    const c = fakeClient((e, b) => {
      if (e === "tgm/who-bought-sold") bodies.push(b);
      return pepeRoutes()(e, b);
    });
    await runChecks(c, claim({ subject: "whales" }), resolved, NOW);
    expect(bodies[0].date).toEqual({ from: "2026-09-17T12:00:00Z", to: "2026-09-18T12:00:00Z" });
    expect((bodies[0].filters as { include_smart_money_labels: string[] }).include_smart_money_labels).toEqual(["Whale"]);
  });
  it("a failed call becomes an ok=false check with its error; the rest still land", async () => {
    const c = fakeClient((e, b) => (e === "smart-money/netflow" ? new Response("boom", { status: 503 }) : pepeRoutes()(e, b)), { timeoutMs: 500 });
    const { evidence, checks } = await runChecks(c, claim(), resolved, NOW);
    const table = checks.find((k) => k.id === "table")!;
    expect(table.ok).toBe(false);
    expect(table.error).toMatch(/503/);
    expect(evidence.table).toBeNull();
    expect(evidence.checksOk).toBe(5);
  });
  it("emits one event per check as it lands, with the recorded call", async () => {
    const events: string[] = [];
    const c = fakeClient(pepeRoutes());
    await runChecks(c, claim(), resolved, NOW, (e) => events.push(`${e.check.id}:${e.call?.endpoint}`));
    expect(events).toHaveLength(6);
    expect(events).toContain("flow1d:tgm/flow-intelligence");
  });
  it("holders evidence sums balance changes and value", async () => {
    const c = fakeClient((e, b) => (e === "tgm/holders" ? { data: [{ address: "0x1", address_label: "Whale", balance_change_24h: -10, balance_change_7d: -20, value_usd: 500 }, { address: "0x2", address_label: "Whale", balance_change_24h: 4, balance_change_7d: 4, value_usd: 300 }], pagination: {} } : pepeRoutes()(e, b)));
    const { evidence } = await runChecks(c, claim({ subject: "whales" }), resolved, NOW);
    expect(evidence.holders).toMatchObject({ count: 2, delta24: -6, delta7d: -16, valueUsd: 800 });
  });
  it("an empty tgm/flow-intelligence response (no row for the token) leaves that window's evidence null", async () => {
    const c = fakeClient((e, b) => (e === "tgm/flow-intelligence" && b.timeframe === "1d" ? { data: [], warnings: [] } : pepeRoutes()(e, b)));
    const { evidence, checks } = await runChecks(c, claim(), resolved, NOW);
    expect(evidence.flow1d).toBeNull();
    const flow1d = checks.find((k) => k.id === "flow1d")!;
    expect(flow1d.ok).toBe(true);
    expect(flow1d.values).toMatchObject({ smart_trader_net_flow_usd: null, smart_trader_wallet_count: null, fresh_wallets_net_flow_usd: null, exchange_net_flow_usd: null });
  });
  it("holders and buyer/seller rows with no label and no USD default to null label and 0 usd (both sides, smart_money holders labelling)", async () => {
    const c = fakeClient((e, b) => {
      if (e === "tgm/who-bought-sold") return b.buy_or_sell === "BUY" ? { data: [{ address: "0x1" }], pagination: {} } : { data: [{ address: "0x3" }], pagination: {} };
      if (e === "tgm/holders") return { data: [{ value_usd: 500 }, { address: "0x4", address_label: "Fund" }], pagination: {}, warnings: [] };
      return pepeRoutes()(e, b);
    });
    const { evidence } = await runChecks(c, claim({ type: "holding" }), resolved, NOW);
    expect(evidence.named?.buyers[0]).toMatchObject({ address: "0x1", label: null, usd: 0 });
    expect(evidence.named?.buyUsd).toBe(0);
    expect(evidence.named?.sellers[0]).toMatchObject({ address: "0x3", label: null, usd: 0 });
    expect(evidence.named?.sellUsd).toBe(0);
    // a holder row with no address at all still gets a (blank) address rather than throwing
    expect(evidence.holders?.top[0]).toMatchObject({ address: "", label: null, usd: 500 });
  });
  it("a token absent from the Smart Money net-flow table records inTable:false with null net/traders", async () => {
    const c = fakeClient((e, b) => (e === "smart-money/netflow" ? { data: [] } : pepeRoutes()(e, b)));
    const { evidence, checks } = await runChecks(c, claim(), resolved, NOW);
    expect(evidence.table).toMatchObject({ inTable: false, net24: null, net7d: null, traders: null });
    const table = checks.find((k) => k.id === "table")!;
    expect(table.values).toMatchObject({ in_table: "no", net_flow_24h_usd: null, net_flow_7d_usd: null, trader_count: null });
  });
  it("fewer than 2 usable candles leaves price evidence null and change_24h null", async () => {
    const c = fakeClient((e, b) => (e === "tgm/token-ohlcv" ? { data: [{ interval_start: "2026-09-18T00:00:00Z", open: 1, close: 1.1, high: 1.1, low: 1, volume_usd: 1 }] } : pepeRoutes()(e, b)));
    const { evidence, checks } = await runChecks(c, claim(), resolved, NOW);
    expect(evidence.price).toBeNull();
    const price = checks.find((k) => k.id === "price")!;
    expect(price.values).toMatchObject({ candles: 1, open: null, close: null, change_24h: null });
  });
  it("an opening price of 0 (or less) reports 0% change instead of dividing by zero", async () => {
    const c = fakeClient((e, b) =>
      e === "tgm/token-ohlcv"
        ? { data: [{ interval_start: "2026-09-18T00:00:00Z", open: 0, close: 1, high: 1, low: 0, volume_usd: 1 }, { interval_start: "2026-09-18T01:00:00Z", open: 1, close: 1, high: 1, low: 1, volume_usd: 1 }] }
        : pepeRoutes()(e, b),
    );
    const { evidence } = await runChecks(c, claim(), resolved, NOW);
    expect(evidence.price).toMatchObject({ open: 0, change: 0 });
  });
  it("flow7d evidence falls back to null when the field itself is a null row value, not just a missing row", async () => {
    const c = fakeClient((e, b) => (e === "tgm/flow-intelligence" && b.timeframe === "7d" ? { data: [{ smart_trader_net_flow_usd: null, smart_trader_wallet_count: null }], warnings: [] } : pepeRoutes()(e, b)));
    const { evidence, checks } = await runChecks(c, claim(), resolved, NOW);
    expect(evidence.flow7d?.smart_trader).toEqual({ net: null, wallets: null });
    const flow7d = checks.find((k) => k.id === "flow7d")!;
    expect(flow7d.values).toMatchObject({ smart_trader_net_flow_usd: null, smart_trader_wallet_count: null });
  });
});

describe("a check whose own Call cannot be found by tag", () => {
  it("still lands as ok with cached:false and the plan's list-price credits, never throwing", async () => {
    class TaglessClient extends NansenClient {
      override async post<T = unknown>(endpoint: string, body: Record<string, unknown>, fieldsUsed: string[] = [], opts: CallOptions = {}): Promise<T> {
        const before = this.calls.length;
        const out = await super.post<T>(endpoint, body, fieldsUsed, opts);
        // simulate a client wrapper that does not preserve the caller's tag on the recorded Call — find OUR
        // own entry by the tag we called with (never by array position: checks run concurrently)
        const mine = this.calls.slice(before).find((c) => c.tag === opts.tag);
        if (mine) mine.tag = undefined;
        return out;
      }
    }
    const routes = pepeRoutes();
    const c = new TaglessClient("nsn_test_key_0000000000000000000000", {
      fetchImpl: async (url, init) => {
        const endpoint = String(url).replace("https://api.nansen.ai/api/v1/", "");
        const body = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify(routes(endpoint, body)), { status: 200 });
      },
      rps: 1000,
    });
    const { checks } = await runChecks(c, claim(), resolved, NOW);
    expect(checks.every((k) => k.ok)).toBe(true);
    for (const k of checks) {
      expect(k.cached).toBe(false); // own() found no Call, so cached?.?? false wins
      expect(k.responseHash).toBeUndefined();
    }
    const flow1d = checks.find((k) => k.id === "flow1d")!;
    // own() found no Call, so credits falls back to the plan's own list price rather than the (unfindable) Call's
    expect(flow1d.credits).toBe(planChecks(claim(), resolved).find((p) => p.id === "flow1d")!.credits);
  });
});

describe("snapshot", () => {
  it("returns null for a missing row (no data for the token)", () => {
    expect(snapshot(null)).toBeNull();
  });
  it("a null net or wallet count on the row becomes null, not 0, in the snapshot", () => {
    const s = snapshot({
      smart_trader_net_flow_usd: null, smart_trader_wallet_count: null,
      whale_net_flow_usd: 1, whale_wallet_count: 1,
      exchange_net_flow_usd: null, exchange_wallet_count: 2,
      fresh_wallets_net_flow_usd: 3, fresh_wallets_wallet_count: null,
      top_pnl_net_flow_usd: null, top_pnl_wallet_count: null,
      public_figure_net_flow_usd: null, public_figure_wallet_count: null,
    });
    expect(s!.smart_trader).toEqual({ net: null, wallets: null });
    expect(s!.exchange).toEqual({ net: null, wallets: 2 });
    expect(s!.fresh_wallets).toEqual({ net: 3, wallets: null });
  });
});
