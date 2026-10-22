import { ColorType, CrosshairMode, LineStyle, TickMarkType, type DeepPartial, type ChartOptions, type Time } from "lightweight-charts";
import { formatAxisPrice, formatCompactVolume, formatSessionDate, timeToIso } from "@/lib/charts/candles";

/** Stage 2B chart palette (from the brief). */
export const CHART_COLORS = {
  bullish: "#39D6A3",
  bearish: "#F07178",
  background: "#0B111B",
  grid: "#223145",
  text: "#A2B4C7",
  line: "#5DD6B5",
  crosshair: "#4B5F78",
  volumeBullish: "rgba(57, 214, 163, 0.45)",
  volumeBearish: "rgba(240, 113, 120, 0.45)",
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function baseChartOptions(): DeepPartial<ChartOptions> {
  return {
    autoSize: true, // ResizeObserver-driven, per the v5 docs
    layout: {
      background: { type: ColorType.Solid, color: CHART_COLORS.background },
      textColor: CHART_COLORS.text,
      fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: 11,
      attributionLogo: true,
      panes: { separatorColor: CHART_COLORS.grid, separatorHoverColor: "rgba(93, 214, 181, 0.25)", enableResize: false },
    },
    grid: {
      vertLines: { color: CHART_COLORS.grid, style: LineStyle.Solid },
      horzLines: { color: CHART_COLORS.grid, style: LineStyle.Solid },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: CHART_COLORS.crosshair, labelBackgroundColor: "#1B2A3D" },
      horzLine: { color: CHART_COLORS.crosshair, labelBackgroundColor: "#1B2A3D" },
    },
    rightPriceScale: { borderColor: CHART_COLORS.grid, scaleMargins: { top: 0.08, bottom: 0.06 } },
    timeScale: {
      borderColor: CHART_COLORS.grid,
      rightOffset: 3,
      minBarSpacing: 2,
      fixLeftEdge: true,
      fixRightEdge: true,
      lockVisibleTimeRangeOnResize: true,
      // Business-day strings: format by string parts only, never via local Date.
      tickMarkFormatter: (time: Time, type: TickMarkType) => {
        const iso = timeToIso(time);
        if (!iso) return null;
        const [y, m, d] = iso.split("-");
        const month = MONTHS[Number(m) - 1];
        if (type === TickMarkType.Year) return y ?? null;
        if (type === TickMarkType.Month) return `${month} ${y!.slice(2)}`;
        return `${Number(d)} ${month}`;
      },
    },
    localization: {
      locale: "en-IN",
      // Price formatting is set per series (priceFormat) so the volume pane keeps its own formatter.
      timeFormatter: (time: unknown) => {
        const iso = timeToIso(time);
        return iso ? formatSessionDate(iso) : "";
      },
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } },
    kineticScroll: { touch: true, mouse: false },
  };
}

/** INR price axis: Indian digit grouping, 2 decimals (4 when the stored value has them). */
export const pricePriceFormat = {
  type: "custom" as const,
  formatter: (v: number) => formatAxisPrice(v),
  minMove: 0.01,
};

/** Volume axis: compact Indian notation (e.g. 1.8 Cr / 97 L). */
export const volumePriceFormat = {
  type: "custom" as const,
  formatter: (v: number) => formatCompactVolume(v),
  minMove: 1,
};
