import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Listing segments supported in Stage 1. Only NSE's two equity directories are
 * accepted: the Mainboard "EQUITY_L.csv" and the Emerge "SME_EQUITY_L.csv".
 * ETF, bond, REIT/InvIT and other non-equity lists are deliberately rejected
 * by the importer and have no segment value here.
 */
export const SEGMENTS = ["MAINBOARD", "SME"] as const;
export type Segment = (typeof SEGMENTS)[number];

/**
 * Instrument kinds found inside the equity directories. A company can appear
 * as more than one security (e.g. separate trading series, DVR shares or a
 * temporary rights entitlement), so securities are not assumed to be companies.
 */
export const INSTRUMENT_KINDS = ["EQUITY_SHARE", "DVR_OR_PARTLY_PAID", "RIGHTS_ENTITLEMENT"] as const;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];

/** One row per traded security: (segment, symbol, series) is NSE's trading identity. */
export const securities = sqliteTable(
  "securities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    isin: text("isin").notNull(),
    segment: text("segment", { enum: SEGMENTS }).notNull(),
    series: text("series").notNull(),
    instrumentKind: text("instrument_kind", { enum: INSTRUMENT_KINDS }).notNull(),
    /**
     * Issuer portion of the ISIN (characters 4-7, e.g. "144J" in INE144J01027).
     * Securities sharing an issuer code belong to the same company, which keeps
     * the security/company distinction without inventing a separate company list.
     */
    issuerCode: text("issuer_code").notNull(),
    /** ISO date (YYYY-MM-DD) from DATE OF LISTING, null when missing/unparseable. */
    listingDate: text("listing_date"),
    faceValue: real("face_value"),
    paidUpValue: real("paid_up_value"),
    marketLot: integer("market_lot"),
    /** False when the security was absent from the latest import of its segment. */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    firstImportedAt: text("first_imported_at").notNull(),
    /** Timestamp of the most recent import that contained this security. */
    importedAt: text("imported_at").notNull(),
    lastImportId: integer("last_import_id")
      .notNull()
      .references(() => directoryImports.id),
  },
  (t) => [
    uniqueIndex("securities_segment_symbol_series_uq").on(t.segment, t.symbol, t.series),
    index("securities_symbol_idx").on(t.symbol),
    index("securities_isin_idx").on(t.isin),
    index("securities_name_idx").on(t.name),
    index("securities_issuer_idx").on(t.issuerCode),
    check("securities_isin_len", sql`length(${t.isin}) = 12`),
  ],
);

/** Audit record for every CLI import, including counts and the source file fingerprint. */
export const directoryImports = sqliteTable("directory_imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  segment: text("segment", { enum: SEGMENTS }).notNull(),
  fileName: text("file_name").notNull(),
  fileSha256: text("file_sha256").notNull(),
  /** File modification time of the supplied CSV (the closest available source timestamp). */
  sourceModifiedAt: text("source_modified_at"),
  importedAt: text("imported_at").notNull(),
  rowsTotal: integer("rows_total").notNull(),
  rowsInserted: integer("rows_inserted").notNull(),
  rowsUpdated: integer("rows_updated").notNull(),
  rowsUnchanged: integer("rows_unchanged").notNull(),
  rowsRejected: integer("rows_rejected").notNull(),
  rowsDuplicate: integer("rows_duplicate").notNull(),
  rowsDeactivated: integer("rows_deactivated").notNull(),
  /** JSON array of human-readable validation warnings (capped). */
  warnings: text("warnings").notNull().default("[]"),
});

export type Security = typeof securities.$inferSelect;
export type NewSecurity = typeof securities.$inferInsert;
export type DirectoryImport = typeof directoryImports.$inferSelect;

/* ------------------------------------------------------------------------ */
/* Stage 2A: authentic daily historical prices                              */
/* ------------------------------------------------------------------------ */

/**
 * Price sources. Only manually downloaded NSE "security-wise historical"
 * CSVs (https://www.nseindia.com/report-detail/eq_security) exist today.
 * A later vendor would add a new value; rows are unique per source.
 */
export const PRICE_SOURCES = ["NSE_EQ_SECURITY_CSV"] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/** NSE security-wise historical data is as traded: no split/bonus/dividend adjustment. */
export const ADJUSTMENT_STATUSES = ["UNADJUSTED"] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export const PRICE_IMPORT_STATUSES = ["SUCCEEDED", "PARTIAL", "FAILED"] as const;
export type PriceImportStatus = (typeof PRICE_IMPORT_STATUSES)[number];

/**
 * Prices are stored as exact scaled integers: value in rupees x 10^4
 * (PRICE_SCALE). "1,450.05" -> 14500500. Parsing is string-based, so no
 * binary floating-point rounding ever enters storage or comparisons.
 */
export const PRICE_SCALE = 10_000;
export const PRICE_DECIMALS = 4;

/** Audit record for every price CLI run, including failed runs. */
export const priceImports = sqliteTable("price_imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source", { enum: PRICE_SOURCES }).notNull(),
  fileName: text("file_name").notNull(),
  fileSha256: text("file_sha256").notNull(),
  sourceModifiedAt: text("source_modified_at"),
  importedAt: text("imported_at").notNull(),
  /** Null when the security could not be identified. */
  securityId: integer("security_id").references(() => securities.id),
  requestedSymbol: text("requested_symbol"),
  requestedSeries: text("requested_series"),
  status: text("status", { enum: PRICE_IMPORT_STATUSES }).notNull(),
  rowsTotal: integer("rows_total").notNull().default(0),
  recordsInserted: integer("records_inserted").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  /** Identical to an already stored observation, or a different series filtered out. */
  recordsSkipped: integer("records_skipped").notNull().default(0),
  recordsRejected: integer("records_rejected").notNull().default(0),
  /** Earliest / latest valid trading date found in the file (YYYY-MM-DD). */
  sourceDateFrom: text("source_date_from"),
  sourceDateTo: text("source_date_to"),
  errorMessage: text("error_message"),
  /** JSON array of row-level messages (capped). */
  messages: text("messages").notNull().default("[]"),
});

/** One end-of-day OHLCV observation per security, trading date and source. */
export const dailyPrices = sqliteTable(
  "daily_prices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    securityId: integer("security_id")
      .notNull()
      .references(() => securities.id),
    /** Exchange trading date from the source file (YYYY-MM-DD), never the import date. */
    tradeDate: text("trade_date").notNull(),
    /** Scaled integers, rupees x PRICE_SCALE. */
    open: integer("open").notNull(),
    high: integer("high").notNull(),
    low: integer("low").notNull(),
    close: integer("close").notNull(),
    /** Shares traded; null when the source does not report it (never defaulted to 0). */
    volume: integer("volume"),
    source: text("source", { enum: PRICE_SOURCES }).notNull(),
    adjustmentStatus: text("adjustment_status", { enum: ADJUSTMENT_STATUSES }).notNull(),
    importedAt: text("imported_at").notNull(),
    lastImportId: integer("last_import_id")
      .notNull()
      .references(() => priceImports.id),
  },
  (t) => [
    uniqueIndex("daily_prices_security_date_source_uq").on(t.securityId, t.tradeDate, t.source),
    index("daily_prices_security_date_idx").on(t.securityId, t.tradeDate),
    check("daily_prices_positive", sql`${t.open} > 0 AND ${t.high} > 0 AND ${t.low} > 0 AND ${t.close} > 0`),
    check("daily_prices_range", sql`${t.high} >= ${t.low} AND ${t.open} BETWEEN ${t.low} AND ${t.high} AND ${t.close} BETWEEN ${t.low} AND ${t.high}`),
    check("daily_prices_volume", sql`${t.volume} IS NULL OR ${t.volume} >= 0`),
    check("daily_prices_date_shape", sql`${t.tradeDate} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`),
  ],
);

export type DailyPrice = typeof dailyPrices.$inferSelect;
export type PriceImport = typeof priceImports.$inferSelect;
