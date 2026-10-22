import type { InstrumentKind, Segment } from "@/db/schema";
import { normaliseHeader, parseCsv } from "./csv";
import {
  SEGMENT_SERIES,
  instrumentKindFor,
  issuerCodeFromIsin,
  normaliseEquityIsin,
  normaliseName,
  normaliseSeries,
  normaliseSymbol,
  parseListingDate,
  parsePositiveNumber,
} from "./normalise";

/**
 * Parses one official NSE equity directory CSV (EQUITY_L.csv or
 * SME_EQUITY_L.csv) using the headers actually present in the file.
 *
 * Observed headers (downloaded October 2026):
 *   EQUITY_L.csv     SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE
 *   SME_EQUITY_L.csv SYMBOL,NAME_OF_COMPANY,SERIES,DATE_OF_LISTING,PAID_UP_VALUE,ISIN_NUMBER,FACE_VALUE,
 * Headers are matched after trimming/upper-casing and folding spaces to "_",
 * so column order and either spelling are accepted.
 */

export const REQUIRED_HEADERS = ["SYMBOL", "NAME_OF_COMPANY", "SERIES", "ISIN_NUMBER"] as const;
const OPTIONAL_HEADERS = ["DATE_OF_LISTING", "PAID_UP_VALUE", "MARKET_LOT", "FACE_VALUE"] as const;
type Header = (typeof REQUIRED_HEADERS)[number] | (typeof OPTIONAL_HEADERS)[number];

export interface ParsedSecurity {
  symbol: string;
  name: string;
  isin: string;
  issuerCode: string;
  series: string;
  instrumentKind: InstrumentKind;
  listingDate: string | null;
  faceValue: number | null;
  paidUpValue: number | null;
  marketLot: number | null;
}

export interface RowIssue {
  line: number;
  reason: string;
}

export interface ParsedDirectory {
  segment: Segment;
  headers: string[];
  rowsTotal: number;
  records: ParsedSecurity[];
  rejected: RowIssue[];
  duplicates: RowIssue[];
  warnings: string[];
}

export class DirectoryFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectoryFormatError";
  }
}

/** Filename hint only; the series codes in the file must agree with it. */
export function segmentHintFromFileName(fileName: string): Segment | null {
  const base = fileName.toUpperCase();
  if (/SME/.test(base)) return "SME";
  if (/^EQUITY_L/.test(base.replace(/^.*[\\/]/, ""))) return "MAINBOARD";
  return null;
}

export function parseDirectory(
  text: string,
  options: { fileName: string; segment?: Segment; now?: Date },
): ParsedDirectory {
  const rows = parseCsv(text);
  const headerRow = rows[0];
  if (!headerRow) throw new DirectoryFormatError(`${options.fileName} is empty.`);

  const headers = headerRow.map(normaliseHeader);
  const index = new Map<Header, number>();
  headers.forEach((h, i) => {
    if ((REQUIRED_HEADERS as readonly string[]).includes(h) || (OPTIONAL_HEADERS as readonly string[]).includes(h)) {
      if (!index.has(h as Header)) index.set(h as Header, i);
    }
  });
  const missing = REQUIRED_HEADERS.filter((h) => !index.has(h));
  if (missing.length > 0) {
    throw new DirectoryFormatError(
      `${options.fileName} is not an NSE equity directory: missing column(s) ${missing.join(", ")}. ` +
        `Found: ${headerRow.map((h) => h.trim()).filter(Boolean).join(", ") || "(none)"}. ` +
        "ETF, bond, REIT/InvIT and other non-equity lists are intentionally not imported.",
    );
  }

  const dataRows = rows.slice(1);
  const cell = (row: string[], h: Header) => {
    const i = index.get(h);
    return i === undefined ? undefined : row[i];
  };

  // Decide the segment from the series codes actually present, cross-checked with the hint.
  const seriesCounts: Record<Segment, number> = { MAINBOARD: 0, SME: 0 };
  for (const row of dataRows) {
    const s = normaliseSeries(cell(row, "SERIES"));
    if (s && SEGMENT_SERIES.MAINBOARD.includes(s)) seriesCounts.MAINBOARD++;
    if (s && SEGMENT_SERIES.SME.includes(s)) seriesCounts.SME++;
  }
  const detected: Segment | null =
    seriesCounts.MAINBOARD === 0 && seriesCounts.SME === 0
      ? null
      : seriesCounts.SME > seriesCounts.MAINBOARD
        ? "SME"
        : "MAINBOARD";
  const requested = options.segment ?? segmentHintFromFileName(options.fileName) ?? detected;
  if (!requested || !detected) {
    throw new DirectoryFormatError(
      `${options.fileName} contains no NSE equity series (${[...SEGMENT_SERIES.MAINBOARD, ...SEGMENT_SERIES.SME].join("/")}).`,
    );
  }
  if (requested !== detected) {
    throw new DirectoryFormatError(
      `${options.fileName} looks like a ${detected} directory by its series codes, but ${requested} was expected. ` +
        "Pass --segment explicitly only if you are sure.",
    );
  }
  const segment = requested;
  const allowedSeries = SEGMENT_SERIES[segment];

  const records: ParsedSecurity[] = [];
  const rejected: RowIssue[] = [];
  const duplicates: RowIssue[] = [];
  const seen = new Map<string, number>();
  const isinOwner = new Map<string, string>();
  const warnings: string[] = [];

  dataRows.forEach((row, i) => {
    const line = i + 2; // 1-based, after the header line
    const symbol = normaliseSymbol(cell(row, "SYMBOL"));
    if (!symbol) return rejected.push({ line, reason: `invalid or missing symbol "${cell(row, "SYMBOL") ?? ""}"` });
    const name = normaliseName(cell(row, "NAME_OF_COMPANY"));
    if (!name) return rejected.push({ line, reason: `${symbol}: missing or invalid company name` });
    const series = normaliseSeries(cell(row, "SERIES"));
    if (!series) return rejected.push({ line, reason: `${symbol}: missing or invalid series` });
    if (!allowedSeries.includes(series)) {
      return rejected.push({ line, reason: `${symbol}: series ${series} is not a ${segment} equity series` });
    }
    const isinResult = normaliseEquityIsin(cell(row, "ISIN_NUMBER"));
    if (!isinResult.ok) return rejected.push({ line, reason: `${symbol}: ${isinResult.reason}` });
    const isin = isinResult.isin;

    const key = `${symbol}|${series}`;
    const firstLine = seen.get(key);
    if (firstLine !== undefined) {
      return duplicates.push({ line, reason: `${symbol} ${series} repeats line ${firstLine}; kept the first` });
    }
    seen.set(key, line);

    const owner = isinOwner.get(isin);
    if (owner && owner !== symbol) warnings.push(`ISIN ${isin} is shared by ${owner} and ${symbol}`);
    isinOwner.set(isin, symbol);

    const lot = parsePositiveNumber(cell(row, "MARKET_LOT"));
    records.push({
      symbol,
      name,
      isin,
      issuerCode: issuerCodeFromIsin(isin),
      series,
      instrumentKind: instrumentKindFor(symbol, isin),
      listingDate: parseListingDate(cell(row, "DATE_OF_LISTING"), options.now),
      faceValue: parsePositiveNumber(cell(row, "FACE_VALUE")),
      paidUpValue: parsePositiveNumber(cell(row, "PAID_UP_VALUE")),
      marketLot: lot !== null && Number.isInteger(lot) ? lot : null,
    });
  });

  return { segment, headers, rowsTotal: dataRows.length, records, rejected, duplicates, warnings };
}
