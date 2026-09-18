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
  BTC: "Bitcoin", ZEC: "Zcash", XRP: "XRP Ledger", ADA: "Cardano", LTC: "Litecoin", XMR: "Monero", DOT: "Polkadot", ATOM: "Cosmos", XLM: "Stellar",
  ALGO: "Algorand", HBAR: "Hedera", KAS: "Kaspa", BCH: "Bitcoin Cash", DOGE: "Dogecoin", FIL: "Filecoin", ICP: "Internet Computer",
  ETC: "Ethereum Classic", BSV: "BSV", DASH: "Dash", APT: "Aptos", XTZ: "Tezos",
};

/** Native coins have no contract; Nansen indexes them under a placeholder address (or a wrapped form). BTC is a Bitcoin-chain coin: WBTC/cbBTC are different books, so it is refused unless a chain is named. */
const NATIVE: Record<string, { symbol: string; chain: string; address: string }> = {
  // native ETH is Nansen's 0xeeee… placeholder on ethereum (rank 314, $199M/24 h) — WETH is a different, quieter book; the
  // robinhood-chain copy trades more and would win the volume rule without this map
  ETH: { symbol: "ETH", chain: "ethereum", address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
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
    // the chain the text names is not a tiebreak, it is the question: look at every same-name match on that chain (not only
    // the rank window — base PEPE ranks 2741 against ethereum's 374 and used to lose silently, audit 2026-09-19), then, when
    // the unfiltered search did not reach that chain at all, ask search for that chain (0 credits); nothing there → null,
    // and the caller says "no token named X on Nansen (chain)" instead of checking a different chain's book
    const onChain = [...matches].filter((t) => t.chain === chainHint).sort((a, b) => (b.volume_24h ?? -1) - (a.volume_24h ?? -1) || (a.rank ?? 1e9) - (b.rank ?? 1e9));
    let hit = onChain[0];
    if (!hit) {
      const chainTokens = await searchTokens(client, query, chainHint, opts);
      const same = chainTokens.filter((t) => sameName(query, t) && t.chain === chainHint).sort((a, b) => (b.volume_24h ?? -1) - (a.volume_24h ?? -1) || (a.rank ?? 1e9) - (b.rank ?? 1e9));
      hit = same[0];
      if (hit) matches = [...matches, ...same];
    }
    if (!hit) return null;
    pick = hit;
    by = `chain hint (${chainHint})`;
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
