import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { securities, type Security } from "@/db/schema";
import { TtlCache } from "@/lib/market-data/cache";
import { PriceRequestError, resolveSecurity } from "@/lib/market-data/price-service";
import { buildGNewsQuery, buildSearchProfile, normalizeCompanyName } from "./company-query";
import { matchArticle } from "./matching";
import { articleId, dedupeArticles, inWindow, newestFirst, rollingWindow } from "./normalize";
import { NewsProviderError, type NewsArticle, type NewsFailureCode, type NewsProvider } from "./types";

/**
 * GET /api/news service: identity -> query -> cache/provider -> validation ->
 * relevance -> dedupe -> newest first. Independent of the market-data stack
 * (a news failure can never affect charts or quotes).
 *
 * Cache: transient, in-memory, per security (TTL NEWS_CACHE_TTL_SECONDS,
 * default 2 h), single-flight. Empty results are cached too. Articles are
 * re-filtered against the CURRENT rolling window on every read.
 */

export type NewsState =
  | "ok" // fetched now or served from a fresh cache, >= 1 article
  | "empty" // provider answered; no matching articles in the window
  | "stale" // provider failed/limited; showing previously retrieved articles
  | "not-configured"
  | "quota-exhausted"
  | "rate-limited"
  | "unavailable";

export interface NewsResponse {
  company: { symbol: string; name: string; series: string; segment: string };
  state: NewsState;
  windowDays: number;
  window: { from: string; to: string };
  provider: string;
  providerDelayHours: number;
  /** When MarketPulse last retrieved this company's news from the provider (not publication time). */
  fetchedAt: string | null;
  cached: boolean;
  /** Provider's total match count for the query (often > retrieved). */
  totalMatches: number | null;
  retrievedCount: number;
  maxPerRequest: number;
  rejectedCount: number;
  duplicateCount: number;
  articles: NewsArticle[];
  query: string;
  message: string | null;
  /** When state is "stale": why fresh retrieval failed. */
  staleReason: "quota-exhausted" | "rate-limited" | "unavailable" | null;
  /** When the provider may be asked again (quota reset / cool-down), if blocked. */
  retryAfter: string | null;
  attribution: string;
}

export interface NewsCacheEntry {
  fetchedAt: string;
  /** All relevant, de-duplicated articles from the fetch (re-windowed on read). */
  articles: NewsArticle[];
  totalMatches: number | null;
  retrievedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  query: string;
}

export interface NewsDeps {
  db?: Db;
  provider: NewsProvider;
  cache: TtlCache<NewsCacheEntry>;
  ttlMs: number;
  lookbackDays: number;
  now?: () => Date;
}

export function createNewsCache(): TtlCache<NewsCacheEntry> {
  return new TtlCache<NewsCacheEntry>(200);
}

const STATE_FOR: Partial<Record<NewsFailureCode, NewsState>> = {
  NOT_CONFIGURED: "not-configured",
  QUOTA_EXHAUSTED: "quota-exhausted",
  RATE_LIMITED: "rate-limited",
};

/** Other directory companies whose names extend this one (ITC -> "ITC Hotels"). */
function siblingNames(db: Db, symbol: string, legalName: string): string[] {
  const core = normalizeCompanyName(legalName);
  const first = core.split(" ")[0] ?? core;
  if (first.length < 3) return [];
  return db
    .select({ name: securities.name })
    .from(securities)
    .where(and(ne(securities.symbol, symbol), sql`${securities.name} LIKE ${`${first} %`}`))
    .groupBy(securities.symbol)
    .limit(40)
    .all()
    .map((r) => r.name);
}

/**
 * News is about a company, not a trading series: with an explicit series it
 * must exist (validated like the price API); without one, any active listing
 * of the symbol identifies the company (HAMPTON EQ/BZ -> one company).
 */
function resolveCompany(db: Db, query: { symbol: string; series: string | null }): Security {
  if (query.series) return resolveSecurity(db, query);
  const rows = db
    .select()
    .from(securities)
    .where(eq(securities.symbol, query.symbol))
    .orderBy(desc(securities.isActive), asc(securities.segment), asc(securities.series))
    .all();
  const first = rows[0];
  if (!first) throw new PriceRequestError("UNKNOWN_SECURITY", 404, `${query.symbol} is not in the NSE directory.`);
  return first;
}

export async function getCompanyNews(query: { symbol: string; series: string | null; refresh?: boolean }, deps: NewsDeps): Promise<NewsResponse> {
  const db = deps.db ?? getDb();
  const sec = resolveCompany(db, query);
  const now = deps.now?.() ?? new Date();
  const window = rollingWindow(now, deps.lookbackDays);
  const profile = buildSearchProfile(sec.symbol, sec.name, siblingNames(db, sec.symbol, sec.name));
  const q = buildGNewsQuery(profile);
  // Per company (all series of a symbol share one company), so switching series never refetches.
  const key = `${sec.segment}:${sec.symbol}`;

  const base = {
    company: { symbol: sec.symbol, name: sec.name, series: sec.series, segment: sec.segment },
    windowDays: deps.lookbackDays,
    window,
    provider: deps.provider.displayName,
    providerDelayHours: deps.provider.delayHours,
    maxPerRequest: deps.provider.maxPerRequest,
    query: q,
    attribution: `News via ${deps.provider.displayName}. Headlines and summaries belong to their publishers; links open the original articles.`,
  };
  const view = (entry: NewsCacheEntry, state: NewsState, cached: boolean, message: string | null, retryAfter: string | null): NewsResponse => {
    const articles = entry.articles.filter((a) => inWindow(a.publishedAt, window)).sort(newestFirst);
    return {
      ...base,
      state: state === "ok" && articles.length === 0 ? "empty" : state,
      fetchedAt: entry.fetchedAt,
      cached,
      totalMatches: entry.totalMatches,
      retrievedCount: entry.retrievedCount,
      rejectedCount: entry.rejectedCount,
      duplicateCount: entry.duplicateCount,
      articles,
      message,
      staleReason: null,
      retryAfter,
    };
  };

  if (!deps.provider.configured) {
    return { ...base, state: "not-configured", fetchedAt: null, cached: false, totalMatches: null, retrievedCount: 0, rejectedCount: 0, duplicateCount: 0, articles: [], message: "News provider not configured.", staleReason: null, retryAfter: null };
  }

  try {
    const { value, cached } = await deps.cache.getOrLoad(
      key,
      deps.ttlMs,
      async () => {
        const result = await deps.provider.getCompanyNews({ companyId: key, companyName: sec.name, symbol: sec.symbol, from: window.from, to: window.to, query: q });
        let rejected = 0;
        const relevant: (NewsArticle & { providerId: string | null })[] = [];
        for (const a of result.articles) {
          if (!inWindow(a.publishedAt, window)) {
            rejected++;
            continue;
          }
          const m = matchArticle(a, profile);
          if (m.relevance === "rejected") {
            rejected++;
            continue;
          }
          relevant.push({
            id: articleId(a.providerId, a.url),
            providerId: a.providerId,
            title: a.title,
            description: a.description,
            url: a.url,
            publisher: a.publisher,
            publishedAt: a.publishedAt,
            provider: deps.provider.displayName,
            relevance: m.relevance,
            matchReason: m.reason,
          });
        }
        relevant.sort(newestFirst);
        const { kept, removed } = dedupeArticles(relevant);
        return {
          fetchedAt: now.toISOString(),
          articles: kept.map((a): NewsArticle => ({
            id: a.id,
            title: a.title,
            description: a.description,
            url: a.url,
            publisher: a.publisher,
            publishedAt: a.publishedAt,
            provider: a.provider,
            relevance: a.relevance,
            matchReason: a.matchReason,
          })),
          totalMatches: result.totalMatches,
          retrievedCount: result.articles.length + result.invalid,
          rejectedCount: rejected + result.invalid,
          duplicateCount: removed,
          query: q,
        };
      },
      { force: query.refresh },
    );
    return view(value, "ok", cached, null, null);
  } catch (error) {
    if (!(error instanceof NewsProviderError)) throw error;
    const retryAfter = error.blockedUntil ? new Date(error.blockedUntil).toISOString() : null;
    const prior = deps.cache.peek(key);
    const state: NewsState = STATE_FOR[error.code] ?? "unavailable";
    if (state === "not-configured") {
      return { ...base, state, fetchedAt: null, cached: false, totalMatches: null, retrievedCount: 0, rejectedCount: 0, duplicateCount: 0, articles: [], message: error.message, staleReason: null, retryAfter: null };
    }
    if (prior) {
      // Previously retrieved (transient) articles, clearly marked with their ORIGINAL retrieval time.
      const v = view(prior.value, "stale", true, error.message, retryAfter);
      return { ...v, state: "stale", staleReason: state === "quota-exhausted" || state === "rate-limited" ? state : "unavailable", message: `${messageFor(state)} ${error.message}` };
    }
    return { ...base, state, fetchedAt: null, cached: false, totalMatches: null, retrievedCount: 0, rejectedCount: 0, duplicateCount: 0, articles: [], message: error.message, staleReason: null, retryAfter };
  }
}

function messageFor(state: NewsState): string {
  switch (state) {
    case "quota-exhausted":
      return "Daily news API limit reached. Previously retrieved articles are shown where available.";
    case "rate-limited":
      return "News refresh is temporarily unavailable because the provider limit has been reached.";
    default:
      return "Unable to fetch recent news.";
  }
}
