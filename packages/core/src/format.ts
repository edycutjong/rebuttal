/** Format a trace value by the FIELD it came from, never by magnitude (a token count is not dollars; a price is not a percent). Browser-safe. */
export function fmtValue(key: string, v: number | string | null): string {
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
