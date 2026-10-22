import type { Db } from "@/db/client";
import { getDb } from "@/db/client";
import type { DelayedQuote } from "./normalize";
import type { NseCmQuoteProvider } from "./nse-quote-provider";
import { PriceRequestError, providerRequestError, resolveSecurity } from "./price-service";

/**
 * GET /api/quotes service. Deliberately separate from /api/prices: a delayed
 * intraday snapshot is never merged with (or turned into) a daily candle.
 */

export type QuoteSourceId = "nse-cm-market-mcp" | "cached-stale" | "unavailable";
export const QUOTE_SOURCE_LABEL: Record<QuoteSourceId, string> = {
  "nse-cm-market-mcp": "NSE CM Market — Delayed Quote",
  "cached-stale": "Cached — Stale",
  unavailable: "Unavailable",
};

export type MarketSession = "open" | "pre-open" | "closed";

export interface QuoteResponse {
  symbol: string;
  series: string;
  name: string;
  currency: "INR";
  dataMode: "DELAYED_QUOTE";
  sourceId: QuoteSourceId;
  sourceLabel: string;
  /** NSE's description of the feed, not a measured delay. */
  delayNote: string;
  isStale: boolean;
  quote: DelayedQuote | null;
  /** When MarketPulse fetched it (not the market time). */
  fetchedAt: string | null;
  cached: boolean;
  /** Based on the IST clock only (holidays are not known): used to avoid implying live movement. */
  marketSession: MarketSession;
  unavailableReason: string | null;
  attribution: string;
}

export function parseQuoteQuery(params: URLSearchParams): { symbol: string; series: string | null; refresh: boolean } {
  const symbol = (params.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) throw new PriceRequestError("INVALID_SYMBOL", 400, "Query parameter `symbol` is required, e.g. ?symbol=RELIANCE.");
  if (!/^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(symbol)) throw new PriceRequestError("INVALID_SYMBOL", 400, `"${symbol.slice(0, 40)}" is not a valid NSE symbol.`);
  const rawSeries = params.get("series");
  const series = rawSeries === null || rawSeries.trim() === "" ? null : rawSeries.trim().toUpperCase();
  if (series !== null && !/^[A-Z0-9]{2}$/.test(series)) throw new PriceRequestError("INVALID_SERIES", 400, `"${series.slice(0, 20)}" is not a valid NSE series code.`);
  return { symbol, series, refresh: params.get("refresh") === "1" };
}

/** NSE CM normal market 09:15-15:30 IST, pre-open 09:00-09:15, Mon-Fri. Holidays are not modelled. */
export function marketSessionAt(now: Date): MarketSession {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  if (parts.weekday === "Sat" || parts.weekday === "Sun") return "closed";
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes >= 9 * 60 && minutes < 9 * 60 + 15) return "pre-open";
  if (minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30) return "open";
  return "closed";
}

const ATTRIBUTION = "Source: National Stock Exchange of India (NSE MCP). For personal, informational use only.";
const DELAY_NOTE = "NSE describes CM Market data as about 1–3 minutes behind real time.";

export async function getQuote(
  query: { symbol: string; series: string | null; refresh?: boolean },
  deps: { db?: Db; quotes: NseCmQuoteProvider | null; mcpEnabled: boolean; now?: () => Date },
): Promise<QuoteResponse> {
  const db = deps.db ?? getDb();
  const match = resolveSecurity(db, query);
  const now = deps.now?.() ?? new Date();
  const base = {
    symbol: match.symbol,
    series: match.series,
    name: match.name,
    currency: "INR" as const,
    dataMode: "DELAYED_QUOTE" as const,
    delayNote: DELAY_NOTE,
    marketSession: marketSessionAt(now),
    attribution: ATTRIBUTION,
  };
  const unavailable = (reason: string): QuoteResponse => ({
    ...base,
    sourceId: "unavailable",
    sourceLabel: QUOTE_SOURCE_LABEL.unavailable,
    isStale: false,
    quote: null,
    fetchedAt: null,
    cached: false,
    unavailableReason: reason,
  });

  if (!deps.mcpEnabled || !deps.quotes) return unavailable("NSE MCP is disabled by configuration; no delayed quotes are fetched.");

  const result = await deps.quotes.getQuote({ symbol: match.symbol, series: match.series }, { force: query.refresh });
  if (result.ok) {
    return {
      ...base,
      sourceId: "nse-cm-market-mcp",
      sourceLabel: QUOTE_SOURCE_LABEL["nse-cm-market-mcp"],
      isStale: false,
      quote: result.entry.quote,
      fetchedAt: result.entry.fetchedAt,
      cached: result.cached,
      unavailableReason: null,
    };
  }
  if (result.kind === "provider") {
    if (result.stale) {
      return {
        ...base,
        sourceId: "cached-stale",
        sourceLabel: QUOTE_SOURCE_LABEL["cached-stale"],
        isStale: true,
        quote: result.stale.quote, // original exchange timestamp preserved
        fetchedAt: result.stale.fetchedAt,
        cached: true,
        unavailableReason: `Latest request failed: ${result.error.message}`,
      };
    }
    throw providerRequestError(result.error.code, result.error.message);
  }
  if (result.kind === "series-mismatch") {
    return unavailable(`${result.message}. MarketPulse does not relabel another series' quote.`);
  }
  if (result.kind === "not-found") return unavailable(result.message);
  throw new PriceRequestError("PROVIDER_INVALID_RESPONSE", 502, `NSE CM Market returned an invalid quote: ${result.message}`);
}
