import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { securities, type Security } from "@/db/schema";
import { LocalNseHistoricalProvider } from "./local-nse-provider";
import type { McpFailureCode } from "./nse-mcp-client";
import type { NseBhavcopyHistoryProvider } from "./nse-history-provider";
import { todayIst } from "./normalize";
import type { DailyCandle, HistoricalPriceProvider } from "./types";

/**
 * Request validation and security resolution for GET /api/prices.
 * Pure of HTTP so it can be unit tested; the route maps results to responses.
 */

export const RANGES = ["1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y", "MAX"] as const;
export type PriceRange = (typeof RANGES)[number];

/** Stage 2C provenance for the candles in this response. */
export type HistorySourceId = "nse-bhavcopy-mcp" | "local-csv" | "unavailable";
export const HISTORY_SOURCE_LABEL: Record<HistorySourceId, string> = {
  "nse-bhavcopy-mcp": "NSE Bhavcopy — Historical EOD",
  "local-csv": "Local CSV — Historical EOD",
  unavailable: "Unavailable",
};

export interface PricesResponse {
  symbol: string;
  series: string;
  name: string;
  isin: string;
  segment: string;
  currency: "INR";
  interval: "1d";
  /** Human-readable provenance (kept for Stage 2A/2B compatibility). */
  source: string;
  sourceId: HistorySourceId;
  sourceLabel: string;
  dataMode: "HISTORICAL_EOD";
  adjustmentStatus: "UNADJUSTED";
  range: PriceRange;
  /** Inclusive window actually queried; null when no data exists. */
  from: string | null;
  to: string | null;
  latestTradingDate: string | null;
  earliestTradingDate: string | null;
  /**
   * True when the candles are known to be behind what the primary source would
   * provide (e.g. MCP failed and local CSV ends before the latest session).
   */
  isStale: boolean;
  /** Why the primary source was not used (null when it was, or when MCP is disabled). */
  fallbackReason: { code: McpFailureCode | "NOT_FOUND" | "SERIES_MISMATCH" | "DISABLED" | "OVERRIDE"; message: string } | null;
  /** Present when MCP served the data: transient cache info, never persisted. */
  provider: {
    fetchedAt: string;
    cached: boolean;
    chunks: number;
    /** True once NSE confirmed no older history exists (start of its ~5-year window). */
    complete: boolean;
    /** Rows excluded because NSE returned another series (e.g. T+0 "T0"); never relabelled. */
    excludedOtherSeriesRows: number;
    otherSeries: string[];
    rejectedRows: number;
    loadWarning?: { code: string; message: string; retryable: boolean };
  } | null;
  count: number;
  candles: DailyCandle[];
}

export type PriceErrorCode =
  | "INVALID_SYMBOL"
  | "INVALID_SERIES"
  | "UNSUPPORTED_RANGE"
  | "BAD_REQUEST"
  | "UNKNOWN_SECURITY"
  | "AMBIGUOUS_SERIES"
  | "UNKNOWN_SERIES"
  | "NO_HISTORICAL_DATA"
  | "QUOTE_UNAVAILABLE"
  | "UNSUPPORTED_SERIES"
  | "PROVIDER_DISABLED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_TOOL_MISSING"
  | "PROVIDER_UNAVAILABLE"
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

/** Maps an MCP provider failure to a typed HTTP error (used by both price and quote APIs). */
export function providerRequestError(code: McpFailureCode, message: string): PriceRequestError {
  switch (code) {
    case "TIMEOUT":
      return new PriceRequestError("PROVIDER_TIMEOUT", 504, message);
    case "RATE_LIMITED":
      return new PriceRequestError("PROVIDER_RATE_LIMITED", 429, message);
    case "INVALID_RESPONSE":
      return new PriceRequestError("PROVIDER_INVALID_RESPONSE", 502, message);
    case "TOOL_MISSING":
      return new PriceRequestError("PROVIDER_TOOL_MISSING", 502, message);
    case "DISABLED":
      return new PriceRequestError("PROVIDER_DISABLED", 503, message);
    default:
      return new PriceRequestError("PROVIDER_UNAVAILABLE", 502, message);
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

export interface PriceQuery {
  symbol: string;
  series: string | null;
  range: PriceRange;
  /** Development-only manual source switch (ignored unless allowed). */
  source?: "auto" | "nse-mcp" | "local-csv";
  /** Bypass the transient MCP cache (manual refresh). */
  refresh?: boolean;
}

export function parsePriceQuery(params: URLSearchParams): PriceQuery {
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
  const rawSource = (params.get("source") ?? "auto").trim().toLowerCase();
  if (!["auto", "nse-mcp", "local-csv"].includes(rawSource)) {
    throw new PriceRequestError("BAD_REQUEST", 400, `Unsupported source "${rawSource.slice(0, 20)}". Use auto, nse-mcp or local-csv.`);
  }
  return { symbol: rawSymbol, series, range: rawRange as PriceRange, source: rawSource as PriceQuery["source"], refresh: params.get("refresh") === "1" };
}

/** Resolves exactly one directory security or throws a typed request error. */
export function resolveSecurity(db: Db, query: { symbol: string; series: string | null }): Security {
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
  return match;
}

/** Window start for a range relative to the latest stored/served session. */
function windowFrom(range: PriceRange, latest: string): string | null {
  if (range === "MAX") return null;
  return rangeWindow(range, latest, "0000-01-01").from;
}

export interface PriceDeps {
  db?: Db;
  provider?: HistoricalPriceProvider & Pick<LocalNseHistoricalProvider, "coverage">;
  /** Stage 2C: NSE Bhavcopy MCP provider; omitted/disabled -> local CSV only. */
  mcpHistory?: NseBhavcopyHistoryProvider | null;
  mcpEnabled?: boolean;
  allowSourceOverride?: boolean;
  now?: () => Date;
}

export async function getPrices(query: PriceQuery, deps: PriceDeps = {}): Promise<PricesResponse> {
  const db = deps.db ?? getDb();
  const provider = deps.provider ?? new LocalNseHistoricalProvider(db);
  const match = resolveSecurity(db, query);
  const source = deps.allowSourceOverride ? (query.source ?? "auto") : "auto";

  const base = {
    symbol: match.symbol,
    series: match.series,
    name: match.name,
    isin: match.isin,
    segment: match.segment,
    currency: "INR" as const,
    interval: "1d" as const,
    dataMode: "HISTORICAL_EOD" as const,
    adjustmentStatus: "UNADJUSTED" as const,
    range: query.range,
  };

  // 1) Official NSE Bhavcopy MCP (transient).
  let fallbackReason: PricesResponse["fallbackReason"] = null;
  const mcpAllowed = Boolean(deps.mcpHistory) && deps.mcpEnabled !== false && source !== "local-csv";
  if (!mcpAllowed) {
    fallbackReason = source === "local-csv" ? { code: "OVERRIDE", message: "Local CSV forced by the development source switch." } : deps.mcpEnabled === false ? { code: "DISABLED", message: "NSE MCP is disabled by configuration." } : null;
  } else {
    // Bhavcopy's latest session is at most "yesterday"; anchor the window on today and let the provider stop once reached.
    const anchor = todayIst(deps.now?.() ?? new Date());
    const from = windowFrom(query.range, anchor);
    const result = await deps.mcpHistory!.getHistory({ symbol: match.symbol, series: match.series }, from, { force: query.refresh });
    // Within its TTL, previously fetched Bhavcopy EOD data is served from the
    // transient cache even if NSE is currently down (labelled cached + fetchedAt).
    // A manual refresh (`refresh=1`) that fails falls through to the local CSV
    // below and says so in `fallbackReason`.
    if (result.ok) {
      const h = result.history;
      const latest = h.candles.at(-1)!.date;
      const earliest = h.candles[0]!.date;
      const winFrom = query.range === "MAX" ? earliest : (windowFrom(query.range, latest) ?? earliest);
      const candles = h.candles.filter((c) => c.date >= winFrom && c.date <= latest);
      return {
        ...base,
        source: "NSE Bhavcopy MCP",
        sourceId: "nse-bhavcopy-mcp",
        sourceLabel: HISTORY_SOURCE_LABEL["nse-bhavcopy-mcp"],
        from: candles[0]?.date ?? winFrom,
        to: latest,
        latestTradingDate: latest,
        // Earliest session loaded so far; provider.complete tells whether NSE has older data.
        earliestTradingDate: earliest,
        isStale: false,
        fallbackReason: null,
        provider: {
          fetchedAt: h.fetchedAt,
          cached: result.cached,
          chunks: h.chunksFetched,
          complete: h.nextEndDate === null,
          excludedOtherSeriesRows: h.foreignSeriesRows,
          otherSeries: h.foreignSeries,
          rejectedRows: h.rejectedRows,
          ...(result.warning ? { loadWarning: result.warning } : {}),
        },
        count: candles.length,
        candles,
      };
    }
    if (source === "nse-mcp") {
      const f = result.failure;
      if (f.kind === "provider") throw providerRequestError(f.error.code, f.error.message);
      if (f.kind === "series-mismatch") throw new PriceRequestError("UNSUPPORTED_SERIES", 404, f.message, { providerSeries: f.providerSeries });
      throw new PriceRequestError("NO_HISTORICAL_DATA", 404, f.message);
    }
    const f = result.failure;
    fallbackReason =
      f.kind === "provider"
        ? { code: f.error.code, message: f.error.message }
        : f.kind === "series-mismatch"
          ? { code: "SERIES_MISMATCH", message: f.message }
          : { code: "NOT_FOUND", message: f.message };
  }

  // 2) Local CSV import (Stage 2A).
  const coverage = provider.coverage(match.id);
  const providerFailed = fallbackReason !== null && !["DISABLED", "OVERRIDE", "NOT_FOUND", "SERIES_MISMATCH"].includes(fallbackReason.code);
  if (!coverage.latest || !coverage.earliest) {
    // A failed NSE request plus no local fallback is an upstream outage, not
    // evidence that the security has no history. Let the chart offer Retry.
    if (providerFailed && fallbackReason) throw providerRequestError(fallbackReason.code as McpFailureCode, fallbackReason.message);
    return {
      ...base,
      source: "Unavailable",
      sourceId: "unavailable",
      sourceLabel: HISTORY_SOURCE_LABEL.unavailable,
      from: null,
      to: null,
      latestTradingDate: null,
      earliestTradingDate: null,
      isStale: false,
      fallbackReason,
      provider: null,
      count: 0,
      candles: [],
    };
  }

  const window = rangeWindow(query.range, coverage.latest, coverage.earliest);
  const result = await provider.getDailyCandles({ securityId: String(match.id), ...window });
  return {
    ...base,
    source: "NSE historical CSV import",
    sourceId: "local-csv",
    sourceLabel: HISTORY_SOURCE_LABEL["local-csv"],
    from: window.from,
    to: window.to,
    latestTradingDate: result.latestTradingDate,
    earliestTradingDate: result.earliestTradingDate,
    // Only "stale" when we know a fresher primary source was expected but failed.
    isStale: providerFailed,
    fallbackReason,
    provider: null,
    count: result.candles.length,
    candles: result.candles,
  };
}
