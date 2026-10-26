import { ExternalLink } from "lucide-react";
import { memo } from "react";
import type { NewsArticleView } from "./use-company-news";

const istFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Absolute instant shown in IST, e.g. "22 Oct 2026, 10:29 IST". */
export function formatIst(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${istFmt.format(d)} IST`;
}

/**
 * Text-first article row: headline, publisher · time, optional summary.
 * No images (third-party copyright). The whole headline is the link; it opens
 * the ORIGINAL publisher page in a new tab with noopener/noreferrer.
 */
export const NewsCard = memo(function NewsCard({ article }: { article: NewsArticleView }) {
  let host = "";
  try {
    host = new URL(article.url).hostname.replace(/^www\./, "");
  } catch {
    host = "";
  }
  return (
    <li data-testid="news-card" data-relevance={article.relevance} className="group py-3.5 first:pt-1 last:pb-1">
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerPolicy="no-referrer"
        className="block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4"
      >
        <h3 className="flex items-start gap-1.5 text-[14px] font-medium leading-snug text-fg transition-colors group-hover:text-accent">
          <span className="min-w-0 break-words">{article.title}</span>
          <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-fg-muted/70 transition-colors group-hover:text-accent" aria-hidden="true" />
          <span className="sr-only"> (opens {article.publisher} in a new tab)</span>
        </h3>
      </a>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-fg-muted">
        <span data-testid="news-publisher" className="font-medium text-fg/80">
          {article.publisher}
        </span>
        <span aria-hidden="true">·</span>
        <time data-testid="news-time" dateTime={article.publishedAt}>
          {formatIst(article.publishedAt)}
        </time>
        {host ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="truncate">{host}</span>
          </>
        ) : null}
        {article.relevance === "likely" ? (
          <span title={article.matchReason} className="rounded border border-line px-1 py-px text-[10px] uppercase tracking-wide text-fg-muted">
            Mentions company
          </span>
        ) : null}
      </p>
      {article.description ? <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-fg-muted">{article.description}</p> : null}
    </li>
  );
});
