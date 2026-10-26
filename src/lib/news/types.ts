/**
 * Stage 3 news contract. Small on purpose: one method, one article shape, so
 * another provider can be added later without touching the API or UI.
 */

export interface CompanyNewsRequest {
  /** Directory identity (segment:symbol). */
  companyId: string;
  /** Official listed name from the NSE directory, e.g. "Tata Consultancy Services Limited". */
  companyName: string;
  symbol: string;
  /** Inclusive ISO-8601 UTC window. */
  from: string;
  to: string;
  /** Provider query, already built by company-query.ts. */
  query: string;
}

/** One article as returned by a provider, before relevance matching. */
export interface ProviderArticle {
  /** Provider's own id, if any. */
  providerId: string | null;
  title: string;
  description: string | null;
  url: string;
  publisher: string;
  publisherUrl: string | null;
  /** ISO-8601 UTC. */
  publishedAt: string;
}

export interface ProviderResult {
  articles: ProviderArticle[];
  /** Provider's count of all matches (may exceed what was retrieved). */
  totalMatches: number | null;
  /** Rows dropped by validation (bad URL, bad date, missing title). */
  invalid: number;
}

export type Relevance = "verified" | "likely";

export interface NewsArticle {
  id: string;
  title: string;
  description: string | null;
  url: string;
  publisher: string;
  publishedAt: string;
  provider: string;
  relevance: Relevance;
  /** Short human-readable reason, e.g. 'title names "Infosys"'. */
  matchReason: string;
}

export type NewsFailureCode = "NOT_CONFIGURED" | "QUOTA_EXHAUSTED" | "RATE_LIMITED" | "PROVIDER_AUTH" | "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "INVALID_RESPONSE" | "BAD_REQUEST";

export class NewsProviderError extends Error {
  constructor(
    readonly code: NewsFailureCode,
    message: string,
    /** Epoch ms until which the provider must not be called again (quota reset / cool-down). */
    readonly blockedUntil: number | null = null,
  ) {
    super(message);
    this.name = "NewsProviderError";
  }
}

export interface NewsProvider {
  readonly id: string;
  readonly displayName: string;
  /** Free-tier publication delay to disclose in the UI (hours). */
  readonly delayHours: number;
  readonly maxPerRequest: number;
  readonly configured: boolean;
  getCompanyNews(request: CompanyNewsRequest, signal?: AbortSignal): Promise<ProviderResult>;
}
