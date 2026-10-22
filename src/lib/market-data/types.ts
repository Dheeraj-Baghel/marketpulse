/**
 * Market-data abstraction. Stage 2A supports only end-of-day historical
 * candles. Stage 2B charts consume `HistoricalPriceProvider`; a future vendor
 * would add another implementation without changing the API or UI.
 *
 * Deliberately absent: live quotes, intraday intervals, streaming.
 */

export type DataMode = "HISTORICAL_EOD";
export type CandleInterval = "1d";

/** One trading day. Prices in INR (rupees), exact to 4 decimals; volume in shares. */
export interface DailyCandle {
  /** Exchange trading date, YYYY-MM-DD (Asia/Kolkata calendar). */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  /** null when the source did not report volume. */
  volume: number | null;
}

export interface HistoricalCandleResult {
  securityId: string;
  currency: "INR";
  interval: CandleInterval;
  dataMode: DataMode;
  /** Human-readable provenance, e.g. "NSE historical CSV import". */
  source: string;
  adjustmentStatus: "UNADJUSTED";
  /** Latest stored trading date for this security overall (not just within the window); null when none. */
  latestTradingDate: string | null;
  earliestTradingDate: string | null;
  /** Ascending by date, one per trading day actually present in the source; no gap-filling. */
  candles: DailyCandle[];
}

export interface HistoricalPriceProvider {
  readonly id: string;
  /** `from`/`to` are inclusive YYYY-MM-DD bounds. */
  getDailyCandles(input: { securityId: string; from: string; to: string }): Promise<HistoricalCandleResult>;
}
