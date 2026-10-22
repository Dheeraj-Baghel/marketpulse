import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { dailyPrices, type PriceSource } from "@/db/schema";
import { scaledToNumber } from "@/lib/prices/decimal";
import type { HistoricalCandleResult, HistoricalPriceProvider } from "./types";

const SOURCE: PriceSource = "NSE_EQ_SECURITY_CSV";

export interface PriceCoverage {
  count: number;
  earliest: string | null;
  latest: string | null;
}

/** Reads locally imported NSE security-wise historical CSV data from SQLite. */
export class LocalNseHistoricalProvider implements HistoricalPriceProvider {
  readonly id = "local-nse-csv";

  constructor(private readonly db: Db = getDb()) {}

  coverage(securityId: number): PriceCoverage {
    const [row] = this.db
      .select({
        count: sql<number>`count(*)`,
        earliest: sql<string | null>`min(${dailyPrices.tradeDate})`,
        latest: sql<string | null>`max(${dailyPrices.tradeDate})`,
      })
      .from(dailyPrices)
      .where(and(eq(dailyPrices.securityId, securityId), eq(dailyPrices.source, SOURCE)))
      .all();
    return { count: row?.count ?? 0, earliest: row?.earliest ?? null, latest: row?.latest ?? null };
  }

  /** Latest stored trading date per security, for many securities in one query. */
  latestDates(securityIds: number[]): Map<number, string> {
    if (securityIds.length === 0) return new Map();
    const rows = this.db
      .select({ securityId: dailyPrices.securityId, latest: sql<string>`max(${dailyPrices.tradeDate})` })
      .from(dailyPrices)
      .where(and(eq(dailyPrices.source, SOURCE), sql`${dailyPrices.securityId} IN ${securityIds}`))
      .groupBy(dailyPrices.securityId)
      .all();
    return new Map(rows.map((r) => [r.securityId, r.latest]));
  }

  async getDailyCandles(input: { securityId: string; from: string; to: string }): Promise<HistoricalCandleResult> {
    const id = Number(input.securityId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`invalid securityId "${input.securityId}"`);
    const coverage = this.coverage(id);
    const rows = this.db
      .select()
      .from(dailyPrices)
      .where(
        and(
          eq(dailyPrices.securityId, id),
          eq(dailyPrices.source, SOURCE),
          gte(dailyPrices.tradeDate, input.from),
          lte(dailyPrices.tradeDate, input.to),
        ),
      )
      .orderBy(asc(dailyPrices.tradeDate))
      .all();

    return {
      securityId: String(id),
      currency: "INR",
      interval: "1d",
      dataMode: "HISTORICAL_EOD",
      source: "NSE historical CSV import",
      adjustmentStatus: "UNADJUSTED",
      latestTradingDate: coverage.latest,
      earliestTradingDate: coverage.earliest,
      candles: rows.map((r) => ({
        date: r.tradeDate,
        open: scaledToNumber(r.open),
        high: scaledToNumber(r.high),
        low: scaledToNumber(r.low),
        close: scaledToNumber(r.close),
        volume: r.volume,
      })),
    };
  }
}
