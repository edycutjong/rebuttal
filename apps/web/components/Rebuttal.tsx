"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Check, Claim, Resolved, Verdict, RebutEvent, AgentRun } from "@rebuttal/core";
import { ClaimCard, Trace, VerdictCard, AgentPanel, type PlanRow } from "./Cards";
import { Example, HowItDecides } from "./Example";

export const EXAMPLES = ["Smart Money is aping $PEPE hard today 🐋", "Smart Money is buying $VVV on Base — net inflows all week", "A whale sold 600,000 UNI tokens, valued at approximately $5.1 million."];
const AGENT_PRICE = 200;

/** Same text as core's `rebuttalText` (packages/core/src/rebut.ts) — copied because importing core pulls node:fs into the browser bundle; `guard.test.ts` keeps the two in step. */
export function rebuttalText(v: Verdict, permalink: string): string {
  const tok = v.resolved ? `$${v.resolved.symbol} (${v.resolved.chain})` : v.claim.token ? `$${v.claim.token}` : "this";
  return [`${v.label} — "${v.claim.raw.slice(0, 120)}${v.claim.raw.length > 120 ? "…" : ""}"`, `${tok}: ${v.reasons.join("; ")}.`, `Checked on Nansen: ${v.checks.filter((c) => c.ok).length}/${v.checks.length} calls, ${v.credits} credits · ${v.hash.slice(0, 12)} · ${permalink}`].join("\n");
}

type Phase = "idle" | "reading" | "checking" | "done" | "error";
type StreamEvent = RebutEvent | { type: "error"; message: string } | { type: "asOf"; asOf: string | null; degraded: boolean };
type AgentEvent = { type: "tool_call"; name: string } | { type: "delta"; text: string } | { type: "finish" } | { type: "error"; error: string } | { type: "done"; run: AgentRun };

export function Rebuttal({ initialQuery, initialVerdict, prefill, example, exampleAgent, proof }: { initialQuery?: string; initialVerdict?: Verdict | null; prefill?: string; example: Verdict; exampleAgent?: AgentRun | null; proof: { tests: number; fixtures: number; p50: string; warm: string; credits: string } }) {
  const [q, setQ] = useState(initialQuery ?? prefill ?? "");
  const [phase, setPhase] = useState<Phase>(initialVerdict ? "done" : initialQuery ? "reading" : "idle");
  const [input, setInput] = useState<{ text: string; fromUrl: boolean; author?: string } | null>(null);
  const [claim, setClaim] = useState<Claim | null>(initialVerdict?.claim ?? null);
  const [resolved, setResolved] = useState<Resolved | null | undefined>(initialVerdict ? initialVerdict.resolved : undefined);
  const [plan, setPlan] = useState<PlanRow[]>(initialVerdict?.checks ?? []);
  const [checks, setChecks] = useState<Map<string, Check>>(new Map(initialVerdict?.checks.map((c) => [c.id, c]) ?? []));
  const [verdict, setVerdict] = useState<Verdict | null>(initialVerdict ?? null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [agent, setAgent] = useState<{ run: AgentRun | null; tools: string[]; text: string; error: string | null; busy: boolean } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stream = useCallback(async (term: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // ?fresh=1 on the page URL (the recording flag) bypasses cache reads so every row lands live with its real credits
    const fresh = typeof location !== "undefined" && new URLSearchParams(location.search).get("fresh") === "1";
    if (typeof history !== "undefined") history.replaceState(null, "", `/?q=${encodeURIComponent(term)}${fresh ? "&fresh=1" : ""}`);
    try {
      const res = await fetch(`/api/rebut?q=${encodeURIComponent(term)}&stream=1${fresh ? "&fresh=1" : ""}`, { signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let sawVerdict = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line) as StreamEvent;
          if (e.type === "input") setInput({ text: e.text, fromUrl: e.fromUrl, author: e.author });
          else if (e.type === "claim") {
            setClaim(e.claim);
            if (e.plan) setPlan(e.plan);
            setPhase("checking");
          } else if (e.type === "resolved") {
            setResolved(e.resolved);
            if (e.plan) setPlan(e.plan);
          } else if (e.type === "check") {
            setChecks((m) => new Map(m).set(e.check.id, e.check));
          } else if (e.type === "verdict") {
            sawVerdict = true;
            setVerdict(e.verdict);
            setPlan(e.verdict.checks.length ? e.verdict.checks : []);
            setPhase("done");
          } else if (e.type === "prose") setVerdict((v) => (v ? { ...v, prose: e.prose } : v));
          else if (e.type === "asOf") setAsOf(e.asOf);
          else if (e.type === "error") throw new Error(e.message);
        }
      }
      if (!sawVerdict) throw new Error("the stream ended before a verdict arrived — try again");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message);
      setPhase("error");
    }
  }, []);

  const run = useCallback(
    (text: string) => {
      const term = text.trim();
      if (!term) return;
      setPhase("reading");
      setError(null);
      setInput(null);
      setClaim(null);
      setResolved(undefined);
      setPlan([]);
      setChecks(new Map());
      setVerdict(null);
      setAsOf(null);
      setAgent(null);
      // the flow renders below the fold on a laptop: bring the claim card into view as the first row lands
      setTimeout(() => document.querySelector(".flow")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
      void stream(term);
    },
    [stream],
  );

  useEffect(() => {
    if (initialQuery && !initialVerdict) void stream(initialQuery);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const permalink = () => `${typeof location !== "undefined" ? location.origin : ""}/c?q=${encodeURIComponent(verdict?.claim.raw ?? q)}`;
  const copy = async () => {
    if (!verdict) return;
    try {
      await navigator.clipboard.writeText(rebuttalText(verdict, permalink()));
      setToast("copied · the verdict, the numbers, the hash, the link");
    } catch {
      setToast("copy failed — select the text instead");
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(permalink());
      setToast("permalink copied");
    } catch {
      setToast(permalink());
    }
  };

  const askAgent = async () => {
    if (!verdict) return;
    setAgent({ run: null, tools: [], text: "", error: null, busy: true });
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: verdict.claim.raw }) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        setAgent({ run: null, tools: [], text: "", error: j.error ?? res.statusText, busy: false });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line) as AgentEvent;
          setAgent((a) => {
            if (!a) return a;
            if (e.type === "tool_call") return { ...a, tools: a.tools.includes(e.name) ? a.tools : [...a.tools, e.name] };
            if (e.type === "delta") return { ...a, text: a.text + e.text };
            if (e.type === "error") return { ...a, error: e.error };
            if (e.type === "done") return { ...a, run: e.run, tools: e.run.toolCalls, text: e.run.text || a.text, busy: false, error: e.run.error ?? a.error };
            return a;
          });
        }
      }
      setAgent((a) => (a ? { ...a, busy: false } : a));
    } catch (err) {
      setAgent((a) => (a ? { ...a, busy: false, error: (err as Error).message } : a));
    }
  };

  const idle = phase === "idle";
  const landed = checks.size;
  const total = plan.length || (claim ? 6 : 0);
  const pct = phase === "reading" ? 8 : phase === "checking" ? 12 + (total ? (landed / total) * 80 : 0) : phase === "done" ? 100 : 0;

  return (
    <main className="wrap">
      <header className="hero">
        <h1>
          Is Smart Money really <span className="real">buying</span>?
        </h1>
        <p>Paste the tweet. Six Nansen calls decide whether it&apos;s true — and show their work.</p>
      </header>
      <div className="panel">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            run(q);
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="paste the claim or the x.com link — “Smart Money is loading $X”" aria-label="claim text or x.com link" maxLength={400} autoFocus={!initialQuery} />
          <button type="submit" disabled={phase === "reading" || phase === "checking"}>
            Check
          </button>
        </form>
        <div className="chips" role="group" aria-label="example claims">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="chip"
              onClick={() => {
                setQ(ex);
                run(ex);
              }}
            >
              {ex.length > 44 ? ex.slice(0, 44) + "…" : ex}
            </button>
          ))}
        </div>
      </div>
      <div className={`progress${idle ? " hidden" : ""}`} aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className={`status${idle ? " hidden" : ""}`} aria-live="polite">
        {phase === "reading" && "reading the claim…"}
        {phase === "checking" && `checking on Nansen · ${landed}/${total} calls landed`}
        {phase === "done" && verdict && `${verdict.label} · ${verdict.credits} credits · ${verdict.calls} calls · ${(verdict.ms / 1000).toFixed(1)} s`}
        {phase === "error" && "something broke"}
      </p>
      {error && (
        <div className="banner err" role="alert">
          {error}
        </div>
      )}
      {!idle && !claim && !error && (
        <div className="flow" aria-busy="true">
          {/* the reading skeleton: without it the page is empty between Enter and the claim card and the footer jumps up (seen frame by frame in the clip) */}
          <section className="claimcard" aria-label="reading the claim">
            <span>
              <span className="k">claim</span>
              <span style={{ color: "var(--muted)" }}>{input?.fromUrl ? `tweet by @${input.author} — reading…` : "reading the claim…"}</span>
            </span>
          </section>
          <section className="trace" aria-label="tool trace">
            <h2>
              <span>Tool trace</span>
              <small>planning…</small>
            </h2>
          </section>
          <VerdictCard verdict={null} pending />
        </div>
      )}
      {!idle && claim && (
        <div className="flow">
          <ClaimCard claim={claim} resolved={resolved} plan={plan.length ? plan : null} text={input?.text} author={input?.author} fromUrl={input?.fromUrl} />
          {plan.length > 0 && <Trace plan={plan} checks={checks} credits={verdict?.credits ?? 0} calls={verdict?.calls} ms={verdict?.ms ?? 0} done={phase === "done"} asOf={asOf} />}
          <VerdictCard verdict={verdict} pending={phase !== "error"} onCopy={copy} onPermalink={copyLink} onAgent={askAgent} agentBusy={agent?.busy} agentPrice={AGENT_PRICE} />
          {agent && <AgentPanel run={agent.run} tools={agent.tools} text={agent.text} ours={plan} error={agent.error} busy={agent.busy} />}
        </div>
      )}
      {idle && (
        <>
          <Example verdict={example} agent={exampleAgent ?? null} onRun={() => run(example.claim.raw)} />
          <HowItDecides proof={proof} />
        </>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
