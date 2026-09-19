import { CachedNansenClient, DiskCache, rebut, envLlm, type CallEvent, type RebutOptions, type Verdict } from "@rebuttal/core";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * One engine for every route. The cache is a disk cache: `.cache/` locally, `/tmp` on Vercel (per instance — a warm
 * instance answers a repeat claim at 0 credits, a cold one goes live). No database.
 */
const dir = process.env.VERCEL ? join(tmpdir(), "rebuttal-cache") : join(process.cwd(), "../../.cache");
let store: DiskCache | undefined;

export function client(fresh = false, onCall?: (e: CallEvent) => void): CachedNansenClient {
  store ??= new DiskCache(dir);
  // fresh: bypass cache reads (every call live, still written to the cache) — the recording flag, same spend guard
  // onCall: the live call feed for the page's Nansen rail (start → end per call, the same Call objects as provenance)
  return new CachedNansenClient(process.env.NANSEN_API_KEY ?? "", { store, ttlMs: fresh ? 0 : undefined, onCall });
}

/** A claim is a sentence or an x.com link: up to 600 chars (a long-form post's text, as rebut() keeps it), no control characters. */
export const MAX_CLAIM = 600;
const CONTROL = /[\u0000-\u001f\u007f]/g;
export function cleanClaim(q: string): string | null {
  const s = q.replace(CONTROL, "").trim().replace(/\s+/g, " ");
  if (!s || s.length > MAX_CLAIM) return null;
  return s;
}
export const CHAINS = ["ethereum", "base", "solana", "bnb", "arbitrum", "polygon", "avalanche", "optimism", "hyperevm", "robinhood"] as const;

export async function rebutFor(q: string, chain?: string, opts: Omit<RebutOptions, "chain" | "llm"> & { fresh?: boolean; onCall?: (e: CallEvent) => void } = {}): Promise<{ verdict: Verdict; oldestHit?: string }> {
  const { fresh, onCall, ...rest } = opts;
  const c = client(fresh, onCall);
  const v = await rebut(c, q, { chain, llm: envLlm(), ...rest });
  return { verdict: v, oldestHit: c.oldestHit };
}
