import { and, eq, ne } from "drizzle-orm";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@/db/client";
import { directoryImports, securities, type Segment } from "@/db/schema";
import { parseDirectory, type ParsedDirectory } from "./parse-directory";

export interface ImportSummary {
  importId: number;
  fileName: string;
  segment: Segment;
  importedAt: string;
  rowsTotal: number;
  inserted: number;
  updated: number;
  unchanged: number;
  rejected: number;
  duplicates: number;
  deactivated: number;
  parsed: ParsedDirectory;
}

const MAX_STORED_WARNINGS = 200;

/**
 * Imports one user-supplied NSE CSV inside a single transaction.
 *
 * Idempotency: rows are upserted on the unique (segment, symbol, series) key,
 * so repeating an import never creates duplicates. Securities of the same
 * segment that are missing from the new file are marked inactive (delisted or
 * moved) rather than deleted, preserving history for later stages.
 */
export function importDirectoryFile(
  db: Db,
  filePath: string,
  options: { segment?: Segment; now?: Date } = {},
): ImportSummary {
  const absolute = path.resolve(filePath);
  const buffer = fs.readFileSync(absolute);
  const stat = fs.statSync(absolute);
  const fileName = path.basename(absolute);
  const now = options.now ?? new Date();
  const importedAt = now.toISOString();
  const parsed = parseDirectory(buffer.toString("utf8"), { fileName, segment: options.segment, now });

  if (parsed.records.length === 0) {
    throw new Error(`${fileName}: no valid securities found (${parsed.rejected.length} rejected). Nothing imported.`);
  }

  const warnings = [
    ...parsed.warnings,
    ...parsed.rejected.map((r) => `line ${r.line}: rejected - ${r.reason}`),
    ...parsed.duplicates.map((r) => `line ${r.line}: duplicate - ${r.reason}`),
  ];

  return db.transaction((tx) => {
    const [importRow] = tx
      .insert(directoryImports)
      .values({
        segment: parsed.segment,
        fileName,
        fileSha256: crypto.createHash("sha256").update(buffer).digest("hex"),
        sourceModifiedAt: stat.mtime.toISOString(),
        importedAt,
        rowsTotal: parsed.rowsTotal,
        rowsInserted: 0,
        rowsUpdated: 0,
        rowsUnchanged: 0,
        rowsRejected: parsed.rejected.length,
        rowsDuplicate: parsed.duplicates.length,
        rowsDeactivated: 0,
        warnings: JSON.stringify(warnings.slice(0, MAX_STORED_WARNINGS)),
      })
      .returning({ id: directoryImports.id })
      .all();
    if (!importRow) throw new Error("Could not create import record.");
    const importId = importRow.id;

    const existing = new Map(
      tx
        .select()
        .from(securities)
        .where(eq(securities.segment, parsed.segment))
        .all()
        .map((row) => [`${row.symbol}|${row.series}`, row]),
    );

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const record of parsed.records) {
      const prior = existing.get(`${record.symbol}|${record.series}`);
      if (!prior) {
        tx.insert(securities)
          .values({ ...record, segment: parsed.segment, isActive: true, firstImportedAt: importedAt, importedAt, lastImportId: importId })
          .run();
        inserted++;
        continue;
      }
      const changed =
        prior.name !== record.name ||
        prior.isin !== record.isin ||
        prior.issuerCode !== record.issuerCode ||
        prior.instrumentKind !== record.instrumentKind ||
        prior.listingDate !== record.listingDate ||
        prior.faceValue !== record.faceValue ||
        prior.paidUpValue !== record.paidUpValue ||
        prior.marketLot !== record.marketLot ||
        !prior.isActive;
      tx.update(securities)
        .set({ ...record, isActive: true, importedAt, lastImportId: importId })
        .where(eq(securities.id, prior.id))
        .run();
      if (changed) updated++;
      else unchanged++;
    }

    const deactivated = tx
      .update(securities)
      .set({ isActive: false })
      .where(
        and(eq(securities.segment, parsed.segment), ne(securities.lastImportId, importId), eq(securities.isActive, true)),
      )
      .run().changes;

    tx.update(directoryImports)
      .set({ rowsInserted: inserted, rowsUpdated: updated, rowsUnchanged: unchanged, rowsDeactivated: deactivated })
      .where(eq(directoryImports.id, importId))
      .run();

    return {
      importId,
      fileName,
      segment: parsed.segment,
      importedAt,
      rowsTotal: parsed.rowsTotal,
      inserted,
      updated,
      unchanged,
      rejected: parsed.rejected.length,
      duplicates: parsed.duplicates.length,
      deactivated,
      parsed,
    };
  });
}
