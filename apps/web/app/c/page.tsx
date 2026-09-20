import type { Metadata } from "next";
import { cache } from "react";
import { Rebuttal } from "@/components/Rebuttal";
import { SiteHeader, SiteFooter } from "@/components/Shell";
import { PROOF } from "@/lib/proof";
import { headers } from "next/headers";
import { rebutFor, cleanClaim } from "@/lib/engine";
import { budgetExhausted, recordSpend, replayFixture, ipAllowed, clientIp } from "@/lib/guard";
import type { Fixture, Verdict } from "@rebuttal/core";
import pepe from "../../../../fixtures/pepe-aping.json";

export const dynamic = "force-dynamic";
const EXAMPLE = pepe as unknown as Fixture;

/**
 * /c?q=<claim> — the permalink: the verdict rendered on the server (from the cache when warm, live otherwise, a recorded
 * replay past the daily ceiling) with Open Graph tags, so a pasted link shows the verdict word and the numbers.
 */
const verdictFor = cache(async (q: string): Promise<Verdict | null> => {
  try {
    // same per-IP gate and daily ceiling as /api/rebut: a link-preview crawler or a loop over /c?q= cannot spend freely
    const gated = !ipAllowed(clientIp(await headers())).ok;
    const degraded = gated || budgetExhausted();
    const r = degraded ? await replayFixture(q, { reason: gated ? "rate" : "budget" }) : await rebutFor(q);
    if (!r) return null;
    if (!degraded) recordSpend(r.verdict.credits);
    return r.verdict;
  } catch {
    return null;
  }
});

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ q?: string }> }): Promise<Metadata> {
  const q = cleanClaim((await searchParams).q ?? "");
  if (!q) return { title: "Rebuttal" };
  const v = await verdictFor(q);
  const title = v ? `${v.label} — ${q.slice(0, 80)}` : `Rebuttal — ${q.slice(0, 80)}`;
  const description = v ? v.reasons.slice(0, 2).join(" · ") : "Paste the tweet. Six Nansen calls decide whether it's true, with the full trace that decided it.";
  const og = `/api/og?q=${encodeURIComponent(q)}`;
  return { title, description, openGraph: { title, description, images: [{ url: og, width: 1200, height: 630 }] }, twitter: { card: "summary_large_image", title, description, images: [og] }, alternates: { canonical: `/c?q=${encodeURIComponent(q)}` } };
}

export default async function Permalink({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = cleanClaim((await searchParams).q ?? "");
  const v = q ? await verdictFor(q) : null;
  return (
    <div className="with-rail">
      <SiteHeader current="home" />
      {/* no verdict (gated, failed, or unrecorded past the ceiling) → the claim is prefilled, never auto-run a second time */}
      <Rebuttal initialQuery={v ? (q ?? undefined) : undefined} initialVerdict={v} prefill={v ? undefined : (q ?? undefined)} example={EXAMPLE.verdict} exampleAgent={EXAMPLE.verdict.agent ?? null} proof={PROOF} />
      <SiteFooter />
    </div>
  );
}
