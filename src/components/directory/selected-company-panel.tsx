import { ArrowUpRight, Database, DatabaseBackup, LineChart, MousePointerClick } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import type { DirectoryRow } from "@/lib/directory/queries";
import { formatIsoDate, INSTRUMENT_LABEL, SEGMENT_LABEL, SERIES_LABEL, stockHref } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Right-hand research area: selected security identity plus the reserved
 * chart canvas. Stage 1 has no price provider, so the canvas states that
 * explicitly and renders no lines, prices or percentages.
 */
export function SelectedCompanyPanel({ row }: { row: DirectoryRow | null }) {
  return (
    <section aria-labelledby="selected-heading" aria-live="polite" className="flex min-h-[26rem] flex-col rounded-lg border border-line bg-panel">
      {row ? (
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] font-semibold text-accent">{row.symbol}</span>
              <Badge variant={row.segment === "SME" ? "sme" : "default"}>{SEGMENT_LABEL[row.segment]}</Badge>
              {row.instrumentKind !== "EQUITY_SHARE" ? <Badge variant="warn">{INSTRUMENT_LABEL[row.instrumentKind]}</Badge> : null}
            </div>
            <h2 id="selected-heading" className="mt-1.5 text-lg font-semibold leading-snug tracking-tight text-fg text-balance sm:text-xl">
              {row.name}
            </h2>
          </div>
          <Link href={stockHref(row.symbol)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
            Company details
            <ArrowUpRight aria-hidden="true" />
          </Link>
          <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
            <Field label="ISIN" value={row.isin} mono />
            <Field
              label="Series"
              value={row.series.join(", ")}
              hint={row.series.map((s) => SERIES_LABEL[s] ?? s).join("; ")}
              mono
            />
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

      <div className="relative m-4 flex flex-1 items-center justify-center overflow-hidden rounded-md border border-dashed border-line chart-grid">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-panel/30 via-panel/70 to-panel/30" aria-hidden="true" />
        <div className="relative max-w-sm px-6 text-center">
          <span className="mx-auto grid size-10 place-items-center rounded-full border border-line bg-bg/70">
            <LineChart className="size-5 text-fg-muted" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-medium text-fg">Price chart not configured yet</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            Charts arrive in a later stage. No prices or price movements are shown here.
          </p>
          {row ? <PriceDataStatus row={row} /> : null}
        </div>
      </div>
    </section>
  );
}

/** Factual availability of imported end-of-day history. Dates only, never prices. */
export function PriceDataStatus({ row }: { row: DirectoryRow }) {
  const history = row.priceHistory;
  if (history.length === 0) {
    return (
      <p data-testid="price-data-status" className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-line bg-bg/60 px-2.5 py-1 text-[11.5px] text-fg-muted">
        <DatabaseBackup className="size-3.5" aria-hidden="true" />
        Historical price data not available
      </p>
    );
  }
  const showSeries = history.length > 1 || row.series.length > 1;
  return (
    <div data-testid="price-data-status" className="mt-4 flex flex-col items-center gap-1">
      {history.map((h) => (
        <p key={h.series} className="inline-flex items-center gap-1.5 rounded-md border border-accent/25 bg-accent/[0.06] px-2.5 py-1 text-[11.5px] text-fg">
          <Database className="size-3.5 text-accent" aria-hidden="true" />
          <span>
            Historical price data available{showSeries ? ` (${h.series})` : ""} — latest trading date:{" "}
            <time dateTime={h.latestTradingDate} className="font-medium">
              {formatIsoDate(h.latestTradingDate)}
            </time>
          </span>
        </p>
      ))}
    </div>
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
