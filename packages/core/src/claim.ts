/**
 * The claim: what the sentence asserts. `extractClaim` is the deterministic extractor — regex + a small name map —
 * used as the fallback when the LLM is down, slow, or wrong, and always used by `verify` (a replay must not need a key).
 */
export type ClaimType = "buying" | "selling" | "holding";
export type Subject = "smart_money" | "whales";

export type Claim = {
  raw: string;
  /** upper-case ticker, e.g. PEPE — undefined when nothing token-like was found */
  token?: string;
  /** Nansen chain id when the text names one */
  chain?: string;
  type?: ClaimType;
  subject?: Subject;
  extractor: "llm" | "rules";
  /** why the claim cannot be checked, when it cannot */
  problem?: string;
};

/** Chains `tgm/flow-intelligence` accepts (openapi.json enum). `hyperliquid` is a perp venue, not a token chain. */
export const SCORABLE_CHAINS = new Set([
  "arbitrum", "avalanche", "base", "bnb", "ethereum", "hyperevm", "injective", "linea", "mantle", "mantra", "monad", "near",
  "optimism", "plasma", "polygon", "robinhood", "sei", "solana", "sonic", "starknet", "sui", "ton", "tron",
]);

const CHAIN_ALIASES: Record<string, string> = {
  ethereum: "ethereum", eth: "ethereum", mainnet: "ethereum",
  solana: "solana", sol: "solana",
  base: "base",
  bnb: "bnb", bsc: "bnb", "binance smart chain": "bnb",
  arbitrum: "arbitrum", arb: "arbitrum",
  polygon: "polygon", matic: "polygon",
  avalanche: "avalanche", avax: "avalanche",
  optimism: "optimism", op: "optimism",
  hyperevm: "hyperevm", hyperliquid: "hyperevm",
  robinhood: "robinhood",
  sonic: "sonic", sei: "sei", sui: "sui", ton: "ton", tron: "tron", linea: "linea", mantle: "mantle", monad: "monad", near: "near", starknet: "starknet", plasma: "plasma",
};

/** Token names people write instead of tickers. Small on purpose: `$TICKER` and `(TICKER)` come first. */
const NAME_TO_TICKER: Record<string, string> = {
  ethereum: "ETH", ether: "ETH", bitcoin: "BTC", zcash: "ZEC", uniswap: "UNI", hyperliquid: "HYPE", pepe: "PEPE", dogecoin: "DOGE",
  shiba: "SHIB", solana: "SOL", chainlink: "LINK", litecoin: "LTC", memecoin: "MEME", bonk: "BONK", fartcoin: "FARTCOIN",
  "artificial inu": "AI", pudgy: "PENGU", "pudgy penguins": "PENGU", worldcoin: "WLD", aave: "AAVE", ondo: "ONDO", arbitrum: "ARB",
};

/** Upper-case words that look like tickers but never are. */
const NOT_TICKERS = new Set([
  "USD", "USDT", "USDC", "DAI", "CEX", "DEX", "ETF", "ETFS", "ATH", "ATL", "SEC", "OKX", "DTC", "SM", "FOMO", "GMGN", "UK", "US", "EU", "OG", "AI",
  "APY", "APR", "TVL", "NFT", "NFTS", "IMO", "LOL", "WTF", "GM", "GN", "RT", "PSA", "FYI", "TL", "DR", "TLDR", "BREAKING", "ALERT", "NEW", "TOP",
  "AND", "THE", "FOR", "NOT", "BUY", "SELL", "HOLD", "LONG", "SHORT", "NOW", "TODAY", "JUST", "WHALE", "WHALES", "FUND", "FUNDS", "SMART", "MONEY",
  "L1", "L2", "IPO", "CEO", "CTO", "DCA", "PNL", "ROI", "KOL", "KOLS", "BTC", "II", "III", "IV", "VC", "VCS", "M", "K", "B", "T", "X",
]);
// "AI" is a real token (Artificial Inu) but also the word; it is accepted only as `$AI` or `(AI)`.

const BUY_RE = /\b(buy|buys|buying|bought|purchas\w*|ape|aping|aped|apes|load(?:ing|ed|s)?(?: up)?|accumulat\w*|scoop\w*|bid(?:ding)?|stack(?:ing|ed)?|added?|adding|built a|building a|open(?:ed|ing)? (?:a )?(?:\w+ )?long|went long|long(?:ed|ing)?|surged|increas\w*|withdr[ae]w\w*|pull(?:ed|s)?\b|withdrawn|net inflow\w*|inflows?)\b/i;
const SELL_RE = /\b(sell|sells|selling|sold|dump\w*|exit\w*|offload\w*|distribut\w*|deposit\w*|took profit|take profit|taking profit|closed|closing|unload\w*|liquidat\w*|net outflow\w*|outflows?|rotat\w* (?:out|from)|cut (?:their |his |her )?(?:losses|loss)|short(?:ed|ing)?|went short)\b/i;
const HOLD_RE = /\b(hold(?:s|ing)?|holds? (?:strong|steady)|hasn'?t sold|haven'?t sold|has not sold|have not sold|diamond|hodl\w*|still (?:in|holding|hold)|logging gains|gains of|sitting on|unrealized|top holders? list|holders? (?:hit|at|reach\w*))\b/i;

const SM_RE = /\b(smart money|smart-money|smart traders?|smart wallets?|\bSM\b|funds?|nansen|top traders?|top pnl|profitable wallets?|insiders?|institutions?)\b/i;
const WHALE_RE = /\b(whales?|large holders?|top holders?|big wallets?|mega wallets?|giant wallets?|whale wallets?)\b/i;

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function findChain(text: string): string | undefined {
  const t = text.toLowerCase();
  const on = t.match(/\bon (?:the )?([a-z ]{2,20}?)(?: chain| network| mainnet)?\b(?=[\s.,;:!?)]|$)/);
  if (on) {
    const w = on[1].trim();
    if (CHAIN_ALIASES[w]) return CHAIN_ALIASES[w];
    const first = w.split(" ")[0];
    if (CHAIN_ALIASES[first]) return CHAIN_ALIASES[first];
  }
  const named = t.match(/\b(robinhood|hyperevm|arbitrum|avalanche|polygon|optimism|solana|base|bnb|bsc) chain\b/);
  if (named) return CHAIN_ALIASES[named[1]];
  const hash = t.match(/#(sol|solana|base|bnb|bsc|eth|ethereum|arbitrum|polygon|avax|avalanche)\b/);
  if (hash) return CHAIN_ALIASES[hash[1]];
  return undefined;
}

export function findToken(text: string): string | undefined {
  const dollar = text.match(/\$([A-Za-z][A-Za-z0-9]{1,11})\b/);
  if (dollar) return dollar[1].toUpperCase();
  const paren = text.match(/\(([A-Z][A-Z0-9]{1,9})\)/);
  if (paren) return paren[1];
  const lower = text.toLowerCase();
  // longest names first so "pudgy penguins" beats "pudgy"
  for (const name of Object.keys(NAME_TO_TICKER).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) return NAME_TO_TICKER[name];
  }
  const bare = text.match(/\b([A-Z][A-Z0-9]{1,9})\b/g) ?? [];
  for (const w of bare) if (!NOT_TICKERS.has(w) && !/^\d+[KMBT]?$/.test(w)) return w;
  return undefined;
}

export function findType(text: string): ClaimType | undefined {
  // the first verb in reading order wins: "sold 602 BTC ... to purchase ETH" is about selling the first token
  const hits: Array<[number, ClaimType]> = [];
  for (const [re, t] of [
    [HOLD_RE, "holding"],
    [SELL_RE, "selling"],
    [BUY_RE, "buying"],
  ] as const) {
    const m = text.match(re);
    if (m && m.index !== undefined) hits.push([m.index, t]);
  }
  hits.sort((a, b) => a[0] - b[0]);
  return hits[0]?.[1];
}

export function findSubject(text: string): Subject | undefined {
  const sm = text.search(SM_RE);
  const wh = text.search(WHALE_RE);
  if (sm < 0 && wh < 0) return undefined;
  if (sm < 0) return "whales";
  if (wh < 0) return "smart_money";
  return sm <= wh ? "smart_money" : "whales";
}

/** Deterministic extraction. Pure; unit-tested on the spike claims. */
export function extractClaim(raw: string): Claim {
  const text = raw.trim().replace(/\s+/g, " ");
  const claim: Claim = { raw: text, extractor: "rules" };
  if (!text) return { ...claim, problem: "empty claim" };
  if (EVM_ADDR.test(text) || SOL_ADDR.test(text)) return { ...claim, problem: "that is an address — paste the claim (the sentence), not a wallet or contract" };
  claim.token = findToken(text);
  claim.chain = findChain(text);
  claim.type = findType(text);
  claim.subject = findSubject(text);
  if (!claim.token) claim.problem = "no token found — write the ticker as $TICKER";
  else if (!claim.type) claim.problem = "not a flow claim — nothing about buying, selling or holding";
  return claim;
}

/** Validation shared by both extractors: what the engine will accept. */
export function validClaim(c: Claim): c is Claim & { token: string; type: ClaimType } {
  return !!c.token && /^[A-Z0-9]{2,12}$/.test(c.token) && !!c.type && !c.problem;
}

/** Merge an LLM extraction with the rules extraction: the LLM fills what the rules found nothing for, never overrides a `$TICKER`. */
export function mergeClaims(rules: Claim, llm: Partial<Claim> | null): Claim {
  if (!llm) return rules;
  const dollar = /\$[A-Za-z][A-Za-z0-9]{1,11}\b/.test(rules.raw);
  const token = dollar && rules.token ? rules.token : (llm.token?.toUpperCase().replace(/^\$/, "") ?? rules.token);
  const out: Claim = {
    raw: rules.raw,
    token,
    // the model may only name a chain the text actually contains (it guessed "ethereum" for a HYPE claim live)
    chain: llm.chain && SCORABLE_CHAINS.has(llm.chain) && new RegExp(`\\b${llm.chain}\\b`, "i").test(rules.raw) ? llm.chain : rules.chain,
    type: llm.type ?? rules.type,
    subject: llm.subject ?? rules.subject ?? "smart_money",
    extractor: "llm",
  };
  if (!out.token) out.problem = "no token found — write the ticker as $TICKER";
  else if (!out.type) out.problem = "not a flow claim — nothing about buying, selling or holding";
  return out;
}
