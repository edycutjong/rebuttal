import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NansenClient, sha256, CREDITS, type ClientOptions, type CallOptions } from "./client.js";

export type CacheEntry = { storedAt: string; ttlMs: number; endpoint: string; body: Record<string, unknown>; text: string };

/** Storage for cached responses. Disk for CLI/dev; the web app can plug in KV with the same three methods. */
export interface CacheStore {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
}

export class DiskCache implements CacheStore {
  constructor(private dir = join(process.cwd(), ".cache")) {
    mkdirSync(dir, { recursive: true });
  }
  private path(key: string) {
    return join(this.dir, `${key}.json`);
  }
  get(key: string): CacheEntry | undefined {
    const p = this.path(key);
    if (!existsSync(p)) return undefined;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as CacheEntry;
    } catch {
      return undefined;
    }
  }
  set(key: string, entry: CacheEntry) {
    writeFileSync(this.path(key), JSON.stringify(entry));
  }
}

export class MemoryCache implements CacheStore {
  private m = new Map<string, CacheEntry>();
  get(key: string) {
    return this.m.get(key);
  }
  set(key: string, entry: CacheEntry) {
    this.m.set(key, entry);
  }
  /** Everything stored, insertion order — `scripts/seed.ts` writes this to a fixture file. */
  entries(): Record<string, CacheEntry> {
    return Object.fromEntries(this.m);
  }
}

export const DEFAULT_TTL_MS = 60 * 60 * 1000; // one hour: the who-bought-sold / ohlcv windows are floored to the hour, so a rebuttal is stable within it

/** Recursively sort object keys so `{a:{y,x}}` and `{a:{x,y}}` serialize identically (arrays keep order). */
export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canonicalize((v as Record<string, unknown>)[k])]),
    );
  return v;
}

/** Stable key: endpoint + canonical body (keys sorted at every depth). */
export function cacheKey(endpoint: string, body: Record<string, unknown>): string {
  return sha256(`${endpoint}\n${JSON.stringify(canonicalize(body))}`).slice(0, 32);
}

export type CachedClientOptions = ClientOptions & {
  store?: CacheStore;
  ttlMs?: number;
  /** NANSEN_OFFLINE=1: never touch the network; a miss is an error. Used by `npm run verify`. */
  offline?: boolean;
};

/**
 * NansenClient with a read-through cache. A hit is recorded as a Call with `cached: true` and 0 credits,
 * so the provenance drawer and the credit counter stay honest.
 */
export class CachedNansenClient extends NansenClient {
  private store: CacheStore;
  private ttlMs: number;
  private offline: boolean;
  /** ISO timestamp of the oldest cached response used by the current verdict, for the "as of" label. */
  oldestHit?: string;

  constructor(apiKey: string, opts: CachedClientOptions = {}) {
    super(apiKey, opts);
    this.store = opts.store ?? new DiskCache();
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.offline = opts.offline ?? process.env.NANSEN_OFFLINE === "1";
  }

  override async post<T = unknown>(endpoint: string, body: Record<string, unknown>, fieldsUsed: string[] = [], opts: CallOptions = {}): Promise<T> {
    const key = cacheKey(endpoint, body);
    // Freshness is judged by THIS client's TTL, not the TTL the entry was written with — so `ttlMs: 0` (--no-cache)
    // really bypasses reads. Offline mode serves any entry regardless of age (it is a replay, and says so).
    const hit = this.ttlMs > 0 || this.offline ? this.store.get(key) : undefined;
    const fresh = hit && Date.now() - Date.parse(hit.storedAt) < this.ttlMs;
    if (hit && (fresh || this.offline)) {
      this.calls.push({
        endpoint,
        body,
        credits: 0,
        ms: 0,
        cached: true,
        status: 200,
        fieldsUsed,
        responseHash: sha256(hit.text),
        attempts: 0,
        totalMs: 0,
        ok: true,
        tag: opts.tag,
      });
      if (!this.oldestHit || hit.storedAt < this.oldestHit) this.oldestHit = hit.storedAt;
      return JSON.parse(hit.text) as T;
    }
    if (this.offline) throw new Error(`NANSEN_OFFLINE=1 and no cached response for ${endpoint} ${JSON.stringify(body)}`);
    const t0 = Date.now();
    let raw: Awaited<ReturnType<NansenClient["postRaw"]>>;
    try {
      raw = await this.postRaw(endpoint, body, opts);
    } catch (e) {
      this.recordFailure(endpoint, body, fieldsUsed, e, Date.now() - t0, opts.tag);
      throw e;
    }
    const { text, ms, status, attempts, totalMs, credits } = raw;
    let parsed: T;
    try {
      parsed = JSON.parse(text) as T; // a non-JSON 200 must never be stored — it would replay (and throw) for an hour
    } catch (e) {
      this.recordFailure(endpoint, body, fieldsUsed, e, Date.now() - t0, opts.tag);
      throw e;
    }
    this.calls.push({
      endpoint,
      body,
      credits: credits ?? CREDITS[endpoint] ?? 1,
      ms,
      cached: false,
      status,
      fieldsUsed,
      responseHash: sha256(text),
      attempts,
      totalMs,
      ok: true,
      tag: opts.tag,
    });
    this.store.set(key, { storedAt: new Date().toISOString(), ttlMs: this.ttlMs, endpoint, body, text });
    return parsed;
  }
}

export function cachedClientFromEnv(opts?: CachedClientOptions): CachedNansenClient {
  return new CachedNansenClient(process.env.NANSEN_API_KEY ?? "", opts);
}
