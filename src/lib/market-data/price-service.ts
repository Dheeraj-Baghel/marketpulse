import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { securities } from "@/db/schema";
import { LocalNseHistoricalProvider } from "./local-nse-provider";
import type { DailyCandle, HistoricalPriceProvider } from "./types";

/**
 * Request validation and security resolution for GET /api/prices.
 * Pure of HTTP so it can be unit tested; the route maps results to responses.
 */

export const RANGES = ["1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y", "MAX"] as const;
export type PriceRange = (typeof RANGES)[number];

export interface PricesResponse {
  symbol: string;
  series: string;
  name: string;
  isin: string;
  segment: string;
  currency: "INR";
  interval: "1d";
  source: string;
  dataMode: "HISTORICAL_EOD";
  adjustmentStatus: "UNADJUSTED";
  range: PriceRange;
  /** Inclusive window actually queried; null when no data exists. */
  from: string | null;
  to: string | null;
  latestTradingDate: string | null;
  earliestTradingDate: string | null;
  count: number;
  candles: DailyCandle[];
}

export type PriceErrorCode =
  | "INVALID_SYMBOL"
  | "INVALID_SERIES"
  | "UNSUPPORTED_RANGE"
  | "UNKNOWN_SECURITY"
  | "AMBIGUOUS_SERIES"
  | "UNKNOWN_SERIES"
  | "INTERNAL_ERROR";

export class PriceRequestError extends Error {
  constructor(
    readonly code: PriceErrorCode,
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PriceRequestError";
  }
}

function shiftIso(iso: string, { months = 0, years = 0 }: { months?: number; years?: number }): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y - years, m - 1 - months, 1));
  // Clamp day to the target month's length (e.g. 31 Mar - 1M -> 28/29 Feb).
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Window for a range, anchored on the latest stored trading date (not "today"),
 * so a 1Y request always shows the most recent year of data actually held.
 * Start is exclusive of the anchor-minus-period day: 1Y to 2026-10-21 starts 2025-10-22.
 */
export function rangeWindow(range: PriceRange, latest: string, earliest: string): { from: string; to: string } {
  const dayAfter = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  switch (range) {
    case "MAX":
      return { from: earliest, to: latest };
    case "YTD":
      return { from: `${latest.slice(0, 4)}-01-01`, to: latest };
    case "1M":
      return { from: dayAfter(shiftIso(latest, { months: 1 })), to: latest };
    case "3M":
      return { from: dayAfter(shiftIso(latest, { months: 3 })), to: latest };
    case "6M":
      return { from: dayAfter(shiftIso(latest, { months: 6 })), to: latest };
    case "1Y":
      return { from: dayAfter(shiftIso(latest, { years: 1 })), to: latest };
    case "2Y":
      return { from: dayAfter(shiftIso(latest, { years: 2 })), to: latest };
    case "5Y":
      return { from: dayAfter(shiftIso(latest, { years: 5 })), to: latest };
  }
}

export function parsePriceQuery(params: URLSearchParams): { symbol: string; series: string | null; range: PriceRange } {
  const rawSymbol = (params.get("symbol") ?? "").trim().toUpperCase();
  if (!rawSymbol) throw new PriceRequestError("INVALID_SYMBOL", 400, "Query parameter `symbol` is required, e.g. ?symbol=RELIANCE.");
  if (!/^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(rawSymbol)) {
    throw new PriceRequestError("INVALID_SYMBOL", 400, `"${rawSymbol.slice(0, 40)}" is not a valid NSE symbol.`);
  }
  const rawSeries = params.get("series");
  const series = rawSeries === null || rawSeries.trim() === "" ? null : rawSeries.trim().toUpperCase();
  if (series !== null && !/^[A-Z0-9]{2}$/.test(series)) {
    throw new PriceRequestError("INVALID_SERIES", 400, `"${series.slice(0, 20)}" is not a valid NSE series code (e.g. EQ).`);
  }
  const rawRange = (params.get("range") ?? "1Y").trim().toUpperCase();
  if (!(RANGES as readonly string[]).includes(rawRange)) {
    throw new PriceRequestError("UNSUPPORTED_RANGE", 400, `Unsupported range "${rawRange.slice(0, 20)}". Use one of ${RANGES.join(", ")}.`, {
      supportedRanges: RANGES,
    });
  }
  return { symbol: rawSymbol, series, range: rawRange as PriceRange };
}

export async function getPrices(
  query: { symbol: string; series: string | null; range: PriceRange },
  deps: { db?: Db; provider?: HistoricalPriceProvider & Pick<LocalNseHistoricalProvider, "coverage"> } = {},
): Promise<PricesResponse> {
  const db = deps.db ?? getDb();
  const provider = deps.provider ?? new LocalNseHistoricalProvider(db);

  const candidates = db.select().from(securities).where(eq(securities.symbol, query.symbol)).all();
  if (candidates.length === 0) {
    throw new PriceRequestError("UNKNOWN_SECURITY", 404, `${query.symbol} is not in the NSE directory.`);
  }
  const available = [...new Set(candidates.map((c) => c.series))].sort();

  let match;
  if (query.series) {
    const bySeries = candidates.filter((c) => c.series === query.series);
    if (bySeries.length === 0) {
      throw new PriceRequestError("UNKNOWN_SERIES", 404, `${query.symbol} has no ${query.series} series in the directory.`, {
        availableSeries: available,
      });
    }
    if (bySeries.length > 1) {
      throw new PriceRequestError("AMBIGUOUS_SERIES", 409, `${query.symbol} ${query.series} matches several listings.`, {
        availableSeries: available,
      });
    }
    match = bySeries[0];
  } else {
    if (candidates.length > 1) {
      throw new PriceRequestError(
        "AMBIGUOUS_SERIES",
        409,
        `${query.symbol} trades in several series (${available.join(", ")}). Pass ?series= explicitly.`,
        { availableSeries: available },
      );
    }
    match = candidates[0];
  }
  if (!match) throw new PriceRequestError("UNKNOWN_SECURITY", 404, `${query.symbol} is not in the NSE directory.`);

  const coverage = provider.coverage(match.id);
  const base = {
    symbol: match.symbol,
    series: match.series,
    name: match.name,
    isin: match.isin,
    segment: match.segment,
    currency: "INR" as const,
    interval: "1d" as const,
    source: "NSE historical CSV import",
    dataMode: "HISTORICAL_EOD" as const,
    adjustmentStatus: "UNADJUSTED" as const,
    range: query.range,
  };
  if (!coverage.latest || !coverage.earliest) {
    return { ...base, from: null, to: null, latestTradingDate: null, earliestTradingDate: null, count: 0, candles: [] };
  }

  const window = rangeWindow(query.range, coverage.latest, coverage.earliest);
  const result = await provider.getDailyCandles({ securityId: String(match.id), ...window });
  return {
    ...base,
    from: window.from,
    to: window.to,
    latestTradingDate: result.latestTradingDate,
    earliestTradingDate: result.earliestTradingDate,
    count: result.candles.length,
    candles: result.candles,
  };
}
