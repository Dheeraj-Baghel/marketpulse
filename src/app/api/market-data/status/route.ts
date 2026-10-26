import { NextResponse } from "next/server";
import { getMarketDataProviders } from "@/lib/market-data/provider";
import { isPublicPreview } from "@/lib/public-preview";

/**
 * GET /api/market-data/status — provider health for diagnostics.
 * Makes NO upstream calls; reports what this server process has observed.
 * Contains no secrets (the MCP endpoints are public, fixed NSE URLs).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const p = getMarketDataProviders();
  return NextResponse.json(
    {
      publicPreview: isPublicPreview(),
      mcpEnabled: p.config.mcpEnabled,
      configErrors: p.config.configErrors,
      servers: p.mcp.health(),
      cache: {
        history: { entries: p.history.cache.size, upstreamCalls: p.history.calls, persisted: false },
        quotes: { entries: p.quotes.cache.size, upstreamCalls: p.quotes.calls, ttlSeconds: p.config.quoteTtlMs / 1000, persisted: false },
      },
      quoteAutoRefreshSeconds: p.config.quoteAutoRefreshMs / 1000,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
