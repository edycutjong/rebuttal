import Link from "next/link";
import pkg from "../package.json";

export const VERSION = `v${pkg.version}`;
export const REPO = "https://github.com/edycutjong/rebuttal";

/** The mark — the family's three bars; Rebuttal's middle bar is the verdict red (the claim, struck through). */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <rect x="4" y="8" width="56" height="14" rx="4" fill="var(--border-2)" />
      <rect x="4" y="25" width="56" height="14" rx="4" fill="var(--impostor)" />
      <rect x="4" y="42" width="56" height="14" rx="4" fill="var(--border-2)" />
    </svg>
  );
}

export function SiteHeader({ current }: { current: "home" | "judge" }) {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Rebuttal — home">
        <Mark />
        <span className="brand-name">rebuttal</span>
        <span className="brand-tag">is Smart Money really buying · on Nansen</span>
      </Link>
      <nav className="site-nav" aria-label="site">
        <Link href="/" aria-current={current === "home" ? "page" : undefined}>
          Check
        </Link>
        <Link href="/judge" aria-current={current === "judge" ? "page" : undefined}>
          For the judge
        </Link>
        <a href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="foot-row">
        <span>
          <Mark size={14} /> rebuttal <a href={`${REPO}/releases/latest`}>{VERSION}</a>
        </span>
        <span className="foot-links">
          <a href={`${REPO}/blob/main/docs/SCORING.md`}>how it decides</a>
          <a href={`${REPO}/blob/main/DEMO.md`}>reproduce it</a>
          <Link href="/judge">for the judge</Link>
          <a href="https://docs.nansen.ai" target="_blank" rel="noreferrer">
            Nansen API
          </a>
        </span>
      </div>
      <p className="foot-note">
        Built on the Nansen API for the Meridian Buildathon by{" "}
        <a href="https://x.com/edycutjong" target="_blank" rel="noreferrer">
          @edycutjong
        </a>
        . The verdict is arithmetic over Nansen label-class flows; the LLM only reads the claim and writes two sentences. Not financial advice.
      </p>
    </footer>
  );
}
