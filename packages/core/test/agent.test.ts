import { describe, it, expect, afterEach, vi } from "vitest";
import { askNansenAgent, AGENT_CREDITS } from "../src/agent";

function sse(lines: string[], delayMs = 0): typeof fetch {
  return async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(ctl) {
        for (const l of lines) {
          if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
          ctl.enqueue(enc.encode(l + "\n"));
        }
        ctl.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}

describe("askNansenAgent — the agent/fast SSE stream", () => {
  it("collects deltas, unique tool_calls and the finish event", async () => {
    const events: string[] = [];
    const run = await askNansenAgent("nsn_x", "SM aping $PEPE", {
      fetchImpl: sse([
        'data: {"type":"tool_call","name":"token_recent_flows_summary"}',
        'data: {"type":"tool_call","name":"token_recent_flows_summary"}',
        'data: {"type":"delta","text":"Smart money "}',
        'data: {"type":"delta","text":"is flat."}',
        'data: {"type":"finish","conversation_id":"c1","tool_calls":["token_recent_flows_summary","token_current_top_holders"]}',
        "data: [DONE]",
      ]),
      onEvent: (e) => events.push(e.type),
    });
    expect(run.text).toBe("Smart money is flat.");
    expect(run.toolCalls).toEqual(["token_recent_flows_summary", "token_current_top_holders"]);
    expect(run.conversationId).toBe("c1");
    expect(run.credits).toBe(AGENT_CREDITS);
    expect(run.timedOut).toBe(false);
    expect(run.firstByteMs).not.toBeNull();
    expect(events).toEqual(["tool_call", "tool_call", "delta", "delta", "finish"]);
  });
  it("finish tool_calls given as objects with a name are accepted", async () => {
    const run = await askNansenAgent("nsn_x", "x", { fetchImpl: sse(['data: {"type":"finish","tool_calls":[{"name":"a"},{"name":"b"}]}']) });
    expect(run.toolCalls).toEqual(["a", "b"]);
  });
  it("a finish event whose tool_calls is missing (not an array) contributes no tool calls", async () => {
    const run = await askNansenAgent("nsn_x", "x", { fetchImpl: sse(['data: {"type":"finish"}']) });
    expect(run.toolCalls).toEqual([]);
  });
  it("an upstream error event is recorded, not thrown", async () => {
    const run = await askNansenAgent("nsn_x", "x", { fetchImpl: sse(['data: {"type":"error","error":"agent unavailable","status_code":503}']) });
    expect(run.error).toBe("agent unavailable");
  });
  it("a non-200 response is an error with the status", async () => {
    const run = await askNansenAgent("nsn_x", "x", { fetchImpl: async () => new Response("no credits", { status: 402 }) });
    expect(run.error).toMatch(/HTTP 402/);
    expect(run.toolCalls).toEqual([]);
  });
  it("times out cleanly and says so", async () => {
    const run = await askNansenAgent("nsn_x", "x", { fetchImpl: sse(['data: {"type":"delta","text":"a"}', 'data: {"type":"delta","text":"b"}'], 400), timeoutMs: 300 });
    expect(run.timedOut).toBe(true);
    expect(run.error).toMatch(/did not finish/);
    expect(run.ms).toBeGreaterThanOrEqual(280);
  });
  it("ignores malformed lines and non-data lines", async () => {
    const run = await askNansenAgent("nsn_x", "x", { fetchImpl: sse([": comment", "event: ping", "data: {not json", 'data: {"type":"delta","text":"ok"}']) });
    expect(run.text).toBe("ok");
  });
  it("ignores a well-formed data event of a type it does not recognize", async () => {
    const run = await askNansenAgent("nsn_x", "x", { fetchImpl: sse(['data: {"type":"ping"}', 'data: {"type":"delta","text":"ok"}']) });
    expect(run.text).toBe("ok");
    expect(run.error).toBeUndefined();
  });
  it("finish tool_calls given as bare objects with no name fall back to their JSON text", async () => {
    const run = await askNansenAgent("nsn_x", "x", { fetchImpl: sse(['data: {"type":"finish","tool_calls":[{"weight":1}]}']) });
    expect(run.toolCalls).toEqual(['{"weight":1}']);
  });
  it("a finish event with no conversation_id leaves conversationId unset", async () => {
    const run = await askNansenAgent("nsn_x", "x", { fetchImpl: sse(['data: {"type":"finish","tool_calls":[]}']) });
    expect(run.conversationId).toBeUndefined();
  });
  it("an error event with no `error` field falls back to a generic message", async () => {
    const run = await askNansenAgent("nsn_x", "x", { fetchImpl: sse(['data: {"type":"error"}']) });
    expect(run.error).toBe("agent error");
  });
  it("a res.text() that itself rejects still returns a bounded HTTP error", async () => {
    const run = await askNansenAgent("nsn_x", "x", {
      fetchImpl: async () => ({ ok: false, status: 500, body: null, text: () => Promise.reject(new Error("boom")) }) as unknown as Response,
    });
    expect(run.error).toMatch(/HTTP 500/);
    expect(run.credits).toBe(0);
  });
  it("a network error that is not an abort is recorded by its message, not as a timeout", async () => {
    const run = await askNansenAgent("nsn_x", "x", {
      fetchImpl: async () => {
        throw new Error("fetch failed: ECONNRESET");
      },
    });
    expect(run.timedOut).toBe(false);
    expect(run.error).toBe("fetch failed: ECONNRESET");
    expect(run.credits).toBe(0);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("with no fetchImpl given, it falls back to the global fetch", async () => {
    vi.stubGlobal("fetch", sse(['data: {"type":"delta","text":"g"}']));
    const run = await askNansenAgent("nsn_x", "x", {});
    expect(run.text).toBe("g");
  });
});
