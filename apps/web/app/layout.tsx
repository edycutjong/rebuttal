import type { Metadata, Viewport } from "next";
import "./globals.css";

const CANONICAL = "https://rebuttal.edycu.dev";
// SITE_URL is only honoured when it parses: `vercel pull` on a CI runner writes sensitive envs as the literal
// "[SENSITIVE]" (locally as ""), and a build must never die on a metadata URL (audit 2026-09-19, CD 2026-09-19).
const siteUrl = process.env.SITE_URL && URL.canParse(process.env.SITE_URL) ? process.env.SITE_URL : CANONICAL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Rebuttal — is Smart Money really buying? Checked on Nansen",
  description: "Paste “Smart Money is buying $X”. Six Nansen calls decide whether it's true — CONFIRMED, OVERSTATED, CONTRADICTED or UNVERIFIABLE — and show the trace that decided it.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Rebuttal",
    title: "Rebuttal",
    description: "Paste the tweet. Six Nansen calls decide whether it's true.",
    images: [{ url: "/api/og?q=Smart%20Money%20is%20aping%20%24PEPE%20hard%20today%20%F0%9F%90%8B&v=1", width: 1200, height: 630, alt: "Rebuttal share card: the claim, the verdict word, the two numbers that decided it, the hash" }],
  },
  twitter: { card: "summary_large_image", creator: "@edycutjong", title: "Rebuttal", description: "Paste the tweet. Six Nansen calls decide whether it's true." },
  authors: [{ name: "Edy Cu Tjong", url: "https://github.com/edycutjong" }],
  creator: "Edy Cu Tjong",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#0a0e13", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
