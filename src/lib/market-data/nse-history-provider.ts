import "server-only";
import { TtlCache } from "./cache";
import { McpProviderError, type McpTransportLike } from "./nse-mcp-client";
import { historyPayloadSchema, normalizeHistoryRows, todayIst } from "./normalize";
import type { DailyCandle } from "./types";

/**
 * Daily EOD history from the official NSE Bhavcopy MCP tool `get_stock_history`.
 *
 * Tool contract (discovered 22 Oct 2026): max 3 months per call; older chunks
 * via `next_end_date`; ~5 years retained; raw, unadjusted bhavcopy prices.
 *
 * Request economy: only the chunks needed for the requested window are
 * fetched, newest first. Results are cached per symbol+series (transient,
 * in-memory) and extended backwards on demand: 1Y costs 4-5 calls once;
 * revisiting within the TTL costs 0; ALL adds the remaining chunks once.
 */

export const CHUNK_MONTHS = 3;
/** Hard upper bound per load (21 x 3 months > 5 years). */
export const MAX_CHUNKS_PER_LOAD = 22;

export interface McpHistory {
  symbol: string;
  series: string;
  /** Ascending, validated, de-duplicated. */
  candles: DailyCandle[];
  /** endDate for the next older chunk; null once NSE has nothing older. */
  nextEndDate: string | null;
  /** When the newest chunk was fetched (drives the TTL). */
  fetchedAt: string;
  chunksFetched: number;
  rejectedRows: number;
  /**
   * Sessions where NSE returned rows only for other series (e.g. the T+0
   * "T0" segment on 2025-11-21 for RELIANCE) — those rows are never relabelled,
   * so the requested series has no candle that day.
   */
  foreignSeriesRows: number;
  foreignSeries: string[];
}

export type HistoryFailure =
  | { kind: "not-found"; message: string }
  | { kind: "series-mismatch"; message: string; providerSeries: string[] }
  | { kind: "provider"; error: McpProviderError };

export type HistoryResult =
  | { ok: true; history: McpHistory; cached: boolean; chunksThisCall: number }
  | { ok: false; failure: HistoryFailure };

class SeriesMismatch extends Error {
  constructor(readonly series: string[]) {
    super("series mismatch");
  }
}

export class NseBhavcopyHistoryProvider {
  readonly id = "nse-bhavcopy-mcp";
  readonly cache = new TtlCache<McpHistory>(64);
  private readonly inflight = new Map<string, Promise<HistoryResult>>();
  /** Total tool calls made (diagnostics/tests). */
  calls = 0;

  constructor(
    private readonly mcp: McpTransportLike,
    private readonly opts: { ttlMs: number; now?: () => Date },
  ) {}

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  /** Does `h` reach back to `fromDate` (or is it complete)? */
  static covers(h: McpHistory, fromDate: string | null): boolean {
    if (h.nextEndDate === null) return true;
    if (fromDate === null) return false;
    return (h.candles[0]?.date ?? "9999-12-31") <= fromDate;
  }

  /**
   * History reaching back to `fromDate` (inclusive), or everything NSE has
   * when `fromDate` is null. Concurrent identical requests share one load.
   */
  async getHistory(security: { symbol: string; series: string }, fromDate: string | null, opts: { force?: boolean } = {}): Promise<HistoryResult> {
    const key = `${security.symbol}|${security.series}`;
    const fresh = opts.force ? undefined : this.cache.get(key);
    if (fresh && NseBhavcopyHistoryProvider.covers(fresh, fromDate)) return { ok: true, history: fresh, cached: true, chunksThisCall: 0 };

    const flightKey = `${key}|${fromDate ?? "ALL"}|${opts.force ? "f" : ""}`;
    const pending = this.inflight.get(flightKey);
    if (pending) return pending;
    const load = this.load(security, fromDate, opts.force ? undefined : fresh).finally(() => this.inflight.delete(flightKey));
    this.inflight.set(flightKey, load);
    return load;
  }

  private async load(security: { symbol: string; series: string }, fromDate: string | null, base: McpHistory | undefined): Promise<HistoryResult> {
    const key = `${security.symbol}|${security.series}`;
    const now = this.now();
    const today = todayIst(now);
    let candles = base?.candles ?? [];
    let next: string | null = base ? base.nextEndDate : "today";
    let rejected = base?.rejectedRows ?? 0;
    let foreignRows = base?.foreignSeriesRows ?? 0;
    const foreignSeries = new Set(base?.foreignSeries ?? []);
    let chunks = 0;
    try {
      while (next !== null && chunks < MAX_CHUNKS_PER_LOAD) {
        let payload: unknown;
        try {
          this.calls++;
          payload = await this.mcp.callJson("bhavcopy", "get_stock_history", { symbol: security.symbol, months: CHUNK_MONTHS, endDate: next });
        } catch (error) {
          // "Symbol not found" past the oldest retained chunk = end of history, not a failure.
          if (candles.length > 0 && error instanceof McpProviderError && error.code === "TOOL_ERROR" && /not found/i.test(error.message)) {
            next = null;
            break;
          }
          throw error;
        }
        chunks++;
        const parsed = historyPayloadSchema.safeParse(payload);
        if (!parsed.success) throw new McpProviderError("INVALID_RESPONSE", "get_stock_history returned an unexpected shape.", "bhavcopy", true);
        if (parsed.data.symbol.toUpperCase() !== security.symbol) {
          throw new McpProviderError("INVALID_RESPONSE", `get_stock_history answered for ${parsed.data.symbol}, not ${security.symbol}.`, "bhavcopy", false);
        }
        const rows = parsed.data.data;
        if (rows.length === 0) {
          next = null;
          break;
        }
        const norm = normalizeHistoryRows(rows, security, today);
        rejected += norm.rejected.length;
        foreignRows += norm.foreign;
        for (const r of rows) {
          const s = String((r as { series?: unknown }).series ?? "").toUpperCase();
          if (s && s !== security.series) foreignSeries.add(s);
        }
        if (norm.candles.length === 0 && norm.foreign > 0 && candles.length === 0) {
          throw new SeriesMismatch([...new Set(rows.map((r) => String((r as { series?: unknown }).series ?? "?").toUpperCase()))].sort());
        }
        const merged = new Map(candles.map((c) => [c.date, c]));
        for (const c of norm.candles) if (!merged.has(c.date)) merged.set(c.date, c);
        candles = [...merged.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        const nextEnd = parsed.data.next_end_date ?? null;
        // Guard against a cursor that does not move backwards (would loop).
        next = nextEnd && (candles[0] ? nextEnd < candles[0].date : true) ? nextEnd : null;
        if (fromDate !== null && (candles[0]?.date ?? "9999-12-31") <= fromDate) break;
      }
    } catch (error) {
      if (error instanceof SeriesMismatch) {
        return {
          ok: false,
          failure: {
            kind: "series-mismatch",
            providerSeries: error.series,
            message: `NSE Bhavcopy currently reports ${security.symbol} in series ${error.series.join(", ")}, not ${security.series}.`,
          },
        };
      }
      if (error instanceof McpProviderError && error.code === "TOOL_ERROR" && /not found/i.test(error.message)) {
        return { ok: false, failure: { kind: "not-found", message: `NSE Bhavcopy has no history for ${security.symbol}.` } };
      }
      if (error instanceof McpProviderError) return { ok: false, failure: { kind: "provider", error } };
      throw error;
    }

    if (candles.length === 0) return { ok: false, failure: { kind: "not-found", message: `NSE Bhavcopy returned no sessions for ${security.symbol} ${security.series}.` } };
    const history: McpHistory = {
      symbol: security.symbol,
      series: security.series,
      candles,
      nextEndDate: next,
      fetchedAt: base?.fetchedAt ?? now.toISOString(),
      chunksFetched: (base?.chunksFetched ?? 0) + chunks,
      rejectedRows: rejected,
      foreignSeriesRows: foreignRows,
      foreignSeries: [...foreignSeries].sort(),
    };
    // Extending an entry backwards keeps its original freshness clock.
    const age = now.getTime() - Date.parse(history.fetchedAt);
    this.cache.set(key, history, Math.max(1000, this.opts.ttlMs - age));
    return { ok: true, history, cached: false, chunksThisCall: chunks };
  }
}
