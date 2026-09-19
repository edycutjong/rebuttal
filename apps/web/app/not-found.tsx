import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/Shell";

export const metadata: Metadata = { title: "Rebuttal — nothing here", robots: { index: false } };

/** 404 — the same shell as the home; says what does exist so a mistyped link still lands somewhere useful. */
export default function NotFound() {
  return (
    <>
      <SiteHeader current="home" />
      <main className="wrap nf">
        <h1>
          This page is <span className="no">unverifiable</span> — it doesn&apos;t exist.
        </h1>
        <p>Rebuttal has three routes. If you followed a permalink, check that the whole query survived the paste.</p>
        <ul>
          <li>
            <Link href="/">/</Link> — paste “Smart Money is buying $X” and get one of four verdict words with the Nansen trace.
          </li>
          <li>
            <Link href="/judge">/judge</Link> — the 30-second path, the receipts and the reproduce command, for one reader.
          </li>
          <li>
            <code>/c?q=&lt;claim&gt;</code> — the permalink for a checked claim, with the verdict rendered on the server.
          </li>
        </ul>
        <p>
          <Link href="/">← back to the tool</Link> · <Link href="/judge">for the judge</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
