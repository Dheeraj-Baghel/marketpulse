import type { InstrumentKind, Segment } from "@/db/schema";

export const SEGMENT_LABEL: Record<Segment, string> = {
  MAINBOARD: "NSE Mainboard",
  SME: "NSE Emerge (SME)",
};

export const SEGMENT_SHORT: Record<Segment, string> = {
  MAINBOARD: "Mainboard",
  SME: "SME",
};

/** NSE series meanings (from NSE market-segment documentation). */
export const SERIES_LABEL: Record<string, string> = {
  EQ: "Rolling settlement",
  BE: "Trade-for-trade",
  BZ: "Trade-for-trade (non-compliant)",
  SM: "SME rolling settlement",
  ST: "SME trade-for-trade",
  SZ: "SME trade-for-trade (non-compliant)",
};

export const INSTRUMENT_LABEL: Record<InstrumentKind, string> = {
  EQUITY_SHARE: "Equity share",
  DVR_OR_PARTLY_PAID: "DVR / partly paid share",
  RIGHTS_ENTITLEMENT: "Rights entitlement",
};

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata",
  timeZoneName: "short",
});
const intFmt = new Intl.NumberFormat("en-IN");

/** "2008-10-06" -> "06 Oct 2008". */
export function formatIsoDate(iso: string | null): string {
  if (!iso) return "Not provided";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "Not provided" : dateFmt.format(d);
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Unknown" : dateTimeFmt.format(d);
}

export function formatInt(n: number): string {
  return intFmt.format(n);
}

export function formatRupees(n: number | null): string {
  return n === null ? "Not provided" : `\u20B9${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

export function stockHref(symbol: string): string {
  return `/stocks/${encodeURIComponent(symbol)}`;
}
