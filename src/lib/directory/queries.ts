import "server-only";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { directoryImports, securities, SEGMENTS, type InstrumentKind, type Segment } from "@/db/schema";

export const PAGE_SIZE = 25;
export const MAX_QUERY_LENGTH = 64;

export type SegmentFilter = Segment | "ALL";

export interface DirectoryQuery {
  q: string;
  page: number;
  segment: SegmentFilter;
}

/** One dashboard row = one listed symbol; multiple trading series are folded together. */
export interface DirectoryRow {
  symbol: string;
  name: string;
  isin: string;
  segment: Segment;
  series: string[];
  instrumentKind: InstrumentKind;
  listingDate: string | null;
}

export interface DirectoryPage {
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

/** Validates untrusted search params; never throws. */
export function parseDirectoryQuery(params: Record<string, string | string[] | undefined>): DirectoryQuery {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = first(params.q).replace(/[\u0000-\u001f]/g, "").trim().slice(0, MAX_QUERY_LENGTH);
  const pageNum = Number.parseInt(first(params.page), 10);
  const seg = first(params.segment).toUpperCase();
  return {
    q,
    page: Number.isFinite(pageNum) && pageNum > 0 ? Math.min(pageNum, 10_000) : 1,
    segment: (SEGMENTS as readonly string[]).includes(seg) ? (seg as Segment) : "ALL",
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function directoryWhere(query: DirectoryQuery): SQL | undefined {
  const conditions: SQL[] = [eq(securities.isActive, true)];
  if (query.segment !== "ALL") conditions.push(eq(securities.segment, query.segment));
  if (query.q) {
    // SQLite LIKE is case-insensitive for ASCII, which covers NSE symbols,
    // ISINs and the (English) listed names. Partial match anywhere.
    const pattern = `%${escapeLike(query.q)}%`;
    conditions.push(
      sql`(${securities.symbol} LIKE ${pattern} ESCAPE '\\' OR ${securities.name} LIKE ${pattern} ESCAPE '\\' OR ${securities.isin} LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  return and(...conditions);
}

export function getDirectoryPage(query: DirectoryQuery): DirectoryPage {
  const db = getDb();
  const where = directoryWhere(query);
  const upper = query.q.toUpperCase();

  const [countRow] = db
    .select({ total: sql<number>`count(DISTINCT ${securities.segment} || '|' || ${securities.symbol})` })
    .from(securities)
    .where(where)
    .all();
  const total = countRow?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page, pageCount);

  // When searching, rank exact symbol/ISIN, then symbol prefix, then other matches.
  // (Never order by a bare literal: SQLite reads `ORDER BY 0` as a column position.)
  const rank = sql<number>`min(CASE WHEN ${securities.symbol} = ${upper} THEN 0 WHEN ${securities.isin} = ${upper} THEN 0 WHEN ${securities.symbol} LIKE ${`${escapeLike(upper)}%`} ESCAPE '\\' THEN 1 ELSE 2 END)`;
  const orderBy = query.q
    ? [asc(rank), asc(securities.symbol), asc(securities.segment)]
    : [asc(securities.symbol), asc(securities.segment)];

  const raw = db
    .select({
      symbol: securities.symbol,
      segment: securities.segment,
      name: sql<string>`max(${securities.name})`,
      isin: sql<string>`min(${securities.isin})`,
      series: sql<string>`group_concat(${securities.series}, ',')`,
      instrumentKind: sql<InstrumentKind>`min(${securities.instrumentKind})`,
      listingDate: sql<string | null>`min(${securities.listingDate})`,
    })
    .from(securities)
    .where(where)
    .groupBy(securities.segment, securities.symbol)
    .orderBy(...orderBy)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE)
    .all();

  return {
    rows: raw.map((r) => ({
      symbol: r.symbol,
      segment: r.segment,
      name: r.name,
      isin: r.isin,
      series: r.series.split(",").sort(),
      instrumentKind: r.instrumentKind,
      listingDate: r.listingDate,
    })),
    total,
    page,
    pageCount,
    pageSize: PAGE_SIZE,
  };
}

export interface SegmentStatus {
  segment: Segment;
  activeSecurities: number;
  lastImport: {
    fileName: string;
    importedAt: string;
    sourceModifiedAt: string | null;
    rowsTotal: number;
    rowsInserted: number;
    rowsUpdated: number;
    rowsUnchanged: number;
    rowsRejected: number;
    rowsDuplicate: number;
    rowsDeactivated: number;
  } | null;
}

export interface DirectoryStatus {
  state: "empty" | "incomplete" | "ready";
  totalSecurities: number;
  totalSymbols: number;
  totalIssuers: number;
  segments: SegmentStatus[];
  missingSegments: Segment[];
  lastImportedAt: string | null;
}

export function getDirectoryStatus(): DirectoryStatus {
  const db = getDb();
  const [totals] = db
    .select({
      securities: sql<number>`count(*)`,
      symbols: sql<number>`count(DISTINCT ${securities.segment} || '|' || ${securities.symbol})`,
      issuers: sql<number>`count(DISTINCT ${securities.issuerCode})`,
    })
    .from(securities)
    .where(eq(securities.isActive, true))
    .all();

  const segments: SegmentStatus[] = SEGMENTS.map((segment) => {
    const [count] = db
      .select({ n: sql<number>`count(*)` })
      .from(securities)
      .where(and(eq(securities.segment, segment), eq(securities.isActive, true)))
      .all();
    const [last] = db
      .select()
      .from(directoryImports)
      .where(eq(directoryImports.segment, segment))
      .orderBy(desc(directoryImports.id))
      .limit(1)
      .all();
    return {
      segment,
      activeSecurities: count?.n ?? 0,
      lastImport: last
        ? {
            fileName: last.fileName,
            importedAt: last.importedAt,
            sourceModifiedAt: last.sourceModifiedAt,
            rowsTotal: last.rowsTotal,
            rowsInserted: last.rowsInserted,
            rowsUpdated: last.rowsUpdated,
            rowsUnchanged: last.rowsUnchanged,
            rowsRejected: last.rowsRejected,
            rowsDuplicate: last.rowsDuplicate,
            rowsDeactivated: last.rowsDeactivated,
          }
        : null,
    };
  });

  const totalSecurities = totals?.securities ?? 0;
  const missingSegments = segments.filter((s) => s.activeSecurities === 0).map((s) => s.segment);
  const importTimes = segments.map((s) => s.lastImport?.importedAt).filter((t): t is string => Boolean(t));
  return {
    state: totalSecurities === 0 ? "empty" : missingSegments.length > 0 ? "incomplete" : "ready",
    totalSecurities,
    totalSymbols: totals?.symbols ?? 0,
    totalIssuers: totals?.issuers ?? 0,
    segments,
    missingSegments,
    lastImportedAt: importTimes.sort().at(-1) ?? null,
  };
}

export interface SecurityDetail {
  id: number;
  symbol: string;
  name: string;
  isin: string;
  issuerCode: string;
  segment: Segment;
  series: string;
  instrumentKind: InstrumentKind;
  listingDate: string | null;
  faceValue: number | null;
  paidUpValue: number | null;
  marketLot: number | null;
  isActive: boolean;
  firstImportedAt: string;
  importedAt: string;
}

export interface CompanyDetail {
  symbol: string;
  name: string;
  segment: Segment;
  isin: string;
  isActive: boolean;
  /** Every trading series of this symbol (e.g. EQ and BZ). */
  listings: SecurityDetail[];
  /** Other symbols issued by the same company (same ISIN issuer code), e.g. DVR shares or rights. */
  relatedSecurities: Pick<SecurityDetail, "symbol" | "name" | "isin" | "segment" | "series" | "instrumentKind" | "isActive">[];
}

/** Valid symbol shape before touching the database; rejects garbage URLs early. */
export function normaliseSymbolParam(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const value = decoded.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(value) ? value : null;
}

export function getCompanyBySymbol(symbol: string): CompanyDetail | null {
  const db = getDb();
  const rows = db
    .select()
    .from(securities)
    .where(eq(securities.symbol, symbol))
    .orderBy(desc(securities.isActive), asc(securities.segment), asc(securities.series))
    .all();
  const primary = rows[0];
  if (!primary) return null;

  const listings: SecurityDetail[] = rows
    .filter((r) => r.segment === primary.segment)
    .map((r) => ({
      id: r.id,
      symbol: r.symbol,
      name: r.name,
      isin: r.isin,
      issuerCode: r.issuerCode,
      segment: r.segment,
      series: r.series,
      instrumentKind: r.instrumentKind,
      listingDate: r.listingDate,
      faceValue: r.faceValue,
      paidUpValue: r.paidUpValue,
      marketLot: r.marketLot,
      isActive: r.isActive,
      firstImportedAt: r.firstImportedAt,
      importedAt: r.importedAt,
    }));

  const relatedSecurities = db
    .select({
      symbol: securities.symbol,
      name: securities.name,
      isin: securities.isin,
      segment: securities.segment,
      series: securities.series,
      instrumentKind: securities.instrumentKind,
      isActive: securities.isActive,
    })
    .from(securities)
    .where(and(eq(securities.issuerCode, primary.issuerCode), sql`${securities.symbol} <> ${symbol}`))
    .orderBy(asc(securities.symbol), asc(securities.series))
    .all();

  return {
    symbol: primary.symbol,
    name: primary.name,
    segment: primary.segment,
    isin: primary.isin,
    isActive: listings.some((l) => l.isActive),
    listings,
    relatedSecurities,
  };
}
