/**
 * HTTP/2 carries no reason phrase, so `res.statusText` is "" on Vercel. An error message built from it alone is the
 * empty string, and `{error && <banner/>}` then renders nothing — a failure with no explanation on screen. Every
 * message this returns is non-empty.
 */
export async function httpError(res: Response): Promise<string> {
  const fallback = res.statusText || `HTTP ${res.status}`;
  const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return (typeof j?.error === "string" && j.error.trim()) || fallback;
}
