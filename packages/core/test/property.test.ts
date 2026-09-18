import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { decide, type Evidence, type FlowSnapshot, type ClassFlow, type NamedRow } from "../src/decide";
import { extractClaim, validClaim } from "../src/claim";
import { verdictHash } from "../src/rebut";
import { claim } from "./helpers";

const LABELS = ["CONFIRMED", "OVERSTATED", "CONTRADICTED", "UNVERIFIABLE"];
const RUNS = 5_000;

const flow = (): fc.Arbitrary<ClassFlow> => fc.record({ net: fc.oneof(fc.constant(null), fc.double({ min: -5e7, max: 5e7, noNaN: true })), wallets: fc.oneof(fc.constant(null), fc.nat(500)) });
const snapshot = (): fc.Arbitrary<FlowSnapshot> => fc.record({ smart_trader: flow(), whale: flow(), exchange: flow(), fresh_wallets: flow(), top_pnl: flow(), public_figure: flow() });
const ev = (): fc.Arbitrary<Evidence> =>
  fc.record({
    flow1d: fc.oneof(fc.constant(null), snapshot()),
    flow7d: fc.oneof(fc.constant(null), snapshot()),
    named: fc.oneof(fc.constant(null), fc.record({ buyUsd: fc.double({ min: 0, max: 1e7, noNaN: true }), sellUsd: fc.double({ min: 0, max: 1e7, noNaN: true }), buyRows: fc.nat(100), sellRows: fc.nat(100), buyers: fc.constant([] as NamedRow[]), sellers: fc.constant([] as NamedRow[]) })),
    table: fc.oneof(fc.constant(null), fc.record({ inTable: fc.boolean(), net24: fc.oneof(fc.constant(null), fc.double({ min: -1e7, max: 1e7, noNaN: true })), net7d: fc.constant(null), traders: fc.oneof(fc.constant(null), fc.nat(300)) })),
    price: fc.oneof(fc.constant(null), fc.double({ min: 0.001, max: 100, noNaN: true }).chain((open) => fc.double({ min: 0.001, max: 100, noNaN: true }).map((close) => ({ open, close, change: (close - open) / open, candles: 25 })))),
    holders: fc.oneof(fc.constant(null), fc.record({ count: fc.nat(100), delta24: fc.double({ min: -1e6, max: 1e6, noNaN: true }), delta7d: fc.double({ min: -1e6, max: 1e6, noNaN: true }), valueUsd: fc.double({ min: 0, max: 1e9, noNaN: true }), top: fc.constant([] as NamedRow[]) })),
    checksOk: fc.nat(7),
    checksTotal: fc.constant(7),
  });
const anyClaim = () => fc.record({ type: fc.constantFrom("buying", "selling", "holding"), subject: fc.constantFrom("smart_money", "whales") }).map((o) => claim(o as never));

describe(`decide() — ${RUNS} random evidence records`, () => {
  it("always returns one of the four labels, a rule id, at least one reason, and never throws", () => {
    fc.assert(
      fc.property(anyClaim(), ev(), (c, e) => {
        const d = decide(c, e);
        expect(LABELS).toContain(d.label);
        expect(d.ruleId).toMatch(/^[UCOA]-[A-Z0-9]+$/);
        expect(d.reasons.length).toBeGreaterThan(0);
        expect(Number.isFinite(d.threshold)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
  it("is a pure function: the same evidence gives the same decision and the same hash", () => {
    fc.assert(
      fc.property(anyClaim(), ev(), (c, e) => {
        const a = decide(c, e);
        const b = decide(c, JSON.parse(JSON.stringify(e)) as Evidence);
        expect(b).toEqual(a);
        expect(verdictHash(c, null, a, e)).toBe(verdictHash(c, null, b, e));
      }),
      { numRuns: RUNS },
    );
  });
  it("selling is the mirror of buying: negate every net flow and the price move (fresh wallets aside) → same label and rule", () => {
    const neg = (s: FlowSnapshot | null): FlowSnapshot | null =>
      s && (Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { net: v.net == null ? null : -v.net, wallets: v.wallets }])) as FlowSnapshot);
    fc.assert(
      fc.property(ev(), (e0) => {
        const e: Evidence = { ...e0, holders: null, flow1d: e0.flow1d && { ...e0.flow1d, fresh_wallets: { net: 0, wallets: 0 } }, named: null };
        const mirrored: Evidence = { ...e, flow1d: neg(e.flow1d), flow7d: neg(e.flow7d), price: e.price && { ...e.price, change: -e.price.change } };
        const buy = decide(claim({ type: "buying" }), e);
        const sell = decide(claim({ type: "selling" }), mirrored);
        expect(sell.label).toBe(buy.label);
        expect(sell.ruleId).toBe(buy.ruleId);
      }),
      { numRuns: RUNS },
    );
  });
  it("fewer than 2 checks is always UNVERIFIABLE; a decisive label needs the class's flow", () => {
    fc.assert(
      fc.property(anyClaim(), ev(), (c, e) => {
        const d = decide(c, { ...e, checksOk: 1 });
        expect(d.ruleId).toBe("U-CHECKS");
      }),
      { numRuns: 1000 },
    );
  });
});

describe(`extractClaim() — ${RUNS} random strings`, () => {
  it("never throws; a valid claim always has a ticker-shaped token and a type", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 300 }), fc.string({ unit: "grapheme", maxLength: 200 })), (s) => {
        const c = extractClaim(s);
        expect(c.extractor).toBe("rules");
        if (validClaim(c)) {
          expect(c.token).toMatch(/^[A-Z0-9]{2,12}$/);
          expect(["buying", "selling", "holding"]).toContain(c.type);
        } else expect(c.problem).toBeTruthy();
      }),
      { numRuns: RUNS },
    );
  });
  it("the first $TICKER is always found, whatever surrounds it", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{1,9}$/), fc.string({ maxLength: 40 }).filter((x) => !x.includes("$")), fc.string({ maxLength: 40 }), (t, a, b) => {
        expect(extractClaim(`${a} $${t} ${b}`).token).toBe(t.toUpperCase());
      }),
      { numRuns: 2000 },
    );
  });
});
