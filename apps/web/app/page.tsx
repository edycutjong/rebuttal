import { Rebuttal } from "@/components/Rebuttal";
import { SiteHeader, SiteFooter } from "@/components/Shell";
import { PROOF } from "@/lib/proof";
import type { Fixture } from "@rebuttal/core";
import pepe from "../../../fixtures/pepe-aping.json";

export const dynamic = "force-dynamic";

/** The recorded hero rebuttal (fixtures/pepe-aping.json) is the empty state's example — replayed, 0 credits, labelled. */
const EXAMPLE = pepe as unknown as Fixture;

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <SiteHeader current="home" />
      <Rebuttal initialQuery={sp.q} example={EXAMPLE.verdict} exampleAgent={EXAMPLE.verdict.agent ?? null} proof={PROOF} />
      <SiteFooter />
    </>
  );
}
