import { NextResponse } from "next/server";
import { PriceRequestError } from "./price-service";

/** Shared JSON error mapping for the market-data routes. Never leaks stack traces or env values. */
export function errorResponse(error: unknown, route: string, fallbackMessage: string) {
  const headers = { "Cache-Control": "no-store" };
  if (error instanceof PriceRequestError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, ...(error.details ?? {}) } }, { status: error.status, headers });
  }
  console.error(`${route} failed:`, error instanceof Error ? error.message : String(error));
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: fallbackMessage } }, { status: 500, headers });
}
