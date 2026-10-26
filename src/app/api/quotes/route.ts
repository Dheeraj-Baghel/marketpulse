import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/lib/market-data/http";
import { getMarketDataProviders } from "@/lib/market-data/provider";
import { getQuote, parseQuoteQuery } from "@/lib/market-data/quote-service";
import { publicPreviewResponse } from "@/lib/public-preview-response";

/**
 * GET /api/quotes?symbol=RELIANCE&series=EQ[&refresh=1]
 *
 * Latest delayed quote from the official NSE CM Market Live MCP
 * (`cm_get_stock_quote`). Separate from /api/prices on purpose: a quote is a
 * snapshot, never a daily candle. Server-side TTL cache + single flight; the
 * symbol is validated against the directory before any MCP call.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const preview = publicPreviewResponse();
  if (preview) return preview;
  try {
    const query = parseQuoteQuery(request.nextUrl.searchParams);
    const p = getMarketDataProviders();
    const body = await getQuote(query, { quotes: p.config.mcpEnabled ? p.quotes : null, mcpEnabled: p.config.mcpEnabled });
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error, "GET /api/quotes", "The delayed quote could not be loaded.");
  }
}
