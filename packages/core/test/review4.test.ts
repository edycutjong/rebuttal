import { describe, it, expect } from "vitest";
import { decide, presence } from "../src/decide";
import { evidence, claim, snap } from "./helpers";

/**
 * Outside architecture review, round 4 (2026-09-23) — findings verified against the code, then fixed.
 * Each test is written so it fails against the code as it was.
 */

describe("review4 · a holding claim needs the class to exist, like every other claim", () => {
  const holding = claim({ subject: "whales", type: "holding", token: "XYZ", raw: "Whales are holding $XYZ" });

  it("0 labelled holders is the absence of the class, not a weak yes", () => {
    // was OVERSTATED / O-HOLDERS: "fewer than 5 labelled holders — nothing to hold with", i.e. partly true about nobody
    const e = evidence({ flow7d: snap({ whale: { net: 0, wallets: 0 } }), holders: { count: 0, valueUsd: 0, delta7d: 0, delta24: 0 } });
    expect(presence(e, "whale")).toBe(false);
    const d = decide(holding, e);
    expect(d.label).toBe("UNVERIFIABLE");
    expect(d.ruleId).toBe("U-NOCLASS");
  });

  it("a failed holders call plus a zero-wallet week is not a CONFIRMED hold", () => {
    // the worse half: with holders null the O-HOLDERS and C-EXIT rules both need `h`, so it fell through to A-HOLD —
    // "Whales balances are not shrinking" — a CONFIRMED verdict about a cohort Nansen tags nobody in
    const e = evidence({ flow7d: snap({ whale: { net: 0, wallets: 0 } }), holders: null });
    expect(presence(e, "whale")).toBe(false);
    const d = decide(holding, e);
    expect(d.label).toBe("UNVERIFIABLE");
    expect(d.ruleId).toBe("U-NOCLASS");
  });

  it("the gate does not fire when the class is present — a real holding claim still decides", () => {
    const e = evidence({ flow7d: snap({ whale: { net: -50_000, wallets: 12 } }), holders: { count: 10, valueUsd: 4_000_000, delta7d: -900, delta24: -10 } });
    expect(presence(e, "whale")).toBe(true);
    const d = decide(holding, e);
    expect(d.label).not.toBe("UNVERIFIABLE");
    expect(["O-TRIM", "C-EXIT", "A-HOLD", "O-HOLDERS"]).toContain(d.ruleId);
  });

  it("holders present but below the floor is still OVERSTATED, not swallowed by the new gate", () => {
    const e = evidence({ flow7d: snap({ whale: { net: 0, wallets: 0 } }), holders: { count: 2, valueUsd: 1000, delta7d: 5, delta24: 0 } });
    expect(presence(e, "whale")).toBe(true); // 2 > 0
    expect(decide(holding, e).ruleId).toBe("O-HOLDERS");
  });
});
