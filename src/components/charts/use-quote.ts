"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Delayed quote for ONE selected security from GET /api/quotes (Stage 2C).
 * Independent of the chart's history request, so a slow quote never blocks
 * the chart and vice versa.
 *
 * - Aborts the in-flight request when the selection changes; results are
 *   stored with the key they were fetched for and shown only for that key.
 * - Background refresh only for the selected stock, only while the server
 *   reports the market session as open/pre-open and the tab is visible. The
 *   server-side TTL cache still bounds upstream NSE calls.
 */

export interface QuoteData {
  symbol: string;
  series: string;
  sourceId: "nse-cm-market-mcp" | "cached-stale" | "unavailable";
  sourceLabel: string;
  delayNote: string;
  isStale: boolean;
  fetchedAt: string | null;
  cached: boolean;
  marketSession: "open" | "pre-open" | "closed";
  unavailableReason: string | null;
  attribution: string;
  quote: {
    lastPrice: number;
    previousClose: number | null;
    change: number | null;
    changePct: number | null;
    changeComputed: boolean;
    open: number | null;
    high: number | null;
    low: number | null;
    volume: number | null;
    exchangeTimestamp: string | null;
  } | null;
}

export type QuoteView =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: QuoteData; refreshing: boolean }
  | { status: "error"; code: string | null; message: string; retryable: boolean };

export const QUOTE_TIMEOUT_MS = 15_000;
/** Last validated quote per security for this page load (never another security's). */
const cache = new Map<string, QuoteData>();

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Rejects anything that is not a delayed quote for exactly the requested security. */
export function validateQuoteResponse(body: unknown, expected: { symbol: string; series: string }): QuoteData {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") throw new Error("Quote response is not an object.");
  if (b.symbol !== expected.symbol || b.series !== expected.series) throw new Error(`Quote response is for ${String(b.symbol)} ${String(b.series)}.`);
  if (b.dataMode !== "DELAYED_QUOTE") throw new Error("Response is not a delayed quote.");
  const sourceId = b.sourceId;
  if (sourceId !== "nse-cm-market-mcp" && sourceId !== "cached-stale" && sourceId !== "unavailable") throw new Error("Unknown quote source.");
  const q = b.quote as Record<string, unknown> | null;
  let quote: QuoteData["quote"] = null;
  if (q) {
    if (!isNum(q.lastPrice) || q.lastPrice <= 0) throw new Error("Quote has no valid last price.");
    const opt = (v: unknown) => (isNum(v) ? v : null);
    quote = {
      lastPrice: q.lastPrice,
      previousClose: opt(q.previousClose),
      change: opt(q.change),
      changePct: opt(q.changePct),
      changeComputed: q.changeComputed === true,
      open: opt(q.open),
      high: opt(q.high),
      low: opt(q.low),
      volume: isNum(q.volume) && Number.isSafeInteger(q.volume) && q.volume >= 0 ? q.volume : null,
      exchangeTimestamp: typeof q.exchangeTimestamp === "string" && !Number.isNaN(Date.parse(q.exchangeTimestamp)) ? q.exchangeTimestamp : null,
    };
  } else if (sourceId !== "unavailable") {
    throw new Error("Quote missing for an available source.");
  }
  return {
    symbol: expected.symbol,
    series: expected.series,
    sourceId,
    sourceLabel: typeof b.sourceLabel === "string" ? b.sourceLabel : String(sourceId),
    delayNote: typeof b.delayNote === "string" ? b.delayNote : "",
    isStale: b.isStale === true,
    fetchedAt: typeof b.fetchedAt === "string" ? b.fetchedAt : null,
    cached: b.cached === true,
    marketSession: b.marketSession === "open" || b.marketSession === "pre-open" ? b.marketSession : "closed",
    unavailableReason: typeof b.unavailableReason === "string" ? b.unavailableReason : null,
    attribution: typeof b.attribution === "string" ? b.attribution : "",
    quote,
  };
}

class QuoteHttpError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly status: number,
  ) {
    super(message);
  }
}

type Stored = { key: string; token: number } & ({ ok: true; data: QuoteData } | { ok: false; code: string | null; message: string; retryable: boolean });

export function useQuote(security: { symbol: string; series: string } | null, opts: { enabled: boolean; autoRefreshMs: number }) {
  const key = security ? `${security.symbol}|${security.series}` : null;
  /** Each value of `req.token` is one request; `force` bypasses the server cache (manual refresh). */
  const [req, setReq] = useState({ token: 0, force: false });
  const token = req.token;
  const [stored, setStored] = useState<Stored | null>(null);

  useEffect(() => {
    if (!security || !key || !opts.enabled) return;
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, QUOTE_TIMEOUT_MS);
    const qs = new URLSearchParams({ symbol: security.symbol, series: security.series });
    if (req.force) qs.set("refresh", "1");

    fetch(`/api/quotes?${qs}`, { signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
          throw new QuoteHttpError(err?.message ?? `HTTP ${res.status}`, err?.code ?? null, res.status);
        }
        return validateQuoteResponse(body, security);
      })
      .then((data) => {
        cache.set(key, data);
        if (!controller.signal.aborted) setStored({ key, token, ok: true, data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted && !timedOut) return; // superseded by a newer selection/request
        if (timedOut) {
          setStored({ key, token, ok: false, code: "TIMEOUT", message: `No quote response within ${QUOTE_TIMEOUT_MS / 1000} seconds.`, retryable: true });
        } else if (error instanceof QuoteHttpError) {
          setStored({ key, token, ok: false, code: error.code, message: error.message, retryable: error.status >= 429 });
        } else {
          setStored({ key, token, ok: false, code: "INVALID", message: error instanceof Error ? error.message : "Quote request failed.", retryable: true });
        }
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `security` is represented by `key`; `req.force` only decides ?refresh=1 for this token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, token, opts.enabled]);

  // Background refresh: selected stock only, market open, tab visible.
  const session = stored?.key === key && stored.ok ? stored.data.marketSession : null;
  useEffect(() => {
    if (!key || !opts.enabled || opts.autoRefreshMs <= 0 || (session !== "open" && session !== "pre-open")) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setReq((r) => ({ token: r.token + 1, force: false }));
    }, opts.autoRefreshMs);
    return () => window.clearInterval(id);
  }, [key, session, opts.enabled, opts.autoRefreshMs]);

  const refresh = useCallback(() => setReq((r) => ({ token: r.token + 1, force: true })), []);

  let view: QuoteView;
  if (!key || !opts.enabled) view = { status: "idle" };
  else if (stored && stored.key === key && stored.token === token) {
    view = stored.ok ? { status: "ready", data: stored.data, refreshing: false } : { status: "error", code: stored.code, message: stored.message, retryable: stored.retryable };
  } else {
    // Request in flight: show only THIS security's last quote (if any), marked refreshing.
    const hit = cache.get(key);
    view = hit ? { status: "ready", data: hit, refreshing: true } : { status: "loading" };
  }
  return { view, refresh };
}
