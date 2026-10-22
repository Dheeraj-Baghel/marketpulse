import type { InstrumentKind, Segment } from "@/db/schema";

/**
 * Validation and normalisation for NSE "Securities available for trading"
 * equity directories. Pure functions only: no I/O, no database.
 *
 * Source page (downloaded manually by the user, never fetched by this app):
 * https://www.nseindia.com/static/market-data/securities-available-for-trading
 */

/** Trading series NSE uses on each equity list. Anything else is rejected. */
export const SEGMENT_SERIES: Record<Segment, readonly string[]> = {
  // EQ rolling, BE/BZ trade-for-trade (BZ = non-compliant/suspended category).
  MAINBOARD: ["EQ", "BE", "BZ"],
  // SM/ST/SZ are the NSE Emerge (SME) equivalents.
  SME: ["SM", "ST", "SZ"],
};

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&-]{0,19}$/;
/**
 * Indian equity ISINs start with INE (company issued) or IN9 (partly paid /
 * DVR style). INF (mutual fund / ETF units) and others are not companies.
 */
const EQUITY_ISIN_RE = /^IN[E9][A-Z0-9]{8}[0-9]$/;
const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

export function normaliseSymbol(raw: string | undefined): string | null {
  const value = (raw ?? "").trim().toUpperCase();
  return SYMBOL_RE.test(value) ? value : null;
}

export function normaliseName(raw: string | undefined): string | null {
  const value = (raw ?? "").replace(/\s+/g, " ").trim();
  if (value.length < 2 || value.length > 200) return null;
  // Must contain at least one letter; rejects placeholders like "-" or "0".
  return /[A-Za-z]/.test(value) ? value : null;
}

export function normaliseSeries(raw: string | undefined): string | null {
  const value = (raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{2}$/.test(value) ? value : null;
}

/** ISO 6166 check digit: letters -> numbers, then Luhn over the digit string. */
export function isValidIsinChecksum(isin: string): boolean {
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
  const digits = isin
    .slice(0, 11)
    .split("")
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join("");
  let sum = 0;
  let double = true; // rightmost digit of the payload is doubled
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10 === Number(isin[11]);
}

export type IsinResult = { ok: true; isin: string } | { ok: false; reason: string };

export function normaliseEquityIsin(raw: string | undefined): IsinResult {
  const isin = (raw ?? "").trim().toUpperCase();
  if (!isin) return { ok: false, reason: "missing ISIN" };
  if (isin.startsWith("INF")) return { ok: false, reason: `fund/ETF ISIN ${isin} is not a company security` };
  if (!EQUITY_ISIN_RE.test(isin)) return { ok: false, reason: `malformed equity ISIN "${isin}"` };
  if (!isValidIsinChecksum(isin)) return { ok: false, reason: `ISIN ${isin} fails its check digit` };
  return { ok: true, isin };
}

/** Characters 4-7 identify the issuing company, e.g. INE144J01027 -> 144J. */
export function issuerCodeFromIsin(isin: string): string {
  return isin.slice(3, 7);
}

export function instrumentKindFor(symbol: string, isin: string): InstrumentKind {
  // Rights entitlements carry a "-RE" symbol suffix and security code 20.
  if (symbol.endsWith("-RE") || isin.slice(7, 9) === "20") return "RIGHTS_ENTITLEMENT";
  if (isin.startsWith("IN9")) return "DVR_OR_PARTLY_PAID";
  return "EQUITY_SHARE";
}

/** "06-OCT-2008" or "22-Oct-26" -> "2008-10-06" / "2026-10-22"; otherwise null. */
export function parseListingDate(raw: string | undefined, now = new Date()): string | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec((raw ?? "").trim());
  if (!match) return null;
  const [, dd = "", mon = "", yy = ""] = match;
  const month = MONTHS[mon.toUpperCase()];
  if (!month) return null;
  let year = Number(yy);
  if (yy.length === 2) {
    // Two-digit years appear in the SME file. Prefer 20xx unless that is in the future.
    year = 2000 + year > now.getUTCFullYear() + 1 ? 1900 + year : 2000 + year;
  }
  const day = Number(dd);
  const date = new Date(Date.UTC(year, Number(month) - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== Number(month) - 1) return null;
  return `${year.toString().padStart(4, "0")}-${month}-${String(day).padStart(2, "0")}`;
}

export function parsePositiveNumber(raw: string | undefined): number | null {
  const value = (raw ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
