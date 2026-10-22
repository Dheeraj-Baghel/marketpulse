import { z } from "zod";
import { PRICE_SCALE } from "@/db/schema";
import type { DailyCandle } from "./types";

/**
 * Validation + normalisation of NSE MCP payloads. Pure (no I/O) so it can be
 * unit-tested with recorded and malformed fixtures.
 *
 * Shapes are the ones actually returned on 22 Oct 2026 (docs/nse-mcp/FINDINGS.md).
 * Unknown extra fields are ignored; required fields missing -> rejection.
 */

const num = z.number().finite();

export const historyRowSchema = z.object({
  symbol: z.string(),
  series: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  open: num,
  high: num,
  low: num,
  close: num,
  volume: num.nullable().optional(),
});

export const historyPayloadSchema = z.object({
  symbol: z.string(),
  data: z.array(z.unknown()),
  next_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const quotePayloadSchema = z.object({
  updatedAt: z.string().optional(),
  stock: z.object({
    type: z.string().optional(),
    symbol: z.string(),
    series: z.string(),
    lastTradedPrice: num,
    preClosePrice: num.optional(),
    openPrice: num.optional(),
    highPrice: num.optional(),
    lowPrice: num.optional(),
    change: num.optional(),
    perChange: num.optional(),
    volume: num.nullable().optional(),
    latestTimestamp: z.string().optional(),
  }),
});

/**
 * Exact conversion of a provider JSON number to scaled integer units
 * (rupees x 10^4). Uses the shortest round-trip decimal string of the number,
 * so 1240.4 -> "1240.4" -> 12404000 without float multiplication drift.
 * Rejects values with more than 4 decimals instead of rounding them.
 */
export function toScaled(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const text = String(value);
  if (/e/i.test(text)) return null;
  const [int = "", frac = ""] = text.split(".");
  if (frac.length > 4) return null;
  const scaled = Number(int) * PRICE_SCALE + Number(frac.padEnd(4, "0") || "0");
  return Number.isSafeInteger(scaled) ? scaled : null;
}

const fromScaled = (s: number) => s / PRICE_SCALE;

function isRealDate(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export interface NormalizedHistory {
  candles: DailyCandle[];
  rejected: { date: string | null; reason: string }[];
  /** Rows with a different symbol/series than requested (never used). */
  foreign: number;
  duplicates: number;
}

/**
 * Turns raw `get_stock_history` rows (possibly from several chunks) into
 * validated, ascending, de-duplicated candles for exactly one symbol+series.
 * Bad rows are dropped and reported, never repaired. No gap-filling.
 */
export function normalizeHistoryRows(rows: unknown[], expected: { symbol: string; series: string }, todayIst: string): NormalizedHistory {
  const byDate = new Map<string, DailyCandle>();
  const rejected: NormalizedHistory["rejected"] = [];
  let foreign = 0;
  let duplicates = 0;
  for (const raw of rows) {
    const parsed = historyRowSchema.safeParse(raw);
    if (!parsed.success) {
      const date = (raw as { date?: unknown } | null)?.date;
      rejected.push({ date: typeof date === "string" ? date : null, reason: `malformed row (${parsed.error.issues[0]?.path.join(".") || "shape"})` });
      continue;
    }
    const r = parsed.data;
    if (r.symbol.toUpperCase() !== expected.symbol || r.series.toUpperCase() !== expected.series) {
      foreign++;
      continue;
    }
    if (!isRealDate(r.date) || r.date > todayIst) {
      rejected.push({ date: r.date, reason: "invalid or future date" });
      continue;
    }
    const o = toScaled(r.open);
    const h = toScaled(r.high);
    const l = toScaled(r.low);
    const c = toScaled(r.close);
    if (o === null || h === null || l === null || c === null) {
      rejected.push({ date: r.date, reason: "non-positive or over-precise price" });
      continue;
    }
    if (h < l || o < l || o > h || c < l || c > h) {
      rejected.push({ date: r.date, reason: "OHLC outside high-low range" });
      continue;
    }
    let volume: number | null = null;
    if (r.volume !== undefined && r.volume !== null) {
      if (!Number.isSafeInteger(r.volume) || r.volume < 0) {
        rejected.push({ date: r.date, reason: "invalid volume" });
        continue;
      }
      volume = r.volume;
    }
    const candle: DailyCandle = { date: r.date, open: fromScaled(o), high: fromScaled(h), low: fromScaled(l), close: fromScaled(c), volume };
    const prior = byDate.get(r.date);
    if (prior) {
      duplicates++;
      const same = prior.open === candle.open && prior.high === candle.high && prior.low === candle.low && prior.close === candle.close && prior.volume === candle.volume;
      if (!same) {
        // Conflicting observations for one session: trust neither.
        byDate.delete(r.date);
        rejected.push({ date: r.date, reason: "conflicting duplicate observations" });
      }
      continue;
    }
    byDate.set(r.date, candle);
  }
  const candles = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { candles, rejected, foreign, duplicates };
}

export interface DelayedQuote {
  symbol: string;
  series: string;
  segmentType: string | null;
  lastPrice: number;
  previousClose: number | null;
  /** Provider-supplied change, else computed from lastPrice - previousClose (flagged). */
  change: number | null;
  changePct: number | null;
  changeComputed: boolean;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  /** Exchange time of the last update as ISO-8601 with +05:30, or null if not supplied. */
  exchangeTimestamp: string | null;
  /** Provider's own crawl/update time (UTC ISO), if supplied. */
  providerUpdatedAt: string | null;
}

/** "2026-10-22 16:00:28" (IST, no zone in the payload) -> "2026-10-22T16:00:28+05:30". */
export function istTimestamp(raw: string | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec((raw ?? "").trim());
  if (!m || !isRealDate(m[1]!)) return null;
  const [hh, mm, ss] = [Number(m[2]), Number(m[3]), Number(m[4])];
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}+05:30`;
}

export type QuoteParse = { ok: true; quote: DelayedQuote } | { ok: false; reason: string; seriesMismatch?: string };

export function normalizeQuote(payload: unknown, expected: { symbol: string; series: string }): QuoteParse {
  const parsed = quotePayloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: `malformed quote (${parsed.error.issues[0]?.path.join(".") || "shape"})` };
  const s = parsed.data.stock;
  if (s.symbol.toUpperCase() !== expected.symbol) return { ok: false, reason: `quote is for ${s.symbol}, not ${expected.symbol}` };
  if (s.series.toUpperCase() !== expected.series) {
    return { ok: false, reason: `NSE currently quotes ${expected.symbol} in series ${s.series}, not ${expected.series}`, seriesMismatch: s.series.toUpperCase() };
  }
  const last = toScaled(s.lastTradedPrice);
  if (last === null) return { ok: false, reason: "quote has no valid last traded price" };
  const prev = s.preClosePrice !== undefined ? toScaled(s.preClosePrice) : null;
  const pos = (v: number | undefined) => (v === undefined ? null : toScaled(v) === null ? null : v);
  let change: number | null = s.change !== undefined && Number.isFinite(s.change) ? s.change : null;
  let changePct: number | null = s.perChange !== undefined && Number.isFinite(s.perChange) ? s.perChange : null;
  let changeComputed = false;
  if ((change === null || changePct === null) && prev !== null) {
    const diff = last - prev;
    if (change === null) change = diff / PRICE_SCALE;
    if (changePct === null) changePct = Math.round((diff / prev) * 10_000) / 100;
    changeComputed = true;
  }
  const volume = s.volume !== undefined && s.volume !== null && Number.isSafeInteger(s.volume) && s.volume >= 0 ? s.volume : null;
  return {
    ok: true,
    quote: {
      symbol: expected.symbol,
      series: expected.series,
      segmentType: s.type ?? null,
      lastPrice: fromScaled(last),
      previousClose: prev === null ? null : fromScaled(prev),
      change,
      changePct,
      changeComputed,
      open: pos(s.openPrice),
      high: pos(s.highPrice),
      low: pos(s.lowPrice),
      volume,
      exchangeTimestamp: istTimestamp(s.latestTimestamp),
      providerUpdatedAt: parsed.data.updatedAt && !Number.isNaN(Date.parse(parsed.data.updatedAt)) ? new Date(parsed.data.updatedAt).toISOString() : null,
    },
  };
}

export function todayIst(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
