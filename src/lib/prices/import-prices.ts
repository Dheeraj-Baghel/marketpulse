import { and, eq, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/db/client";
import {
  dailyPrices,
  priceImports,
  securities,
  type PriceImportStatus,
  type PriceSource,
  type Security,
} from "@/db/schema";
import { parseHistoricalCsv, PriceFileError, type ParsedHistoricalFile, type RowProblem } from "./parse-historical";

export const NSE_CSV_SOURCE: PriceSource = "NSE_EQ_SECURITY_CSV";
const MAX_STORED_MESSAGES = 200;

export interface PriceImportOptions {
  /** Required for NSE eq_security exports, which have no symbol column. */
  symbol?: string;
  /** Required when the symbol has several series or the file mixes series. */
  series?: string;
  /** Fail the whole import if any row is rejected. */
  strict?: boolean;
  now?: Date;
}

export interface PriceImportSummary {
  importId: number;
  status: PriceImportStatus;
  fileName: string;
  security: Pick<Security, "id" | "symbol" | "name" | "series" | "segment" | "isin">;
  rowsTotal: number;
  inserted: number;
  updated: number;
  skipped: number;
  rejected: number;
  dateFrom: string;
  dateTo: string;
  messages: string[];
}

/** Thrown for any import that stored no prices. `importId` is the FAILED audit row. */
export class PriceImportError extends Error {
  constructor(
    message: string,
    readonly importId: number | null,
  ) {
    super(message);
    this.name = "PriceImportError";
  }
}

type Resolved = { security: Security; seriesFilter: string | null };

/**
 * Decides which single directory security the file belongs to. Never guesses:
 * anything ambiguous is an error that names the flag needed to resolve it.
 */
export function resolveSecurity(db: Db, parsed: ParsedHistoricalFile, options: PriceImportOptions): Resolved {
  const argSymbol = options.symbol?.trim().toUpperCase() || null;
  const argSeries = options.series?.trim().toUpperCase() || null;

  if (parsed.symbolsFound.length > 1) {
    throw new PriceFileError(`File contains several symbols (${parsed.symbolsFound.join(", ")}). Import one security per file.`);
  }
  const fileSymbol = parsed.symbolsFound[0] ?? null;
  if (argSymbol && fileSymbol && argSymbol !== fileSymbol) {
    throw new PriceFileError(`--symbol ${argSymbol} does not match the file's SYMBOL column (${fileSymbol}).`);
  }
  const symbol = argSymbol ?? fileSymbol;
  if (!symbol) {
    throw new PriceFileError(
      "This NSE export has no SYMBOL column, so the security cannot be identified from the file. " +
        "Pass it explicitly, e.g. `npm run import:prices -- --symbol RELIANCE --series EQ data/prices/RELIANCE.csv`.",
    );
  }
  if (!/^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(symbol)) throw new PriceFileError(`"${symbol}" is not a valid NSE symbol.`);
  if (argSeries && !/^[A-Z0-9]{2}$/.test(argSeries)) throw new PriceFileError(`"${argSeries}" is not a valid NSE series code.`);

  const candidates = db.select().from(securities).where(eq(securities.symbol, symbol)).all();
  if (candidates.length === 0) {
    throw new PriceFileError(`${symbol} is not in the imported NSE directory. Check the symbol or run \`npm run import:nse\` first.`);
  }
  const directorySeries = [...new Set(candidates.map((c) => c.series))].sort();

  let series = argSeries;
  if (!series) {
    if (parsed.seriesFound.length > 1) {
      throw new PriceFileError(
        `File mixes series ${parsed.seriesFound.join(", ")} for ${symbol}. Choose one with --series (one of ${parsed.seriesFound.join(", ")}).`,
      );
    }
    series = parsed.seriesFound[0] ?? null;
    if (!series) {
      if (directorySeries.length > 1) {
        throw new PriceFileError(
          `${symbol} trades in several series (${directorySeries.join(", ")}) and the file has no SERIES column. Pass --series.`,
        );
      }
      series = directorySeries[0] ?? null;
    }
  } else if (parsed.hasSeriesColumn && !parsed.seriesFound.includes(series)) {
    throw new PriceFileError(
      `--series ${series} does not appear in the file (file has ${parsed.seriesFound.join(", ") || "no valid rows"}).`,
    );
  }

  const matches = candidates.filter((c) => c.series === series);
  if (matches.length === 0) {
    throw new PriceFileError(`${symbol} ${series} is not in the directory (known series: ${directorySeries.join(", ")}).`);
  }
  if (matches.length > 1) {
    throw new PriceFileError(`${symbol} ${series} exists in several segments (${matches.map((m) => m.segment).join(", ")}). Cannot choose safely.`);
  }
  const security = matches[0] as Security;
  // Only filter rows by series when the file actually has a SERIES column.
  return { security, seriesFilter: parsed.hasSeriesColumn ? security.series : null };
}

function fmtProblems(kind: string, problems: RowProblem[]): string[] {
  return problems.map((p) => `line ${p.line}: ${kind} - ${p.message}`);
}

/**
 * Imports one manually downloaded NSE security-wise historical CSV.
 *
 * - All price writes happen in one transaction: an error leaves stored prices untouched.
 * - Upsert on (security_id, trade_date, source): identical rows are skipped,
 *   changed rows (e.g. a corrected re-download) are updated. Repeat imports are idempotent.
 * - Every run, including failures, gets a `price_imports` audit row.
 */
export function importPriceFile(db: Db, filePath: string, options: PriceImportOptions = {}): PriceImportSummary {
  const absolute = path.resolve(filePath);
  const fileName = path.basename(absolute);
  const now = options.now ?? new Date();
  const importedAt = now.toISOString();

  let buffer: Buffer;
  let mtime: string | null = null;
  try {
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) throw new Error("not a regular file");
    if (!/\.csv$/i.test(fileName)) throw new Error("expected a .csv file");
    buffer = fs.readFileSync(absolute);
    mtime = stat.mtime.toISOString();
  } catch (error) {
    throw new PriceImportError(`${fileName}: ${error instanceof Error ? error.message : String(error)}`, null);
  }
  const sha = crypto.createHash("sha256").update(buffer).digest("hex");

  const audit = {
    source: NSE_CSV_SOURCE,
    fileName,
    fileSha256: sha,
    sourceModifiedAt: mtime,
    importedAt,
    requestedSymbol: options.symbol?.trim().toUpperCase() || null,
    requestedSeries: options.series?.trim().toUpperCase() || null,
  };
  const recordFailure = (message: string, extra: Partial<typeof priceImports.$inferInsert> = {}): never => {
    const [row] = db
      .insert(priceImports)
      .values({ ...audit, status: "FAILED", errorMessage: message, ...extra })
      .returning({ id: priceImports.id })
      .all();
    throw new PriceImportError(message, row?.id ?? null);
  };

  let parsed: ParsedHistoricalFile;
  let resolved: Resolved;
  try {
    parsed = parseHistoricalCsv(buffer.toString("utf8"), { fileName, now });
    resolved = resolveSecurity(db, parsed, options);
  } catch (error) {
    if (error instanceof PriceFileError) return recordFailure(error.message);
    throw error;
  }

  const { security, seriesFilter } = resolved;
  const relevant = seriesFilter ? parsed.rows.filter((r) => r.series === seriesFilter) : parsed.rows;
  const otherSeries = parsed.rows.length - relevant.length;
  const messages = [
    ...fmtProblems("rejected", parsed.rejected),
    ...fmtProblems("duplicate line skipped", parsed.duplicateLines),
    ...(otherSeries > 0 ? [`${otherSeries} row(s) of other series skipped (importing ${seriesFilter} only)`] : []),
    ...relevant
      .filter((r) => [0, 6].includes(new Date(`${r.tradeDate}T00:00:00Z`).getUTCDay()))
      .map((r) => `line ${r.line}: note - ${r.tradeDate} is a weekend date; kept as reported by the source (e.g. a special session)`),
    ...(!parsed.hasVolumeColumn ? ["file has no VOLUME column; volume stored as null"] : []),
    ...(!security.isActive ? [`note - ${security.symbol} is not in the latest directory import`] : []),
  ];
  const dates = relevant.map((r) => r.tradeDate).sort();
  const dateFrom = dates[0] ?? null;
  const dateTo = dates.at(-1) ?? null;
  const counts = { rowsTotal: parsed.rowsTotal, recordsRejected: parsed.rejected.length, securityId: security.id, sourceDateFrom: dateFrom, sourceDateTo: dateTo };

  if (relevant.length === 0) {
    return recordFailure(
      parsed.rowsTotal === 0
        ? `${fileName} contains a header but no price rows (empty dataset).`
        : `${fileName}: no valid ${security.symbol} ${security.series} rows (${parsed.rejected.length} rejected).${parsed.rejected[0] ? ` First problem: line ${parsed.rejected[0].line}: ${parsed.rejected[0].message}` : ""}`,
      { ...counts, messages: JSON.stringify(messages.slice(0, MAX_STORED_MESSAGES)) },
    );
  }
  if (options.strict && parsed.rejected.length > 0) {
    return recordFailure(`${fileName}: ${parsed.rejected.length} row(s) rejected and --strict is set; nothing imported.`, {
      ...counts,
      messages: JSON.stringify(messages.slice(0, MAX_STORED_MESSAGES)),
    });
  }

  const status: PriceImportStatus = parsed.rejected.length > 0 ? "PARTIAL" : "SUCCEEDED";
  try {
    return db.transaction((tx) => {
      const [importRow] = tx
        .insert(priceImports)
        .values({ ...audit, ...counts, status, messages: JSON.stringify(messages.slice(0, MAX_STORED_MESSAGES)) })
        .returning({ id: priceImports.id })
        .all();
      if (!importRow) throw new Error("could not create price import record");

      const existing = new Map(
        tx
          .select()
          .from(dailyPrices)
          .where(
            and(
              eq(dailyPrices.securityId, security.id),
              eq(dailyPrices.source, NSE_CSV_SOURCE),
              inArray(dailyPrices.tradeDate, dates),
            ),
          )
          .all()
          .map((p) => [p.tradeDate, p]),
      );

      let inserted = 0;
      let updated = 0;
      let skipped = parsed.duplicateLines.length + otherSeries;
      for (const r of relevant) {
        const values = { open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume };
        const prior = existing.get(r.tradeDate);
        if (!prior) {
          tx.insert(dailyPrices)
            .values({
              ...values,
              securityId: security.id,
              tradeDate: r.tradeDate,
              source: NSE_CSV_SOURCE,
              adjustmentStatus: "UNADJUSTED",
              importedAt,
              lastImportId: importRow.id,
            })
            .run();
          inserted++;
        } else if (
          prior.open !== r.open || prior.high !== r.high || prior.low !== r.low || prior.close !== r.close || prior.volume !== r.volume
        ) {
          tx.update(dailyPrices).set({ ...values, importedAt, lastImportId: importRow.id }).where(eq(dailyPrices.id, prior.id)).run();
          updated++;
        } else {
          skipped++;
        }
      }

      tx.update(priceImports)
        .set({ recordsInserted: inserted, recordsUpdated: updated, recordsSkipped: skipped })
        .where(eq(priceImports.id, importRow.id))
        .run();

      return {
        importId: importRow.id,
        status,
        fileName,
        security: { id: security.id, symbol: security.symbol, name: security.name, series: security.series, segment: security.segment, isin: security.isin },
        rowsTotal: parsed.rowsTotal,
        inserted,
        updated,
        skipped,
        rejected: parsed.rejected.length,
        dateFrom: dateFrom as string,
        dateTo: dateTo as string,
        messages,
      };
    });
  } catch (error) {
    // Transaction rolled back: no prices or audit row from it remain.
    return recordFailure(`${fileName}: database error, nothing imported (${error instanceof Error ? error.message : String(error)})`, counts);
  }
}
