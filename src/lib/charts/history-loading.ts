// Client range-loading policy. Render one recent NSE chunk first; never require
// five years before showing a chart. Used independently of React in unit tests.
import type { ChartRange, ValidatedSeries } from "./candles";
export type HistoryApiRange = "3M" | "6M" | "1Y" | "MAX";
export function historyApiRange(range: ChartRange): HistoryApiRange {
  if (range === "ALL") return "MAX";
  if (range === "1Y" || range === "6M") return range;
  return "3M";
}
export const HISTORY_DEPTH: Record<HistoryApiRange, number> = { "3M": 1, "6M": 2, "1Y": 3, MAX: 4 };
export function historyCovers(data: ValidatedSeries, loadedDepth: number, range: HistoryApiRange): boolean {
  return data.meta.sourceId === "unavailable" || data.meta.provider?.complete === true || loadedDepth >= HISTORY_DEPTH[range];
}
/** Merge only the same provider AND trading identity. Never splice a stale CSV
 * fallback or another security into current NSE candles. Latest response wins. */
export function mergeLoadedHistory(previous: ValidatedSeries | undefined, next: ValidatedSeries): ValidatedSeries {
  if (previous?.candles.length && previous.meta.symbol === next.meta.symbol && previous.meta.series === next.meta.series
    && previous.meta.sourceId === "nse-bhavcopy-mcp" && next.meta.sourceId === "local-csv" && next.meta.isStale && next.meta.fallbackReason) {
    // A failed extension may return the old CSV fallback from another server
    // instance. Keep newer verified NSE data without falsely blending sources.
    return { ...previous, meta: { ...previous.meta, provider: previous.meta.provider ? { ...previous.meta.provider,
      loadWarning: { code: next.meta.fallbackReason.code, message: `Keeping verified NSE candles. Older history could not finish: ${next.meta.fallbackReason.message}`, retryable: true },
    } : null } };
  }
  if (!previous || previous.meta.symbol !== next.meta.symbol || previous.meta.series !== next.meta.series || previous.meta.sourceId !== next.meta.sourceId) return next;
  const candles = new Map(previous.candles.map(candle => [candle.time, candle]));
  for (const candle of next.candles) candles.set(candle.time, candle);
  const all = [...candles.values()].sort((a, b) => a.time.localeCompare(b.time));
  return { ...next, candles: all, hasVolume: all.some(candle => candle.volume !== null), meta: { ...next.meta, earliestTradingDate: all[0]?.time ?? null, latestTradingDate: all.at(-1)?.time ?? null } };
}
