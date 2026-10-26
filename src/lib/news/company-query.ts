/**
 * Company identity -> news search terms. Pure and deterministic.
 *
 * Rules (Stage 3):
 * - Search by the verified directory name, normalised for search only:
 *   corporate suffixes ("Limited", "Ltd.", "(India)") are dropped; the stored
 *   legal name is never modified.
 * - The NSE symbol is NOT a search term by default (TCS, ITC, BEL, ... collide
 *   with other meanings). Only the small hand-verified ALIASES below may add
 *   short forms, and each alias declares whether it is unambiguous on its own
 *   ("strong") or needs a company-context word next to it ("weak").
 * - Names whose core is a single short token (e.g. "ITC Limited") are treated
 *   as ambiguous: they need an alias rule or context to match.
 */

export interface Alias {
  /** Case-insensitive term as written in news (e.g. "RIL"). */
  term: string;
  /** strong: names the company by itself. weak: only with a company/market context word. */
  strength: "strong" | "weak";
}

export interface CompanySearchProfile {
  symbol: string;
  legalName: string;
  /** Normalised full name, e.g. "Tata Consultancy Services". */
  searchName: string;
  /** Additional verified names/short forms. */
  aliases: Alias[];
  /**
   * Different listed companies whose names contain the search name
   * (e.g. "ITC Hotels" for ITC, "Reliance Power" for RELIANCE). Mentions of
   * these do not count as mentions of the selected company.
   */
  siblings: string[];
  /** True when the core name alone is a short, collision-prone token. */
  ambiguousName: boolean;
}

/**
 * Hand-verified aliases (Stage 3). Keep this list short and reviewed:
 * each entry is a well-established name used by Indian business media for
 * that specific NSE company. Symbols that collide with common words or other
 * organisations are "weak".
 */
export const VERIFIED_ALIASES: Record<string, Alias[]> = {
  RELIANCE: [
    { term: "RIL", strength: "strong" },
    { term: "Reliance Industries", strength: "strong" },
  ],
  TCS: [{ term: "TCS", strength: "weak" }],
  INFY: [{ term: "Infosys", strength: "strong" }],
  HDFCBANK: [{ term: "HDFC Bank", strength: "strong" }],
  ITC: [
    { term: "ITC Ltd", strength: "strong" },
    { term: "ITC Limited", strength: "strong" },
    { term: "ITC", strength: "weak" },
  ],
};

const SUFFIXES = [
  /\s*\((?:india|i)\)\s*$/i,
  /\s*,?\s*(?:limited|ltd\.?|ltd|pvt\.?\s*ltd\.?|private\s+limited|corporation|corp\.?)\s*$/i,
  /\s*\.+\s*$/,
];

/** "Tata Consultancy Services Limited" -> "Tata Consultancy Services". */
export function normalizeCompanyName(legalName: string): string {
  let name = legalName.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) for (const re of SUFFIXES) name = name.replace(re, "").trim();
  return name;
}

/** Words that tie a weak alias to the company (case-insensitive, whole words). */
export const CONTEXT_WORDS = [
  "share", "shares", "stock", "stocks", "nse", "bse", "q1", "q2", "q3", "q4", "quarter", "results", "earnings",
  "profit", "revenue", "dividend", "ceo", "md", "chairman", "board", "ltd", "limited", "company", "group",
  "sensex", "nifty", "market cap", "m-cap", "deal", "contract", "acquisition", "stake", "buyback", "guidance",
];

/**
 * Builds the search profile. `siblingNames` are other directory names (normalised)
 * that start with the same core words, e.g. for ITC: ["ITC Hotels"].
 */
export function buildSearchProfile(symbol: string, legalName: string, siblingNames: string[]): CompanySearchProfile {
  const searchName = normalizeCompanyName(legalName);
  const words = searchName.split(" ").filter(Boolean);
  const ambiguousName = words.length === 1 && searchName.length <= 4;
  // Drop an alias identical to the full name only when the name itself is usable
  // (for an ambiguous name like "ITC" the weak alias IS how it is matched).
  const aliases = (VERIFIED_ALIASES[symbol] ?? []).filter((a) => ambiguousName || a.term.toLowerCase() !== searchName.toLowerCase());
  const siblings = siblingNames
    .map(normalizeCompanyName)
    .filter((n) => n.toLowerCase() !== searchName.toLowerCase() && n.toLowerCase().startsWith(`${(words[0] ?? searchName).toLowerCase()} `))
    // Only siblings that are longer variants of our name or share its first word.
    .slice(0, 12);
  return { symbol, legalName, searchName, aliases, siblings, ambiguousName };
}

const quote = (s: string) => `"${s.replace(/"/g, "")}"`;

/**
 * GNews query (documented syntax: "phrase", OR, AND, NOT, parentheses; max 200 chars).
 * - Full name always, as an exact phrase.
 * - Strong aliases as phrases.
 * - Weak aliases only combined with a context term, e.g. (TCS AND (shares OR stock ...)).
 * Siblings are NOT excluded in the query (that would drop legitimate articles
 * mentioning both); they are handled by local matching.
 */
export function buildGNewsQuery(profile: CompanySearchProfile): string {
  const parts: string[] = [];
  if (!profile.ambiguousName) parts.push(quote(profile.searchName));
  for (const a of profile.aliases.filter((x) => x.strength === "strong")) parts.push(quote(a.term));
  const weak = profile.aliases.filter((x) => x.strength === "weak");
  const context = "(shares OR stock OR results OR NSE OR BSE OR stake)";
  for (const a of weak) parts.push(`(${quote(a.term)} AND ${context})`);
  if (parts.length === 0) parts.push(`(${quote(profile.searchName)} AND ${context})`);
  let q = parts.join(" OR ");
  // Respect the 200-character limit by dropping the lowest-priority (last) terms.
  while (q.length > 200 && parts.length > 1) {
    parts.pop();
    q = parts.join(" OR ");
  }
  return q.length > 200 ? q.slice(0, 200) : q;
}
