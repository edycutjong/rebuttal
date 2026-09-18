import { NansenClient, type ClientOptions } from "../src/client.js";
import type { Evidence, FlowSnapshot } from "../src/decide.js";
import type { Claim } from "../src/claim.js";

/** A NansenClient whose network is a lookup table: (endpoint, body) → JSON. Records calls like the real one. */
export function fakeClient(routes: (endpoint: string, body: Record<string, unknown>) => unknown, opts: ClientOptions = {}) {
  const fetchImpl: typeof fetch = async (url, init) => {
    const endpoint = String(url).replace("https://api.nansen.ai/api/v1/", "");
    const body = JSON.parse(String(init?.body ?? "{}"));
    const out = routes(endpoint, body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
  return new NansenClient("nsn_test_key_0000000000000000000000", { fetchImpl, rps: 1000, ...opts });
}

export const flowRow = (o: Record<string, number> = {}) => ({
  data: [
    {
      smart_trader_wallet_count: 0, smart_trader_net_flow_usd: 0,
      whale_wallet_count: 0, whale_net_flow_usd: 0,
      top_pnl_wallet_count: 0, top_pnl_net_flow_usd: 0,
      public_figure_wallet_count: 0, public_figure_net_flow_usd: 0,
      exchange_wallet_count: 0, exchange_net_flow_usd: 0,
      fresh_wallets_wallet_count: 0, fresh_wallets_net_flow_usd: 0,
      ...o,
    },
  ],
  warnings: [],
});

export const wbsRows = (rows: Array<{ usd: number; label?: string | null; side?: "buy" | "sell" }>) => ({
  data: rows.map((r, i) => ({
    address: "0x" + String(i + 1).padStart(40, "0"),
    address_label: r.label ?? null,
    bought_volume_usd: r.side === "sell" ? 0 : r.usd,
    sold_volume_usd: r.side === "sell" ? r.usd : 0,
    bought_token_volume: 0,
    sold_token_volume: 0,
    token_trade_volume: 0,
    trade_volume_usd: r.usd,
  })),
  pagination: { page: 1, per_page: 100, is_last_page: true },
});

export const netflowRows = (rows: Array<{ address: string; net24?: number; net7d?: number; traders?: number; symbol?: string; chain?: string }>) => ({
  data: rows.map((r) => ({
    token_address: r.address,
    token_symbol: r.symbol ?? "PEPE",
    chain: r.chain ?? "ethereum",
    net_flow_1h_usd: 0,
    net_flow_24h_usd: r.net24 ?? 0,
    net_flow_7d_usd: r.net7d ?? 0,
    net_flow_30d_usd: 0,
    token_sectors: [],
    trader_count: r.traders ?? 0,
    token_age_days: 100,
    market_cap_usd: 1e9,
  })),
  pagination: { page: 1, per_page: 10, is_last_page: true },
});

export const candles = (open: number, close: number, n = 25) => ({
  chain: "ethereum",
  token_address: "0x",
  timeframe: "1h",
  data: Array.from({ length: n }, (_, i) => {
    const px = open + ((close - open) * i) / (n - 1);
    return { interval_start: new Date(Date.UTC(2026, 8, 18, i)).toISOString(), open: px, close: px, high: px, low: px, volume: 1, volume_usd: 1, market_cap: {} };
  }),
});

export const holderRows = (rows: Array<{ label?: string | null; d24?: number; d7?: number; usd?: number }>) => ({
  data: rows.map((r, i) => ({
    address: "0x" + String(i + 1).padStart(40, "a"),
    address_label: r.label ?? null,
    token_amount: 1,
    balance_change_24h: r.d24 ?? 0,
    balance_change_7d: r.d7 ?? 0,
    balance_change_30d: 0,
    ownership_percentage: 1,
    value_usd: r.usd ?? 1000,
  })),
  pagination: { page: 1, per_page: 100, is_last_page: true },
  warnings: [],
});

export const searchTokens = (tokens: Array<{ chain: string; address: string; symbol?: string; name?: string; rank?: number; market_cap?: number; volume_24h?: number }>) => ({
  tokens: tokens.map((t, i) => ({
    name: t.name ?? "Pepe",
    symbol: t.symbol ?? "PEPE",
    chain: t.chain,
    address: t.address,
    price: 1,
    volume_24h: t.volume_24h ?? 1,
    market_cap: t.market_cap ?? 1,
    rank: t.rank ?? i + 1,
  })),
  entities: [],
  total_results: tokens.length,
});

export const PEPE_ETH = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
export const PEPE_ARB = "0x25d887ce7a35172c62febfd67a1856f20faebb00";
export const PEPE_BNB = "0x25d887ce7a35172c62febfd67a1856f20faebb01";

/** Routes modelled on the live PEPE spike run (2026-09-18): 14 same-name tokens, SM present on the table but idle for 24 h. */
export function pepeRoutes(over: { flow1d?: Record<string, number>; flow7d?: Record<string, number>; buyers?: number[]; sellers?: number[]; px?: [number, number]; table?: boolean } = {}) {
  return (endpoint: string, body: Record<string, unknown>) => {
    if (endpoint === "search/general")
      return searchTokens([
        { chain: "hyperliquid", address: "PEPE", rank: 20, market_cap: 1.5e9, volume_24h: 5e7 },
        { chain: "ethereum", address: PEPE_ETH, rank: 370, market_cap: 1.5528e9, volume_24h: 1_771_649 },
        { chain: "bnb", address: PEPE_BNB, rank: 371, market_cap: 1.5331e9, volume_24h: 79_018 },
        { chain: "arbitrum", address: PEPE_ARB, rank: 6120, market_cap: 1.5533e9, volume_24h: 846 },
        { chain: "solana", address: "Fuzzy", rank: 5, symbol: "PEPEX", name: "Pepe X" },
      ]);
    if (endpoint === "tgm/flow-intelligence") {
      if (body.timeframe === "1d") return flowRow({ exchange_net_flow_usd: 1_239_425, fresh_wallets_net_flow_usd: 1_136_203, top_pnl_net_flow_usd: -48_952, top_pnl_wallet_count: 6, ...over.flow1d });
      return flowRow({ smart_trader_net_flow_usd: 4_611, smart_trader_wallet_count: 53, whale_net_flow_usd: 1, whale_wallet_count: 1, exchange_net_flow_usd: 1_360_681, fresh_wallets_net_flow_usd: 17_109_806, top_pnl_net_flow_usd: -171_604, top_pnl_wallet_count: 31, ...over.flow7d });
    }
    if (endpoint === "tgm/who-bought-sold") return wbsRows(((body.buy_or_sell === "BUY" ? over.buyers : over.sellers) ?? []).map((usd) => ({ usd, label: "Smart Trader", side: body.buy_or_sell === "BUY" ? "buy" : "sell" })));
    if (endpoint === "smart-money/netflow") return over.table === false ? netflowRows([]) : netflowRows([{ address: PEPE_ETH, net24: 0, net7d: 4611, traders: 89 }]);
    if (endpoint === "tgm/token-ohlcv") return candles(over.px?.[0] ?? 0.00000346, over.px?.[1] ?? 0.0000037);
    if (endpoint === "tgm/holders") return holderRows([]);
    throw new Error("unexpected " + endpoint);
  };
}

const c0 = { net: 0, wallets: 0 };
export function snap(o: Partial<Record<keyof FlowSnapshot, { net: number | null; wallets: number | null }>> = {}): FlowSnapshot {
  return { smart_trader: c0, whale: c0, exchange: c0, fresh_wallets: c0, top_pnl: c0, public_figure: c0, ...o };
}

export function evidence(over: Partial<Evidence> = {}): Evidence {
  return { flow1d: snap(), flow7d: snap(), named: { buyUsd: 0, sellUsd: 0, buyRows: 0, sellRows: 0, buyers: [], sellers: [] }, table: null, price: null, holders: null, checksOk: 6, checksTotal: 6, ...over };
}

export function claim(over: Partial<Claim> = {}): Claim {
  return { raw: "Smart Money is aping $PEPE", token: "PEPE", type: "buying", subject: "smart_money", extractor: "rules", ...over };
}
