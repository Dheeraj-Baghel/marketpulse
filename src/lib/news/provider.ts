import "server-only";
import { createHash } from "node:crypto";
import { GNewsProvider, GNEWS_ENDPOINT } from "./gnews-provider";
import { createNewsCache } from "./service";
import type { NewsProvider } from "./types";
import { isPublicPreview } from "../public-preview";

/**
 * News provider registry + config (Stage 3). Server-only: the API key is read
 * here and never leaves the server (no NEXT_PUBLIC_ variable, never in
 * responses or logs).
 *
 *   NEWS_PROVIDER=gnews            (only supported value; anything else = not configured)
 *   GNEWS_API_KEY=...              (in .env.local — never commit it)
 *   NEWS_LOOKBACK_DAYS=14          (1..30; GNews free plan reaches 30 days)
 *   NEWS_CACHE_TTL_SECONDS=7200    (300..86400)
 *   NEWS_DAILY_REQUEST_BUDGET=90   (<= 100 free-plan requests/day; keeps headroom)
 */

export interface NewsConfig {
  providerName: string;
  configured: boolean;
  lookbackDays: number;
  ttlMs: number;
  dailyBudget: number;
  timeoutMs: number;
}

function intEnv(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const v = Number(env[key]);
  return Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : fallback;
}

/** Test-only: a loopback GNews double is allowed outside production (mirrors the MCP double). */
function endpointOverride(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.GNEWS_ENDPOINT_OVERRIDE;
  if (!raw || env.MARKETPULSE_ALLOW_LOOPBACK_NEWS !== "1" || env.NODE_ENV === "production") return undefined;
  try {
    const u = new URL(raw);
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.protocol === "http:" ? u.toString().replace(/\/$/, "") : undefined;
  } catch {
    return undefined;
  }
}

export function readNewsConfig(env: NodeJS.ProcessEnv = process.env): NewsConfig & { apiKey: string | null; endpoint: string } {
  const providerName = (env.NEWS_PROVIDER ?? "gnews").trim().toLowerCase();
  const key = (env.GNEWS_API_KEY ?? "").trim();
  const apiKey = !isPublicPreview(env) && providerName === "gnews" && /^[A-Za-z0-9]{16,128}$/.test(key) ? key : null;
  return {
    providerName,
    configured: apiKey !== null,
    apiKey,
    endpoint: endpointOverride(env) ?? GNEWS_ENDPOINT,
    lookbackDays: intEnv(env, "NEWS_LOOKBACK_DAYS", 14, 1, 30),
    ttlMs: intEnv(env, "NEWS_CACHE_TTL_SECONDS", 7200, 300, 86_400) * 1000,
    dailyBudget: intEnv(env, "NEWS_DAILY_REQUEST_BUDGET", 90, 1, 100),
    timeoutMs: intEnv(env, "NEWS_TIMEOUT_MS", 10_000, 1000, 30_000),
  };
}

export interface NewsRuntime {
  config: NewsConfig;
  provider: NewsProvider & { usage?: () => unknown };
  cache: ReturnType<typeof createNewsCache>;
}

const g = globalThis as unknown as { __mpNews?: { key: string; value: NewsRuntime } };

export function getNewsRuntime(): NewsRuntime {
  const { apiKey, endpoint, ...config } = readNewsConfig();
  // Rebuild when config or key changes; only a one-way hash of the key is kept in memory here.
  const fp = apiKey ? createHash("sha256").update(apiKey).digest("hex").slice(0, 12) : null;
  const key = JSON.stringify({ ...config, endpoint, fp });
  if (!g.__mpNews || g.__mpNews.key !== key) {
    g.__mpNews = {
      key,
      value: {
        config,
        provider: new GNewsProvider({ apiKey, timeoutMs: config.timeoutMs, dailyBudget: config.dailyBudget, minIntervalMs: 1100, endpoint }),
        cache: createNewsCache(),
      },
    };
  }
  return g.__mpNews.value;
}
