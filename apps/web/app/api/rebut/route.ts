import { NextRequest } from "next/server";
import { rebutFor, cleanClaim, CHAINS, MAX_CLAIM } from "@/lib/engine";
import { clientIp, ipAllowed, budgetExhausted, recordSpend, replayFixture, NO_FIXTURE_MESSAGE } from "@/lib/guard";
import type { RebutEvent } from "@rebuttal/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/rebut?q=<claim or x.com URL>[&chain=base]      → Verdict JSON
 * GET /api/rebut?q=…&stream=1[&fresh=1]                    → NDJSON (fresh=1: bypass cache reads — every call live, same guard): {type:input} · {type:claim} · {type:resolved} ·
 *                                                             {type:check}×N (as each Nansen call lands) · {type:verdict} · {type:prose}
 * Same engine, same hash as the CLI. Spend guard (lib/guard.ts): 429 past the per-IP rate; past the daily credit
 * ceiling a recorded fixture replays at 0 credits (labelled in `warnings`, `degraded: true`) or the request gets a 503.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const q = cleanClaim(url.searchParams.get("q") ?? "");
  const chainParam = url.searchParams.get("chain") ?? undefined;
  const chain = chainParam && (CHAINS as readonly string[]).includes(chainParam) ? chainParam : undefined;
  if (!q) return Response.json({ error: `paste the claim — 1 to ${MAX_CLAIM} characters` }, { status: 400 });
  if (!process.env.NANSEN_API_KEY) return Response.json({ error: "server has no NANSEN_API_KEY" }, { status: 500 });
  const gate = ipAllowed(clientIp(req.headers));
  if (!gate.ok) {
    return Response.json(
      { error: `Too many checks from this address — try again in ${gate.retryAfter} s` },
      { status: 429, headers: { "retry-after": String(gate.retryAfter), "cache-control": "no-store" } },
    );
  }
  const degraded = budgetExhausted();
  const fresh = url.searchParams.get("fresh") === "1";

  if (url.searchParams.get("stream") !== "1") {
    try {
      const r = degraded ? await replayFixture(q) : await rebutFor(q, chain, { fresh });
      if (!r) return Response.json({ error: NO_FIXTURE_MESSAGE }, { status: 503, headers: { "retry-after": "3600", "cache-control": "no-store" } });
      if (!degraded) recordSpend(r.verdict.credits);
      return Response.json({ ...r.verdict, asOf: r.oldestHit ?? null, degraded }, { headers: { "cache-control": "no-store" } });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: RebutEvent | { type: "error"; message: string } | { type: "asOf"; asOf: string | null; degraded: boolean }) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };
      try {
        const r = degraded ? await replayFixture(q, { onProgress: send }) : await rebutFor(q, chain, { onProgress: send, fresh });
        if (!r) send({ type: "error", message: NO_FIXTURE_MESSAGE });
        else {
          if (!degraded) recordSpend(r.verdict.credits);
          send({ type: "asOf", asOf: r.oldestHit ?? null, degraded });
        }
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed by the client */
          }
        }
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
