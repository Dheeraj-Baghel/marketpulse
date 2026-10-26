import "server-only";
import { gnewsResponseSchema, parseGNewsArticles } from "./normalize";
import { NewsProviderError, type CompanyNewsRequest, type NewsProvider, type ProviderResult } from "./types";

/**
 * GNews (https://docs.gnews.io/) search provider. Server-only.
 *
 * - Fixed endpoint (no user-supplied hosts): https://gnews.io/api/v4/search
 * - Key sent in the documented `X-Api-Key` header, never in the URL, logs or responses.
 * - Free plan: 1 request/second (enforced by a start-time gate), 100/day
 *   (local counter + 403 handling: no further calls until 00:00 UTC),
 *   max 10 articles, ~12 h delay.
 */
export const GNEWS_ENDPOINT = "https://gnews.io/api/v4/search";

export interface GNewsConfig {
  apiKey: string | null;
  timeoutMs: number;
  dailyBudget: number;
  minIntervalMs: number;
  /** Test-only override (loopback only, non-production). */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function nextUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export class GNewsProvider implements NewsProvider {
  readonly id = "gnews";
  readonly displayName = "GNews";
  readonly delayHours = 12;
  readonly maxPerRequest = 10;

  private lastStart = 0;
  private gate: Promise<void> = Promise.resolve();
  private blockedUntil = 0;
  private blockReason: NewsProviderError | null = null;
  private used = { day: "", count: 0 };

  constructor(private readonly config: GNewsConfig) {}

  get configured(): boolean {
    return Boolean(this.config.apiKey);
  }

  private now(): number {
    return this.config.now?.() ?? Date.now();
  }

  /** Requests made today (UTC), as counted by this server process. */
  usage(): { day: string; used: number; budget: number; blockedUntil: string | null } {
    const day = utcDay(this.now());
    return { day, used: this.used.day === day ? this.used.count : 0, budget: this.config.dailyBudget, blockedUntil: this.blockedUntil > this.now() ? new Date(this.blockedUntil).toISOString() : null };
  }

  private async pace(): Promise<void> {
    const prev = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((r) => (release = r));
    await prev;
    const wait = this.lastStart + this.config.minIntervalMs - this.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastStart = this.now();
    release();
  }

  async getCompanyNews(request: CompanyNewsRequest, signal?: AbortSignal): Promise<ProviderResult> {
    if (!this.config.apiKey) throw new NewsProviderError("NOT_CONFIGURED", "News provider not configured.");
    const now = this.now();
    if (this.blockedUntil > now && this.blockReason) {
      throw new NewsProviderError(this.blockReason.code, this.blockReason.message, this.blockedUntil);
    }
    const day = utcDay(now);
    if (this.used.day !== day) this.used = { day, count: 0 };
    if (this.used.count >= this.config.dailyBudget) {
      const until = nextUtcMidnight(now);
      throw new NewsProviderError("QUOTA_EXHAUSTED", `Local daily budget of ${this.config.dailyBudget} GNews requests used; resets 00:00 UTC.`, until);
    }

    await this.pace();
    this.used.count++;
    const params = new URLSearchParams({
      q: request.query,
      lang: "en",
      max: String(this.maxPerRequest),
      sortby: "publishedAt",
      from: request.from,
      to: request.to,
      in: "title,description",
      nullable: "description,image,content",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), this.config.timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    try {
      res = await (this.config.fetchImpl ?? fetch)(`${this.config.endpoint ?? GNEWS_ENDPOINT}?${params}`, {
        headers: { "X-Api-Key": this.config.apiKey, Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      if (controller.signal.reason instanceof DOMException && controller.signal.reason.name === "TimeoutError") {
        throw new NewsProviderError("TIMEOUT", `GNews did not respond within ${this.config.timeoutMs / 1000} s.`);
      }
      throw new NewsProviderError("PROVIDER_UNAVAILABLE", "GNews could not be reached.");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw this.httpError(res.status, body);

    const parsed = gnewsResponseSchema.safeParse(body);
    if (!parsed.success) throw new NewsProviderError("INVALID_RESPONSE", "GNews returned an unexpected response shape.");
    const { articles, invalid } = parseGNewsArticles(parsed.data.articles);
    return { articles, invalid, totalMatches: parsed.data.totalArticles ?? null };
  }

  private httpError(status: number, body: unknown): NewsProviderError {
    // Provider messages are short and contain no secrets; still, never echo request URLs.
    const errors = (body as { errors?: unknown } | null)?.errors;
    const detail = Array.isArray(errors) ? String(errors[0] ?? "") : errors && typeof errors === "object" ? Object.values(errors).map(String).join("; ") : "";
    const now = this.now();
    let e: NewsProviderError;
    switch (status) {
      case 403:
        e = new NewsProviderError("QUOTA_EXHAUSTED", "Daily GNews request limit reached; resets at 00:00 UTC.", nextUtcMidnight(now));
        this.used.count = this.config.dailyBudget;
        break;
      case 429:
        e = new NewsProviderError("RATE_LIMITED", "GNews rate limit reached (free plan: 1 request per second).", now + 5_000);
        break;
      case 401:
        e = new NewsProviderError("PROVIDER_AUTH", "GNews rejected the API key. Check GNEWS_API_KEY.", now + 10 * 60_000);
        break;
      case 400:
        return new NewsProviderError("BAD_REQUEST", `GNews rejected the request${detail ? `: ${detail.slice(0, 160)}` : "."}`);
      default:
        e = new NewsProviderError("PROVIDER_UNAVAILABLE", `GNews is unavailable (HTTP ${status}).`, now + 30_000);
    }
    this.blockedUntil = e.blockedUntil ?? 0;
    this.blockReason = e;
    return e;
  }
}
