import { normaliseHeader, parseCsv } from "@/lib/nse/csv";
import { formatScaled, parseScaledPrice, parseVolume } from "./decimal";

/**
 * Parser for NSE "Security-wise Price Volume & Deliverable" historical exports
 * downloaded manually from https://www.nseindia.com/report-detail/eq_security.
 *
 * Header observed in the supplied files (RELIANCE / TCS, October 2026; UTF-8 BOM):
 *   DATE,SERIES,OPEN,HIGH,LOW,PREV. CLOSE,LTP,CLOSE,VWAP,52 WEEK HIGH,52 WEEK LOW,VOLUME,VALUE,NO. OF  TRADES
 * Rows are newest-first, numbers use Indian digit grouping inside quotes
 * ("1,76,07,823"), dates look like "21-Oct-2026".
 *
 * This export contains NO symbol column, so the security must be supplied by
 * the caller (--symbol) and is validated against the directory. If a file does
 * carry a SYMBOL column it is cross-checked against that argument.
 *
 * Only the columns below are read. CLOSE is NSE's official closing price; LTP
 * (last traded price) and PREV. CLOSE are deliberately ignored.
 */
const COLUMN_ALIASES = {
  DATE: ["DATE"],
  SERIES: ["SERIES"],
  SYMBOL: ["SYMBOL"],
  OPEN: ["OPEN", "OPEN_PRICE"],
  HIGH: ["HIGH", "HIGH_PRICE"],
  LOW: ["LOW", "LOW_PRICE"],
  CLOSE: ["CLOSE", "CLOSE_PRICE"],
  VOLUME: ["VOLUME", "TOTAL_TRADED_QUANTITY"],
} as const;
type Column = keyof typeof COLUMN_ALIASES;
const REQUIRED: Column[] = ["DATE", "OPEN", "HIGH", "LOW", "CLOSE"];

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
/** NSE equity trading history (electronic) begins November 1994; anything earlier is a parse error. */
const EARLIEST_PLAUSIBLE = "1994-11-01";

export interface PriceRow {
  line: number;
  tradeDate: string;
  series: string | null;
  symbol: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface RowProblem {
  line: number;
  message: string;
}

export interface ParsedHistoricalFile {
  headers: string[];
  hasSeriesColumn: boolean;
  hasSymbolColumn: boolean;
  hasVolumeColumn: boolean;
  rowsTotal: number;
  rows: PriceRow[];
  rejected: RowProblem[];
  /** Exact repeats of an earlier line in the same file (same date and identical values). */
  duplicateLines: RowProblem[];
  seriesFound: string[];
  symbolsFound: string[];
}

export class PriceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PriceFileError";
  }
}

/** "21-Oct-2026" | "21-OCT-26" | "2026-10-21" -> "2026-10-21"; null when invalid. */
export function parseTradeDate(raw: string | undefined): string | null {
  const text = (raw ?? "").trim();
  let y: number;
  let m: number;
  let d: number;
  const nse = /^(\d{1,2})-([A-Za-z]{3})-(\d{4}|\d{2})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (nse) {
    const month = MONTHS[(nse[2] ?? "").toUpperCase()];
    if (!month) return null;
    d = Number(nse[1]);
    m = month;
    y = Number(nse[3]);
    if ((nse[3] ?? "").length === 2) y += y >= 90 ? 1900 : 2000;
  } else if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Today's date in India (exchange time zone), used to reject future-dated rows. */
export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function parseHistoricalCsv(text: string, options: { fileName: string; now?: Date }): ParsedHistoricalFile {
  if (text.includes("\u0000")) throw new PriceFileError(`${options.fileName} looks like a binary file, not a CSV export.`);
  const table = parseCsv(text);
  const headerRow = table[0];
  if (!headerRow) throw new PriceFileError(`${options.fileName} is empty.`);

  const headers = headerRow.map(normaliseHeader);
  const index = new Map<Column, number>();
  for (const [column, aliases] of Object.entries(COLUMN_ALIASES) as [Column, readonly string[]][]) {
    const at = headers.findIndex((h) => aliases.includes(h));
    if (at >= 0) index.set(column, at);
  }

  const missing = REQUIRED.filter((c) => !index.has(c));
  if (missing.length > 0) {
    const found = headerRow.map((h) => h.trim()).filter(Boolean).join(", ") || "(none)";
    const hint = headers.includes("NAME_OF_COMPANY")
      ? " This looks like the NSE securities directory; import it with `npm run import:nse` instead."
      : " Expected the NSE security-wise historical export (DATE, SERIES, OPEN, HIGH, LOW, ..., CLOSE, ..., VOLUME).";
    throw new PriceFileError(`${options.fileName}: unrecognised columns, missing ${missing.join(", ")}. Found: ${found}.${hint}`);
  }

  const today = todayInIndia(options.now);
  const cell = (row: string[], c: Column) => {
    const i = index.get(c);
    return i === undefined ? undefined : row[i];
  };

  const dataRows = table.slice(1);
  const rows: PriceRow[] = [];
  const rejected: RowProblem[] = [];
  const duplicateLines: RowProblem[] = [];
  const series = new Set<string>();
  const symbols = new Set<string>();
  // key = series|date -> first row; used to detect repeats and conflicts.
  const byKey = new Map<string, PriceRow>();
  const conflicted = new Set<string>();

  dataRows.forEach((row, i) => {
    const line = i + 2;
    const problems: string[] = [];
    const rawDate = cell(row, "DATE");
    const tradeDate = parseTradeDate(rawDate);
    if (!tradeDate) problems.push(`invalid date "${(rawDate ?? "").trim()}" (expected e.g. 21-Oct-2026)`);
    else if (tradeDate > today) problems.push(`date ${tradeDate} is in the future`);
    else if (tradeDate < EARLIEST_PLAUSIBLE) problems.push(`date ${tradeDate} predates NSE equity trading`);

    const rowSeries = index.has("SERIES") ? (cell(row, "SERIES") ?? "").trim().toUpperCase() : null;
    if (rowSeries !== null && !/^[A-Z0-9]{2}$/.test(rowSeries)) problems.push(`invalid series "${rowSeries}"`);
    const rowSymbol = index.has("SYMBOL") ? (cell(row, "SYMBOL") ?? "").trim().toUpperCase() : null;
    if (rowSymbol !== null && !/^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(rowSymbol)) problems.push(`invalid symbol "${rowSymbol}"`);

    const prices: Partial<Record<"open" | "high" | "low" | "close", number>> = {};
    for (const key of ["open", "high", "low", "close"] as const) {
      const raw = cell(row, key.toUpperCase() as Column);
      const parsed = parseScaledPrice(raw);
      if (parsed.ok) prices[key] = parsed.value;
      else problems.push(`${key.toUpperCase()}: ${parsed.reason}`);
    }
    const volume = parseVolume(cell(row, "VOLUME"));
    if (!volume.ok) problems.push(`VOLUME: ${volume.reason}`);

    const { open, high, low, close } = prices;
    if (open !== undefined && high !== undefined && low !== undefined && close !== undefined) {
      // Exact integer comparison (prices are scaled integers): no tolerance is
      // needed or applied. NSE's own OHLC values satisfy low <= open/close <= high.
      if (high < low) problems.push(`HIGH ${formatScaled(high)} is below LOW ${formatScaled(low)}`);
      else {
        if (open < low || open > high) problems.push(`OPEN ${formatScaled(open)} is outside LOW-HIGH ${formatScaled(low)}-${formatScaled(high)}`);
        if (close < low || close > high) problems.push(`CLOSE ${formatScaled(close)} is outside LOW-HIGH ${formatScaled(low)}-${formatScaled(high)}`);
      }
    }

    if (problems.length > 0 || !tradeDate || open === undefined || high === undefined || low === undefined || close === undefined || !volume.ok) {
      rejected.push({ line, message: problems.join("; ") });
      return;
    }

    if (rowSeries) series.add(rowSeries);
    if (rowSymbol) symbols.add(rowSymbol);
    const record: PriceRow = { line, tradeDate, series: rowSeries, symbol: rowSymbol, open, high, low, close, volume: volume.value };
    const key = `${rowSymbol ?? ""}|${rowSeries ?? ""}|${tradeDate}`;
    const prior = byKey.get(key);
    if (prior) {
      const same = prior.open === open && prior.high === high && prior.low === low && prior.close === close && prior.volume === record.volume;
      if (same) duplicateLines.push({ line, message: `repeats line ${prior.line} (${tradeDate})` });
      else {
        conflicted.add(key);
        rejected.push({ line, message: `${tradeDate} conflicts with line ${prior.line} (same date, different values); appears more than once with different values` });
      }
      return;
    }
    byKey.set(key, record);
    rows.push(record);
  });

  // Two different observations for one date: neither can be trusted.
  const kept = rows.filter((r) => {
    const key = `${r.symbol ?? ""}|${r.series ?? ""}|${r.tradeDate}`;
    if (!conflicted.has(key)) return true;
    rejected.push({ line: r.line, message: `${r.tradeDate} appears more than once with different values; remove the conflicting rows` });
    return false;
  });
  rejected.sort((a, b) => a.line - b.line);

  return {
    headers,
    hasSeriesColumn: index.has("SERIES"),
    hasSymbolColumn: index.has("SYMBOL"),
    hasVolumeColumn: index.has("VOLUME"),
    rowsTotal: dataRows.length,
    rows: kept,
    rejected,
    duplicateLines,
    seriesFound: [...series].sort(),
    symbolsFound: [...symbols].sort(),
  };
}
