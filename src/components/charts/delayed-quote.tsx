"use client";

import { AlertTriangle, Clock3, RefreshCw } from "lucide-react";
import { memo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatInr, formatSignedInr, formatSignedPct } from "@/lib/charts/candles";
import { cn } from "@/lib/utils";
import type { QuoteView } from "./use-quote";

const istFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** "2026-10-22T16:00:28+05:30" -> "22 Oct 2026, 16:00:28 IST" (absolute instant, shown in IST). */
export function formatIstTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${istFmt.format(d)} IST`;
}

/**
 * Delayed NSE CM Market quote, shown separately from the daily candles.
 * Only provider-supplied fields (or values safely computed from them, which
 * are flagged) are displayed. Never presented as live.
 */
export const DelayedQuote = memo(function DelayedQuote({ view, onRefresh, symbol }: { view: QuoteView; onRefresh: () => void; symbol: string }) {
  if (view.status === "idle") return null;

  const refreshButton = (busy: boolean) => (
    <button
      type="button"
      onClick={onRefresh}
      disabled={busy}
      aria-label={`Refresh ${symbol} delayed quote`}
      title="Refresh delayed quote"
      className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-bg text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 disabled:opacity-40 [&_svg]:size-3.5"
    >
      <RefreshCw className={busy ? "animate-spin" : undefined} aria-hidden="true" />
    </button>
  );

  if (view.status === "loading") {
    return (
      <div data-testid="delayed-quote" data-status="loading" role="status" aria-label={`Loading ${symbol} delayed quote`} className="flex items-center gap-3 rounded-md border border-line bg-bg/50 px-3 py-2">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3.5 w-40" />
      </div>
    );
  }

  if (view.status === "error") {
    return (
      <div data-testid="delayed-quote" data-status="error" data-code={view.code ?? ""} role="status" className="flex items-center justify-between gap-3 rounded-md border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2 text-xs">
        <p className="flex min-w-0 items-center gap-2 text-amber-100">
          <AlertTriangle className="size-3.5 shrink-0 text-amber-300" aria-hidden="true" />
          <span className="min-w-0">
            <span className="font-medium">Delayed quote unavailable.</span> <span className="text-fg-muted">{view.message}</span>
          </span>
        </p>
        {view.retryable ? refreshButton(false) : null}
      </div>
    );
  }

  const { data, refreshing } = view;
  const q = data.quote;
  if (!q) {
    return (
      <div data-testid="delayed-quote" data-status="unavailable" data-source={data.sourceId} role="status" className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg/50 px-3 py-2 text-xs">
        <p className="min-w-0 text-fg-muted">
          <span className="font-medium text-fg">Delayed quote unavailable.</span> {data.unavailableReason}
        </p>
        {data.sourceId === "unavailable" && /disabled/i.test(data.unavailableReason ?? "") ? null : refreshButton(refreshing)}
      </div>
    );
  }

  const up = (q.change ?? 0) > 0;
  const down = (q.change ?? 0) < 0;
  return (
    <div
      data-testid="delayed-quote"
      data-status={data.isStale ? "stale" : "ready"}
      data-source={data.sourceId}
      className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-md border px-3 py-2", data.isStale ? "border-amber-400/30 bg-amber-400/[0.05]" : "border-line bg-bg/50")}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span data-testid="quote-price" className="font-mono text-[17px] font-semibold tabular text-fg">
          {formatInr(q.lastPrice)}
        </span>
        {q.change !== null && q.changePct !== null ? (
          <span
            data-testid="quote-change"
            title={q.changeComputed ? "Computed from NSE last price and previous close" : "As reported by NSE"}
            className={cn("whitespace-nowrap font-mono text-xs font-medium tabular", up ? "text-[#39D6A3]" : down ? "text-[#F07178]" : "text-fg")}
          >
            {formatSignedInr(q.change)} · {formatSignedPct(q.changePct)}
            {q.changeComputed ? "*" : ""}
          </span>
        ) : null}
        <span data-testid="quote-source" className={cn("rounded border px-1.5 py-px font-mono text-[10px] font-semibold tracking-wide", data.isStale ? "border-amber-300/40 text-amber-200" : "border-sky-300/30 bg-sky-300/[0.07] text-sky-200")}>
          {data.isStale ? "CACHED — STALE" : "NSE CM MARKET · DELAYED"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <p className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <Clock3 className="size-3.5" aria-hidden="true" />
          {q.exchangeTimestamp ? (
            <span>
              Last market update: <time data-testid="quote-timestamp" dateTime={q.exchangeTimestamp} className="text-fg">{formatIstTimestamp(q.exchangeTimestamp)}</time>
              {data.marketSession === "closed" ? <span data-testid="market-closed"> · market closed</span> : null}
            </span>
          ) : (
            <span data-testid="quote-timestamp-missing">Exchange timestamp not provided</span>
          )}
        </p>
        {refreshButton(refreshing)}
      </div>
      {data.isStale && data.unavailableReason ? <p className="w-full text-[11px] text-amber-200">Showing the last quote received. {data.unavailableReason}</p> : null}
    </div>
  );
});
