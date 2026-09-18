import { z } from "zod";
import type { NansenClient, CallOptions } from "./client.js";

/** Typed, zod-validated wrappers over the seven Nansen endpoints Rebuttal calls (bodies from openapi.json, 2026-09-15). */

const num = z.number().nullable().optional();
const int = z.number().int().nullable().optional();

export const TokenSearchResult = z.object({
  name: z.string(),
  symbol: z.string(),
  chain: z.string(),
  address: z.string(),
  price: num,
  volume_24h: num,
  market_cap: num,
  rank: int,
});
export type TokenSearchResult = z.infer<typeof TokenSearchResult>;
const GeneralSearchResponse = z.object({ tokens: z.array(TokenSearchResult).default([]), total_results: z.number().optional() });

export const SEARCH_FIELDS = ["tokens[].symbol", "tokens[].name", "tokens[].chain", "tokens[].address", "tokens[].rank", "tokens[].volume_24h", "tokens[].market_cap"];

export async function searchTokens(client: NansenClient, query: string, chain?: string, opts?: CallOptions): Promise<TokenSearchResult[]> {
  const body: Record<string, unknown> = { search_query: query.trim().slice(0, 200), result_type: "token", limit: 50 };
  if (chain) body.chain = chain;
  const raw = await client.post("search/general", body, SEARCH_FIELDS, opts);
  return GeneralSearchResponse.parse(raw).tokens;
}

/** One row of tgm/flow-intelligence: net flow USD + wallet count per label class. */
export const FlowRow = z.object({
  smart_trader_net_flow_usd: num,
  smart_trader_wallet_count: int,
  whale_net_flow_usd: num,
  whale_wallet_count: int,
  exchange_net_flow_usd: num,
  exchange_wallet_count: int,
  fresh_wallets_net_flow_usd: num,
  fresh_wallets_wallet_count: int,
  top_pnl_net_flow_usd: num,
  top_pnl_wallet_count: int,
  public_figure_net_flow_usd: num,
  public_figure_wallet_count: int,
});
export type FlowRow = z.infer<typeof FlowRow>;
const FlowResponse = z.object({ data: z.array(FlowRow).default([]), warnings: z.array(z.string()).nullable().optional() });

export const FLOW_CLASSES = ["smart_trader", "whale", "exchange", "fresh_wallets", "top_pnl", "public_figure"] as const;
export type FlowClass = (typeof FLOW_CLASSES)[number];

export function flowFields(timeframe: string): string[] {
  return FLOW_CLASSES.flatMap((c) => [`data[0].${c}_net_flow_usd`, `data[0].${c}_wallet_count`]).map((f) => `${f} (${timeframe})`);
}

export async function flowIntelligence(client: NansenClient, chain: string, token: string, timeframe: "1d" | "7d", opts?: CallOptions): Promise<FlowRow | null> {
  const raw = await client.post("tgm/flow-intelligence", { chain, token_address: token, timeframe }, flowFields(timeframe), opts);
  const parsed = FlowResponse.parse(raw);
  return parsed.data[0] ?? null;
}

export const WbsRow = z.object({
  address: z.string(),
  address_label: z.string().nullable().optional(),
  bought_volume_usd: num,
  sold_volume_usd: num,
  bought_token_volume: num,
  sold_token_volume: num,
});
export type WbsRow = z.infer<typeof WbsRow>;
const WbsResponse = z.object({ data: z.array(WbsRow).default([]), pagination: z.object({ is_last_page: z.boolean().optional() }).partial().optional() });

/** Label filters per claim subject: the Smart Money classes, or the Whale class. */
export const SUBJECT_LABELS = {
  smart_money: ["Smart Trader", "Fund", "30D Smart Trader", "90D Smart Trader", "180D Smart Trader"],
  whales: ["Whale"],
} as const;
export type LabelSubject = keyof typeof SUBJECT_LABELS;

export const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** Floor to the hour so a window (and its cache key) is stable within the hour. */
export const floorHour = (ms: number) => Math.floor(ms / 3_600_000) * 3_600_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** who-bought-sold, one side, last 24 h ending at the hour, filtered to the subject's label classes, top 100 by USD. */
export async function whoBoughtSold(
  client: NansenClient,
  chain: string,
  token: string,
  side: "BUY" | "SELL",
  subject: LabelSubject,
  now: number,
  opts?: CallOptions,
): Promise<{ rows: WbsRow[]; lastPage: boolean }> {
  const to = floorHour(now);
  const from = to - DAY;
  const usd = side === "BUY" ? "bought_volume_usd" : "sold_volume_usd";
  const raw = await client.post(
    "tgm/who-bought-sold",
    {
      chain,
      token_address: token,
      buy_or_sell: side,
      date: { from: iso(from), to: iso(to) },
      pagination: { page: 1, per_page: 100 },
      filters: { include_smart_money_labels: [...SUBJECT_LABELS[subject]] },
      order_by: [{ field: usd, direction: "DESC" }],
    },
    [`data[].${usd}`, "data[].address", "data[].address_label", "pagination.is_last_page"].map((f) => `${f} (${side} 24h)`),
    opts,
  );
  const parsed = WbsResponse.parse(raw);
  return { rows: parsed.data, lastPage: parsed.pagination?.is_last_page !== false };
}

export const NetflowRow = z.object({
  token_address: z.string(),
  token_symbol: z.string(),
  chain: z.string(),
  net_flow_1h_usd: num,
  net_flow_24h_usd: num,
  net_flow_7d_usd: num,
  net_flow_30d_usd: num,
  trader_count: int,
  token_age_days: int,
  market_cap_usd: num,
});
export type NetflowRow = z.infer<typeof NetflowRow>;
const NetflowResponse = z.object({ data: z.array(NetflowRow).default([]) });

/** Chains smart-money/netflow accepts (openapi enum). */
export const NETFLOW_CHAINS = new Set([
  "arbitrum", "avalanche", "base", "bnb", "ethereum", "hyperevm", "iotaevm", "linea", "mantle", "monad", "optimism", "plasma", "polygon", "robinhood", "sei", "solana", "sonic",
]);

/** The Smart Money net-flow table filtered to one token: is it there, with what sign, how many traders. */
export async function smartMoneyNetflow(client: NansenClient, chain: string, token: string, opts?: CallOptions): Promise<NetflowRow[]> {
  const raw = await client.post(
    "smart-money/netflow",
    {
      chains: [chain],
      filters: { token_address: token, include_stablecoins: true, include_native_tokens: true },
      pagination: { page: 1, per_page: 10 },
    },
    ["data[].net_flow_24h_usd", "data[].net_flow_7d_usd", "data[].trader_count", "data[].token_symbol"],
    opts,
  );
  return NetflowResponse.parse(raw).data;
}

export const Candle = z.object({ interval_start: z.string(), open: num, close: num, high: num, low: num, volume_usd: num });
export type Candle = z.infer<typeof Candle>;
const OhlcvResponse = z.object({ data: z.array(Candle).default([]) });

/** Hourly candles for the last 24 h ending at the hour. */
export async function tokenOhlcv(client: NansenClient, chain: string, token: string, now: number, opts?: CallOptions): Promise<Candle[]> {
  const to = floorHour(now);
  const from = to - DAY;
  const raw = await client.post(
    "tgm/token-ohlcv",
    { chain, token_address: token, timeframe: "1h", date: { from: iso(from), to: iso(to) } },
    ["data[].open", "data[].close", "data[].interval_start"],
    opts,
  );
  const parsed = OhlcvResponse.parse(raw);
  return [...parsed.data].sort((a, b) => a.interval_start.localeCompare(b.interval_start));
}

export const HolderRow = z.object({
  address: z.string().nullable().optional(),
  address_label: z.string().nullable().optional(),
  token_amount: num,
  balance_change_24h: num,
  balance_change_7d: num,
  balance_change_30d: num,
  ownership_percentage: num,
  value_usd: num,
});
export type HolderRow = z.infer<typeof HolderRow>;
const HoldersResponse = z.object({ data: z.array(HolderRow).default([]), warnings: z.array(z.string()).nullable().optional() });

/** Labelled holders of one class (smart_money | whale), page 1 of 100. Never `premium_labels`. */
export async function holders(client: NansenClient, chain: string, token: string, labelType: "smart_money" | "whale", opts?: CallOptions): Promise<HolderRow[]> {
  const raw = await client.post(
    "tgm/holders",
    { chain, token_address: token, label_type: labelType, pagination: { page: 1, per_page: 100 } },
    ["data[].address_label", "data[].balance_change_24h", "data[].balance_change_7d", "data[].value_usd"].map((f) => `${f} (${labelType})`),
    opts,
  );
  return HoldersResponse.parse(raw).data;
}
