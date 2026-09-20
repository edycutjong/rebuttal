import { describe, it, expect, afterEach, vi } from "vitest";
import { chat, extractWithLlm, narrateWithLlm, keysFromEnv } from "../src/llm";
import { rebut } from "../src/rebut";
import { fakeClient, pepeRoutes } from "./helpers";

const toolReply = (args: Record<string, unknown>) => new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ function: { name: "extract_claim", arguments: JSON.stringify(args) } }] } }] }), { status: 200 });
const textReply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe("chat — key rotation and budgets", () => {
  it("rotates past 429 and a restricted (400) key, then succeeds", async () => {
    const used: string[] = [];
    const fetchImpl: typeof fetch = async (_u, init) => {
      const k = String((init!.headers as Record<string, string>).authorization).replace("Bearer ", "");
      used.push(k);
      if (k === "k429") return new Response("slow", { status: 429 });
      if (k === "kbad") return new Response('{"error":{"message":"Organization has been restricted."}}', { status: 400 });
      return textReply("ok");
    };
    // the start index is `floor(Date.now()/1000) % keys.length` — pin the clock (Date only; real timers still run
    // the abort/setTimeout machinery) so the rotation deterministically starts at k429 and visits all three keys,
    // rather than leaving it to which wall-clock second the test happens to run in (a real, if rare, CI flake)
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    try {
      const r = await chat({ keys: ["k429", "kbad", "kgood"], fetchImpl, timeoutMs: 2000 }, [{ role: "user", content: "hi" }]);
      expect(r?.content).toBe("ok");
      expect(used).toEqual(["k429", "kbad", "kgood"]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("returns null on a genuine 400 (bad request) without trying every key", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async () => {
      n++;
      return new Response('{"error":{"message":"invalid tool schema"}}', { status: 400 });
    };
    expect(await chat({ keys: ["a", "b", "c"], fetchImpl }, [{ role: "user", content: "hi" }])).toBeNull();
    expect(n).toBe(1);
  });
  it("returns null when the budget is exceeded (abort), never throws", async () => {
    const fetchImpl: typeof fetch = async (_u, init) => new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const t0 = Date.now();
    expect(await chat({ keys: ["a"], fetchImpl, timeoutMs: 250 }, [{ role: "user", content: "hi" }])).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("sends tools with a forced tool_choice and parses the arguments", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (_u, init) => {
      body = JSON.parse(String(init!.body));
      return toolReply({ token: "PEPE" });
    };
    const r = await chat({ keys: ["a"], fetchImpl }, [{ role: "user", content: "x" }], [{ type: "function", function: { name: "extract_claim", description: "", parameters: {} } }]);
    expect((body.tool_choice as { function: { name: string } }).function.name).toBe("extract_claim");
    expect(body.temperature).toBe(0);
    expect(r?.toolArgs).toEqual({ token: "PEPE" });
  });
  it("no keys → nothing is fetched", async () => {
    const r = await extractWithLlm("SM aping $PEPE", { keys: [] });
    expect(r.claim).toBeNull();
    expect(r.status.error).toMatch(/no GROQ key/);
  });
  it("chat() with an empty key list returns null without ever fetching", async () => {
    let n = 0;
    expect(await chat({ keys: [], fetchImpl: async () => (n++, textReply("x")) }, [{ role: "user", content: "hi" }])).toBeNull();
    expect(n).toBe(0);
  });
  it("with no fetchImpl given, it falls back to the global fetch", async () => {
    vi.stubGlobal("fetch", async () => textReply("from global fetch"));
    const r = await chat({ keys: ["a"] }, [{ role: "user", content: "hi" }]);
    expect(r?.content).toBe("from global fetch");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("a request that outlasts the remaining budget stops rotating keys instead of trying the next one", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async () => {
      n++;
      await new Promise((r) => setTimeout(r, 120));
      return new Response("slow", { status: 429 }); // would normally rotate to the next key…
    };
    // …but the budget (100ms) is already spent by the time the loop gets back around to check it
    expect(await chat({ keys: ["a", "b"], fetchImpl, timeoutMs: 100 }, [{ role: "user", content: "hi" }])).toBeNull();
    expect(n).toBe(1);
  });
  it("a res.text() that itself rejects on a non-retryable status still returns null, not a throw", async () => {
    const fetchImpl: typeof fetch = async () => ({ ok: false, status: 400, text: () => Promise.reject(new Error("boom")) }) as unknown as Response;
    expect(await chat({ keys: ["a"], fetchImpl }, [{ role: "user", content: "hi" }])).toBeNull();
  });
});

describe("extractWithLlm validation", () => {
  it("accepts a clean tool call", async () => {
    const r = await extractWithLlm("x", { keys: ["a"], fetchImpl: async () => toolReply({ token: "$pepe", type: "buying", subject: "whales", chain: "Ethereum" }) });
    expect(r.claim).toEqual({ token: "PEPE", type: "buying", subject: "whales", chain: "ethereum" });
    expect(r.status.used).toBe(true);
  });
  it("rejects a token that is not ticker-shaped, and unknown enums become undefined", async () => {
    const r = await extractWithLlm("x", { keys: ["a"], fetchImpl: async () => toolReply({ token: "the frog coin", type: "mooning", subject: "retail" }) });
    expect(r.claim).toBeNull();
    expect(r.status.error).toMatch(/bad token/);
  });
  it("malformed arguments → null, no throw", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: "{not json" } }] } }] }), { status: 200 });
    expect((await extractWithLlm("x", { keys: ["a"], fetchImpl })).claim).toBeNull();
  });
  it("a tool call with no token field at all is treated as an empty (rejected) token", async () => {
    const r = await extractWithLlm("x", { keys: ["a"], fetchImpl: async () => toolReply({ type: "buying", subject: "smart_money" }) });
    expect(r.claim).toBeNull();
    expect(r.status.error).toMatch(/bad token ""/);
  });
});

describe("narrateWithLlm guards", () => {
  it("rejects prose that is too short or too long", async () => {
    expect((await narrateWithLlm("s", { keys: ["a"], fetchImpl: async () => textReply("nope") })).text).toBeNull();
    expect((await narrateWithLlm("s", { keys: ["a"], fetchImpl: async () => textReply("x".repeat(500)) })).text).toBeNull();
  });
  it("collapses whitespace in usable prose", async () => {
    const r = await narrateWithLlm("s", { keys: ["a"], fetchImpl: async () => textReply("Smart Money  net sold\n$212K in 24 h. The buyers were fresh wallets.") });
    expect(r.text).toBe("Smart Money net sold $212K in 24 h. The buyers were fresh wallets.");
  });
  it("no keys → nothing is fetched, template prose", async () => {
    const r = await narrateWithLlm("s", { keys: [] });
    expect(r.text).toBeNull();
    expect(r.status.error).toMatch(/no GROQ key/);
  });
});

describe("rebut with an LLM in the loop", () => {
  it("the LLM narrates but cannot change the label; extraction is recorded as llm", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => (++calls === 1 ? toolReply({ token: "PEPE", type: "buying", subject: "smart_money" }) : textReply("Smart Money sat this one out entirely. Nobody labelled traded PEPE in the last day."));
    const v = await rebut(fakeClient(pepeRoutes()), "Smart Money is aping $PEPE hard today", { llm: { keys: ["a"], fetchImpl }, now: 0 });
    expect(v.claim.extractor).toBe("llm");
    expect(v.label).toBe("CONTRADICTED");
    expect(v.prose.source).toBe("llm");
    expect(v.llm.extract?.used).toBe(true);
    expect(v.llm.narrate?.used).toBe(true);
  });
  it("when the LLM is down the verdict is identical and the prose is the template", async () => {
    const down: typeof fetch = async () => new Response("x", { status: 500 });
    const a = await rebut(fakeClient(pepeRoutes()), "Smart Money is aping $PEPE", { llm: { keys: ["a"], fetchImpl: down }, now: 0 });
    const b = await rebut(fakeClient(pepeRoutes()), "Smart Money is aping $PEPE", { llm: null, now: 0 });
    expect(a.hash).toBe(b.hash);
    expect(a.claim.extractor).toBe("rules");
    expect(a.prose.source).toBe("template");
  });
});

describe("keysFromEnv", () => {
  it("prefers the comma list, trims, falls back to the single key", () => {
    expect(keysFromEnv({ GROQ_API_KEYS: " a, b ,,c " })).toEqual(["a", "b", "c"]);
    expect(keysFromEnv({ GROQ_API_KEY: "z" })).toEqual(["z"]);
    expect(keysFromEnv({})).toEqual([]);
  });
});

describe("prose that disputes the verdict is discarded (live finding 2026-09-18: a CONFIRMED whale sale narrated as 'not supported')", () => {
  it("proseConsistent per label", async () => {
    const { proseConsistent } = await import("../src/llm");
    expect(proseConsistent("CONFIRMED", "Thus the reported sale is not supported.")).toBe(false);
    expect(proseConsistent("CONFIRMED", "Whale holders sold $532K net in 24 h; the direction holds.")).toBe(true);
    expect(proseConsistent("CONTRADICTED", "The data supports the claim.")).toBe(false);
    expect(proseConsistent("CONTRADICTED", "No Smart Money wallet traded it.")).toBe(true);
    expect(proseConsistent("OVERSTATED", "Nansen fully supports the claim.")).toBe(false);
    expect(proseConsistent("UNVERIFIABLE", "This confirms the claim.")).toBe(false);
    expect(proseConsistent("SOME_UNKNOWN_LABEL", "anything at all")).toBe(true);
  });
  it("narrateWithLlm falls back to the template when the model disputes the label", async () => {
    const r = await narrateWithLlm("s", { keys: ["a"], label: "CONFIRMED", fetchImpl: async () => textReply("Whales sold only $532K, far below $5.1M, so the claim is not supported by the data.") });
    expect(r.text).toBeNull();
    expect(r.status.error).toMatch(/disputed/);
  });
});
