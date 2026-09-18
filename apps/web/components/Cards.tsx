"use client";
import type { Check, Claim, Resolved, Verdict, AgentRun } from "@rebuttal/core";

const short = (a: string) => (a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-4)}` : a);
/** Same as core's `fmtValue` (packages/core/src/format.ts) — copied because importing core pulls node:fs into the browser bundle; a test keeps them equal. */
export function fmt(key: string, v: number | string | null): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  const k = key.toLowerCase();
  const usd = (n: number) => {
    const a = Math.abs(n);
    const s = a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(0)}K` : `$${a.toFixed(0)}`;
    return n < 0 ? `−${s}` : s;
  };
  const amount = (n: number) => {
    const a = Math.abs(n);
    const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(a < 10 ? 2 : 0);
    return `${n < 0 ? "−" : "+"}${s} tokens`;
  };
  if (k.endsWith("_usd") || k === "usd") return usd(v);
  if (k.startsWith("balance_change")) return amount(v);
  if (k.startsWith("change")) return `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(1)}%`;
  if (k === "open" || k === "close" || k === "price") return v >= 1 ? v.toFixed(2) : v.toPrecision(3);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

export type PlanRow = { id: string; endpoint: string; window: string; credits: number; decides: string };

/** The claim, as read, and the token it resolved to. */
export function ClaimCard({ claim, resolved, plan, text, author, fromUrl }: { claim: Claim; resolved: Resolved | null | undefined; plan: PlanRow[] | null; text?: string; author?: string; fromUrl?: boolean }) {
  const who = claim.subject === "whales" ? "Whales" : "Smart Money";
  return (
    <section className="claimcard" aria-label="claim as read">
      {fromUrl && text && (
        <p className="quote">
          “{text}” <span className="by">— @{author}</span>
        </p>
      )}
      <span>
        <span className="k">claim</span>
        <b>{who}</b> {claim.type ?? "?"}
      </span>
      <span>
        <span className="k">token</span>
        <b>{claim.token ?? "?"}</b>
        {resolved ? (
          <>
            {" "}
            <span className="badge chain">{resolved.chain}</span> <span className="addr">{short(resolved.address)}</span>
            {resolved.sameName > 1 ? <span className="addr"> · {resolved.by} of {resolved.sameName} same-name</span> : null}
          </>
        ) : resolved === null ? (
          <span className="addr"> · not on Nansen</span>
        ) : null}
      </span>
      <span>
        <span className="k">read by</span>
        {claim.extractor === "llm" ? "LLM" : "rules"}
      </span>
      {plan && (
        <span>
          <span className="k">plan</span>
          {plan.length} checks · {plan.reduce((n, p) => n + p.credits, 0)} credits
        </span>
      )}
      {claim.problem && (
        <span>
          <span className="k">problem</span>
          {claim.problem}
        </span>
      )}
    </section>
  );
}

/** The tool trace: one row per planned Nansen call, filled in as each lands. */
export function Trace({ plan, checks, credits, calls, ms, done, asOf }: { plan: PlanRow[]; checks: Map<string, Check>; credits: number; calls?: number; ms: number; done: boolean; asOf?: string | null }) {
  const landed = plan.filter((p) => checks.has(p.id)).length;
  return (
    <section className="trace" aria-label="tool trace" aria-live="polite">
      <h2>
        <span>Tool trace</span>
        <small>
          {landed}/{plan.length} calls landed{done ? ` · ${credits} credits · ${(ms / 1000).toFixed(1)} s` : "…"}
        </small>
      </h2>
      <table>
        <thead>
          <tr>
            <th>endpoint · window</th>
            <th>fields read</th>
            <th>credits · ms · hash</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((p) => {
            const c = checks.get(p.id);
            return (
              <tr key={p.id} className={c ? (c.ok ? "landed" : "landed failed") : "pending"}>
                <td className="ep">
                  {c ? <span className={c.ok ? "ok" : "fail"}>{c.ok ? "✔ " : "✖ "}</span> : <span className="dots">… </span>}
                  {p.endpoint}
                  <small>
                    {p.window} → {p.decides}
                  </small>
                </td>
                <td className="vals">
                  {c
                    ? c.ok
                      ? Object.entries(c.values).map(([k, v]) => (
                          <span key={k}>
                            {k}=<b>{fmt(k, v)}</b>{" "}
                          </span>
                        ))
                      : `unavailable: ${c.error}`
                    : "waiting for Nansen"}
                </td>
                <td className="meta">
                  {c ? `${c.credits} cr · ${c.ms} ms${c.cached ? " · cached" : ""}` : `${p.credits} cr`}
                  {c?.responseHash ? <div>{c.responseHash.slice(0, 12)}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {done && (
        <p className="sum">
          <span>
            {credits} credits · {calls ?? plan.length} calls{calls && calls > plan.length ? ` (${plan.length} checks + search)` : ""} · {(ms / 1000).toFixed(1)} s{asOf ? ` · data as of ${new Date(asOf).toISOString().slice(11, 16)} UTC` : ""}
          </span>
          <span>every row: endpoint, the fields that entered the rule, credits, latency, sha256 of the response</span>
        </p>
      )}
    </section>
  );
}

const LABEL_CLASS: Record<string, string> = { CONFIRMED: "confirmed", OVERSTATED: "overstated", CONTRADICTED: "contradicted", UNVERIFIABLE: "unverifiable" };

/** The verdict word, the rule, the numbers, the two sentences, the hash. */
export function VerdictCard({ verdict, pending, narrating, replay, onCopy, onPermalink, onAgent, agentBusy, agentPrice, compact }: { verdict: Verdict | null; pending?: boolean; narrating?: boolean; replay?: boolean; onCopy?: () => void; onPermalink?: () => void; onAgent?: () => void; agentBusy?: boolean; agentPrice?: number; compact?: boolean }) {
  if (!verdict)
    return (
      <section className="verdict pending" aria-label="verdict">
        <div className="word">
          <span style={{ color: "var(--muted)" }}>{pending ? "deciding…" : "—"}</span>
        </div>
        <p className="prose" style={{ color: "var(--muted)" }}>
          The verdict is arithmetic over the rows on the left: once the checks land, one rule fires.
        </p>
      </section>
    );
  const v = verdict;
  return (
    <section className={`verdict ${LABEL_CLASS[v.label]}`} aria-label={`verdict ${v.label}`}>
      <div className="word">
        {v.label} <small>rule {v.ruleId}</small>
      </div>
      <ul className="reasons">
        {v.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <p className="prose">
        {v.prose.text}
        <small>
          {v.prose.source === "llm"
            ? "narrated by the LLM from the numbers above — it cannot change the verdict"
            : narrating
              ? "writing the two sentences… (the verdict above is already final)"
              : replay
                ? "replayed offline without the LLM — template prose; the verdict is unchanged"
                : "template prose — the LLM was skipped or slow; the verdict is unchanged"}
        </small>
      </p>
      {v.warnings.length > 0 && (
        <p className="warns">
          {v.warnings.map((w, i) => (
            <span key={i}>
              ⚠ {w}
              <br />
            </span>
          ))}
        </p>
      )}
      <p className="meta">
        {v.credits} credits · {v.calls} calls · {(v.ms / 1000).toFixed(1)} s · hash {v.hash.slice(0, 12)}
      </p>
      {!compact && (
        <div className="actions">
          <button className="btn primary" onClick={onCopy}>
            Copy rebuttal
          </button>
          <button className="btn" onClick={onPermalink}>
            Permalink
          </button>
          {v.resolved && onAgent && (
            <button className="btn agent" onClick={onAgent} disabled={agentBusy} aria-label={`Ask Nansen's agent, ${agentPrice} credits`}>
              {agentBusy ? "Asking Nansen's agent…" : "Ask Nansen's agent"}
              <span className="price">{agentPrice} credits</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Nansen's own agent, side by side: its tool list against our trace. */
export function AgentPanel({ run, tools, text, ours, error, busy }: { run: AgentRun | null; tools: string[]; text: string; ours: PlanRow[]; error?: string | null; busy: boolean }) {
  return (
    <section className="agent" aria-label="Nansen's agent, side by side" aria-live="polite">
      <h2>
        <span>Nansen&apos;s own agent (agent/fast) on the same claim</span>
        <small>
          {run ? `${run.credits} credits` : "200 credits"}{run ? ` · ${(run.ms / 1000).toFixed(1)} s${run.firstByteMs != null ? ` · first byte ${(run.firstByteMs / 1000).toFixed(1)} s` : ""}${run.timedOut ? " · timed out" : ""}` : busy ? " · streaming…" : ""}
          {run?.error ? ` · ${run.error}` : ""}
        </small>
      </h2>
      {error ? <p className="answer">{error}</p> : null}
      <div className="agent-grid">
        <div className="col">
          <h3>its tools ({tools.length})</h3>
          <ul className="tools">
            {tools.map((t) => (
              <li key={t}>{t}</li>
            ))}
            {tools.length === 0 && <li style={{ color: "var(--muted)" }}>{busy ? "waiting for the first tool_call…" : "none reported"}</li>}
          </ul>
          <h3 style={{ marginTop: 10 }}>our trace ({ours.length})</h3>
          <ul className="tools">
            {ours.map((p) => (
              <li key={p.id} className="ours">
                {p.endpoint} <span className="cr">{p.credits} cr</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="col">
          <h3>its answer</h3>
          <div className={`answer${text ? "" : " wait"}`}>{text || (busy ? "Nansen's agent is thinking…" : "no answer")}</div>
        </div>
      </div>
    </section>
  );
}
