"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Call, CallEvent, AgentRun } from "@rebuttal/core";
import { REPO } from "./Shell";

/**
 * The Nansen call rail — the live meter beside the page (the trace table is the receipt). Every row is a real `Call`
 * from the engine's own provenance stream: `start` when the request leaves (pending), `end` when the same object lands
 * in `verdict.provenance`. Nothing here is synthetic; the recorded example on load is labelled "replayed · 0 cr".
 */
export type RailStatus = "pending" | "live" | "cached" | "error" | "replayed";
export type RailRow = {
  id: string;
  group: number;
  seq: number;
  /** call = a Nansen endpoint the engine hit · agent = agent/fast itself · tool = a tool_call Nansen's agent reported inside that run */
  kind: "call" | "agent" | "tool";
  endpoint: string;
  params: string;
  status: RailStatus;
  credits: number;
  ms: number | null;
  hash: string | null;
  error?: string;
};
export type RailGroup = { id: number; label: string; kind: "replayed" | "live" | "agent" | "permalink"; startedAt: number; ms: number | null; done: boolean };
type RailState = { rows: RailRow[]; groups: RailGroup[] };

export const RAIL_CAP = 200;
const AGENT_PRICE = 200;
export const shortAddr = (a: string) => (a.length > 16 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const short = (h: string | undefined | null) => (h ? h.slice(0, 8) : null);

function rowsFromCalls(group: number, calls: Call[], status: "replayed" | "provenance"): RailRow[] {
  return calls.map((c, i) => ({
    id: `${group}-${i}`,
    group,
    seq: i + 1,
    kind: "call",
    endpoint: c.endpoint,
    params: summarize(c),
    status: status === "replayed" ? "replayed" : !c.ok ? "error" : c.cached ? "cached" : "live",
    credits: status === "replayed" ? 0 : c.credits,
    ms: status === "replayed" || c.cached ? null : c.ms,
    hash: short(c.responseHash),
    error: c.error,
  }));
}

/** The same one-liner core's `summarizeParams` builds — reproduced here for recorded calls, since core pulls node:fs into the bundle. */
function summarize(c: Call): string {
  const b = c.body as Record<string, unknown> & { filters?: { token_address?: string }; date?: { from?: string; to?: string }; chains?: string[] };
  if (c.endpoint === "search/general") return `"${String(b.search_query ?? "").slice(0, 32)}"${b.chain ? ` · ${b.chain}` : ""} · ${b.result_type ?? "all"}`;
  const parts: string[] = [];
  const chain = b.chain ?? (Array.isArray(b.chains) ? b.chains.join(",") : undefined);
  if (chain) parts.push(String(chain));
  const addr = b.token_address ?? b.filters?.token_address;
  if (typeof addr === "string") parts.push(shortAddr(addr));
  if (b.timeframe) parts.push(String(b.timeframe));
  if (b.buy_or_sell) parts.push(String(b.buy_or_sell));
  if (b.label_type) parts.push(String(b.label_type));
  if (b.date?.from && b.date?.to) {
    const h = Math.round((Date.parse(b.date.to) - Date.parse(b.date.from)) / 3_600_000);
    if (Number.isFinite(h)) parts.push(h % 24 === 0 && h >= 24 ? `${h / 24}d` : `${h}h`);
  }
  if (c.endpoint === "smart-money/netflow") parts.push("token filter");
  return parts.join(" · ");
}

const cap = (s: RailState): RailState => {
  if (s.rows.length <= RAIL_CAP) return s;
  const rows = s.rows.slice(s.rows.length - RAIL_CAP);
  const live = new Set(rows.map((r) => r.group));
  return { rows, groups: s.groups.filter((g) => live.has(g.id) || !g.done) };
};

/** State + the four verbs the page needs. Initial rows come from a recorded verdict so the SSR HTML already shows the shape. */
export function useRail(initial?: { calls: Call[]; label: string; kind: "replayed" | "permalink"; ms: number }) {
  const [state, setState] = useState<RailState>(() => {
    if (!initial) return { rows: [], groups: [] };
    const g: RailGroup = { id: 1, label: initial.label, kind: initial.kind, startedAt: 0, ms: initial.ms, done: true };
    return { groups: [g], rows: rowsFromCalls(1, initial.calls, initial.kind === "replayed" ? "replayed" : "provenance") };
  });
  const nextId = useRef(initial ? 2 : 1);

  const startGroup = useCallback((label: string, kind: RailGroup["kind"]) => {
    const id = nextId.current++;
    setState((s) => ({ ...s, groups: [...s.groups, { id, label, kind, startedAt: Date.now(), ms: null, done: false }] }));
    return id;
  }, []);
  const finishGroup = useCallback((id: number, ms: number | null) => {
    setState((s) => ({ ...s, groups: s.groups.map((g) => (g.id === id ? { ...g, done: true, ms: ms ?? Date.now() - g.startedAt } : g)) }));
  }, []);
  const onCall = useCallback((group: number, e: CallEvent) => {
    setState((s) => {
      const id = `${group}-${e.seq}`;
      if (e.phase === "start") {
        if (s.rows.some((r) => r.id === id)) return s;
        return cap({ ...s, rows: [...s.rows, { id, group, seq: e.seq, kind: "call", endpoint: e.endpoint, params: e.params, status: "pending", credits: e.credits, ms: null, hash: null }] });
      }
      const c = e.call;
      const done: RailRow = {
        id,
        group,
        seq: e.seq,
        kind: "call",
        endpoint: c.endpoint,
        params: summarize(c),
        status: !c.ok ? "error" : c.cached ? "cached" : "live",
        credits: c.credits,
        ms: c.cached ? null : c.ms,
        hash: short(c.responseHash),
        error: c.error,
      };
      const i = s.rows.findIndex((r) => r.id === id);
      if (i < 0) return cap({ ...s, rows: [...s.rows, done] });
      const rows = s.rows.slice();
      rows[i] = done;
      return { ...s, rows };
    });
  }, []);
  /** agent/fast is one Nansen call (200 cr) whose tool_calls are reported by the agent itself — shown indented, never priced */
  const agent = useMemo(
    () => ({
      start(group: number, claim: string) {
        setState((s) =>
          cap({
            ...s,
            rows: [
              ...s.rows,
              {
                id: `${group}-agent`,
                group,
                seq: 0,
                kind: "agent",
                endpoint: "agent/fast",
                params: `"${claim.slice(0, 40)}${claim.length > 40 ? "…" : ""}"`,
                status: "pending",
                credits: AGENT_PRICE,
                ms: null,
                hash: null,
              },
            ],
          }),
        );
      },
      tool(group: number, name: string) {
        setState((s) =>
          s.rows.some((r) => r.id === `${group}-tool-${name}`)
            ? s
            : cap({
                ...s,
                rows: [
                  ...s.rows,
                  {
                    id: `${group}-tool-${name}`,
                    group,
                    seq: s.rows.length,
                    kind: "tool",
                    endpoint: name,
                    params: "reported by Nansen's agent",
                    status: "live",
                    credits: 0,
                    ms: null,
                    hash: null,
                  },
                ],
              }),
        );
      },
      end(group: number, run: AgentRun | null, error?: string | null) {
        setState((s) => ({
          ...s,
          rows: s.rows.map((r) =>
            r.id === `${group}-agent` ? { ...r, status: run && !run.error && !error ? "live" : "error", credits: run?.credits ?? 0, ms: run?.ms ?? null, error: run?.error ?? error ?? undefined } : r,
          ),
        }));
      },
    }),
    [],
  );
  const clear = useCallback(() => setState({ rows: [], groups: [] }), []);
  return { ...state, startGroup, finishGroup, onCall, agent, clear };
}

/** 240 ms count-up on a number (tabular); instant under prefers-reduced-motion. A new target mid-flight continues from the value on screen. */
function useCountUp(value: number, decimals = 0): string {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    const start = shownRef.current;
    if (start === value) return;
    if (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 240);
      const e = 1 - Math.pow(1 - p, 3);
      const v = start + (value - start) * e;
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown.toFixed(decimals);
}

const GROUP_LABEL: Record<RailGroup["kind"], string> = { replayed: "example · replayed from fixtures", live: "live", agent: "Nansen's agent", permalink: "permalink · server run" };

export function Rail({ rows, groups, symbols, onClear, onRunExample }: { rows: RailRow[]; groups: RailGroup[]; symbols: Record<string, string>; onClear: () => void; onRunExample?: () => void }) {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const current = groups[groups.length - 1];
  const curRows = useMemo(() => (current ? rows.filter((r) => r.group === current.id && r.kind !== "tool") : []), [rows, current]);
  const calls = curRows.filter((r) => r.status !== "pending").length;
  const credits = curRows.reduce((n, r) => n + (r.status === "pending" ? 0 : r.credits), 0);
  const sessionCalls = rows.filter((r) => r.kind !== "tool" && r.status !== "pending").length;
  const sessionCredits = rows.reduce((n, r) => n + (r.status === "pending" ? 0 : r.credits), 0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!current || current.done) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [current]);
  const secs = current ? (current.done ? (current.ms ?? 0) : Math.max(0, (now || Date.now()) - current.startedAt)) / 1000 : 0;
  const callsShown = useCountUp(calls);
  const creditsShown = useCountUp(credits);
  const secsShown = useCountUp(current?.done ? secs : Math.floor(secs * 10) / 10, 1);
  const last = rows[rows.length - 1];
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, last?.status]);
  const name = (params: string) => params.replace(/0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}|[1-9A-HJ-NP-Za-km-z]{6}…[1-9A-HJ-NP-Za-km-z]{4}/g, (m) => (symbols[m] ? `$${symbols[m]}` : m));
  const pending = rows.some((r) => r.status === "pending");
  return (
    <aside className={`rail${open ? " open" : ""}`} aria-label="Nansen API calls" aria-live="polite">
      <button type="button" className="rail-bar" aria-expanded={open} aria-controls="rail-body" onClick={() => setOpen((o) => !o)}>
        <span className={`dot ${pending ? "pending" : "idle"}`} aria-hidden />
        <span>Nansen calls</span>
        <b>
          {sessionCalls} {sessionCalls === 1 ? "call" : "calls"} · {sessionCredits} cr
        </b>
        <span className="rail-chev" aria-hidden>
          {open ? "▾" : "▴"}
        </span>
      </button>
      <div className="rail-body" id="rail-body">
        <header className="rail-head">
          <div>
            <span className="kicker">Nansen API</span>
            <span className="rail-title">Live call log</span>
          </div>
          <span className="rail-counts" aria-label={`${calls} calls, ${credits} credits, ${secs.toFixed(1)} seconds`}>
            {callsShown} {calls === 1 ? "call" : "calls"} · {creditsShown} cr · {secsShown} s
          </span>
        </header>
        {rows.length === 0 ? (
          <div className="rail-empty">
            <p>No calls yet — run the example live.</p>
            {onRunExample && (
              <button type="button" className="btn" onClick={onRunExample}>
                Run it live now
              </button>
            )}
          </div>
        ) : (
          <ol className="rail-list" ref={listRef}>
            {groups
              .map((g) => ({ g, gr: rows.filter((r) => r.group === g.id) }))
              .filter(({ gr }) => gr.length)
              .map(({ g, gr }, n) => (
                <li key={g.id} className="rail-group-item">
                  <div className="rail-group">
                    <span>#{n + 1}</span> {GROUP_LABEL[g.kind]} · <i>“{g.label.length > 44 ? g.label.slice(0, 44) + "…" : g.label}”</i>
                  </div>
                  <ol>
                    {gr.map((r) => (
                      <li key={r.id} className={`rail-row ${r.status} ${r.kind}`} title={r.error ? `${r.endpoint}: ${r.error}` : undefined}>
                        <span className={`dot ${r.status}`} aria-hidden />
                        <span className="rail-main">
                          <span className="rail-ep">
                            {r.kind === "tool" ? <span className="m">↳ tool</span> : <span className="m">POST</span>} <b>{r.endpoint}</b>
                          </span>
                          <span className="rail-params">{r.kind === "call" ? name(r.params) : r.params}</span>
                        </span>
                        <span className="rail-right">
                          <span className={`rail-chip ${r.status}`}>
                            {r.kind === "tool"
                              ? "inside agent/fast"
                              : r.status === "cached"
                                ? "0 cr · cached"
                                : r.status === "replayed"
                                  ? "0 cr · replayed"
                                  : r.status === "error"
                                    ? `0 cr · ${r.error === "timeout" ? "timeout" : "error"}`
                                    : r.status === "pending"
                                      ? `${r.credits} cr · …`
                                      : `${r.credits} cr`}
                          </span>
                          {(r.ms != null || r.hash) && (
                            <span className="rail-meta">
                              {r.ms != null ? `${r.ms} ms` : ""}
                              {r.ms != null && r.hash ? " · " : ""}
                              {r.hash ? <span className="rail-hash">{r.hash}</span> : null}
                            </span>
                          )}
                        </span>
                        <span className="sr-only">{r.status}</span>
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
          </ol>
        )}
        <footer className="rail-foot">
          <span>
            session · {sessionCalls} {sessionCalls === 1 ? "call" : "calls"} · {sessionCredits} credits
            {rows.length > 0 && (
              <>
                {" · "}
                <button type="button" className="rail-clear" onClick={onClear}>
                  clear
                </button>
              </>
            )}
          </span>
          <a href={`${REPO}#run-it-in-under-10-minutes`} target="_blank" rel="noreferrer">
            same calls: <code>--explain</code> in the CLI
          </a>
        </footer>
      </div>
    </aside>
  );
}
