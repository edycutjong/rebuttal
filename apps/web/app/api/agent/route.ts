import { NextRequest } from "next/server";
import { askNansenAgent, AGENT_CREDITS, type AgentEvent } from "@rebuttal/core";
import { cleanClaim } from "@/lib/engine";
import { clientIp, agentAllowed } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * POST /api/agent  {q}  → NDJSON relay of Nansen's own agent/fast (200 credits): {type:tool_call} · {type:delta} ·
 * {type:finish} · {type:done, run}. This is the comparison beat, never part of the verdict: the button that calls it
 * prints the price, and lib/guard.ts caps runs per IP and per day. GET is not allowed — a link preview must never spend 200 credits.
 */
export async function POST(req: NextRequest) {
  // only our own page may spend 200 credits: a JSON body (never a no-preflight text/plain form) from this origin
  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  const sameOrigin = site ? site === "same-origin" || site === "none" : !origin || origin === req.nextUrl.origin;
  if (!sameOrigin || !(req.headers.get("content-type") ?? "").includes("application/json")) return Response.json({ error: "this route only serves the Rebuttal page" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { q?: string };
  const q = cleanClaim(body.q ?? "");
  if (!q) return Response.json({ error: "no claim" }, { status: 400 });
  if (!process.env.NANSEN_API_KEY) return Response.json({ error: "server has no NANSEN_API_KEY" }, { status: 500 });
  const ip = clientIp(req.headers);
  const refusal = agentAllowed(ip);
  if (refusal) return Response.json({ error: refusal, credits: AGENT_CREDITS }, { status: 429, headers: { "cache-control": "no-store" } });
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: AgentEvent | { type: "done"; run: unknown }) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        const run = await askNansenAgent(process.env.NANSEN_API_KEY as string, q, { onEvent: send, timeoutMs: 60_000 });
        send({ type: "done", run });
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* closed by the client */
          }
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

export function GET() {
  return Response.json({ error: `POST only — this route spends ${AGENT_CREDITS} Nansen credits per call` }, { status: 405 });
}
