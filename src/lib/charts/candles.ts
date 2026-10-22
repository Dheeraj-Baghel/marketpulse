/**
 * Pure, framework-free helpers for the Stage 2B chart. No React, no chart
 * library imports, so they are unit tested directly.
 *
 * Source of truth: GET /api/prices (Stage 2A), which returns
 *   { symbol, series, name, isin, segment, currency: "INR", interval: "1d",
 *     source, dataMode: "HISTORICAL_EOD", adjustmentStatus: "UNADJUSTED",
 *     range, from, to, latestTradingDate, earliestTradingDate, count,
 *     candles: [{ date: "YYYY-MM-DD", open, high, low, close, volume|null }] }
 * with prices stored as exact 1/10,000-rupee integers and serialised as
 * plain JSON numbers (e.g. 1450.05).
 */

export const CHART_RANGES = ["1M", "3M", "6M", "1Y", "ALL"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export type ChartMode = "candles" | "line";

export interface ChartCandle {
  /** Trading session date, YYYY-MM-DD, passed to the chart as a business-day string (no timezone math). */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface PriceSeriesMeta {
  symbol: string;
  series: string;
  name: string;
  isin: string;
  source: string;
  dataMode: "HISTORICAL_EOD";
  adjustmentStatus: "UNADJUSTED";
  currency: "INR";
  earliestTradingDate: string | null;
  latestTradingDate: string | null;
}

export interface ValidatedSeries {
  meta: PriceSeriesMeta;
  candles: ChartCandle[];
  /** Candles dropped by client-side validation, with reasons (should be 0 for imported data). */
  dropped: { index: number; reason: string }[];
  hasVolume: boolean;
}

export class PriceResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceResponseError";
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  // Date.UTC is used only to check the calendar date exists; nothing is displayed from it.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const isPositive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Validates an /api/prices body before anything is rendered. Identity must
 * match what was requested: a response for another symbol or series is an
 * error, never displayed. Individual bad candles are dropped (and reported),
 * never repaired; dates must be strictly ascending and unique.
 */
export function validatePriceResponse(body: unknown, expected: { symbol: string; series: string }): ValidatedSeries {
  if (!body || typeof body !== "object") throw new PriceResponseError("Price response is not an object.");
  const b = body as Record<string, unknown>;
  if (b.symbol !== expected.symbol || b.series !== expected.series) {
    throw new PriceResponseError(
      `Price response is for ${String(b.symbol)} ${String(b.series)}, but ${expected.symbol} ${expected.series} was requested.`,
    );
  }
  if (b.dataMode !== "HISTORICAL_EOD" || b.interval !== "1d" || b.currency !== "INR") {
    throw new PriceResponseError("Price response is not daily historical INR data.");
  }
  if (!Array.isArray(b.candles)) throw new PriceResponseError("Price response has no candles array.");

  const dropped: ValidatedSeries["dropped"] = [];
  const candles: ChartCandle[] = [];
  let previous = "";
  b.candles.forEach((raw: unknown, index: number) => {
    const c = raw as Record<string, unknown> | null;
    const date = typeof c?.date === "string" ? c.date : "";
    const reason = !c
      ? "not an object"
      : !isRealDate(date)
        ? `invalid date "${date}"`
        : date <= previous
          ? `date ${date} is not after ${previous} (duplicate or unsorted)`
          : !isPositive(c.open) || !isPositive(c.high) || !isPositive(c.low) || !isPositive(c.close)
            ? "non-positive or missing OHLC value"
            : (c.high as number) < (c.low as number)
              ? "high below low"
              : (c.open as number) < (c.low as number) || (c.open as number) > (c.high as number) || (c.close as number) < (c.low as number) || (c.close as number) > (c.high as number)
                ? "open/close outside high-low range"
                : c.volume !== null && c.volume !== undefined && !(typeof c.volume === "number" && Number.isSafeInteger(c.volume) && c.volume >= 0)
                  ? "invalid volume"
                  : null;
    if (reason) {
      dropped.push({ index, reason });
      return;
    }
    previous = date;
    candles.push({
      time: date,
      open: c!.open as number,
      high: c!.high as number,
      low: c!.low as number,
      close: c!.close as number,
      volume: typeof c!.volume === "number" ? c!.volume : null,
    });
  });

  return {
    meta: {
      symbol: expected.symbol,
      series: expected.series,
      name: typeof b.name === "string" ? b.name : expected.symbol,
      isin: typeof b.isin === "string" ? b.isin : "",
      source: typeof b.source === "string" ? b.source : "Unknown source",
      dataMode: "HISTORICAL_EOD",
      adjustmentStatus: "UNADJUSTED",
      currency: "INR",
      earliestTradingDate: typeof b.earliestTradingDate === "string" ? b.earliestTradingDate : null,
      latestTradingDate: typeof b.latestTradingDate === "string" ? b.latestTradingDate : null,
    },
    candles,
    dropped,
    hasVolume: candles.some((c) => c.volume !== null),
  };
}

/** Subtracts calendar months from YYYY-MM-DD using integer arithmetic (no timezone). */
export function minusMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${String(ty).padStart(4, "0")}-${String(tm).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

const RANGE_MONTHS: Record<Exclude<ChartRange, "ALL">, number> = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12 };

/**
 * Candles for a range, anchored on the latest stored session (same rule as the
 * Stage 2A API: 1M ending 2026-10-21 starts after 2026-09-21). Never extends
 * or fills data; may legitimately return an empty array.
 */
export function sliceRange(candles: ChartCandle[], range: ChartRange): { candles: ChartCandle[]; from: string | null; to: string | null } {
  const last = candles.at(-1);
  if (!last) return { candles: [], from: null, to: null };
  if (range === "ALL") return { candles, from: candles[0]!.time, to: last.time };
  const cutoff = minusMonths(last.time, RANGE_MONTHS[range]);
  const inRange = candles.filter((c) => c.time > cutoff);
  return { candles: inRange, from: inRange[0]?.time ?? null, to: last.time };
}

export interface RangeInfo {
  /** At least one stored session falls in the window. */
  available: boolean;
  /**
   * Stored history reaches the start of the window. False means the window
   * shows less history than its label (e.g. "1Y" with only 7 months held);
   * the UI then says so instead of implying a full period.
   */
  covered: boolean;
  sessions: number;
}

export function rangeAvailability(candles: ChartCandle[]): Record<ChartRange, RangeInfo> {
  const first = candles[0]?.time;
  const last = candles.at(-1)?.time;
  const out = {} as Record<ChartRange, RangeInfo>;
  for (const r of CHART_RANGES) {
    const sessions = sliceRange(candles, r).candles.length;
    // The first stored day only proves coverage if it is on/before the window's
    // exclusive cutoff; a cutoff that falls on a weekend/holiday right before
    // the first stored session is treated as covered within 4 calendar days.
    const covered =
      r === "ALL" || !first || !last ? sessions > 0 : first <= addDays(minusMonths(last, RANGE_MONTHS[r]), 4);
    out[r] = { available: sessions > 0, covered: sessions > 0 && covered, sessions };
  }
  return out;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Change of the latest close vs the immediately previous stored session. Null if < 2 sessions. */
export function previousSessionChange(candles: ChartCandle[]): { previousDate: string; previousClose: number; abs: number; pct: number } | null {
  const last = candles.at(-1);
  const prev = candles.at(-2);
  if (!last || !prev) return null;
  // Work in paise-of-paise integers (x10^4) to avoid float drift in the difference.
  const absScaled = Math.round(last.close * 10_000) - Math.round(prev.close * 10_000);
  return { previousDate: prev.time, previousClose: prev.close, abs: absScaled / 10_000, pct: (absScaled / Math.round(prev.close * 10_000)) * 100 };
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrPrecise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 4 });
// Axis/crosshair labels are interpolated positions, not stored values: fixed 2 dp.
const plain = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat("en-IN");
const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

/** ₹1,450.05 (shows 3rd/4th decimals only when the stored value has them). */
export function formatInr(value: number): string {
  return Math.round(value * 100) === value * 100 ? inr.format(value) : inrPrecise.format(value);
}
/** 1,450.05 for the price axis (currency symbol lives in the axis label to save width). */
export function formatAxisPrice(value: number): string {
  return plain.format(value);
}
export function formatVolume(value: number | null): string {
  return value === null ? "Not reported" : intFmt.format(value);
}
export function formatCompactVolume(value: number): string {
  return compact.format(value);
}
export function formatSignedPct(pct: number): string {
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(2)}%`;
}
export function formatSignedInr(abs: number): string {
  return `${abs > 0 ? "+" : abs < 0 ? "−" : ""}${inr.format(Math.abs(abs))}`;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-10-21" -> "Wed, 21 Oct 2026" by string arithmetic only, so no timezone can shift the session date. */
export function formatSessionDate(iso: string, withWeekday = true): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const label = `${String(d).padStart(2, "0")} ${MONTH_SHORT[m - 1] ?? "?"} ${y}`;
  if (!withWeekday) return label;
  // Zeller-free weekday via UTC (date-only, no local offset involved).
  const weekday = WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${label}`;
}

/** Chart time (business-day string or object) -> "YYYY-MM-DD". */
export function timeToIso(time: unknown): string | null {
  if (typeof time === "string" && DATE_RE.test(time)) return time;
  if (time && typeof time === "object" && "year" in time && "month" in time && "day" in time) {
    const t = time as { year: number; month: number; day: number };
    return `${String(t.year).padStart(4, "0")}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
  }
  return null;
}
