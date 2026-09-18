/**
 * Groq (OpenAI-compatible chat completions, tool calling). Used for two things only: extracting the claim from free
 * text, and paraphrasing a decided verdict in two sentences. Both have a deterministic fallback; neither can change a label.
 * Keys come from GROQ_API_KEYS (comma-separated) or GROQ_API_KEY; on 429 the next key is tried.
 */
import type { Claim } from "./claim.js";
import { SCORABLE_CHAINS } from "./claim.js";

export type LlmOptions = { keys: string[]; model?: string; timeoutMs?: number; fetchImpl?: typeof fetch; baseUrl?: string };
export type LlmStatus = { used: boolean; ms: number; error?: string; model: string };

/** llama-3.3-70b-versatile was retired from Groq before 2026-09-18 (model_not_found); gpt-oss-120b tool-calls in ~1 s. */
const MODEL = "openai/gpt-oss-120b";
const BASE = "https://api.groq.com/openai/v1";

export function keysFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const multi = (env.GROQ_API_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
  if (multi.length) return multi;
  return env.GROQ_API_KEY ? [env.GROQ_API_KEY.trim()] : [];
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type ToolDef = { type: "function"; function: { name: string; description: string; parameters: unknown } };

/** One chat completion; rotates keys on 429/401; returns null on any failure inside the time budget. */
export async function chat(
  opts: LlmOptions,
  messages: ChatMessage[],
  tools?: ToolDef[],
): Promise<{ content: string | null; toolArgs: Record<string, unknown> | null; ms: number } | null> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const model = opts.model ?? MODEL;
  const timeoutMs = opts.timeoutMs ?? 3000;
  const t0 = Date.now();
  const keys = [...opts.keys];
  // deterministic start key from the second so parallel runs spread load across keys
  const start = keys.length ? Math.floor(Date.now() / 1000) % keys.length : 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length];
    if (Date.now() - t0 > timeoutMs) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(200, timeoutMs - (Date.now() - t0)));
    try {
      const body: Record<string, unknown> = { model, messages, temperature: 0, max_tokens: 400, reasoning_effort: "low" };
      if (tools) {
        body.tools = tools;
        body.tool_choice = { type: "function", function: { name: tools[0].function.name } };
      }
      const res = await fetchImpl(`${opts.baseUrl ?? BASE}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status === 401 || res.status === 403) continue;
      if (!res.ok) {
        // a restricted/suspended key answers 400 "Organization has been restricted" — that is a key problem, not a request problem
        const t = await res.text().catch(() => "");
        if (/restricted|suspended|quota|billing/i.test(t)) continue;
        return null;
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { arguments?: string } }> } }> };
      const msg = json.choices?.[0]?.message;
      const args = msg?.tool_calls?.[0]?.function?.arguments;
      let toolArgs: Record<string, unknown> | null = null;
      if (args) {
        try {
          toolArgs = JSON.parse(args) as Record<string, unknown>;
        } catch {
          toolArgs = null;
        }
      }
      return { content: msg?.content ?? null, toolArgs, ms: Date.now() - t0 };
    } catch {
      return null; // timeout or network: the caller falls back
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const EXTRACT_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "extract_claim",
    description: "Extract the on-chain flow claim a crypto post makes: which token, which chain if named, whether the post says the subject is buying, selling or holding, and who the subject is.",
    parameters: {
      type: "object",
      properties: {
        token: { type: "string", description: "ticker symbol in upper case without $, e.g. PEPE. Empty string if none." },
        chain: { type: "string", description: "Nansen chain id if the text names one: ethereum, solana, base, bnb, arbitrum, polygon, avalanche, optimism, hyperevm, robinhood. Empty if not named." },
        type: { type: "string", enum: ["buying", "selling", "holding", "none"], description: "buying = buying/accumulating/aping/withdrawing from exchanges/going long; selling = selling/dumping/depositing to exchanges/taking profit; holding = still holding/hasn't sold/sitting on gains; none = not a flow claim" },
        subject: { type: "string", enum: ["smart_money", "whales"], description: "smart_money for smart money / smart traders / funds / insiders; whales for whales / large holders" },
        confidence: { type: "number" },
      },
      required: ["token", "type", "subject"],
    },
  },
};

/** LLM extraction → partial Claim, or null. Validated: a token must look like a ticker. */
export async function extractWithLlm(text: string, opts: LlmOptions): Promise<{ claim: Partial<Claim> | null; status: LlmStatus }> {
  const model = opts.model ?? MODEL;
  if (!opts.keys.length) return { claim: null, status: { used: false, ms: 0, error: "no GROQ key", model } };
  const r = await chat(
    opts,
    [
      { role: "system", content: "You extract structured claims from crypto social posts. Call the tool exactly once. Never invent a token that is not in the text." },
      { role: "user", content: text.slice(0, 600) },
    ],
    [EXTRACT_TOOL],
  );
  if (!r || !r.toolArgs) return { claim: null, status: { used: false, ms: r?.ms ?? 0, error: "no tool call", model } };
  const a = r.toolArgs;
  const token = typeof a.token === "string" ? a.token.toUpperCase().replace(/^\$/, "").trim() : "";
  const type = a.type === "buying" || a.type === "selling" || a.type === "holding" ? a.type : undefined;
  const subject = a.subject === "whales" ? "whales" : a.subject === "smart_money" ? "smart_money" : undefined;
  const chain = typeof a.chain === "string" && SCORABLE_CHAINS.has(a.chain.toLowerCase()) ? a.chain.toLowerCase() : undefined;
  if (!/^[A-Z0-9]{2,12}$/.test(token)) return { claim: null, status: { used: false, ms: r.ms, error: `bad token "${token}"`, model } };
  return { claim: { token, type, subject, chain }, status: { used: true, ms: r.ms, model } };
}

/** Two sentences from the decided verdict. The label is passed as a fact; the model may not dispute it. */
export async function narrateWithLlm(summary: string, opts: LlmOptions): Promise<{ text: string | null; status: LlmStatus }> {
  const model = opts.model ?? MODEL;
  if (!opts.keys.length) return { text: null, status: { used: false, ms: 0, error: "no GROQ key", model } };
  const r = await chat({ ...opts, timeoutMs: opts.timeoutMs ?? 4000 }, [
    {
      role: "system",
      content:
        "You write the two-sentence rebuttal under a fact-check card. Use ONLY the numbers given. Do not change the verdict. Do not add advice, hedges, emojis or questions. Plain prose, at most 45 words total, no bullet points, no markdown.",
    },
    { role: "user", content: summary },
  ]);
  const text = r?.content?.trim().replace(/\s+/g, " ") ?? null;
  if (!text || text.length < 20 || text.length > 400) return { text: null, status: { used: false, ms: r?.ms ?? 0, error: "unusable prose", model } };
  return { text, status: { used: true, ms: r?.ms ?? 0, model } };
}
