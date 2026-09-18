import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { rebutFor, cleanClaim, CHAINS } from "@/lib/engine";
import { clientIp, ipAllowed, budgetExhausted, recordSpend, replayFixture } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COLOR: Record<string, string> = { CONFIRMED: "#22c55e", OVERSTATED: "#f59e0b", CONTRADICTED: "#ef4444", UNVERIFIABLE: "#8b9bab" };

/** 1200×630 share card: the claim, the verdict word in its colour, two reason lines, the hash. Cached at the edge for 30 min. */
export async function GET(req: NextRequest) {
  const q = cleanClaim(req.nextUrl.searchParams.get("q") ?? "Smart Money is aping $PEPE hard today 🐋") ?? "Smart Money is aping $PEPE hard today 🐋";
  const chainParam = req.nextUrl.searchParams.get("chain") ?? undefined;
  const chain = chainParam && (CHAINS as readonly string[]).includes(chainParam) ? chainParam : undefined;
  let label = "UNVERIFIABLE";
  let reasons: string[] = [];
  let hash = "";
  let meta = "";
  let claim = q;
  let failed = false;
  try {
    // same spend guard as /api/rebut — but an image never 4xxs (a scraper would drop the card): past the per-IP rate
    // or the daily ceiling the card comes from a recorded fixture, or falls through to the data-free layout below
    const gated = !ipAllowed(clientIp(req.headers)).ok;
    const live = !gated && !budgetExhausted();
    const r = live ? await rebutFor(q, chain) : await replayFixture(q, { reason: gated ? "rate" : "budget" });
    if (!r) throw new Error("no live budget and no recorded run");
    if (live) recordSpend(r.verdict.credits);
    const v = r.verdict;
    label = v.label;
    reasons = v.reasons.slice(0, 2);
    hash = v.hash.slice(0, 12);
    claim = v.claim.raw;
    meta = `${v.resolved ? `$${v.resolved.symbol} · ${v.resolved.chain} · ` : ""}${v.checks.filter((c) => c.ok).length}/${v.checks.length} Nansen calls · ${v.credits} credits`;
  } catch (e) {
    failed = true;
    reasons = [`Nansen lookup failed: ${(e as Error).message.slice(0, 80)}`];
  }
  const color = COLOR[label];
  return new ImageResponse(
    <div style={{ width: 1200, height: 630, display: "flex", flexDirection: "column", background: "#0a0e13", color: "#e6edf3", padding: 56, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, color: "#8b9bab" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ width: 34, height: 8, borderRadius: 3, background: "#2c3b4b" }} />
          <div style={{ width: 34, height: 8, borderRadius: 3, background: "#ef4444" }} />
          <div style={{ width: 34, height: 8, borderRadius: 3, background: "#2c3b4b" }} />
        </div>
        <div style={{ display: "flex" }}>
          <b style={{ color: "#e6edf3" }}>rebuttal</b>&nbsp;· is Smart Money really buying · on Nansen
        </div>
      </div>
      <div style={{ display: "flex", marginTop: 40, fontSize: 34, lineHeight: 1.25, color: "#b6c2cf", fontStyle: "italic" }}>“{claim.length > 110 ? claim.slice(0, 110) + "…" : claim}”</div>
      <div style={{ display: "flex", marginTop: 34, fontSize: 84, fontWeight: 900, letterSpacing: -3, color }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20, fontSize: 27, color: "#e6edf3" }}>
        {reasons.map((r, i) => (
          <div key={i} style={{ display: "flex" }}>
            · {r.length > 92 ? r.slice(0, 92) + "…" : r}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", fontSize: 22, color: "#8b9bab" }}>
        <div style={{ display: "flex" }}>{meta}</div>
        <div style={{ display: "flex", fontFamily: "monospace" }}>{hash}</div>
      </div>
    </div>,
    // a failure card is never cached at the edge — the next crawler gets a fresh try
    { width: 1200, height: 630, headers: { "cache-control": failed ? "no-store" : "public, s-maxage=1800, stale-while-revalidate=86400" } },
  );
}
