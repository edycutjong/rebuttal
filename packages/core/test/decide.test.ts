import { describe, it, expect } from "vitest";
import { decide, threshold, totalFlow, presence, RULES, fmtUsd } from "../src/decide.js";
import { evidence, snap, claim } from "./helpers.js";

const sm = (net: number, wallets: number, more: Record<string, { net: number | null; wallets: number | null }> = {}) => snap({ smart_trader: { net, wallets }, ...more });

describe("threshold", () => {
  it("is the $5K floor on a quiet token", () => {
    expect(threshold(snap())).toBe(RULES.floorUsd);
  });
  it("scales with 1% of the labelled flow on a busy token — fresh-wallet and exchange volume do not count", () => {
    const s = snap({ fresh_wallets: { net: 73_914_417, wallets: 0 }, exchange: { net: 4_607_092, wallets: 0 }, top_pnl: { net: -1_500_000, wallets: 30 }, smart_trader: { net: 100_000, wallets: 4 } });
    expect(totalFlow(s)).toBe(1_600_000);
    expect(threshold(s)).toBe(16_000);
  });
});

describe("decide — buying claims about Smart Money", () => {
  it("U-CHECKS when fewer than 2 checks answered", () => {
    const d = decide(claim(), evidence({ checksOk: 1 }));
    expect(d).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-CHECKS" });
  });
  it("U-FLOW when neither flow-intelligence nor who-bought-sold answered", () => {
    const d = decide(claim(), evidence({ flow1d: null, named: null }));
    expect(d).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-FLOW" });
  });
  it("C-SIGN: Smart Money net sold past the threshold", () => {
    const d = decide(claim(), evidence({ flow1d: sm(-212_000, 12) }));
    expect(d).toMatchObject({ label: "CONTRADICTED", ruleId: "C-SIGN" });
    expect(d.reasons[0]).toMatch(/net sold \$212K/);
  });
  it("C-NOBODY: nobody in the class traded in 24 h, but the class exists in the token (live PEPE 2026-09-18)", () => {
    const d = decide(claim(), evidence({ flow1d: sm(0, 0), flow7d: sm(4_611, 53), table: { inTable: true, net24: 0, net7d: 4611, traders: 89 } }));
    expect(d).toMatchObject({ label: "CONTRADICTED", ruleId: "C-NOBODY" });
    expect(d.reasons.join(" ")).toMatch(/89 traders/);
  });
  it("U-NOCLASS: nobody traded and the class has no presence at all", () => {
    const d = decide(claim(), evidence({ flow1d: sm(0, 0), flow7d: sm(0, 0), table: { inTable: false, net24: null, net7d: null, traders: null } }));
    expect(d).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-NOCLASS" });
  });
  it("O-SMALL: positive but under the threshold", () => {
    const d = decide(claim(), evidence({ flow1d: sm(2_000, 5) }));
    expect(d).toMatchObject({ label: "OVERSTATED", ruleId: "O-SMALL" });
  });
  it("fresh wallets out-buying Smart Money is context on a CONFIRMED, never a downgrade (live VVV 2026-09-18: SM +$100K, fresh +$74M, #2 on the SM table)", () => {
    const d = decide(claim(), evidence({ flow1d: sm(99_702, 4, { fresh_wallets: { net: 73_914_417, wallets: 0 }, top_pnl: { net: -1_496_391, wallets: 30 } }), flow7d: sm(115_136, 9), table: { inTable: true, net24: 99_702, net7d: 115_136, traders: 21 } }));
    expect(d).toMatchObject({ label: "CONFIRMED", ruleId: "A-FLOW" });
    expect(d.reasons.join(" ")).toMatch(/fresh wallets net bought \$73.91M — retail is the bigger buyer/);
  });
  it("O-7D: a one-day blip against a week of selling", () => {
    const d = decide(claim(), evidence({ flow1d: sm(60_000, 8), flow7d: sm(-500_000, 40) }));
    expect(d).toMatchObject({ label: "OVERSTATED", ruleId: "O-7D" });
  });
  it("O-STALE: the price already moved 20%+", () => {
    const d = decide(claim(), evidence({ flow1d: sm(60_000, 8), flow7d: sm(70_000, 9), price: { open: 1, close: 1.25, change: 0.25, candles: 25 } }));
    expect(d).toMatchObject({ label: "OVERSTATED", ruleId: "O-STALE" });
  });
  it("O-FEW: one or two wallets, not the class", () => {
    const d = decide(claim(), evidence({ flow1d: sm(60_000, 2) }));
    expect(d).toMatchObject({ label: "OVERSTATED", ruleId: "O-FEW" });
  });
  it("A-FLOW: confirmed when the flow is over the threshold, wallets ≥ 3, nothing undercuts it", () => {
    const d = decide(claim(), evidence({ flow1d: sm(120_000, 14), flow7d: sm(400_000, 40), table: { inTable: true, net24: 120_000, net7d: 400_000, traders: 30 }, price: { open: 1, close: 1.05, change: 0.05, candles: 25 } }));
    expect(d).toMatchObject({ label: "CONFIRMED", ruleId: "A-FLOW" });
    expect(d.reasons).toHaveLength(4);
    expect(d.threshold).toBe(RULES.floorUsd);
  });
  it("O-FLAT: within noise with the class present", () => {
    const d = decide(claim(), evidence({ flow1d: sm(-1_000, 4) }));
    expect(d).toMatchObject({ label: "OVERSTATED", ruleId: "O-FLAT" });
  });
  it("uses who-bought-sold as the primary when flow-intelligence 1d failed", () => {
    const d = decide(claim(), evidence({ flow1d: null, named: { buyUsd: 90_000, sellUsd: 10_000, buyRows: 5, sellRows: 1, buyers: [], sellers: [] } }));
    expect(d).toMatchObject({ label: "CONFIRMED", ruleId: "A-FLOW" });
    expect(d.reasons[0]).toMatch(/flow-intelligence unavailable/);
  });
});

describe("decide — selling claims mirror the signs", () => {
  const sell = claim({ type: "selling", raw: "Smart Money is dumping $PEPE" });
  it("net selling past the threshold → CONFIRMED", () => {
    expect(decide(sell, evidence({ flow1d: sm(-120_000, 14) }))).toMatchObject({ label: "CONFIRMED", ruleId: "A-FLOW" });
  });
  it("net buying past the threshold → CONTRADICTED", () => {
    expect(decide(sell, evidence({ flow1d: sm(120_000, 14) }))).toMatchObject({ label: "CONTRADICTED", ruleId: "C-SIGN" });
  });
  it("a −20% move makes a selling claim stale", () => {
    expect(decide(sell, evidence({ flow1d: sm(-120_000, 14), price: { open: 1, close: 0.7, change: -0.3, candles: 25 } }))).toMatchObject({ ruleId: "O-STALE" });
  });
  it("fresh-wallet rule does not apply to selling", () => {
    expect(decide(sell, evidence({ flow1d: sm(-120_000, 14, { fresh_wallets: { net: 9_000_000, wallets: 0 } }) }))).toMatchObject({ label: "CONFIRMED" });
  });
});

describe("decide — whale claims", () => {
  const whale = claim({ subject: "whales", type: "selling", raw: "A whale sold 600,000 UNI" });
  it("uses whale holders' 24 h balance change × price as the primary signal (live UNI 2026-09-18)", () => {
    const d = decide(whale, evidence({
      flow1d: snap({ whale: { net: -474_230, wallets: 2 }, fresh_wallets: { net: 15_193_350, wallets: 0 }, top_pnl: { net: -7_186_015, wallets: 36 }, exchange: { net: -3_626_183, wallets: 0 } }),
      flow7d: snap({ whale: { net: -462_383, wallets: 2 } }),
      price: { open: 6.5, close: 8.56, change: 0.32, candles: 25 },
      holders: { count: 10, delta24: -58_694, delta7d: -55_117, valueUsd: 30_043_065, top: [] },
    }));
    expect(d).toMatchObject({ label: "CONFIRMED", ruleId: "A-FLOW" });
    expect(d.reasons[0]).toMatch(/whale holders/);
    expect(d.reasons[0]).toMatch(/\$502K/);
  });
  it("a single whale is enough for a whale claim (minWhales = 1)", () => {
    const d = decide(claim({ subject: "whales" }), evidence({ flow1d: snap({ whale: { net: 80_000, wallets: 1 } }) }));
    expect(d).toMatchObject({ label: "CONFIRMED" });
  });
  it("no Whale-labelled wallet anywhere → U-NOCLASS", () => {
    const d = decide(claim({ subject: "whales" }), evidence({ holders: { count: 0, delta24: 0, delta7d: 0, valueUsd: 0, top: [] }, table: { inTable: true, net24: 0, net7d: 0, traders: 2 } }));
    expect(d).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-NOCLASS" });
  });
  it("presence counts holders and 7 d wallets, and SM table traders only for Smart Money", () => {
    expect(presence(evidence({ holders: { count: 3, delta24: 0, delta7d: 0, valueUsd: 0, top: [] } }), "whale")).toBe(true);
    expect(presence(evidence({ flow7d: snap({ whale: { net: 0, wallets: 2 } }) }), "whale")).toBe(true);
    expect(presence(evidence({ table: { inTable: true, net24: 0, net7d: 0, traders: 5 } }), "whale")).toBe(false);
    expect(presence(evidence({ table: { inTable: true, net24: 0, net7d: 0, traders: 5 } }), "smart_trader")).toBe(true);
  });
});

describe("decide — holding claims", () => {
  const hold = claim({ type: "holding", raw: "smart money logging gains on UNI" });
  it("U-HOLD without holders or 7 d flow", () => {
    expect(decide(hold, evidence({ holders: null, flow7d: null }))).toMatchObject({ label: "UNVERIFIABLE", ruleId: "U-HOLD" });
  });
  it("O-HOLDERS: too few labelled holders", () => {
    expect(decide(hold, evidence({ holders: { count: 2, delta24: 0, delta7d: 10, valueUsd: 1e5, top: [] } }))).toMatchObject({ ruleId: "O-HOLDERS" });
  });
  it("C-EXIT: net sellers over the week and balances shrank", () => {
    expect(decide(hold, evidence({ holders: { count: 20, delta24: -5, delta7d: -900, valueUsd: 1e6, top: [] }, flow7d: sm(-90_000, 20) }))).toMatchObject({ label: "CONTRADICTED", ruleId: "C-EXIT" });
  });
  it("O-TRIM: some trimming (live UNI 2026-09-18)", () => {
    expect(decide(hold, evidence({ holders: { count: 59, delta24: 2278, delta7d: -5691, valueUsd: 371_910_171, top: [] }, flow7d: sm(-38_375, 3, { fresh_wallets: { net: 36_945_980, wallets: 0 }, top_pnl: { net: -8_040_070, wallets: 62 }, exchange: { net: -13_826_854, wallets: 0 } }) }))).toMatchObject({ label: "OVERSTATED", ruleId: "O-TRIM" });
  });
  it("A-HOLD: balances not shrinking", () => {
    expect(decide(hold, evidence({ holders: { count: 12, delta24: 1, delta7d: 40, valueUsd: 1e6, top: [] }, flow7d: sm(1_000, 10) }))).toMatchObject({ label: "CONFIRMED", ruleId: "A-HOLD" });
  });
});

describe("fmtUsd", () => {
  it("formats magnitudes with a real minus sign", () => {
    expect(fmtUsd(212_000)).toBe("$212K");
    expect(fmtUsd(-1_100_000)).toBe("−$1.10M");
    expect(fmtUsd(2_500_000_000)).toBe("$2.50B");
    expect(fmtUsd(42)).toBe("$42");
  });
});
