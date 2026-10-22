import { NextResponse, type NextRequest } from "next/server";
import { getPrices, parsePriceQuery, PriceRequestError } from "@/lib/market-data/price-service";

/**
 * GET /api/prices?symbol=RELIANCE&series=EQ&range=1Y
 *
 * Returns ascending daily OHLCV candles imported from NSE security-wise
 * historical CSVs. Unadjusted, end-of-day only. An empty `candles` array means
 * no data has been imported for this (valid) security; it is never filled
 * with another security's or series' data.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const query = parsePriceQuery(request.nextUrl.searchParams);
    const body = await getPrices(query);
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PriceRequestError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, ...(error.details ?? {}) } },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    console.error("GET /api/prices failed", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Price data could not be read from the local database." } },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
