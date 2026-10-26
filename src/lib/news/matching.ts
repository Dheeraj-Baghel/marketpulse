import { CONTEXT_WORDS, type CompanySearchProfile } from "./company-query";
import type { ProviderArticle, Relevance } from "./types";

/**
 * Deterministic relevance rules (no AI). Text is title + description only
 * (what the provider returns on the free plan).
 *
 *   verified  — the TITLE names the company (full name or strong alias), or
 *               the title has a weak alias right next to a context word.
 *   likely    — the description names the company by full name/strong alias,
 *               or a weak alias appears in the title with a context word
 *               anywhere in title+description.
 *   rejected  — only a sibling company is named (e.g. "ITC Hotels" for ITC),
 *               only a bare weak alias without context, or no mention at all.
 *
 * Mentions inside a sibling's name never count (e.g. "Reliance Power" is
 * not "Reliance Industries"; "ITC Hotels" is not "ITC").
 */

export type MatchOutcome = { relevance: Relevance; reason: string } | { relevance: "rejected"; reason: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word, case-insensitive matcher; tolerant of possessives ("Infosys'", "RIL's") and hyphens. */
function wordRe(term: string, flags = "i"): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(term).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, `${flags}u`);
}

/** Removes sibling-company names so their words cannot match the selected company. */
function maskSiblings(text: string, siblings: string[]): { text: string; hadSibling: boolean } {
  let out = text;
  let hadSibling = false;
  for (const s of [...siblings].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(wordRe(s).source, "giu");
    if (re.test(out)) {
      hadSibling = true;
      out = out.replace(new RegExp(wordRe(s).source, "giu"), " \u0000 ");
    }
  }
  return { text: out, hadSibling };
}

const CONTEXT_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${CONTEXT_WORDS.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "iu");

/**
 * Weak alias directly followed/preceded by a context word, e.g. "TCS shares",
 * "TCS Share Price", "stake in ITC", "TCS Q2". The ALIAS must match in exact
 * case (acronyms: "TCS", not "tcs"); context words match in any case.
 */
function weakNearContext(text: string, term: string): boolean {
  const t = escape(term);
  // Context alternation made case-insensitive per character class so the alias stays case-sensitive.
  const ci = (w: string) => w.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
  const ctx = CONTEXT_WORDS.map((w) => ci(escape(w))).join("|");
  const after = new RegExp(`(?<![\\p{L}\\p{N}])${t}(?:['’]s)?\\s+(?:${ctx})(?![\\p{L}\\p{N}])`, "u");
  const before = new RegExp(`(?<![\\p{L}\\p{N}])(?:${ctx})\\s+(?:[oO][fF]\\s+|[iI][nN]\\s+)?${t}(?![\\p{L}\\p{N}])`, "u");
  return after.test(text) || before.test(text);
}

export function matchArticle(article: Pick<ProviderArticle, "title" | "description">, profile: CompanySearchProfile): MatchOutcome {
  const title = maskSiblings(article.title, profile.siblings);
  const desc = maskSiblings(article.description ?? "", profile.siblings);
  const strongTerms = [profile.ambiguousName ? null : profile.searchName, ...profile.aliases.filter((a) => a.strength === "strong").map((a) => a.term)].filter((x): x is string => Boolean(x));
  const weakTerms = profile.aliases.filter((a) => a.strength === "weak").map((a) => a.term);

  const strongIn = (text: string) => strongTerms.find((t) => wordRe(t).test(text));
  // Weak aliases are acronyms/short tokens: require exact case (so "Tcs"/"itc" don't count).
  const weakIn = (text: string) => weakTerms.find((t) => wordRe(t, "").test(text));

  const st = strongIn(title.text);
  if (st) return { relevance: "verified", reason: `headline names "${st}"` };
  const wt = weakTerms.find((t) => weakNearContext(title.text, t));
  if (wt) return { relevance: "verified", reason: `headline names "${wt}" with market context` };

  const sd = strongIn(desc.text);
  if (sd) return { relevance: "likely", reason: `summary names "${sd}"` };
  const wtTitle = weakIn(title.text);
  if (wtTitle && (CONTEXT_RE.test(title.text) || CONTEXT_RE.test(desc.text))) {
    return { relevance: "likely", reason: `headline mentions "${wtTitle}" with market context` };
  }
  const wd = weakTerms.find((t) => weakNearContext(desc.text, t));
  if (wd) return { relevance: "likely", reason: `summary names "${wd}" with market context` };

  if (title.hadSibling || desc.hadSibling) return { relevance: "rejected", reason: "mentions only a different company with a similar name" };
  if (weakIn(title.text) || weakIn(desc.text)) return { relevance: "rejected", reason: "ambiguous abbreviation without company context" };
  return { relevance: "rejected", reason: "company not named in headline or summary" };
}
