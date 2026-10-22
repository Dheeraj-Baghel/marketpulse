"use client";

import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import { memo, useEffect, useRef } from "react";
import { timeToIso, type ChartCandle, type ChartMode } from "@/lib/charts/candles";
import { baseChartOptions, CHART_COLORS, pricePriceFormat, volumePriceFormat } from "./chart-options";

interface Props {
  /** Already validated, ascending, de-duplicated candles for ONE security and range. */
  candles: ChartCandle[];
  /** Identity of the data (security + range). When it changes the view is refit. */
  dataKey: string;
  mode: ChartMode;
  showVolume: boolean;
  /** Incremented by the parent's "Reset view" action. */
  resetToken: number;
  /** Hovered session date, or null when the crosshair leaves the data. */
  onHover: (isoDate: string | null) => void;
  ariaLabel: string;
}

/**
 * Read-only diagnostic hook for the browser test suite: live chart instances
 * and what they actually plotted. Lets tests verify cleanup (no leaked
 * charts), identity (no stale candles) and interactions without touching
 * private library internals. Contains only already-rendered data.
 */
export interface ChartProbe {
  dataKey: string;
  mode: ChartMode;
  panes: () => number;
  candles: () => readonly { time: unknown; open?: number; high?: number; low?: number; close?: number }[];
  line: () => readonly { time: unknown; value?: number }[];
  volume: () => readonly { time: unknown; value?: number }[];
  visibleLogicalRange: () => { from: number; to: number } | null;
  candlesVisible: () => boolean;
}
type ChartRegistry = Map<IChartApi, ChartProbe>;
function registry(): ChartRegistry {
  const w = window as unknown as { __mpCharts?: ChartRegistry };
  return (w.__mpCharts ??= new Map());
}

/**
 * Thin imperative wrapper around a single lightweight-charts v5 instance.
 * Client-only (loaded via next/dynamic with ssr:false). The chart is created
 * once per mount and destroyed with chart.remove() on unmount; data, mode and
 * volume changes update series in place instead of recreating the chart.
 */
function PriceChartCanvas({ candles, dataKey, mode, showVolume, resetToken, onHover, ariaLabel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const hoverRef = useRef(onHover);
  const lastKeyRef = useRef<string | null>(null);
  /**
   * True while the view should track "fit all candles". autoSize measures the
   * container asynchronously (ResizeObserver), so a fit done at setData time
   * can use a stale width; we refit on resize until the user zooms or pans.
   */
  const autoFitRef = useRef(true);

  useEffect(() => {
    hoverRef.current = onHover;
  }, [onHover]);

  // Create once; destroy on unmount.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, baseChartOptions());
    chartRef.current = chart;

    const fit = () => chart.timeScale().fitContent();
    let frame = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (!autoFitRef.current) return; // user's zoom/pan is kept (lockVisibleTimeRangeOnResize)
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    resizeObserver.observe(container);
    // Any direct manipulation ends auto-fit until data changes or Reset view.
    const stopAutoFit = () => {
      autoFitRef.current = false;
    };
    container.addEventListener("wheel", stopAutoFit, { passive: true });
    container.addEventListener("pointerdown", stopAutoFit);
    container.addEventListener("touchstart", stopAutoFit, { passive: true });

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: CHART_COLORS.bullish,
      downColor: CHART_COLORS.bearish,
      borderUpColor: CHART_COLORS.bullish,
      borderDownColor: CHART_COLORS.bearish,
      wickUpColor: CHART_COLORS.bullish,
      wickDownColor: CHART_COLORS.bearish,
      borderVisible: true,
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: pricePriceFormat,
    });
    lineRef.current = chart.addSeries(LineSeries, {
      color: CHART_COLORS.line,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      priceFormat: pricePriceFormat,
      visible: false,
    });

    const onMove = (param: MouseEventParams<Time>) => {
      hoverRef.current(param.time !== undefined && param.point ? timeToIso(param.time) : null);
    };
    chart.subscribeCrosshairMove(onMove);
    registry().set(chart, {
      dataKey: "",
      mode: "candles",
      panes: () => chart.panes().length,
      candles: () => candleRef.current?.data() ?? [],
      line: () => lineRef.current?.data() ?? [],
      volume: () => volumeRef.current?.data() ?? [],
      visibleLogicalRange: () => chart.timeScale().getVisibleLogicalRange(),
      candlesVisible: () => candleRef.current?.options().visible ?? false,
    });

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      container.removeEventListener("wheel", stopAutoFit);
      container.removeEventListener("pointerdown", stopAutoFit);
      container.removeEventListener("touchstart", stopAutoFit);
      chart.unsubscribeCrosshairMove(onMove);
      registry().delete(chart);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      lineRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  // Data / mode / volume updates, in place.
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleRef.current;
    const lineSeries = lineRef.current;
    if (!chart || !candleSeries || !lineSeries) return;

    const candleData: CandlestickData<Time>[] = candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
    const lineData: LineData<Time>[] = candles.map((c) => ({ time: c.time, value: c.close }));
    candleSeries.setData(candleData);
    lineSeries.setData(lineData);
    candleSeries.applyOptions({ visible: mode === "candles" });
    lineSeries.applyOptions({ visible: mode === "line" });

    // Volume lives in its own pane (v5 panes API), created/removed on demand so a
    // security without volume shows no empty pane. Missing volumes stay gaps, never 0.
    const withVolume = candles.filter((c) => c.volume !== null);
    if (showVolume && withVolume.length > 0) {
      if (!volumeRef.current) {
        volumeRef.current = chart.addSeries(HistogramSeries, { priceFormat: volumePriceFormat, priceLineVisible: false, lastValueVisible: false }, 1);
        // Top margin keeps the highest volume label clear of the pane separator.
        volumeRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.3, bottom: 0 } });
      }
      const volumeData: HistogramData<Time>[] = withVolume.map((c) => ({
        time: c.time,
        value: c.volume as number,
        color: c.close >= c.open ? CHART_COLORS.volumeBullish : CHART_COLORS.volumeBearish,
      }));
      volumeRef.current.setData(volumeData);
      const panes = chart.panes();
      panes[0]?.setStretchFactor(4);
      panes[1]?.setStretchFactor(1);
    } else if (volumeRef.current) {
      chart.removeSeries(volumeRef.current);
      volumeRef.current = null;
    }

    if (lastKeyRef.current !== dataKey) {
      lastKeyRef.current = dataKey;
      autoFitRef.current = true;
      chart.timeScale().fitContent();
    }
    const probe = registry().get(chart);
    if (probe) {
      probe.dataKey = dataKey;
      probe.mode = mode;
    }
  }, [candles, dataKey, mode, showVolume]);

  // Reset view: fit all candles of the current range and restore price autoscale.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || resetToken === 0) return;
    autoFitRef.current = true;
    chart.timeScale().fitContent();
    chart.priceScale("right").applyOptions({ autoScale: true });
  }, [resetToken]);

  return <div ref={containerRef} role="img" aria-label={ariaLabel} data-testid="price-chart-canvas" className="absolute inset-0" />;
}

export default memo(PriceChartCanvas);
