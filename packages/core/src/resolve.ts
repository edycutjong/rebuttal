import type { NansenClient, CallOptions } from "./client.js";
import { searchTokens, type TokenSearchResult } from "./nansen.js";
import { SCORABLE_CHAINS } from "./claim.js";

export type Resolved = {
  chain: string;
  address: string;
  symbol: string;
  name: string;
  marketCap: number | null;
  /** how many tokens share the name on scorable chains */
  sameName: number;
  /** why this one: "chain hint (x)" | "top Nansen search rank" | "only match" */
  by: string;
  others: Array<{ chain: string; address: string; marketCap: number | null }>;
};

/**
 * Coins whose home chain Nansen does not index. Search still finds bridged copies (ZEC on near, XRP on bnb…) — checking
 * those would answer a question nobody asked. UNVERIFIABLE unless the claim names a chain.
 */
export const NOT_A_NANSEN_CHAIN: Record<string, string> = {
  ZEC: "Zcash", XRP: "XRP Ledger", ADA: "Cardano", LTC: "Litecoin", XMR: "Monero", DOT: "Polkadot", ATOM: "Cosmos", XLM: "Stellar",
  ALGO: "Algorand", HBAR: "Hedera", KAS: "Kaspa", BCH: "Bitcoin Cash", DOGE: "Dogecoin", FIL: "Filecoin", ICP: "Internet Computer",
  ETC: "Ethereum Classic", BSV: "BSV", DASH: "Dash", APT: "Aptos", XTZ: "Tezos",
};

/** Native coins have no contract; Nansen indexes their wrapped form or a placeholder address. */
const NATIVE: Record<string, { symbol: string; chain: string; address: string }> = {
  ETH: { symbol: "WETH", chain: "ethereum", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" },
  BTC: { symbol: "WBTC", chain: "ethereum", address: "0x2260fac5e5542a773aa44fbcfb037771d84ecc68" },
  SOL: { symbol: "SOL", chain: "solana", address: "So11111111111111111111111111111111111111112" },
  HYPE: { symbol: "HYPE", chain: "hyperevm", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
};

export function sameName(query: string, t: TokenSearchResult): boolean {
  const q = query.trim().toLowerCase();
  return t.symbol.toLowerCase() === q || t.name.toLowerCase() === q;
}

/**
 * Which token does the claim mean? `search/general` (0 credits) → same-name matches on scorable chains → the chain the
 * text named, else the largest market cap. Returns null when Nansen knows no token by that name.
 */
export async function resolveToken(client: NansenClient, token: string, chainHint?: string, opts?: CallOptions): Promise<Resolved | null> {
  const native = NATIVE[token];
  const query = native && !chainHint ? native.symbol : token;
  const tokens = await searchTokens(client, query, undefined, opts);
  let matches = tokens.filter((t) => sameName(query, t) && SCORABLE_CHAINS.has(t.chain));
  if (native && !chainHint) {
    // the native coin's own chain wins over bridged copies (HYPE on solana ranks above HYPE on hyperevm)
    const home = matches.filter((t) => t.chain === native.chain);
    if (home.length) matches = home;
  }
  if (matches.length === 0 && native) {
    const direct = tokens.find((t) => t.address.toLowerCase() === native.address.toLowerCase());
    matches = direct ? [direct] : [{ name: native.symbol, symbol: native.symbol, chain: native.chain, address: native.address, market_cap: null }];
  }
  if (matches.length === 0) return null;
  // Neither signal alone works (seen live 2026-09-18): bridged PEPE on arbitrum reports the canonical market cap ($1.553B vs
  // $1.552B) but ranks 6120 vs 370; HYPE on solana ranks 317 vs hyperevm 318 with $68M vs $19.8B. So: the largest market
  // cap among the candidates whose search rank is within the window of the best rank.
  const bestRank = Math.min(...matches.map((t) => t.rank ?? 1e9));
  const window = bestRank * 2 + 50;
  const inWindow = matches.filter((t) => (t.rank ?? 1e9) <= window);
  // …and among those, the one that actually trades: bridged copies carry the canonical cap but a sliver of the volume
  // (PEPE: ethereum $1.77M/24 h, bnb $79K, arbitrum $847).
  const byCap = [...inWindow].sort((a, b) => (b.volume_24h ?? -1) - (a.volume_24h ?? -1) || (b.market_cap ?? -1) - (a.market_cap ?? -1) || (a.rank ?? 1e9) - (b.rank ?? 1e9));
  let pick = byCap[0];
  let by = matches.length === 1 ? "only match" : "most traded of the top-ranked";
  if (chainHint) {
    const onChain = byCap.find((t) => t.chain === chainHint);
    if (onChain) {
      pick = onChain;
      by = `chain hint (${chainHint})`;
    }
  }
  return {
    chain: pick.chain,
    address: pick.address,
    symbol: pick.symbol,
    name: pick.name,
    marketCap: pick.market_cap ?? null,
    sameName: matches.length,
    by,
    others: matches
      .filter((t) => t !== pick)
      .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
      .slice(0, 8)
      .map((t) => ({ chain: t.chain, address: t.address, marketCap: t.market_cap ?? null })),
  };
}
