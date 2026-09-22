import { createHash } from "node:crypto";

/** Every Nansen call the engine makes, recorded for the provenance drawer and `--explain`. */
export type Call = {
  endpoint: string;
  body: Record<string, unknown>;
  credits: number;
  ms: number;
  cached: boolean;
  status: number;
  fieldsUsed: string[];
  /** sha256 of the raw response body — verify.ts compares live vs fixture. */
  responseHash: string;
  /** network attempts made (1 = clean; 2 = one timeout/429/5xx was retried) */
  attempts: number;
  /** wall time including any failed attempt, so a hidden timeout is visible in provenance */
  totalMs: number;
  /** false when every attempt failed; `error` says why. Failed calls are recorded at 0 credits. */
  ok: boolean;
  error?: string;
  /** caller's label for this call (the check id) so a parallel runner can find its own call in the log */
  tag?: string;
};

/** Per-call overrides: a secondary lookup can be given a shorter timeout and no retry so it cannot stall a verdict. */
export type CallOptions = { timeoutMs?: number; retries?: number; tag?: string };

/**
 * The live call feed: `start` the moment a request leaves (pending row), `end` when the Call is recorded — the same
 * object that lands in `calls`/provenance. The web rail streams these; nothing in it is synthetic.
 */
export type CallEvent =
  | { type: "call"; phase: "start"; seq: number; endpoint: string; params: string; credits: number; tag?: string }
  | { type: "call"; phase: "end"; seq: number; call: Call };

export type ClientOptions = {
  baseUrl?: string;
  /** requests per second, client-side burst cap (Nansen: 300/min) */
  rps?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** observer for the live call feed (see CallEvent); errors thrown by it are swallowed so a UI bug cannot break a verdict */
  onCall?: (e: CallEvent) => void;
  /** share one bucket across clients — a server builds a client per request, and `rps` is a property of the key, not the request */
  limiter?: RateLimiter;
  /** caller's cancellation (a closed HTTP stream): aborts the in-flight call and stops the retry, so a dropped page stops spending */
  signal?: AbortSignal;
};

const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const hours = (d: unknown): string | null => {
  const r = d as { from?: string; to?: string } | undefined;
  if (!r?.from || !r?.to) return null;
  const h = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 3_600_000);
  return Number.isFinite(h) ? (h % 24 === 0 && h >= 24 ? `${h / 24}d` : `${h}h`) : null;
};

/**
 * One line a reader can scan — chain · token · window — never the request body itself. The address is shortened; the
 * UI swaps it for the symbol once the token has resolved.
 */
export function summarizeParams(endpoint: string, body: Record<string, unknown>): string {
  const b = body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (endpoint === "search/general") return `"${String(b.search_query ?? "").slice(0, 32)}"${b.chain ? ` · ${b.chain}` : ""} · ${b.result_type ?? "all"}`;
  if (endpoint === "agent/fast" || endpoint === "agent/expert") return `"${String(b.text ?? "").slice(0, 40)}${String(b.text ?? "").length > 40 ? "…" : ""}"`;
  const parts: string[] = [];
  const chain = b.chain ?? (Array.isArray(b.chains) ? b.chains.join(",") : undefined);
  if (chain) parts.push(String(chain));
  const addr = b.token_address ?? b.filters?.token_address ?? b.address;
  if (typeof addr === "string") parts.push(shortAddr(addr));
  if (b.timeframe) parts.push(String(b.timeframe));
  if (b.buy_or_sell) parts.push(String(b.buy_or_sell));
  if (b.label_type) parts.push(String(b.label_type));
  const win = hours(b.date);
  if (win) parts.push(win);
  if (endpoint === "smart-money/netflow") parts.push("token filter");
  return parts.join(" · ") || Object.keys(body).slice(0, 3).join(", ");
}

/** Credit cost per endpoint (docs.nansen.ai credits table, crawled 2026-09-15). Unknown endpoints count as 1. */
export const CREDITS: Record<string, number> = {
  account: 0,
  "search/general": 0,
  "tgm/flow-intelligence": 1,
  "tgm/who-bought-sold": 1,
  "tgm/token-ohlcv": 1,
  "tgm/token-information": 1,
  "tgm/holders": 5,
  "tgm/indicators": 5,
  "smart-money/netflow": 5,
  "agent/fast": 200,
  "agent/expert": 750,
  "profiler/address/labels": 100,
  "profiler/address/premium-labels": 500,
};

export class NansenError extends Error {
  constructor(
    public endpoint: string,
    public status: number,
    public bodyText: string,
  ) {
    super(`Nansen ${endpoint} → HTTP ${status}: ${bodyText.slice(0, 200)}`);
  }
}

function withAttempts(e: unknown, attempts: number): unknown {
  if (e && typeof e === "object") (e as { attempts?: number }).attempts = attempts;
  return e;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Minimal token bucket: at most `rps` requests per rolling second. Share one instance to pace concurrent clients. */
export class RateLimiter {
  private timestamps: number[] = [];
  constructor(private rps: number) {}
  async take(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < 1000);
      if (this.timestamps.length < this.rps) {
        this.timestamps.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 - (now - this.timestamps[0]) + 5));
    }
  }
}

export class NansenClient {
  private baseUrl: string;
  private limiter: RateLimiter;
  protected timeoutMs: number;
  private fetchImpl: typeof fetch;
  private signal?: AbortSignal;
  /** Every call made through this client, in order. */
  readonly calls: Call[] = [];
  private onCall?: (e: CallEvent) => void;
  private seq = 0;

  constructor(
    private apiKey: string,
    opts: ClientOptions = {},
  ) {
    if (!apiKey || !apiKey.startsWith("nsn_")) {
      throw new Error("NANSEN_API_KEY missing or malformed (expected nsn_…)");
    }
    this.baseUrl = opts.baseUrl ?? "https://api.nansen.ai/api/v1";
    this.limiter = opts.limiter ?? new RateLimiter(opts.rps ?? 5); // Nansen cap is 300/min; a rebuttal is ≤ 8 calls, so 5 rps never waits more than ~1 s
    this.timeoutMs = opts.timeoutMs ?? 8000; // Nansen occasionally hangs; 8 s + one retry caps a call at ~17 s, and the checks run in parallel
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.onCall = opts.onCall;
    this.signal = opts.signal;
  }

  private emit(e: CallEvent) {
    try {
      this.onCall?.(e);
    } catch {
      /* an observer must never break a verdict */
    }
  }

  /** Announce a call that is about to leave; returns its sequence number for `record`. */
  protected begin(endpoint: string, body: Record<string, unknown>, tag?: string): number {
    const seq = ++this.seq;
    if (this.onCall) this.emit({ type: "call", phase: "start", seq, endpoint, params: summarizeParams(endpoint, body), credits: CREDITS[endpoint] ?? 1, tag });
    return seq;
  }

  /** The single place a Call enters provenance — and the feed sees exactly that object. */
  protected record(call: Call, seq: number) {
    this.calls.push(call);
    if (this.onCall) this.emit({ type: "call", phase: "end", seq, call });
  }

  /** POST `endpoint` with a JSON body; one retry on 429/5xx/timeout unless `retries: 0`; records the call. */
  async post<T = unknown>(endpoint: string, body: Record<string, unknown>, fieldsUsed: string[] = [], opts: CallOptions = {}): Promise<T> {
    const t0 = Date.now();
    const seq = this.begin(endpoint, body, opts.tag);
    try {
      const { text, ms, status, attempts, totalMs, credits } = await this.postRaw(endpoint, body, opts);
      const parsed = JSON.parse(text) as T; // parse first: a non-JSON 200 is a failure, not an ok record plus a throw
      this.record(
        {
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
        },
        seq,
      );
      return parsed;
    } catch (e) {
      this.recordFailure(endpoint, body, fieldsUsed, e, Date.now() - t0, opts.tag, seq);
      throw e;
    }
  }

  /** A call that failed every attempt still appears in provenance — a hidden 12 s timeout is a recording risk, not a detail. */
  protected recordFailure(endpoint: string, body: Record<string, unknown>, fieldsUsed: string[], e: unknown, totalMs: number, tag: string | undefined, seq: number) {
    const status = e instanceof NansenError ? e.status : 0;
    const error = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message.slice(0, 120)) : String(e);
    const attempts = (e as { attempts?: number })?.attempts ?? 1;
    this.record({ endpoint, body, credits: 0, ms: 0, cached: false, status, fieldsUsed, responseHash: "", attempts, totalMs, ok: false, error, tag }, seq);
  }

  /** The network call itself, returning the raw body so callers (and the cache) hash exactly what Nansen sent. */
  protected async postRaw(
    endpoint: string,
    body: Record<string, unknown>,
    opts: CallOptions = {},
  ): Promise<{ text: string; ms: number; status: number; attempts: number; totalMs: number; credits?: number }> {
    const url = `${this.baseUrl}/${endpoint}`;
    const t0 = Date.now();
    const maxAttempts = 1 + (opts.retries ?? 1);
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    let lastErr: unknown;
    let attemptsMade = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      attemptsMade = attempt + 1;
      await this.limiter.take();
      const started = Date.now();
      if (this.signal?.aborted) throw withAttempts(new DOMException("caller aborted", "AbortError"), attemptsMade);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      // the call dies on whichever comes first: our timeout, or the caller hanging up
      const signal = this.signal ? AbortSignal.any([ctrl.signal, this.signal]) : ctrl.signal;
      try {
        const res = await this.fetchImpl(url, {
          method: "POST",
          headers: { apikey: this.apiKey, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          signal,
        });
        const text = await res.text();
        const ms = Date.now() - started;
        if (res.status === 429 || res.status >= 500) {
          lastErr = new NansenError(endpoint, res.status, text);
          if (attempt < maxAttempts - 1) {
            // honour Retry-After on a 429 (seconds), capped so one slow minute cannot stall a verdict
            const ra = Number(res.headers.get("retry-after"));
            await new Promise((r) => setTimeout(r, res.status === 429 && ra > 0 ? Math.min(ra * 1000, 5000) : 750));
            continue;
          }
          throw lastErr;
        }
        if (!res.ok) throw new NansenError(endpoint, res.status, text);
        // Nansen reports the credits it actually charged; the static table is the fallback
        const used = Number(res.headers.get("x-nansen-credits-used"));
        return { text, ms, status: res.status, attempts: attempt + 1, totalMs: Date.now() - t0, credits: Number.isFinite(used) && res.headers.has("x-nansen-credits-used") ? used : undefined };
      } catch (e) {
        lastErr = e;
        // a caller who hung up gets no retry — retrying an abandoned request is the spend this signal exists to stop
        if (this.signal?.aborted || attempt === maxAttempts - 1 || !(e instanceof Error && e.name === "AbortError")) throw withAttempts(e, attemptsMade);
      } finally {
        clearTimeout(timer);
      }
    }
    throw withAttempts(lastErr, attemptsMade);
  }

  /** Credits spent through this client so far (from the static cost table; failed calls count 0). */
  get creditsSpent(): number {
    return this.calls.reduce((n, c) => n + c.credits, 0);
  }
}

/** Load the key from the environment; `source ~/.config/nansen/meridian.env` first. */
export function clientFromEnv(opts?: ClientOptions): NansenClient {
  const key = process.env.NANSEN_API_KEY ?? "";
  return new NansenClient(key, opts);
}
