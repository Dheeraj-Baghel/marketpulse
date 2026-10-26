"use client";

import { Clock3, RefreshCw } from "lucide-react";
import { NewsCard, formatIst } from "./NewsCard";
import { NewsEmptyState, type NewsMessageKind } from "./NewsEmptyState";
import { NewsSkeleton } from "./NewsSkeleton";
import { useCompanyNews, type NewsData } from "./use-company-news";
import { cn } from "@/lib/utils";

/**
 * "Recent News" section of /stocks/[symbol] (Stage 3). Loads independently of
 * the chart and quote (its own request and loading state), so a news failure
 * never affects market data.
 */
export function CompanyNews({ symbol, companyName }: { symbol: string; companyName: string }) {
  const { view, refresh, retry } = useCompanyNews(symbol);
  const data = view.status === "ready" ? view.data : null;
  const busy = view.status === "loading" || (view.status === "ready" && view.refreshing);
  const blocked = data && (data.state === "quota-exhausted" || data.state === "rate-limited" || data.state === "not-configured");

  return (
    <section aria-labelledby="news-heading" data-testid="company-news" data-symbol={symbol} data-state={view.status === "ready" ? view.data.state : view.status} className="rounded-lg border border-line bg-panel">
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id="news-heading" className="text-[15px] font-semibold tracking-tight text-fg">
            Recent News
          </h2>
          <p className="text-xs text-fg-muted">
            Articles from the past {data?.windowDays ?? 14} days about <span className="text-fg/80">{companyName}</span>
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <StatusLine data={data} loading={view.status === "loading"} />
          <button
            type="button"
            onClick={refresh}
            disabled={busy || Boolean(blocked)}
            aria-label="Refresh news"
            title={blocked ? "Refresh unavailable (provider not configured or limit reached)" : "Refresh news"}
            className="grid size-8 place-items-center rounded-md border border-line bg-bg text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-3.5"
          >
            <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="px-4 sm:px-5">
        {view.status === "loading" ? (
          <NewsSkeleton />
        ) : view.status === "error" ? (
          <NewsEmptyState kind="error" detail={view.message} onRetry={retry} />
        ) : (
          <Body data={view.data} onRetry={retry} />
        )}
      </div>

      <footer className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 text-[11px] text-fg-muted sm:px-5">
        <span data-testid="news-delay-note">News availability may be delayed by approximately {data?.providerDelayHours || 12} hours on the free provider.</span>
        {data && data.articles.length > 0 && data.totalMatches !== null && data.totalMatches > data.retrievedCount ? (
          <span data-testid="news-limit-note">
            Showing up to {data.maxPerRequest} retrieved results; the provider reported {data.totalMatches.toLocaleString("en-IN")} matches, and the free tier limits
            each request.
          </span>
        ) : null}
        {data?.attribution ? <span>{data.attribution}</span> : null}
      </footer>
    </section>
  );
}

function Body({ data, onRetry }: { data: NewsData; onRetry: () => void }) {
  const showArticles = data.articles.length > 0 && (data.state === "ok" || data.state === "stale");
  const banner: NewsMessageKind | null = data.state === "stale" ? (data.staleReason ?? "unavailable") : null;
  return (
    <>
      {banner ? (
        <p data-testid="news-stale-banner" role="status" className="mt-3 rounded-md border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2 text-xs text-amber-100">
          {banner === "quota-exhausted"
            ? "Daily news API limit reached. Previously retrieved articles are shown where available."
            : banner === "rate-limited"
              ? "News refresh is temporarily unavailable because the provider limit has been reached."
              : "Unable to fetch recent news. Showing previously retrieved articles."}
          {data.fetchedAt ? <span className="text-fg-muted"> Last checked: {formatIst(data.fetchedAt)}.</span> : null}
        </p>
      ) : null}
      {showArticles ? (
        <ul data-testid="news-list" className="divide-y divide-line/70">
          {data.articles.map((a) => (
            <NewsCard key={a.id} article={a} />
          ))}
        </ul>
      ) : data.state === "ok" || data.state === "empty" || data.state === "stale" ? (
        <NewsEmptyState kind="empty" windowDays={data.windowDays} />
      ) : (
        <NewsEmptyState
          kind={data.state}
          detail={data.retryAfter ? `${data.message ?? ""} Next attempt after ${formatIst(data.retryAfter)}.` : data.message}
          onRetry={data.state === "unavailable" ? onRetry : undefined}
        />
      )}
    </>
  );
}

function StatusLine({ data, loading }: { data: NewsData | null; loading: boolean }) {
  if (loading) return <span className="text-[11px] text-fg-muted">Checking news…</span>;
  if (!data) return null;
  const label =
    data.state === "not-configured"
      ? "Not configured"
      : data.state === "stale"
        ? "Cached — stale"
        : data.state === "quota-exhausted" || data.state === "rate-limited"
          ? "Limit reached"
          : data.state === "unavailable"
            ? "Unavailable"
            : data.cached
              ? "Cached"
              : "Fetched";
  return (
    <span data-testid="news-status" className="flex items-center gap-1.5 text-[11px] text-fg-muted">
      <span className={cn("rounded border px-1.5 py-px font-mono text-[10px] font-semibold tracking-wide", data.state === "stale" || data.state === "quota-exhausted" || data.state === "rate-limited" || data.state === "not-configured" ? "border-amber-300/40 text-amber-200" : data.state === "unavailable" ? "border-red-400/40 text-red-200" : "border-sky-300/30 bg-sky-300/[0.07] text-sky-200")}>
        {data.provider || "News"} · {label}
      </span>
      {data.fetchedAt ? (
        <span className="hidden items-center gap-1 sm:inline-flex">
          <Clock3 className="size-3" aria-hidden="true" />
          Last checked <time data-testid="news-fetched-at" dateTime={data.fetchedAt}>{formatIst(data.fetchedAt)}</time>
        </span>
      ) : null}
    </span>
  );
}
