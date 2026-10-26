"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Client loader for GET /api/news (Stage 3). One request per company page
 * visit (the server caches for 2 h); the in-flight request is aborted when the
 * company changes, and results are stored with their symbol so a late reply
 * for a previous company is never shown under the current one.
 */

export type NewsState = "ok" | "empty" | "stale" | "not-configured" | "quota-exhausted" | "rate-limited" | "unavailable";

export interface NewsArticleView {
  id: string;
  title: string;
  description: string | null;
  url: string;
  publisher: string;
  publishedAt: string;
  provider: string;
  relevance: "verified" | "likely";
  matchReason: string;
}

export interface NewsData {
  company: { symbol: string; name: string };
  state: NewsState;
  windowDays: number;
  window: { from: string; to: string };
  provider: string;
  providerDelayHours: number;
  fetchedAt: string | null;
  cached: boolean;
  totalMatches: number | null;
  retrievedCount: number;
  maxPerRequest: number;
  rejectedCount: number;
  duplicateCount: number;
  articles: NewsArticleView[];
  message: string | null;
  staleReason: "quota-exhausted" | "rate-limited" | "unavailable" | null;
  retryAfter: string | null;
  attribution: string;
}

export type NewsView =
  | { status: "loading" }
  | { status: "ready"; data: NewsData; refreshing: boolean }
  | { status: "error"; message: string };

const STATES: NewsState[] = ["ok", "empty", "stale", "not-configured", "quota-exhausted", "rate-limited", "unavailable"];
const TIMEOUT_MS = 25_000;

const isStr = (v: unknown): v is string => typeof v === "string";

/** Defensive validation: only http(s) links, only this company's articles. */
export function validateNewsResponse(body: unknown, symbol: string): NewsData {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") throw new Error("News response is not an object.");
  const company = b.company as { symbol?: unknown; name?: unknown } | undefined;
  if (company?.symbol !== symbol) throw new Error(`News response is for ${String(company?.symbol)}, not ${symbol}.`);
  if (!STATES.includes(b.state as NewsState)) throw new Error("Unknown news state.");
  const articles = (Array.isArray(b.articles) ? b.articles : []).flatMap((raw): NewsArticleView[] => {
    const a = raw as Record<string, unknown>;
    if (!isStr(a.id) || !isStr(a.title) || !isStr(a.url) || !isStr(a.publisher) || !isStr(a.publishedAt)) return [];
    let href: URL;
    try {
      href = new URL(a.url);
    } catch {
      return [];
    }
    if (href.protocol !== "https:" && href.protocol !== "http:") return [];
    if (Number.isNaN(Date.parse(a.publishedAt))) return [];
    return [
      {
        id: a.id,
        title: a.title,
        description: isStr(a.description) ? a.description : null,
        url: href.toString(),
        publisher: a.publisher,
        publishedAt: a.publishedAt,
        provider: isStr(a.provider) ? a.provider : "",
        relevance: a.relevance === "verified" ? "verified" : "likely",
        matchReason: isStr(a.matchReason) ? a.matchReason : "",
      },
    ];
  });
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    company: { symbol, name: isStr(company?.name) ? company.name : symbol },
    state: b.state as NewsState,
    windowDays: num(b.windowDays) ?? 14,
    window: (b.window as { from: string; to: string }) ?? { from: "", to: "" },
    provider: isStr(b.provider) ? b.provider : "",
    providerDelayHours: num(b.providerDelayHours) ?? 0,
    fetchedAt: isStr(b.fetchedAt) ? b.fetchedAt : null,
    cached: b.cached === true,
    totalMatches: num(b.totalMatches),
    retrievedCount: num(b.retrievedCount) ?? 0,
    maxPerRequest: num(b.maxPerRequest) ?? 10,
    rejectedCount: num(b.rejectedCount) ?? 0,
    duplicateCount: num(b.duplicateCount) ?? 0,
    articles,
    message: isStr(b.message) ? b.message : null,
    staleReason: b.staleReason === "quota-exhausted" || b.staleReason === "rate-limited" || b.staleReason === "unavailable" ? b.staleReason : null,
    retryAfter: isStr(b.retryAfter) ? b.retryAfter : null,
    attribution: isStr(b.attribution) ? b.attribution : "",
  };
}

type Stored = { symbol: string; token: number } & ({ ok: true; data: NewsData } | { ok: false; message: string });

export function useCompanyNews(symbol: string) {
  const [req, setReq] = useState({ token: 0, force: false });
  const [stored, setStored] = useState<Stored | null>(null);
  const [lastGood, setLastGood] = useState<{ symbol: string; data: NewsData } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, TIMEOUT_MS);
    const qs = new URLSearchParams({ symbol });
    if (req.force) qs.set("refresh", "1");
    const token = req.token;
    fetch(`/api/news?${qs}`, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`);
        return validateNewsResponse(body, symbol);
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setStored({ symbol, token, ok: true, data });
        if (data.articles.length > 0 || data.state === "empty") setLastGood({ symbol, data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted && !timedOut) return;
        setStored({ symbol, token, ok: false, message: timedOut ? "The news request timed out." : error instanceof Error ? error.message : "Unable to fetch recent news." });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `req.force` only shapes this request; `symbol` + token define it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, req.token]);

  const refresh = useCallback(() => setReq((r) => ({ token: r.token + 1, force: true })), []);
  const retry = useCallback(() => setReq((r) => ({ token: r.token + 1, force: false })), []);

  let view: NewsView;
  if (stored && stored.symbol === symbol && stored.token === req.token) {
    view = stored.ok ? { status: "ready", data: stored.data, refreshing: false } : { status: "error", message: stored.message };
  } else if (lastGood && lastGood.symbol === symbol) {
    view = { status: "ready", data: lastGood.data, refreshing: true };
  } else {
    view = { status: "loading" };
  }
  return { view, refresh, retry };
}
