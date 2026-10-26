import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/market-data/http";
import { getMarketDataProviders } from "@/lib/market-data/provider";
import { getPrices, parsePriceQuery } from "@/lib/market-data/price-service";
import { publicPreviewResponse } from "@/lib/public-preview-response";

/**
 * GET /api/prices?symbol=RELIANCE&series=EQ&range=1Y[&refresh=1][&source=auto|nse-mcp|local-csv (dev only)]
 *
 * Ascending, unadjusted daily OHLCV candles. Stage 2C source priority:
 * NSE Bhavcopy MCP (transient) -> local CSV import -> explicit empty.
 * Every response states `sourceId`/`sourceLabel`, `isStale` and, when the
 * primary source was not used, `fallbackReason`. Never returns another
 * security's or series' data. Stage 2A/2B fields are unchanged.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const preview = publicPreviewResponse();
  if (preview) return preview;
  try {
    const query = parsePriceQuery(request.nextUrl.searchParams);
    const p = getMarketDataProviders();
    const body = await getPrices(query, {
      mcpHistory: p.config.mcpEnabled ? p.history : null,
      mcpEnabled: p.config.mcpEnabled,
      allowSourceOverride: p.config.allowSourceOverride,
    });
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "GET /api/prices", "Price data could not be read.");
  }
}
