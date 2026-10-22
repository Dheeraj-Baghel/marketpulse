import { PRICE_DECIMALS, PRICE_SCALE } from "@/db/schema";

/**
 * Exact, string-based decimal handling for prices. Values are never parsed
 * through floating point: "1,450.05" becomes the integer 14500500
 * (rupees x 10^4). This keeps storage and range checks exact, so OHLC
 * validation needs no numerical tolerance.
 */

/** Accepts plain digits, or digits grouped with commas (Indian "1,76,07,823" or Western "17,607,823"). */
const GROUPED = /^(?:\d+|\d{1,3}(?:,\d{2})*,\d{3}|\d{1,3}(?:,\d{3})+)$/;

export type ParseResult = { ok: true; value: number } | { ok: false; reason: string };

function splitNumber(raw: string): { int: string; frac: string } | null {
  const value = raw.trim();
  const match = /^([0-9,]+)(?:\.([0-9]+))?$/.exec(value);
  if (!match) return null;
  const [, intPart = "", frac = ""] = match;
  if (!GROUPED.test(intPart)) return null;
  return { int: intPart.replace(/,/g, ""), frac };
}

/** Parses a positive price into scaled integer units. Rejects (never rounds) excess precision. */
export function parseScaledPrice(raw: string | undefined): ParseResult {
  const text = (raw ?? "").trim();
  if (text === "" || text === "-") return { ok: false, reason: "missing value" };
  if (text.startsWith("-")) return { ok: false, reason: `negative value "${text}"` };
  const parts = splitNumber(text);
  if (!parts) return { ok: false, reason: `not a number "${text}"` };
  if (parts.frac.length > PRICE_DECIMALS) {
    return { ok: false, reason: `"${text}" has more than ${PRICE_DECIMALS} decimal places` };
  }
  const scaled = Number(parts.int) * PRICE_SCALE + Number(parts.frac.padEnd(PRICE_DECIMALS, "0") || "0");
  if (!Number.isSafeInteger(scaled)) return { ok: false, reason: `"${text}" is out of range` };
  if (scaled <= 0) return { ok: false, reason: `price must be positive, got "${text}"` };
  return { ok: true, value: scaled };
}

export type VolumeResult = { ok: true; value: number | null } | { ok: false; reason: string };

/** Whole-share volume. Empty or "-" means "not reported" (null), never 0. */
export function parseVolume(raw: string | undefined): VolumeResult {
  const text = (raw ?? "").trim();
  if (text === "" || text === "-") return { ok: true, value: null };
  if (text.startsWith("-")) return { ok: false, reason: `negative volume "${text}"` };
  const parts = splitNumber(text);
  if (!parts) return { ok: false, reason: `volume is not a number "${text}"` };
  if (parts.frac !== "" && !/^0+$/.test(parts.frac)) return { ok: false, reason: `volume must be a whole number, got "${text}"` };
  const value = Number(parts.int);
  if (!Number.isSafeInteger(value)) return { ok: false, reason: `volume "${text}" is out of range` };
  return { ok: true, value };
}

/** Scaled integer -> JSON number (e.g. 14500500 -> 1450.05). Exact for the stored precision. */
export function scaledToNumber(scaled: number): number {
  return scaled / PRICE_SCALE;
}

/** Scaled integer -> fixed decimal string with 2-4 decimals, for messages and display. */
export function formatScaled(scaled: number): string {
  const int = Math.trunc(scaled / PRICE_SCALE);
  const frac = String(scaled % PRICE_SCALE).padStart(PRICE_DECIMALS, "0").replace(/0{1,2}$/, "");
  return `${int}.${frac.length < 2 ? frac.padEnd(2, "0") : frac}`;
}
