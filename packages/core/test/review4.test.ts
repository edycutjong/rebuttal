import { describe, it, expect, vi } from "vitest";
import { decide, presence } from "../src/decide";
import { evidence, claim, snap } from "./helpers";
import { askNansenAgent } from "../src/agent";

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

describe("review4 · the agent relay stops when its caller hangs up", () => {
  const sse = (body: string) =>
    new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });

  it("an already-aborted caller signal makes no request", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return sse("");
    }) as unknown as typeof fetch;
    const run = await askNansenAgent("nsn_k", "claim", { fetchImpl, signal: ctrl.signal });
    expect(run.error).toBe("cancelled — the reader closed the connection");
    expect(run.timedOut).toBe(false);
    expect(run.credits).toBe(0); // nothing streamed: never charge for a run the reader abandoned
  });

  it("a cancelled run is not reported as a timeout", async () => {
    // the message matters: provenance that says "did not finish in 60 s" about a 2 s hang-up is a false statement
    const ctrl = new AbortController();
    const fetchImpl = (async () => {
      ctrl.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;
    const run = await askNansenAgent("nsn_k", "claim", { fetchImpl, signal: ctrl.signal });
    expect(run.timedOut).toBe(false);
    expect(run.error).not.toMatch(/did not finish/);
  });

  it("a real timeout is still a timeout", async () => {
    const fetchImpl = (async (_u: string, init?: RequestInit) =>
      new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "AbortError" }))))) as unknown as typeof fetch;
    const run = await askNansenAgent("nsn_k", "claim", { fetchImpl, timeoutMs: 20 });
    expect(run.timedOut).toBe(true);
    expect(run.error).toMatch(/did not finish in/);
  });

  it("without a caller signal the agent behaves exactly as before", async () => {
    const fetchImpl = (async () => sse('data: {"type":"tool_call","name":"tgm/holders"}\ndata: {"type":"delta","text":"hi"}\n')) as unknown as typeof fetch;
    const run = await askNansenAgent("nsn_k", "claim", { fetchImpl });
    expect(run.toolCalls).toEqual(["tgm/holders"]);
    expect(run.text).toBe("hi");
    expect(run.error).toBeUndefined();
  });
});
