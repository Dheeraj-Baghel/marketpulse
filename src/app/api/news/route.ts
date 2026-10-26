import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/market-data/http";
import { PriceRequestError } from "@/lib/market-data/price-service";
import { getNewsRuntime } from "@/lib/news/provider";
import { getCompanyNews } from "@/lib/news/service";
import { publicPreviewResponse } from "@/lib/public-preview-response";

/**
 * GET /api/news?symbol=RELIANCE[&series=EQ][&refresh=1]
 *
 * Company news from the last NEWS_LOOKBACK_DAYS (default 14) via GNews.
 * Server-side only; the API key never reaches the client. The symbol is
 * validated against the NSE directory before any provider call.
 *
 * Provider problems are returned as HTTP 200 with an explicit `state`
 * ("not-configured" | "quota-exhausted" | "rate-limited" | "unavailable" |
 * "stale") so the UI can show the right message — never as a fake "empty".
 * Unknown symbols / bad input are 4xx, like the price APIs.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const preview = publicPreviewResponse();
  if (preview) return preview;
  try {
    const params = request.nextUrl.searchParams;
    const symbol = (params.get("symbol") ?? "").trim().toUpperCase();
    if (!symbol) throw new PriceRequestError("INVALID_SYMBOL", 400, "Query parameter `symbol` is required, e.g. ?symbol=RELIANCE.");
    if (!/^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(symbol)) throw new PriceRequestError("INVALID_SYMBOL", 400, `"${symbol.slice(0, 40)}" is not a valid NSE symbol.`);
    const rawSeries = params.get("series");
    const series = rawSeries && rawSeries.trim() ? rawSeries.trim().toUpperCase() : null;
    if (series !== null && !/^[A-Z0-9]{2}$/.test(series)) throw new PriceRequestError("INVALID_SERIES", 400, `"${series.slice(0, 20)}" is not a valid NSE series code.`);

    const rt = getNewsRuntime();
    const body = await getCompanyNews(
      { symbol, series, refresh: params.get("refresh") === "1" },
      { provider: rt.provider, cache: rt.cache, ttlMs: rt.config.ttlMs, lookbackDays: rt.config.lookbackDays },
    );
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "GET /api/news", "News could not be loaded.");
  }
}
