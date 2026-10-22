/**
 * Which of a symbol's directory series to chart/quote. Pure, shared by the
 * dashboard (client) and the details page (server).
 *
 * 1. A series that already has local CSV history (Stage 2A data stays usable).
 * 2. Otherwise the normal rolling-settlement series before trade-for-trade:
 *    EQ > BE > BZ (Mainboard), SM > ST > SZ (SME). Probing showed NSE MCP
 *    reports only one current series per symbol (e.g. HAMPTON -> EQ,
 *    PARSVNATH -> BE), which is normally the highest-ranked one listed.
 * The chosen series is always sent explicitly; responses for any other
 * series are rejected, never relabelled.
 */
const RANK = ["EQ", "BE", "BZ", "SM", "ST", "SZ"];

export function preferredSeries(series: string[], withLocalHistory: string[] = []): string | null {
  const local = series.find((s) => withLocalHistory.includes(s));
  if (local) return local;
  const sorted = [...series].sort((a, b) => {
    const ra = RANK.indexOf(a);
    const rb = RANK.indexOf(b);
    return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb) || a.localeCompare(b);
  });
  return sorted[0] ?? null;
}
