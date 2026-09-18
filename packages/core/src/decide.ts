/**
 * The verdict. Pure arithmetic over Nansen fields — the LLM never sees this function's inputs as a question.
 * Every threshold lives in RULES and is printed by `--explain`; `docs/SCORING.md` shows the arithmetic on real fixtures.
 */
import type { Claim, ClaimType, Subject } from "./claim.js";

export type Label = "CONFIRMED" | "OVERSTATED" | "CONTRADICTED" | "UNVERIFIABLE";

export type ClassFlow = { net: number | null; wallets: number | null };
export type FlowSnapshot = Record<"smart_trader" | "whale" | "exchange" | "fresh_wallets" | "top_pnl" | "public_figure", ClassFlow>;
export type NamedRow = { address: string; label: string | null; usd: number };

export type Evidence = {
  /** tgm/flow-intelligence 1d / 7d, per label class */
  flow1d: FlowSnapshot | null;
  flow7d: FlowSnapshot | null;
  /** tgm/who-bought-sold 24 h, both sides, filtered to the subject's labels */
  named: { buyUsd: number; sellUsd: number; buyRows: number; sellRows: number; buyers: NamedRow[]; sellers: NamedRow[] } | null;
  /** smart-money/netflow filtered to the token */
  table: { inTable: boolean; net24: number | null; net7d: number | null; traders: number | null } | null;
  /** tgm/token-ohlcv 1h × 24 */
  price: { open: number; close: number; change: number; candles: number } | null;
  /** tgm/holders for the subject class (holding claims and whale claims only) */
  holders: { count: number; delta24: number; delta7d: number; valueUsd: number; top: NamedRow[] } | null;
  checksOk: number;
  checksTotal: number;
};

export const RULES = {
  /** a class net flow below this is noise on any token */
  floorUsd: 5_000,
  /** … and below this share of the token's labelled flow (Σ|net| over Smart Trader, Whale, Top PnL, Public Figure) it is noise on a big token */
  shareOfFlow: 0.01,
  /** |price move over 24 h| ≥ this → the claim is late */
  staleMove: 0.2,
  /** fewer Smart Money wallets than this → a desk, not the class ("a whale" is singular by nature: 1) */
  minWallets: 3,
  minWhales: 1,
  /** fewer labelled holders than this → nothing to hold with */
  minHolders: 5,
  /** fewer checks answered than this → UNVERIFIABLE */
  minChecks: 2,
} as const;
export type Rules = typeof RULES;

export type Decision = { label: Label; ruleId: string; reasons: string[]; threshold: number };

export const fmtUsd = (n: number): string => {
  const a = Math.abs(n);
  const s = a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(0)}K` : `$${a.toFixed(0)}`;
  return n < 0 ? `−${s}` : s;
};
const pct = (x: number) => `${x >= 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(1)}%`;

export function subjectClass(subject: Subject | undefined): "smart_trader" | "whale" {
  return subject === "whales" ? "whale" : "smart_trader";
}
export const subjectName = (subject: Subject | undefined) => (subject === "whales" ? "Whales" : "Smart Money");

/** Labelled cohorts: the "who" classes. Exchange and fresh-wallet flows are venue/anonymous volume and dwarf them (VVV: fresh $74M vs SM $100K). */
export const LABELLED: ReadonlyArray<keyof FlowSnapshot> = ["smart_trader", "whale", "top_pnl", "public_figure"];

/** Σ|net| over the labelled classes — the scale a threshold is measured against. */
export function totalFlow(s: FlowSnapshot | null): number {
  if (!s) return 0;
  return LABELLED.reduce((n, k) => n + Math.abs(s[k].net ?? 0), 0);
}

export function threshold(s: FlowSnapshot | null, rules: Rules = RULES): number {
  return Math.max(rules.floorUsd, rules.shareOfFlow * totalFlow(s));
}

/**
 * The primary signal: the subject class's 24 h net flow from flow-intelligence; when that call failed, the named
 * buyers − sellers from who-bought-sold stand in (and the reason says so).
 */
function primary(e: Evidence, cls: "smart_trader" | "whale"): { net: number; wallets: number | null; source: string } | null {
  // Whale claims: Nansen's Whale-labelled holders and their 24 h balance change (transfers included, not just DEX trades),
  // priced at the last close — richer than the whale flow column, which is DEX-only and often empty
  if (cls === "whale" && e.holders && e.holders.count > 0 && e.price && e.price.close > 0)
    return { net: e.holders.delta24 * e.price.close, wallets: e.holders.count, source: "whale holders' 24 h balance change × price" };
  const f = e.flow1d?.[cls];
  if (f && f.net != null) return { net: f.net, wallets: f.wallets, source: "flow-intelligence 1d" };
  if (e.named) return { net: e.named.buyUsd - e.named.sellUsd, wallets: e.named.buyRows + e.named.sellRows, source: "who-bought-sold 24h (flow-intelligence unavailable)" };
  return null;
}

/** Does the subject class exist in this token at all (any window, any endpoint)? Decides CONTRADICTED vs UNVERIFIABLE when nobody traded. */
export function presence(e: Evidence, cls: "smart_trader" | "whale"): boolean {
  return (e.flow1d?.[cls]?.wallets ?? 0) > 0 || (e.flow7d?.[cls]?.wallets ?? 0) > 0 || (e.holders?.count ?? 0) > 0 || (cls === "smart_trader" && (e.table?.traders ?? 0) > 0) || (e.named ? e.named.buyRows + e.named.sellRows > 0 : false);
}

export function decide(claim: Claim, e: Evidence, rules: Rules = RULES): Decision {
  const who = subjectName(claim.subject);
  const cls = subjectClass(claim.subject);
  const T = threshold(e.flow1d, rules);
  const T7 = threshold(e.flow7d, rules);
  const R = (label: Label, ruleId: string, reasons: string[]): Decision => ({ label, ruleId, reasons, threshold: Math.round(T) });

  if (e.checksOk < rules.minChecks) return R("UNVERIFIABLE", "U-CHECKS", [`only ${e.checksOk} of ${e.checksTotal} Nansen checks answered — not enough to decide`]);
  const p = primary(e, cls);
  const type: ClaimType = claim.type ?? "buying";

  if (type === "holding") return decideHolding(claim, e, rules, T7, R);
  if (!p) return R("UNVERIFIABLE", "U-FLOW", [`no ${who} flow data for this token in the last 24 h`]);

  // selling is the mirror image of buying: flip the sign once, reuse the rules
  const sign = type === "selling" ? -1 : 1;
  // a fraction of a dollar is zero (whale holders: 0.3 tokens × price), otherwise "net sold $0 … real but small" (seen live on HYPE)
  const net = Math.abs(p.net) < 1 ? 0 : p.net * sign;
  const verb = type === "selling" ? "sold" : "bought";
  const anti = type === "selling" ? "bought" : "sold";
  const net7 = e.flow7d?.[cls]?.net;
  const fresh = e.flow1d?.fresh_wallets.net ?? null;
  // context, never a verdict: on a hot token fresh wallets always out-buy every labelled class
  const freshLine = fresh != null && Math.abs(fresh) >= rules.floorUsd ? `fresh wallets net ${fresh >= 0 ? "bought" : "sold"} ${fmtUsd(Math.abs(fresh))}${net >= T && fresh * sign >= 3 * Math.abs(p.net) ? ` — retail is the bigger ${type === "selling" ? "seller" : "buyer"}` : ""}` : null;
  const priceLine = e.price ? `price ${pct(e.price.change)} over the last 24 h` : null;
  const tableLine = e.table ? (e.table.inTable ? `on the Smart Money net-flow table (24 h ${fmtUsd(e.table.net24 ?? 0)}, ${e.table.traders ?? "?"} traders)` : "not on the Smart Money net-flow table") : null;
  const wallets = p.wallets;
  const base = `${who} net ${net >= 0 ? verb : anti} ${fmtUsd(Math.abs(p.net))} in 24 h (${p.source}${wallets != null ? `, ${wallets} wallet${wallets === 1 ? "" : "s"}` : ""}; threshold ${fmtUsd(T)})`;

  if (net <= -T) return R("CONTRADICTED", "C-SIGN", [base, ...(net7 != null ? [`7 d: ${fmtUsd(net7)}`] : []), ...(freshLine ? [freshLine] : []), ...(tableLine ? [tableLine] : [])]);
  if (Math.abs(net) < rules.floorUsd && (wallets ?? 0) === 0 && (e.named ? e.named.buyRows + e.named.sellRows === 0 : true)) {
    if (!presence(e, cls)) return R("UNVERIFIABLE", "U-NOCLASS", [`Nansen tags no wallet as ${who} in this token (24 h, 7 d, holders) — the wallet in the post is not one Nansen labels`]);
    return R("CONTRADICTED", "C-NOBODY", [`no ${who} wallet traded this token in the last 24 h (net ${fmtUsd(p.net)})`, ...(net7 != null ? [`7 d: ${fmtUsd(net7)}`] : []), ...(tableLine ? [tableLine] : [])]);
  }
  if (net > 0 && net < T) return R("OVERSTATED", "O-SMALL", [base, `real but small: under ${fmtUsd(T)}, the noise level for a token with ${fmtUsd(totalFlow(e.flow1d))} of labelled flow a day`, ...(net7 != null ? [`7 d: ${fmtUsd(net7)}`] : []), ...(freshLine ? [freshLine] : [])]);
  if (net >= T) {
    if (net7 != null && net7 * sign <= -T7) return R("OVERSTATED", "O-7D", [base, `but over 7 d ${who} net ${anti} ${fmtUsd(Math.abs(net7))} — a one-day blip against the week`]);
    if (e.price && e.price.change * sign >= rules.staleMove) return R("OVERSTATED", "O-STALE", [base, `${priceLine} — the move already happened; the claim is late`]);
    const minW = cls === "whale" ? rules.minWhales : rules.minWallets;
    if (wallets != null && wallets < minW) return R("OVERSTATED", "O-FEW", [base, `${wallets} wallet${wallets === 1 ? "" : "s"} — one desk, not the class`]);
    const reasons = [base];
    if (net7 != null) reasons.push(`7 d ${net7 * sign >= 0 ? "agrees" : "disagrees"}: ${fmtUsd(net7)}`);
    if (tableLine) reasons.push(tableLine);
    if (freshLine) reasons.push(freshLine);
    if (priceLine) reasons.push(priceLine);
    return R("CONFIRMED", "A-FLOW", reasons);
  }
  // −T < net ≤ 0 with someone in the class present: flat
  return R("OVERSTATED", "O-FLAT", [base, `flat within the noise threshold — no ${type === "selling" ? "exit" : "accumulation"} to speak of`, ...(net7 != null ? [`7 d: ${fmtUsd(net7)}`] : [])]);
}

function decideHolding(claim: Claim, e: Evidence, rules: Rules, T7: number, R: (l: Label, id: string, r: string[]) => Decision): Decision {
  const who = subjectName(claim.subject);
  const cls = subjectClass(claim.subject);
  const h = e.holders;
  const net7 = e.flow7d?.[cls]?.net ?? null;
  if (!h && net7 == null) return R("UNVERIFIABLE", "U-HOLD", [`no ${who} holders or 7 d flow data for this token`]);
  const lines: string[] = [];
  if (h) lines.push(`${h.count} ${who} holders on page 1, ${fmtUsd(h.valueUsd)} held, 7 d balance change ${h.delta7d >= 0 ? "+" : ""}${h.delta7d.toFixed(0)} tokens`);
  if (net7 != null) lines.push(`7 d ${who} net flow ${fmtUsd(net7)} (threshold ${fmtUsd(T7)})`);
  if (h && h.count < rules.minHolders) return R("OVERSTATED", "O-HOLDERS", [...lines, `fewer than ${rules.minHolders} labelled holders — nothing to hold with`]);
  if (h && net7 != null && net7 <= -T7 && h.delta7d < 0) return R("CONTRADICTED", "C-EXIT", [...lines, `${who} are net sellers over the week and their balances shrank`]);
  if ((h && h.delta7d < 0) || (net7 != null && net7 <= -T7)) return R("OVERSTATED", "O-TRIM", [...lines, `some ${who} are trimming — holding, but not all of them`]);
  return R("CONFIRMED", "A-HOLD", [...lines, `${who} balances are not shrinking`]);
}
