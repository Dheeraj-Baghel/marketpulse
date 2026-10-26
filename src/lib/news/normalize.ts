import { createHash } from "node:crypto";
import { z } from "zod";
import type { NewsArticle, ProviderArticle } from "./types";

/**
 * Pure validation, window filtering, URL safety and de-duplication for news.
 */

// ---- GNews payload (shape verified 22 Oct 2026; docs/news/FINDINGS.md) ----
const gnewsArticle = z.object({
  id: z.string().optional().nullable(),
  title: z.string(),
  description: z.string().nullable().optional(),
  url: z.string(),
  publishedAt: z.string(),
  source: z.object({ name: z.string().nullable().optional(), url: z.string().nullable().optional() }).optional().nullable(),
});
export const gnewsResponseSchema = z.object({
  totalArticles: z.number().int().nonnegative().optional(),
  articles: z.array(z.unknown()),
});

const MAX_TITLE = 400;
const MAX_DESCRIPTION = 600;
/** Hard cap on the per-company payload we keep (well above max=10). */
const MAX_ARTICLES = 50;

/**
 * Only http(s) URLs with a real hostname, no credentials, no local/private
 * hosts, no script/data schemes. The server never fetches these URLs; they
 * are rendered as outbound links only.
 */
export function safeExternalUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) return null; // bare IPs
  u.hash = "";
  return u.toString();
}

/** Strips tags/control chars and collapses whitespace; text is rendered as plain text anyway. */
function cleanText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const t = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Strict ISO-8601 with an explicit zone; returns canonical UTC ISO or null. */
export function parsePublishedAt(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(raw.trim())) return null;
  const ms = Date.parse(raw.trim());
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export function parseGNewsArticles(rows: unknown[]): { articles: ProviderArticle[]; invalid: number } {
  const articles: ProviderArticle[] = [];
  let invalid = 0;
  for (const raw of rows.slice(0, MAX_ARTICLES)) {
    const p = gnewsArticle.safeParse(raw);
    if (!p.success) {
      invalid++;
      continue;
    }
    const url = safeExternalUrl(p.data.url);
    const title = cleanText(p.data.title, MAX_TITLE);
    const publishedAt = parsePublishedAt(p.data.publishedAt);
    if (!url || !title || !publishedAt) {
      invalid++;
      continue;
    }
    const publisher = cleanText(p.data.source?.name, 120) ?? new URL(url).hostname.replace(/^www\./, "");
    articles.push({
      providerId: typeof p.data.id === "string" && p.data.id.length <= 200 ? p.data.id : null,
      title,
      description: cleanText(p.data.description, MAX_DESCRIPTION),
      url,
      publisher,
      publisherUrl: safeExternalUrl(p.data.source?.url),
      publishedAt,
    });
  }
  invalid += Math.max(0, rows.length - MAX_ARTICLES);
  return { articles, invalid };
}

// ---- Rolling window --------------------------------------------------------
export function rollingWindow(now: Date, days: number): { from: string; to: string } {
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: now.toISOString() };
}

export function inWindow(publishedAt: string, window: { from: string; to: string }): boolean {
  const t = Date.parse(publishedAt);
  return t >= Date.parse(window.from) && t <= Date.parse(window.to);
}

// ---- De-duplication --------------------------------------------------------
const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|cmpid$|ocid$|src$|from$|amp$|output$)/i;

/** Canonical form used for duplicate detection only (the original URL is what we link to). */
export function normalizeUrlForDedupe(url: string): string {
  const u = new URL(url);
  u.protocol = "https:";
  u.hostname = u.hostname.toLowerCase().replace(/^(www|m|amp)\./, "");
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  let path = u.pathname.replace(/\/amp\/?$/i, "/").replace(/\.amp(\.html?)?$/i, "$1").replace(/\/+$/, "");
  if (!path) path = "/";
  return `${u.hostname}${path}${u.searchParams.size ? `?${u.searchParams}` : ""}`;
}

/** Lowercase, punctuation-free, whitespace-collapsed title for similarity checks. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenSet(t: string): Set<string> {
  return new Set(normalizeTitle(t).split(" ").filter((w) => w.length > 2));
}

/** Jaccard similarity of title word sets. */
export function titleSimilarity(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Removes duplicates, keeping the first (newest after sorting) occurrence:
 * 1. same provider id, 2. same canonical URL, 3. identical normalised title,
 * 4. near-identical title (Jaccard >= 0.9) from the SAME publisher, or within
 *    30 minutes from any publisher (syndicated copies).
 * Different publishers covering the same event hours apart are kept
 * (they are different articles with their own attribution).
 */
export function dedupeArticles<T extends { providerId?: string | null; url: string; title: string; publisher: string; publishedAt: string }>(items: T[]): { kept: T[]; removed: number } {
  const kept: T[] = [];
  const ids = new Set<string>();
  const urls = new Set<string>();
  const titles = new Map<string, T>();
  let removed = 0;
  for (const a of items) {
    const id = a.providerId ?? null;
    const canon = normalizeUrlForDedupe(a.url);
    const nt = normalizeTitle(a.title);
    const dupe =
      (id !== null && ids.has(id)) ||
      urls.has(canon) ||
      titles.has(nt) ||
      kept.some(
        (k) =>
          titleSimilarity(k.title, a.title) >= 0.9 &&
          (k.publisher.toLowerCase() === a.publisher.toLowerCase() || Math.abs(Date.parse(k.publishedAt) - Date.parse(a.publishedAt)) <= 30 * 60_000),
      );
    if (dupe) {
      removed++;
      continue;
    }
    if (id) ids.add(id);
    urls.add(canon);
    titles.set(nt, a);
    kept.push(a);
  }
  return { kept, removed };
}

/** Stable article id: provider id if present, else a hash of the canonical URL. */
export function articleId(providerId: string | null, url: string): string {
  return providerId ? `gn_${providerId}` : `u_${createHash("sha256").update(normalizeUrlForDedupe(url)).digest("hex").slice(0, 20)}`;
}

export function newestFirst<T extends { publishedAt: string }>(a: T, b: T): number {
  return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
}

export type { NewsArticle };
