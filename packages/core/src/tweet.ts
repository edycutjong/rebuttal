/** x.com / twitter.com status URL → the tweet's text via the public oEmbed endpoint (no key, no credits). */
const STATUS_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})(?:[/?#].*)?$/;

export function isTweetUrl(s: string): boolean {
  return STATUS_RE.test(s.trim());
}

export async function fetchTweetText(url: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<{ text: string; author: string } | null> {
  const m = url.trim().match(STATUS_RE);
  if (!m) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 4000);
  try {
    const clean = `https://x.com/${m[1]}/status/${m[2]}`;
    const res = await fetchImpl(`https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(clean)}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const j = (await res.json()) as { html?: string; author_name?: string };
    if (!j.html) return null;
    // <blockquote><p>text<br>more</p>&mdash; author (@handle) <a>date</a></blockquote>
    const p = j.html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const text = decode((p?.[1] ?? j.html).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    return text ? { text, author: j.author_name ?? m[1] } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}
