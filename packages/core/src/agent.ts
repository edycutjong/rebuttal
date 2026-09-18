/**
 * Nansen's own Research Agent (`agent/fast`, 200 credits, SSE). Rebuttal does not use it to decide anything: it is the
 * comparison beat — the same claim, Nansen's agent's answer and the list of tools it called, shown beside our trace.
 * Never auto-fired; the caller prints the price on the button.
 */
export type AgentEvent = { type: "tool_call"; name: string } | { type: "delta"; text: string } | { type: "finish"; conversationId?: string; toolCalls: string[] } | { type: "error"; error: string };
export type AgentRun = { text: string; toolCalls: string[]; ms: number; credits: number; conversationId?: string; timedOut: boolean; error?: string; firstByteMs: number | null };

export const AGENT_CREDITS = 200;

export async function askNansenAgent(
  apiKey: string,
  text: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; baseUrl?: string; onEvent?: (e: AgentEvent) => void } = {},
): Promise<AgentRun> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const run: AgentRun = { text: "", toolCalls: [], ms: 0, credits: AGENT_CREDITS, timedOut: false, firstByteMs: null };
  const seen = new Set<string>();
  try {
    const res = await fetchImpl(`${opts.baseUrl ?? "https://api.nansen.ai/api/v1"}/agent/fast`, {
      method: "POST",
      headers: { apikey: apiKey, "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ text: text.slice(0, 1000) }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      run.error = `HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`;
      return run;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    // the timer must also cut a stream that is still trickling deltas past the budget, not only the initial fetch
    const aborted = new Promise<never>((_, rej) => ctrl.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const handle = (raw: string) => {
      const line = raw.trim();
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      let ev: Record<string, unknown>;
      try {
        ev = JSON.parse(data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (ev.type === "delta" && typeof ev.text === "string") {
        run.text += ev.text;
        opts.onEvent?.({ type: "delta", text: ev.text });
      } else if (ev.type === "tool_call" && typeof ev.name === "string") {
        if (!seen.has(ev.name)) {
          seen.add(ev.name);
          run.toolCalls.push(ev.name);
        }
        opts.onEvent?.({ type: "tool_call", name: ev.name });
      } else if (ev.type === "finish") {
        const tc = Array.isArray(ev.tool_calls) ? (ev.tool_calls as unknown[]).map((t) => (typeof t === "string" ? t : ((t as { name?: string }).name ?? JSON.stringify(t)))) : [];
        for (const n of tc)
          if (!seen.has(n)) {
            seen.add(n);
            run.toolCalls.push(n);
          }
        if (typeof ev.conversation_id === "string") run.conversationId = ev.conversation_id;
        opts.onEvent?.({ type: "finish", conversationId: run.conversationId, toolCalls: run.toolCalls });
      } else if (ev.type === "error") {
        run.error = String(ev.error ?? "agent error");
        opts.onEvent?.({ type: "error", error: run.error });
      }
    };
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (run.firstByteMs == null) run.firstByteMs = Date.now() - t0;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    }
    if (buf.trim()) handle(buf); // a final event without a trailing newline (finish carries tool_calls)
  } catch (e) {
    ctrl.abort();
    if ((e as Error).name === "AbortError") {
      run.timedOut = true;
      run.error = `Nansen's agent did not finish in ${Math.round(timeoutMs / 1000)} s`;
    } else run.error = (e as Error).message.slice(0, 160);
  } finally {
    clearTimeout(timer);
    run.ms = Date.now() - t0;
  }
  return run;
}
