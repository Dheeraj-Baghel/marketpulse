import "server-only";
import { getNseMcpClient, readMcpConfig, type McpTransportLike } from "./nse-mcp-client";
import { NseBhavcopyHistoryProvider } from "./nse-history-provider";
import { NseCmQuoteProvider } from "./nse-quote-provider";

/**
 * Provider registry + selection policy (Stage 2C).
 *
 * Historical candles, in priority order:
 *   1. NSE Bhavcopy MCP (official, transient)   -> "NSE Bhavcopy — Historical EOD"
 *   2. Local CSV import in SQLite (Stage 2A)    -> "Local CSV — Historical EOD"
 *   3. explicit unavailable
 * Delayed quotes, in priority order:
 *   1. NSE CM Market MCP                        -> "NSE CM Market — Delayed Quote"
 *   2. last good quote with original timestamp  -> "Cached — Stale"
 *   3. explicit unavailable
 * A historical close is never presented as a delayed quote, and categories
 * are never switched silently: every response carries its sourceId + label.
 */

export const SOURCE_LABELS = {
  "nse-bhavcopy-mcp": "NSE Bhavcopy — Historical EOD",
  "local-csv": "Local CSV — Historical EOD",
  "nse-cm-market-mcp": "NSE CM Market — Delayed Quote",
  "cached-stale": "Cached — Stale",
  unavailable: "Unavailable",
} as const;
export type SourceId = keyof typeof SOURCE_LABELS;

export type HistorySourcePreference = "auto" | "nse-mcp" | "local-csv";

export interface MarketDataConfig {
  mcpEnabled: boolean;
  historyTtlMs: number;
  quoteTtlMs: number;
  /** How long a last-good quote may be shown (labelled stale) during an outage. */
  quoteStaleMaxMs: number;
  /** Client background refresh for the selected stock while the market is open; 0 = off. */
  quoteAutoRefreshMs: number;
  /** Dev-only manual switch exposed in the API (?source=). */
  allowSourceOverride: boolean;
  configErrors: string[];
}

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const v = Number(env[key]);
  return Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : fallback;
}

export function readMarketDataConfig(env: NodeJS.ProcessEnv = process.env): MarketDataConfig {
  const mcp = readMcpConfig(env);
  return {
    mcpEnabled: mcp.enabled,
    historyTtlMs: intEnv(env, "NSE_HISTORY_CACHE_TTL_SECONDS", 30 * 60, 60, 24 * 3600) * 1000,
    quoteTtlMs: intEnv(env, "NSE_QUOTE_CACHE_TTL_SECONDS", 60, 15, 3600) * 1000,
    quoteStaleMaxMs: intEnv(env, "NSE_QUOTE_STALE_MAX_SECONDS", 6 * 3600, 0, 7 * 24 * 3600) * 1000,
    quoteAutoRefreshMs: intEnv(env, "NSE_QUOTE_AUTO_REFRESH_SECONDS", 120, 0, 3600) * 1000,
    allowSourceOverride: env.NODE_ENV !== "production",
    configErrors: mcp.configErrors,
  };
}

export interface MarketDataProviders {
  config: MarketDataConfig;
  mcp: McpTransportLike;
  history: NseBhavcopyHistoryProvider;
  quotes: NseCmQuoteProvider;
}

const g = globalThis as unknown as { __mpProviders?: { key: string; value: MarketDataProviders } };

/** Process-wide providers (shared caches survive dev hot reloads). Tests inject their own. */
export function getMarketDataProviders(): MarketDataProviders {
  const config = readMarketDataConfig();
  const mcpClient = getNseMcpClient();
  const key = JSON.stringify(config);
  if (!g.__mpProviders || g.__mpProviders.key !== key || g.__mpProviders.value.mcp !== mcpClient) {
    const mcp = mcpClient;
    g.__mpProviders = {
      key,
      value: {
        config,
        mcp,
        history: new NseBhavcopyHistoryProvider(mcp, { ttlMs: config.historyTtlMs }),
        quotes: new NseCmQuoteProvider(mcp, { ttlMs: config.quoteTtlMs, staleMaxMs: config.quoteStaleMaxMs }),
      },
    };
  }
  return g.__mpProviders.value;
}
