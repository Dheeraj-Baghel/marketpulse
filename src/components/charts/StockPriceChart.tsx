"use client";

import { AlertTriangle, CandlestickChart, DatabaseBackup, LineChart, Maximize2, Minimize2, RefreshCw, RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CHART_RANGES,
  formatInr,
  formatSessionDate,
  formatSignedInr,
  formatSignedPct,
  formatVolume,
  isSessionChartRange,
  largeDiscontinuities,
  previousSessionChange,
  RANGE_SESSIONS,
  rangeAvailability,
  sliceRange,
  type ChartCandle,
  type ChartMode,
  type ChartRange,
  type ValidatedSeries,
} from "@/lib/charts/candles";
import { cn } from "@/lib/utils";
import { DelayedQuote } from "./delayed-quote";
import { useQuote } from "./use-quote";
import { securityKey, usePriceHistory } from "./use-price-history";

// The chart library touches `window`/canvas: client-only, never server-rendered.
const PriceChartCanvas = dynamic(() => import("./price-chart-canvas"), {
  ssr: false,
  loading: () => <ChartSkeleton label="Loading chart engine" />,
});

export interface StockPriceChartProps {
  /** Directory security id (for keys/diagnostics; identity checks use symbol+series). */
  securityId: number | string;
  symbol: string;
  series: string;
  /** Company name from the parent page; avoids a second identity request. */
  name: string;
  /** Optional server-validated history (details page) to skip the first fetch. */
  initialData?: ValidatedSeries | null;
  /** Controlled range/mode so the dashboard can keep them across company switches. */
  range: ChartRange;
  onRangeChange: (range: ChartRange) => void;
  mode: ChartMode;
  onModeChange: (mode: ChartMode) => void;
  /** Compact header (dashboard preview) vs full (details page). */
  variant?: "preview" | "full";
  /** Stage 2C: show the NSE CM Market delayed quote (server decides whether MCP is enabled). */
  quotes?: { enabled: boolean; autoRefreshMs: number };
  className?: string;
}

/**
 * Interactive historical EOD chart for one NSE security. Data comes only from
 * GET /api/prices (Stage 2A) and is validated before rendering. Used by both
 * the dashboard preview and /stocks/[symbol].
 */
export function StockPriceChart(props: StockPriceChartProps) {
  const { symbol, series, name, initialData, range, onRangeChange, mode, onModeChange, variant = "preview", className, quotes } = props;
  const security = useMemo(() => ({ symbol, series }), [symbol, series]);
  const key = securityKey(security);
  const initial = useMemo(() => (initialData ? { key, data: initialData } : null), [initialData, key]);
  const { view, retry, refresh: refreshHistory, isRefreshing, refreshError } = usePriceHistory(security, initial);
  // Separate request + loading state: a slow quote never blocks the chart, and vice versa.
  const { view: quoteView, refresh: refreshQuote } = useQuote(security, { enabled: quotes?.enabled ?? false, autoRefreshMs: quotes?.autoRefreshMs ?? 0 });

  const frameRef = useRef<HTMLDivElement>(null);
  const [resetToken, setResetToken] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  const allCandles = view.status === "ready" ? view.data.candles : EMPTY;
  const ranges = useMemo(() => rangeAvailability(allCandles), [allCandles]);
  const sliced = useMemo(() => sliceRange(allCandles, range), [allCandles, range]);
  const byDate = useMemo(() => new Map(sliced.candles.map((c, i) => [c.time, { candle: c, prev: sliced.candles[i - 1] ?? null }])), [sliced]);
  const latest = allCandles.at(-1) ?? null;
  const change = useMemo(() => previousSessionChange(allCandles), [allCandles]);
  const hasVolume = view.status === "ready" && view.data.hasVolume;
  // Unadjusted data: flag (never alter) likely corporate-action jumps within the visible range.
  const jumps = useMemo(() => largeDiscontinuities(sliced.candles), [sliced]);

  // Reset hover when the security changes so no stale values show under a new name.
  const [hoverKey, setHoverKey] = useState(key);
  if (hoverKey !== key) {
    setHoverKey(key);
    setHoverDate(null);
  }

  // Full screen: native Fullscreen API where available, CSS overlay fallback (iOS Safari).
  const toggleFullscreen = useCallback(async () => {
    const el = frameRef.current;
    if (!el) return;
    if (fullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      setFullscreen(false);
      return;
    }
    setFullscreen(true);
    if (el.requestFullscreen) await el.requestFullscreen().catch(() => undefined);
  }, [fullscreen]);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    if (fullscreen) window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  const hovered = hoverDate ? byDate.get(hoverDate) ?? null : null;
  const readout = hovered ?? (sliced.candles.length ? { candle: sliced.candles.at(-1)!, prev: sliced.candles.at(-2) ?? null } : null);

  return (
    <div
      ref={frameRef}
      data-testid="stock-price-chart"
      data-symbol={symbol}
      data-series={series}
      data-status={view.status}
      data-range={range}
      data-mode={mode}
      className={cn(
        "flex min-h-0 flex-col bg-panel",
        fullscreen && "fixed inset-0 z-[60] h-dvh w-screen p-3 sm:p-5",
        className,
      )}
      aria-label={`${symbol} historical price chart`}
      role="region"
    >
      <ChartHeader symbol={symbol} series={series} name={name} variant={variant} latest={latest} change={change} view={view} />

      {quotes?.enabled ? (
        <div className="px-4 pb-2 sm:px-5">
          <DelayedQuote view={quoteView} onRefresh={refreshQuote} symbol={symbol} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-1 sm:px-5">
        <div role="group" aria-label="Time range" className="flex flex-wrap rounded-md border border-line bg-bg p-0.5">
          {CHART_RANGES.map((r) => {
            const info = ranges[r];
            const selected = r === range;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={selected}
                title={rangeTitle(r, view.status, info)}
                onClick={() => onRangeChange(r)}
                className={cn(
                  "h-7 min-w-9 rounded px-2 font-mono text-[11px] font-semibold tabular transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 sm:min-w-10",
                  selected ? "bg-panel text-fg shadow-sm ring-1 ring-line" : "text-fg-muted hover:text-fg",
                )}
              >
                {r}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <div role="group" aria-label="Chart type" className="flex rounded-md border border-line bg-bg p-0.5">
            <ModeButton active={mode === "candles"} onClick={() => onModeChange("candles")} label="Candlestick" icon={CandlestickChart} />
            <ModeButton active={mode === "line"} onClick={() => onModeChange("line")} label="Line" icon={LineChart} />
          </div>
          <IconButton label="Reset view" onClick={() => setResetToken((t) => t + 1)} disabled={view.status !== "ready" || sliced.candles.length === 0}>
            <RotateCcw />
          </IconButton>
          <IconButton
            label={isRefreshing ? "Refreshing historical data" : "Refresh historical data"}
            onClick={refreshHistory}
            disabled={isRefreshing || view.status === "loading" || view.status === "idle"}
          >
            <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
          </IconButton>
          <IconButton label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen} pressed={fullscreen}>
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </IconButton>
        </div>
      </div>

      <OhlcReadout readout={readout} hovering={Boolean(hovered)} hasVolume={hasVolume} status={view.status} />

      <div className={cn("relative mx-4 mb-3 min-h-[18rem] flex-1 overflow-hidden rounded-md border border-line sm:mx-5", variant === "full" && "min-h-[26rem]", fullscreen && "min-h-0")}>
        {view.status === "loading" || view.status === "idle" ? (
          <ChartSkeleton label={`Loading ${symbol} historical prices`} />
        ) : view.status === "error" ? (
          <ChartMessage tone="error" icon={AlertTriangle} title={view.error.title} body={view.error.message} action={view.error.retryable ? { label: "Retry", onClick: retry } : undefined} kind={view.error.kind} />
        ) : view.status === "empty" ? (
          <ChartMessage tone="muted" icon={DatabaseBackup} title="Historical price data is not available for this security." body={noDataBody(symbol, series, view.data.meta.fallbackReason)} kind="no-data" />
        ) : sliced.candles.length === 0 ? (
          <ChartMessage tone="muted" icon={DatabaseBackup} title={`No stored sessions in the last ${range}.`} body={`Stored history for ${symbol} ends on ${latest ? formatSessionDate(latest.time) : "an unknown date"}. Choose ALL to see every imported session.`} kind="no-range-data" />
        ) : (
          <PriceChartCanvas
            candles={sliced.candles}
            dataKey={`${key}|${range}`}
            mode={mode}
            showVolume={hasVolume}
            resetToken={resetToken}
            onHover={setHoverDate}
            ariaLabel={`${mode === "candles" ? "Candlestick" : "Line"} chart of ${symbol} ${series} daily ${mode === "line" ? "closing prices" : "OHLC"} ${sliced.from === sliced.to ? `for ${formatSessionDate(sliced.to!, false)}` : `from ${formatSessionDate(sliced.from!, false)} to ${formatSessionDate(sliced.to!, false)}`}, ${sessionCount(sliced.candles.length)}`}
          />
        )}
      </div>

      <ChartFooter view={view} range={range} rangeInfo={ranges[range]} slicedCount={sliced.candles.length} hasVolume={hasVolume} refreshError={refreshError?.message ?? null} jumps={jumps} />
    </div>
  );
}

const EMPTY: ChartCandle[] = [];

function sessionCount(n: number): string {
  return `${n} ${n === 1 ? "session" : "sessions"}`;
}

/** Day filters are trading sessions from daily EOD data, never intraday windows. */
function rangeTitle(range: ChartRange, status: string, info: { available: boolean; covered: boolean; sessions: number }): string {
  const sessionRange = isSessionChartRange(range);
  const definition = sessionRange
    ? `Latest ${sessionCount(RANGE_SESSIONS[range])} of daily EOD data`
    : range === "ALL"
      ? "All stored daily EOD sessions"
      : `Daily EOD sessions in the last ${range}`;
  if (status !== "ready") return definition;
  if (!info.available) return `${definition}: no stored sessions`;
  if (!info.covered) return sessionRange ? `${definition}: only ${sessionCount(info.sessions)} stored` : `${definition}: stored history covers less than ${range}`;
  return `${definition}: ${sessionCount(info.sessions)}`;
}

/** Explains WHY there is no history, without implying data exists elsewhere. */
function noDataBody(symbol: string, series: string, reason: { code: string; message: string } | null): string {
  const csv = `No local CSV import exists for ${symbol} ${series} either (npm run import:prices).`;
  if (!reason || reason.code === "DISABLED") return `NSE MCP fetching is disabled and no daily prices have been imported for ${symbol} ${series}. Import an NSE security-wise historical CSV with npm run import:prices.`;
  if (reason.code === "OVERRIDE") return `Local CSV source selected and no daily prices have been imported for ${symbol} ${series}.`;
  if (reason.code === "NOT_FOUND") return `NSE Bhavcopy has no daily history for ${symbol} (for example, a very recent listing). ${csv}`;
  if (reason.code === "SERIES_MISMATCH") return `${reason.message} MarketPulse does not relabel another series' prices. ${csv}`;
  return `NSE Bhavcopy could not be reached (${reason.message}). ${csv}`;
}

const ChartHeader = memo(function ChartHeader({
  symbol,
  series,
  name,
  variant,
  latest,
  change,
  view,
}: {
  symbol: string;
  series: string;
  name: string;
  variant: "preview" | "full";
  latest: ChartCandle | null;
  change: ReturnType<typeof previousSessionChange>;
  view: ReturnType<typeof usePriceHistory>["view"];
}) {
  const Heading = variant === "full" ? "h2" : "h3";
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 pb-2 pt-3 sm:px-5">
      <div className="min-w-0">
        <Heading className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold tracking-tight text-fg">
          <span className="font-mono text-accent">{symbol}</span>
          <span className="text-fg-muted">—</span>
          <span className="truncate">{name}</span>
          <span className="font-mono text-[11px] font-medium text-fg-muted">{series}</span>
        </Heading>
        <div data-testid="chart-summary" className="mt-1 min-h-[2.25rem] text-xs">
          {view.status === "ready" && latest ? (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2 text-fg-muted">
                <span>Historical close</span>
                <span data-testid="latest-close" className="font-mono text-[15px] font-semibold tabular text-fg">
                  {formatInr(latest.close)}
                </span>
                <span>
                  · <time dateTime={latest.time} data-testid="latest-date">{formatSessionDate(latest.time)}</time>
                </span>
              </p>
              {change ? (
                <p data-testid="session-change" className="mt-0.5 text-fg-muted">
                  Change vs previous available session ({formatSessionDate(change.previousDate, false)}):{" "}
                  <span className={cn("whitespace-nowrap font-mono tabular font-medium", change.abs > 0 ? "text-[#39D6A3]" : change.abs < 0 ? "text-[#F07178]" : "text-fg")}>
                    {formatSignedInr(change.abs)} ({formatSignedPct(change.pct)})
                  </span>
                </p>
              ) : null}
            </>
          ) : view.status === "loading" ? (
            <Skeleton className="h-4 w-56" />
          ) : (
            <p className="text-fg-muted">{view.status === "empty" ? "No historical price data" : view.status === "error" ? "Price data unavailable" : ""}</p>
          )}
        </div>
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 sm:shrink-0 sm:flex-col sm:items-end">
        <span data-testid="eod-badge" className="shrink-0 rounded border border-amber-300/30 bg-amber-300/[0.08] px-1.5 py-px font-mono text-[10px] font-semibold tracking-[0.12em] text-amber-200">
          HISTORICAL EOD
        </span>
        {view.status === "ready" ? (
          <span data-testid="source-badge" data-source={view.data.meta.sourceId} className="min-w-0 text-[10.5px] text-fg-muted">
            Source: <span className="text-fg">{view.data.meta.sourceLabel}</span> · Unadjusted
            {view.data.meta.isStale ? <span className="text-amber-200"> · fallback</span> : null}
          </span>
        ) : null}
      </div>
    </div>
  );
});

function OhlcReadout({
  readout,
  hovering,
  hasVolume,
  status,
}: {
  readout: { candle: ChartCandle; prev: ChartCandle | null } | null;
  hovering: boolean;
  hasVolume: boolean;
  status: string;
}) {
  if (status !== "ready" || !readout) return <div className="h-[1.375rem]" aria-hidden="true" />;
  const c = readout.candle;
  const up = c.close >= c.open;
  return (
    <dl
      data-testid="ohlc-readout"
      data-date={c.time}
      data-hovering={hovering}
      className="flex min-h-[1.375rem] flex-wrap items-center gap-x-3 gap-y-0.5 px-4 pb-1.5 font-mono text-[11px] tabular sm:px-5"
    >
      <div className="flex gap-1 text-fg-muted">
        <dt className="sr-only">Date</dt>
        <dd>
          <time dateTime={c.time}>{formatSessionDate(c.time)}</time>
          {hovering ? "" : <span className="font-sans"> (latest)</span>}
        </dd>
      </div>
      {(
        [
          ["O", "Open", c.open],
          ["H", "High", c.high],
          ["L", "Low", c.low],
          ["C", "Close", c.close],
        ] as const
      ).map(([abbr, label, value]) => (
        <div key={abbr} className="flex gap-1">
          <dt className="text-fg-muted" title={label}>
            {abbr}
            <span className="sr-only">{label.slice(1)}</span>
          </dt>
          <dd data-field={label.toLowerCase()} className={up ? "text-[#39D6A3]" : "text-[#F07178]"}>
            {formatInr(value)}
          </dd>
        </div>
      ))}
      <div className="flex gap-1">
        <dt className="text-fg-muted">Vol</dt>
        <dd data-field="volume" className="text-fg">
          {hasVolume ? formatVolume(c.volume) : "Not reported"}
        </dd>
      </div>
    </dl>
  );
}

function ChartFooter({
  view,
  range,
  rangeInfo,
  slicedCount,
  hasVolume,
  refreshError,
  jumps,
}: {
  view: ReturnType<typeof usePriceHistory>["view"];
  range: ChartRange;
  rangeInfo: { available: boolean; covered: boolean; sessions: number };
  slicedCount: number;
  hasVolume: boolean;
  refreshError: string | null;
  jumps: { from: string; to: string; changePct: number }[];
}) {
  if (view.status !== "ready" && view.status !== "empty") return null;
  const meta = view.data.meta;
  if (view.status === "empty") {
    return meta.fallbackReason && meta.fallbackReason.code !== "DISABLED" ? (
      <p data-testid="chart-footer" className="px-4 pb-3 text-[10.5px] text-fg-muted sm:px-5">
        <span data-testid="fallback-reason">NSE Bhavcopy: {meta.fallbackReason.message}</span>
      </p>
    ) : null;
  }
  const { earliestTradingDate, latestTradingDate } = meta;
  const mcp = meta.sourceId === "nse-bhavcopy-mcp";
  return (
    <p data-testid="chart-footer" className="flex flex-wrap gap-x-3 gap-y-0.5 px-4 pb-3 text-[10.5px] text-fg-muted sm:px-5">
      <span>
        Daily end-of-day, INR, not adjusted for corporate actions. {mcp ? "Loaded from NSE Bhavcopy" : "Stored history"}:{" "}
        {earliestTradingDate ? formatSessionDate(earliestTradingDate, false) : "?"} – {latestTradingDate ? formatSessionDate(latestTradingDate, false) : "?"} ({view.data.candles.length} sessions).
      </span>
      {mcp && meta.provider ? (
        <span data-testid="provider-freshness">
          Fetched {new Date(meta.provider.fetchedAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })} IST
          {meta.provider.cached ? " (cached)" : ""}; not stored on this device.
          {meta.provider.complete ? "" : " Older history loads on demand."}
        </span>
      ) : null}
      {mcp && meta.provider && meta.provider.excludedOtherSeriesRows > 0 ? (
        <span data-testid="other-series-note">
          {meta.provider.excludedOtherSeriesRows} session(s) where NSE returned only {meta.provider.otherSeries.join("/")} rows are not shown as {meta.series}.
        </span>
      ) : null}
      {meta.fallbackReason && meta.fallbackReason.code !== "DISABLED" && meta.fallbackReason.code !== "OVERRIDE" ? (
        <span data-testid="fallback-reason" className="text-amber-200">
          NSE Bhavcopy unavailable ({meta.fallbackReason.message}); showing local CSV.
        </span>
      ) : null}
      {jumps.length > 0 ? (
        <span data-testid="discontinuity-note" className="text-amber-200">
          Unadjusted prices: {jumps.map((j) => `${j.changePct > 0 ? "+" : ""}${j.changePct}% between ${formatSessionDate(j.from, false)} and ${formatSessionDate(j.to, false)}`).join("; ")} may reflect a split or bonus issue, not a market move.
        </span>
      ) : null}
      {refreshError ? (
        <span data-testid="refresh-error" className="text-amber-200">
          Refresh failed: {refreshError}
        </span>
      ) : null}
      {range !== "ALL" && rangeInfo.available && !rangeInfo.covered ? (
        <span data-testid="range-partial" className="text-amber-200">
          {range} shows {sessionCount(slicedCount)}: available history is shorter than {range}.
        </span>
      ) : null}
      {isSessionChartRange(range) && slicedCount > 0 ? (
        <span data-testid="session-range-note">
          {range} = latest {sessionCount(RANGE_SESSIONS[range])} of daily EOD data, not intraday prices.
        </span>
      ) : null}
      {!hasVolume ? <span data-testid="volume-missing">Volume not reported by the source; volume pane hidden.</span> : null}
      {view.data.dropped.length > 0 ? <span className="text-amber-200">{view.data.dropped.length} invalid candle(s) excluded.</span> : null}
    </p>
  );
}

function ModeButton({ active, onClick, label, icon: Icon }: { active: boolean; onClick: () => void; label: string; icon: typeof LineChart }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1",
        active ? "bg-panel text-fg shadow-sm ring-1 ring-line" : "text-fg-muted hover:text-fg",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </button>
  );
}

function IconButton({ label, onClick, children, disabled, pressed }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className="grid size-8 place-items-center rounded-md border border-line bg-bg text-fg-muted transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

function ChartSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} data-testid="chart-loading" className="absolute inset-0 flex flex-col gap-3 bg-panel p-4">
      <div className="flex flex-1 items-end gap-1.5 opacity-60" aria-hidden="true">
        {/* Neutral shimmer blocks of equal height steps: deliberately not price-shaped. */}
        {Array.from({ length: 28 }, (_, i) => (
          <Skeleton key={i} className="flex-1" style={{ height: "55%" }} />
        ))}
      </div>
      <Skeleton className="h-10 w-full opacity-60" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

function ChartMessage({
  tone,
  icon: Icon,
  title,
  body,
  action,
  kind,
}: {
  tone: "error" | "muted";
  icon: typeof AlertTriangle;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
  kind: string;
}) {
  return (
    <div data-testid="chart-message" data-kind={kind} role={tone === "error" ? "alert" : "status"} className="absolute inset-0 grid place-items-center bg-panel chart-grid px-6 text-center">
      <div className="max-w-sm">
        <span className={cn("mx-auto grid size-10 place-items-center rounded-full border bg-bg/80", tone === "error" ? "border-red-400/30" : "border-line")}>
          <Icon className={cn("size-5", tone === "error" ? "text-red-300" : "text-fg-muted")} aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-medium text-fg">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{body}</p>
        {action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-xs font-medium text-fg hover:bg-line/50 focus-visible:outline-2"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}
