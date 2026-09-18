/**
 * Resolve the canonical site origin from SITE_URL, falling back to the canonical domain (DNS live 2026-09-19;
 * `https://rebuttal-edycutjong.vercel.app` stays as the fallback alias). Only a parseable http(s) URL is accepted:
 * an empty value, a blank .env line, or the literal "[SENSITIVE]" placeholder that `vercel pull` writes for sensitive
 * env vars on a CI runner (which made `new URL()` throw while Next collected page data — CI/CD run 35403618340) all
 * resolve to the default.
 */
export function resolveSite(raw: string | undefined, fallback: string): string {
  try {
    const u = new URL(raw ?? "");
    return /^https?:$/.test(u.protocol) ? u.origin : fallback;
  } catch {
    return fallback;
  }
}
export const SITE = resolveSite(process.env.SITE_URL, "https://rebuttal.edycu.dev");
