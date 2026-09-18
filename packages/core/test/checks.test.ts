import { describe, it, expect } from "vitest";
import { runChecks, planChecks } from "../src/checks";
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
});
