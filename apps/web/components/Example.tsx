"use client";
import type { Verdict, AgentRun } from "@rebuttal/core";
import { ClaimCard, Trace, VerdictCard, AgentPanel } from "./Cards";

/** The empty state already shows the payoff: the recorded hero rebuttal, replayed from fixtures at 0 credits, labelled. */
export function Example({ verdict, agent, onRun }: { verdict: Verdict; agent: AgentRun | null; onRun: () => void }) {
  const v = verdict;
  const date = new Date(v.now).toISOString().slice(0, 10);
  return (
    <section className="example" aria-labelledby="example-h">
      <div className="example-head">
        <div>
          <h2 id="example-h">
            <span className="kicker">example</span> “{v.claim.raw}”
          </h2>
          <p className="example-sub">
            {v.calls} Nansen calls · recorded {date} · replayed from <code>fixtures/pepe-aping.json</code> · 0 credits · <code>{v.hash.slice(0, 12)}</code>
          </p>
        </div>
        <button className="btn primary" onClick={onRun}>
          Run it live now
        </button>
      </div>
      <div className="flow">
        <ClaimCard claim={v.claim} resolved={v.resolved} plan={v.checks} />
        <Trace plan={v.checks} checks={new Map(v.checks.map((c) => [c.id, c]))} calls={new Map(v.checks.map((c, i) => [c.id, v.provenance.filter((p) => p.endpoint !== "search/general")[i]]))} credits={v.credits} ms={v.ms} done asOf={v.provenance[0] ? new Date(v.now).toISOString() : null} />
        <VerdictCard verdict={v} compact />
        {agent && <AgentPanel run={agent} tools={agent.toolCalls} text={agent.text} ours={v.checks} busy={false} />}
      </div>
      <p className="example-more">{agent ? "the violet panel is Nansen's own agent on the same claim, recorded once (200 credits) — live it is a button with the price on it" : "live, the “Ask Nansen's agent” button runs the same claim through agent/fast (200 credits) and shows its tool list beside this trace"}</p>
    </section>
  );
}

const STEPS = [
  { ep: "search/general", cr: "0 cr", what: "every token by that name, across chains", decides: "→ which token the tweet means (most traded of the top-ranked)" },
  { ep: "tgm/flow-intelligence", cr: "1 cr × 2", what: "net flow + wallet count per label class, 24 h and 7 d", decides: "→ the primary signal: Smart Money / Whale net flow vs the threshold" },
  { ep: "tgm/who-bought-sold", cr: "1 cr × 2", what: "buyers and sellers filtered to Smart Money labels, by USD", decides: "→ who exactly bought and sold in the last 24 h" },
  { ep: "smart-money/netflow", cr: "5 cr", what: "the Smart Money table filtered to the token", decides: "→ is it on Nansen's Smart Money screen at all" },
  { ep: "tgm/token-ohlcv", cr: "1 cr", what: "24 hourly candles", decides: "→ did the price already move (the claim is late)" },
  { ep: "tgm/holders", cr: "5 cr · whale / holding claims", what: "labelled holders and their 24 h / 7 d balance change", decides: "→ whale claims: are the whales' balances actually growing" },
];

export function HowItDecides({ proof }: { proof: { tests: number; fixtures: number; p50: string; warm: string; credits: string } }) {
  return (
    <section className="how" aria-labelledby="how-h">
      <h2 id="how-h">How it decides — six Nansen calls, one rule fires, no opinion</h2>
      <ol className="how-grid">
        {STEPS.map((s, i) => (
          <li key={s.ep} className="how-step">
            <span className="how-n">{i + 1}</span>
            <code className="how-ep">
              {s.ep.split("/").map((part, j) => (
                <span key={j}>
                  {j > 0 && (
                    <>
                      /<wbr />
                    </>
                  )}
                  {part}
                </span>
              ))}
            </code>
            <span className="how-cr">{s.cr}</span>
            <p>{s.what}</p>
            <p className="how-decides">{s.decides}</p>
          </li>
        ))}
      </ol>
      <ul className="proof-row">
        <li>
          <b>{proof.credits}</b> credits per rebuttal
        </li>
        <li>
          <b>{proof.p50}</b> cold p50 · <b>{proof.warm}</b> warm
        </li>
        <li>
          <b>
            {proof.fixtures}/{proof.fixtures}
          </b>{" "}
          verdicts replay offline
        </li>
        <li>
          <b>{proof.tests}</b> tests · <b>20,000</b> property cases
        </li>
      </ul>
    </section>
  );
}
