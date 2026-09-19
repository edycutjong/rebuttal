import type { NansenClient, Call } from "./client";
import type { Claim } from "./claim";
import type { Resolved } from "./resolve";
import { flowIntelligence, whoBoughtSold, smartMoneyNetflow, tokenOhlcv, holders, NETFLOW_CHAINS, type FlowRow, type LabelSubject } from "./nansen";
import { subjectClass, type Evidence, type FlowSnapshot, type NamedRow } from "./decide";
import { CREDITS } from "./client";

/** One planned check: what it asks Nansen, what it costs, what it decides. */
export type Check = {
  id: string;
  endpoint: string;
  window: string;
  credits: number;
  decides: string;
  ok: boolean;
  ms: number;
  cached: boolean;
  /** sha256 of the raw Nansen response this check read (from its own Call, matched by tag — never by position) */
  responseHash?: string;
  error?: string;
  /** the values that entered decide(), for the trace row */
  values: Record<string, number | string | null>;
};

export type CheckEvent = { type: "check"; check: Check; call?: Call };

export function snapshot(r: FlowRow | null): FlowSnapshot | null {
  if (!r) return null;
  const c = (net: number | null | undefined, wallets: number | null | undefined) => ({ net: net ?? null, wallets: wallets ?? null });
  return {
    smart_trader: c(r.smart_trader_net_flow_usd, r.smart_trader_wallet_count),
    whale: c(r.whale_net_flow_usd, r.whale_wallet_count),
    exchange: c(r.exchange_net_flow_usd, r.exchange_wallet_count),
    fresh_wallets: c(r.fresh_wallets_net_flow_usd, r.fresh_wallets_wallet_count),
    top_pnl: c(r.top_pnl_net_flow_usd, r.top_pnl_wallet_count),
    public_figure: c(r.public_figure_net_flow_usd, r.public_figure_wallet_count),
  };
}

/** The check plan for a claim type: which calls, in which order the trace lists them. */
export function planChecks(claim: Claim, resolved: Resolved): Array<Omit<Check, "ok" | "ms" | "cached" | "values">> {
  const who = claim.subject === "whales" ? "Whales" : "Smart Money";
  const plan = [
    { id: "flow1d", endpoint: "tgm/flow-intelligence", window: "1d", credits: CREDITS["tgm/flow-intelligence"], decides: `${who} net flow and wallet count, last 24 h — the primary signal` },
    { id: "flow7d", endpoint: "tgm/flow-intelligence", window: "7d", credits: CREDITS["tgm/flow-intelligence"], decides: `${who} net flow over the week — blip or trend` },
    { id: "buyers", endpoint: "tgm/who-bought-sold", window: "BUY 24h", credits: CREDITS["tgm/who-bought-sold"], decides: `who among ${who} bought, by USD` },
    { id: "sellers", endpoint: "tgm/who-bought-sold", window: "SELL 24h", credits: CREDITS["tgm/who-bought-sold"], decides: `who among ${who} sold, by USD` },
    { id: "price", endpoint: "tgm/token-ohlcv", window: "1h × 24", credits: CREDITS["tgm/token-ohlcv"], decides: "did the price already move — is the claim late" },
  ];
  if (NETFLOW_CHAINS.has(resolved.chain))
    plan.splice(4, 0, { id: "table", endpoint: "smart-money/netflow", window: "token filter", credits: CREDITS["smart-money/netflow"], decides: "is the token on the Smart Money net-flow table at all" });
  if (claim.type === "holding" || claim.subject === "whales")
    plan.push({ id: "holders", endpoint: "tgm/holders", window: claim.subject === "whales" ? "whale" : "smart_money", credits: CREDITS["tgm/holders"], decides: `${who} holders and whether their balances grew` });
  return plan;
}

const row = (address: string, label: string | null | undefined, usd: number | null | undefined): NamedRow => ({ address, label: label ?? null, usd: usd ?? 0 });

/**
 * Run the plan in parallel (the client's token bucket paces it), turning each response into the numbers decide() reads.
 * A failed call becomes a Check with ok=false and its error; the evidence field stays null. Nothing here throws.
 */
export async function runChecks(
  client: NansenClient,
  claim: Claim,
  resolved: Resolved,
  now: number,
  onCheck?: (e: CheckEvent) => void,
): Promise<{ evidence: Evidence; checks: Check[] }> {
  const plan = planChecks(claim, resolved);
  const subject: LabelSubject = claim.subject === "whales" ? "whales" : "smart_money";
  const { chain, address } = resolved;
  const evidence: Evidence = { flow1d: null, flow7d: null, named: null, table: null, price: null, holders: null, checksOk: 0, checksTotal: plan.length };
  const named = { buyUsd: 0, sellUsd: 0, buyRows: 0, sellRows: 0, buyers: [] as NamedRow[], sellers: [] as NamedRow[], sides: 0 };
  const cls = subjectClass(claim.subject);

  const runners: Record<string, () => Promise<Record<string, number | string | null>>> = {
    flow1d: async () => {
      evidence.flow1d = snapshot(await flowIntelligence(client, chain, address, "1d", { tag: "flow1d" }));
      const s = evidence.flow1d?.[cls];
      return { [`${cls}_net_flow_usd`]: s?.net ?? null, [`${cls}_wallet_count`]: s?.wallets ?? null, fresh_wallets_net_flow_usd: evidence.flow1d?.fresh_wallets.net ?? null, exchange_net_flow_usd: evidence.flow1d?.exchange.net ?? null };
    },
    flow7d: async () => {
      evidence.flow7d = snapshot(await flowIntelligence(client, chain, address, "7d", { tag: "flow7d" }));
      const s = evidence.flow7d?.[cls];
      return { [`${cls}_net_flow_usd`]: s?.net ?? null, [`${cls}_wallet_count`]: s?.wallets ?? null };
    },
    buyers: async () => {
      const r = await whoBoughtSold(client, chain, address, "BUY", subject, now, { tag: "buyers" });
      named.buyUsd = r.rows.reduce((n, x) => n + (x.bought_volume_usd ?? 0), 0);
      named.buyRows = r.rows.length;
      named.buyers = r.rows.slice(0, 3).map((x) => row(x.address, x.address_label, x.bought_volume_usd));
      named.sides++;
      return { bought_volume_usd: Math.round(named.buyUsd), rows: named.buyRows, top: named.buyers[0] ? `${named.buyers[0].label ?? named.buyers[0].address.slice(0, 8)} ${Math.round(named.buyers[0].usd)}` : null };
    },
    sellers: async () => {
      const r = await whoBoughtSold(client, chain, address, "SELL", subject, now, { tag: "sellers" });
      named.sellUsd = r.rows.reduce((n, x) => n + (x.sold_volume_usd ?? 0), 0);
      named.sellRows = r.rows.length;
      named.sellers = r.rows.slice(0, 3).map((x) => row(x.address, x.address_label, x.sold_volume_usd));
      named.sides++;
      return { sold_volume_usd: Math.round(named.sellUsd), rows: named.sellRows, top: named.sellers[0] ? `${named.sellers[0].label ?? named.sellers[0].address.slice(0, 8)} ${Math.round(named.sellers[0].usd)}` : null };
    },
    table: async () => {
      const rows = await smartMoneyNetflow(client, chain, address, { tag: "table" });
      // only the token's own row counts: a filter Nansen ignored would otherwise put another token's numbers on the card (audit 2026-09-19)
      const hit = rows.find((r) => r.token_address.toLowerCase() === address.toLowerCase()) ?? null;
      evidence.table = { inTable: !!hit, net24: hit?.net_flow_24h_usd ?? null, net7d: hit?.net_flow_7d_usd ?? null, traders: hit?.trader_count ?? null };
      return { in_table: hit ? "yes" : "no", net_flow_24h_usd: hit?.net_flow_24h_usd ?? null, net_flow_7d_usd: hit?.net_flow_7d_usd ?? null, trader_count: hit?.trader_count ?? null };
    },
    price: async () => {
      const candles = (await tokenOhlcv(client, chain, address, now, { tag: "price" })).filter((c) => c.open != null && c.close != null);
      if (candles.length >= 2) {
        const open = candles[0].open as number;
        const close = candles[candles.length - 1].close as number;
        evidence.price = { open, close, change: open > 0 ? (close - open) / open : 0, candles: candles.length };
      }
      return { candles: candles.length, open: evidence.price?.open ?? null, close: evidence.price?.close ?? null, change_24h: evidence.price ? Number(evidence.price.change.toFixed(4)) : null };
    },
    holders: async () => {
      const rows = await holders(client, chain, address, subject === "whales" ? "whale" : "smart_money", { tag: "holders" });
      evidence.holders = {
        count: rows.length,
        delta24: rows.reduce((n, r) => n + (r.balance_change_24h ?? 0), 0),
        delta7d: rows.reduce((n, r) => n + (r.balance_change_7d ?? 0), 0),
        valueUsd: rows.reduce((n, r) => n + (r.value_usd ?? 0), 0),
        top: rows.slice(0, 3).map((r) => row(r.address ?? "", r.address_label, r.value_usd)),
      };
      return { holders: rows.length, value_usd: Math.round(evidence.holders.valueUsd), balance_change_7d: Math.round(evidence.holders.delta7d), balance_change_24h: Math.round(evidence.holders.delta24) };
    },
  };

  const checks: Check[] = [];
  const before = client.calls.length;
  await Promise.all(
    plan.map(async (p) => {
      const t0 = Date.now();
      let check: Check;
      // the runners land in any order, so a check finds its own Call by tag — never by index (review finding #1)
      const own = () => client.calls.slice(before).find((c) => c.tag === p.id);
      try {
        const values = await runners[p.id]();
        const call = own();
        // ms = the Call's own network time when it has one, so the trace row and the live call rail print the same number
        check = { ...p, ok: true, ms: call && call.ok ? call.ms : Date.now() - t0, cached: call?.cached ?? false, credits: call?.credits ?? p.credits, responseHash: call?.responseHash, values };
        evidence.checksOk++;
      } catch (e) {
        check = { ...p, ok: false, ms: Date.now() - t0, cached: false, credits: 0, error: (e instanceof Error ? e.message : String(e)).slice(0, 160), values: {} };
      }
      checks.push(check);
      onCheck?.({ type: "check", check, call: own() });
    }),
  );
  if (named.sides === 2) evidence.named = { buyUsd: named.buyUsd, sellUsd: named.sellUsd, buyRows: named.buyRows, sellRows: named.sellRows, buyers: named.buyers, sellers: named.sellers };
  // keep the plan's order in the final list; the stream already showed arrival order
  checks.sort((a, b) => plan.findIndex((p) => p.id === a.id) - plan.findIndex((p) => p.id === b.id));
  return { evidence, checks };
}
