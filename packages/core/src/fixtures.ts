import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryCache, type CacheEntry } from "./cache";
import type { Claim } from "./claim";
import type { Verdict } from "./rebut";

/**
 * A recorded live run: every raw Nansen response the rebuttal touched (keyed by cache key, byte-for-byte as sent), the
 * claim as extracted at record time (so a replay never needs an LLM key), the clock, and the verdict it produced.
 * `scripts/seed.ts` writes these; `scripts/verify.ts` and the tests replay them with NANSEN_OFFLINE=1 — same inputs,
 * same clock, so the label, rule and hash must come out identical. Responses are never edited.
 */
export type Fixture = {
  slug: string;
  /** why this claim is in the set — the edge it exercises (specs/seed-data.md) */
  edge: string;
  input: string;
  source: string;
  claim: Claim;
  options: { chain?: string };
  now: number;
  recordedAt: string;
  live: { calls: number; credits: number; ms: number };
  responses: Record<string, CacheEntry>;
  verdict: Verdict;
};

export const FIXTURES_DIR = "fixtures";

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function writeFixture(f: Fixture, dir = FIXTURES_DIR): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${f.slug}.json`);
  writeFileSync(path, JSON.stringify(f, null, 2) + "\n");
  return path;
}

export function readFixture(path: string): Fixture {
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

export function listFixtures(dir = FIXTURES_DIR): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort()
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

/** A cache store pre-loaded with the fixture's responses — plug into `CachedNansenClient` with `offline: true`. */
export function fixtureStore(f: Fixture): MemoryCache {
  const store = new MemoryCache();
  for (const [key, entry] of Object.entries(f.responses)) store.set(key, entry);
  return store;
}
