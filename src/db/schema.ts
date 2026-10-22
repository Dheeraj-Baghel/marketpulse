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
