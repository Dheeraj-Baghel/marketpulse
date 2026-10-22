"use client";

import { ArrowUpRight, MousePointerClick } from "lucide-react";
import Link from "next/link";
import { StockPriceChart } from "@/components/charts/StockPriceChart";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { ChartMode, ChartRange } from "@/lib/charts/candles";
import type { DirectoryRow } from "@/lib/directory/queries";
import { preferredSeries } from "@/lib/market-data/series";
import { formatIsoDate, INSTRUMENT_LABEL, SEGMENT_LABEL, SERIES_LABEL, stockHref } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props {
  row: DirectoryRow | null;
  range: ChartRange;
  onRangeChange: (r: ChartRange) => void;
  mode: ChartMode;
  onModeChange: (m: ChartMode) => void;
  quotes: { enabled: boolean; autoRefreshMs: number };
}

/**
 * Which series to chart for a directory row. Prefer one that actually has
 * imported history; otherwise the row's first series (the chart then shows
 * the explicit no-data state). Never mixes series.
 */
export function chartSeriesFor(row: DirectoryRow): string {
  return preferredSeries(row.series, row.priceHistory.map((h) => h.series)) ?? "EQ";
}

/**
 * Right-hand research area: selected security identity plus its interactive
 * historical EOD chart (Stage 2B). Company metadata stays visible whatever
 * the chart's loading/error state.
 */
export function SelectedCompanyPanel({ row, range, onRangeChange, mode, onModeChange, quotes }: Props) {
  return (
    <section aria-labelledby="selected-heading" className="flex min-h-[34rem] flex-col overflow-hidden rounded-lg border border-line bg-panel">
      {row ? (
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-semibold text-accent">{row.symbol}</span>
              <Badge variant={row.segment === "SME" ? "sme" : "default"}>{SEGMENT_LABEL[row.segment]}</Badge>
              {row.instrumentKind !== "EQUITY_SHARE" ? <Badge variant="warn">{INSTRUMENT_LABEL[row.instrumentKind]}</Badge> : null}
            </div>
            <h2 id="selected-heading" className="mt-1 text-lg font-semibold leading-snug tracking-tight text-fg text-balance">
              {row.name}
            </h2>
          </div>
          <Link href={stockHref(row.symbol)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
            Company details
            <ArrowUpRight aria-hidden="true" />
          </Link>
          <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
            <Field label="ISIN" value={row.isin} mono />
            <Field label="Series" value={row.series.join(", ")} hint={row.series.map((s) => SERIES_LABEL[s] ?? s).join("; ")} mono />
            <Field label="Segment" value={SEGMENT_LABEL[row.segment]} />
            <Field label="Listed" value={formatIsoDate(row.listingDate)} />
          </dl>
        </header>
      ) : (
        <header className="flex items-center gap-3 border-b border-line px-5 py-4 text-sm text-fg-muted">
          <MousePointerClick className="size-4 text-fg-muted" aria-hidden="true" />
          <h2 id="selected-heading">Select a company in the directory to preview it here.</h2>
        </header>
      )}

      {row ? (
        <StockPriceChart
          securityId={`${row.segment}:${row.symbol}`}
          symbol={row.symbol}
          series={chartSeriesFor(row)}
          name={row.name}
          range={range}
          onRangeChange={onRangeChange}
          mode={mode}
          onModeChange={onModeChange}
          variant="preview"
          quotes={quotes}
          className="flex-1"
        />
      ) : null}
    </section>
  );
}

function Field({ label, value, mono, hint }: { label: string; value: string; mono?: boolean; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-fg", mono && "font-mono text-[12px]")} title={hint ?? value}>
        {value}
      </dd>
    </div>
  );
}
