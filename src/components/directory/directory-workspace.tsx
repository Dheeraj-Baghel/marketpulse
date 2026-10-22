"use client";

import { Columns3, SearchX } from "lucide-react";
import { useRef, useState } from "react";
import type { ChartMode, ChartRange } from "@/lib/charts/candles";
import type { DirectoryPage, SegmentFilter as Filter } from "@/lib/directory/queries";
import { formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CompanyTable, rowKey } from "./company-table";
import { useDirectoryNavigation } from "./directory-navigation";
import { Pagination } from "./pagination";
import { SegmentFilter } from "./segment-filter";
import { SelectedCompanyPanel } from "./selected-company-panel";

interface Props {
  page: DirectoryPage;
  query: string;
  segment: Filter;
  initialSelected: string | null;
  quotes: { enabled: boolean; autoRefreshMs: number };
}

/**
 * Desktop: ~40% directory / ~60% research area. Below lg the two stack, table
 * first; selecting a row on a narrow screen scrolls the preview into view.
 */
export function DirectoryWorkspace({ page, query, segment, initialSelected, quotes }: Props) {
  const { isPending, navigate } = useDirectoryNavigation();
  const panelRef = useRef<HTMLDivElement>(null);
  // ISIN is an optional column (always shown in the preview panel and details page).
  const [showIsin, setShowIsin] = useState(false);
  // Chart preferences survive company switches (and new result pages).
  const [chartRange, setChartRange] = useState<ChartRange>("1Y");
  const [chartMode, setChartMode] = useState<ChartMode>("candles");

  const fallbackKey = page.rows[0] ? rowKey(page.rows[0]) : null;
  const [selectedKey, setSelectedKey] = useState<string | null>(
    initialSelected && page.rows.some((r) => rowKey(r) === initialSelected) ? initialSelected : fallbackKey,
  );
  // New page of results: reset selection to the URL choice or the first row.
  const [rowsSeen, setRowsSeen] = useState(page.rows);
  if (rowsSeen !== page.rows) {
    setRowsSeen(page.rows);
    setSelectedKey(initialSelected && page.rows.some((r) => rowKey(r) === initialSelected) ? initialSelected : fallbackKey);
  }

  const selectedRow = page.rows.find((r) => rowKey(r) === selectedKey) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section
        aria-labelledby="directory-heading"
        className={cn("flex min-w-0 flex-col rounded-lg border border-line bg-panel transition-opacity", isPending && "opacity-60")}
        aria-busy={isPending}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <h2 id="directory-heading" className="text-[13px] font-semibold tracking-tight">
              Company directory
            </h2>
            <span className="font-mono text-[11px] tabular text-fg-muted">{formatInt(page.total)}</span>
          </div>
          <div className="flex items-center gap-2">
            <SegmentFilter value={segment} />
            <button
              type="button"
              aria-pressed={showIsin}
              onClick={() => setShowIsin((v) => !v)}
              title={showIsin ? "Hide ISIN column" : "Show ISIN column"}
              className={cn(
                "hidden h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 md:inline-flex",
                showIsin ? "border-accent/30 bg-accent/10 text-accent" : "border-line text-fg-muted hover:text-fg",
              )}
            >
              <Columns3 className="size-3.5" aria-hidden="true" />
              ISIN
            </button>
          </div>
        </div>

        {page.rows.length > 0 ? (
          <>
            <div className="min-h-0 flex-1 overflow-x-hidden">
              <CompanyTable
                rows={page.rows}
                selectedKey={selectedKey}
                showIsin={showIsin}
                query={query}
                onSelect={(row) => {
                  const key = rowKey(row);
                  setSelectedKey(key);
                  // Persist selection in the URL without a server round trip.
                  const url = new URL(window.location.href);
                  url.searchParams.set("selected", key);
                  window.history.replaceState(window.history.state, "", url);
                  if (window.matchMedia("(max-width: 1023px)").matches) {
                    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
              />
            </div>
            <Pagination page={page.page} pageCount={page.pageCount} total={page.total} pageSize={page.pageSize} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
            <SearchX className="size-6 text-fg-muted" aria-hidden="true" />
            <p className="mt-3 text-sm font-medium">No securities match &ldquo;{query}&rdquo;</p>
            <p className="mt-1 max-w-xs text-xs text-fg-muted">
              Search matches part of a company name, NSE symbol or ISIN{segment !== "ALL" ? " within the selected segment" : ""}.
            </p>
            {segment !== "ALL" ? (
              <button
                type="button"
                onClick={() => navigate({ segment: null })}
                className="mt-4 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-fg hover:bg-line/50 focus-visible:outline-2"
              >
                Search all segments
              </button>
            ) : null}
          </div>
        )}
      </section>

      <div ref={panelRef} className="min-w-0 scroll-mt-16 lg:sticky lg:top-[4.5rem] lg:flex lg:h-[calc(100dvh-5.5rem)] lg:min-h-[36rem] lg:flex-col [&>section]:lg:flex-1">
        <SelectedCompanyPanel row={selectedRow} range={chartRange} onRangeChange={setChartRange} mode={chartMode} onModeChange={setChartMode} quotes={quotes} />
      </div>
    </div>
  );
}
