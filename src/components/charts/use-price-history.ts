"use client";

import { useCallback, useEffect, useState } from "react";
import { PriceResponseError, validatePriceResponse, type ValidatedSeries, type ChartRange } from "@/lib/charts/candles";
import { historyApiRange, historyCovers, mergeLoadedHistory, HISTORY_DEPTH, type HistoryApiRange } from "@/lib/charts/history-loading";

/**
 * Paints recent (3M) daily history for ONE security first, then extends to the
 * requested API window. Short/day filters reuse loaded data; ALL alone requests
 * MAX. A failed longer load keeps verified recent candles and offers Retry.
 *
 * Stale-response protection (rapid company switching):
 *   1. every request is aborted when the selected security changes;
 *   2. results are stored with the key they were fetched for, and are only
 *      returned while that key is still the selected one.
 */

export type ChartErrorKind = "network" | "timeout" | "database" | "api" | "invalid-response" | "unavailable" | "ambiguous" | "bad-request";

export interface ChartError {
  kind: ChartErrorKind;
  title: string;
  message: string;
  retryable: boolean;
}

export type PriceHistoryView =
  | { status: "idle"; key: null; data: null; error: null }
  | { status: "loading"; key: string; data: null; error: null }
  | { status: "ready" | "empty"; key: string; data: ValidatedSeries; error: null }
  | { status: "error"; key: string; data: null; error: ChartError };

export interface SecurityKey {
  symbol: string;
  series: string;
}

/**
 * Total budget for recent-first loading plus a selected-range extension.
 * Already accepted candles remain visible if an extension reaches this budget.
 */
export const REQUEST_TIMEOUT_MS = 45_000;
const CACHE_LIMIT = 24;
/** Successful results only; errors are never cached. Cleared on page reload. */
const cache = new Map<string, { data: ValidatedSeries; depth: number; expires: number }>();

export function securityKey(s: SecurityKey): string {
  return `${s.symbol}|${s.series}`;
}

function cacheGet(key: string) {
  const entry = cache.get(key);
  if (entry && entry.expires <= Date.now()) { cache.delete(key); return undefined; }
  return entry;
}

function cacheSet(key: string, value: ValidatedSeries, range: HistoryApiRange) {
  const previous = cacheGet(key);
  const data = mergeLoadedHistory(previous?.data, value);
  const depth = data.meta.provider?.loadWarning ? (previous?.depth ?? 0) : Math.max(previous?.depth ?? 0, HISTORY_DEPTH[range]);
  cache.delete(key);
  cache.set(key, { data, depth, expires: Date.now() + (data.candles.length ? 5 * 60_000 : 30_000) });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return data;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

async function fetchHistory(security: SecurityKey, signal: AbortSignal, refresh: boolean, range: HistoryApiRange): Promise<ValidatedSeries> {
  const qs = new URLSearchParams({ symbol: security.symbol, series: security.series, range });
  if (refresh) qs.set("refresh", "1");
  const response = await fetch(`/api/prices?${qs}`, { signal, cache: "no-store", headers: { Accept: "application/json" } });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new PriceResponseError("The price service returned a response that is not JSON.");
  }
  if (!response.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new HttpError(response.status, err?.code ?? null, err?.message ?? `HTTP ${response.status}`);
  }
  const data = validatePriceResponse(body, security);
  // Also reject old-deployment HTTP 200 "empty" outage envelopes. Never cache
  // an upstream failure as proof that there is no historical data.
  if (!data.candles.length && data.meta.fallbackReason && !["NOT_FOUND", "SERIES_MISMATCH", "DISABLED", "OVERRIDE"].includes(data.meta.fallbackReason.code)) {
    throw new HttpError(502, `PROVIDER_${data.meta.fallbackReason.code}`, data.meta.fallbackReason.message);
  }
  return data;
}

function classify(error: unknown, timedOut: boolean): ChartError {
  if (timedOut) {
    return { kind: "timeout", title: "Price data took too long to load", message: `The price service did not finish within ${REQUEST_TIMEOUT_MS / 1000} seconds. Retry the request; any verified candles remain visible.`, retryable: true };
  }
  if (error instanceof PriceResponseError) {
    return { kind: "invalid-response", title: "Price data failed validation", message: error.message, retryable: true };
  }
  if (error instanceof HttpError) {
    if (error.code === "UNKNOWN_SECURITY" || error.code === "UNKNOWN_SERIES") {
      return { kind: "unavailable", title: "Security unavailable", message: error.message, retryable: false };
    }
    if (error.code === "AMBIGUOUS_SERIES") return { kind: "ambiguous", title: "Series is ambiguous", message: error.message, retryable: false };
    if (error.status === 400) return { kind: "bad-request", title: "Invalid price request", message: error.message, retryable: false };
    if (error.code === "PROVIDER_RATE_LIMITED") return { kind: "api", title: "NSE rate limit reached", message: error.message, retryable: true };
    if (error.code === "PROVIDER_TIMEOUT") return { kind: "timeout", title: "NSE Bhavcopy did not respond in time", message: error.message, retryable: true };
    if (error.code?.startsWith("PROVIDER_")) return { kind: "api", title: "NSE market-data provider error", message: error.message, retryable: true };
    if (error.code === "INTERNAL_ERROR" || error.status >= 500) {
      return { kind: "database", title: "Price database unavailable", message: error.message, retryable: true };
    }
    return { kind: "api", title: "Price service error", message: error.message, retryable: true };
  }
  return {
    kind: "network",
    title: "Could not reach the price service",
    message: error instanceof Error ? error.message : "Network request failed.",
    retryable: true,
  };
}

type Stored = { requestId: string } & (
  | { status: "ready" | "empty"; data: ValidatedSeries; error: null }
  | { status: "error"; data: null; error: ChartError }
);

/** Recent candles first; extend only to the selected range. Failed extensions
 * never hide an existing chart, and aborted/foreign responses cannot enter cache. */
export function usePriceHistory(security: SecurityKey | null, initial?: { key: string; data: ValidatedSeries } | null, range: ChartRange = "1Y") {
  const key = security ? securityKey(security) : null;
  const target = historyApiRange(range);
  const [req, setReq] = useState<{ attempt: number; refreshFor: string | null }>({ attempt: 0, refreshFor: null });
  const [stored, setStored] = useState<Stored | null>(null);
  const [finished, setFinished] = useState("");
  const refreshing = req.refreshFor !== null && req.refreshFor === key;
  const seeded = initial && key === initial.key ? initial.data : undefined;
  const requestId = `${key}|${target}|${req.attempt}`;

  useEffect(() => {
    if (!security || !key) return;
    const cached = cacheGet(key);
    if (!refreshing && cached && historyCovers(cached.data, cached.depth, target)) return;
    if (!refreshing && !cached && seeded && historyCovers(seeded, 1, target)) return;
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
    const publish = (data: ValidatedSeries, requested: HistoryApiRange) => {
      if (controller.signal.aborted) return;
      const merged = cacheSet(key, data, requested);
      setStored({ requestId, status: merged.candles.length ? "ready" : "empty", data: merged, error: null });
    };
    const load = async () => {
      if (!cacheGet(key) && seeded) cacheSet(key, seeded, "3M");
      if (!cacheGet(key)) {
        // Fetch one recent chunk before any multi-year traversal. One bounded
        // retry for transient gateway/network failures; never retry 429 here.
        let recent: ValidatedSeries;
        try { recent = await fetchHistory(security, controller.signal, false, "3M"); }
        catch (error) {
          const transient = error instanceof TypeError || (error instanceof HttpError && [502, 503].includes(error.status));
          if (!transient || controller.signal.aborted) throw error;
          await new Promise(resolve => setTimeout(resolve, 750));
          recent = await fetchHistory(security, controller.signal, false, "3M");
        }
        publish(recent, "3M");
      }
      if (controller.signal.aborted) return;
      const hit = cacheGet(key);
      if (refreshing || !hit || !historyCovers(hit.data, hit.depth, target)) {
        publish(await fetchHistory(security, controller.signal, refreshing, target), target);
      }
      if (!controller.signal.aborted) setFinished(requestId);
    };
    load().catch((error: unknown) => {
      if (controller.signal.aborted && !timedOut) return;
      setStored({ requestId, status: "error", data: null, error: classify(error, timedOut) });
      setFinished(requestId);
    }).finally(() => window.clearTimeout(timer));
    return () => { window.clearTimeout(timer); controller.abort(); };
    // Identity, requested API window and explicit retry determine this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, target, req.attempt]);

  const retry = useCallback(() => setReq(r => ({ attempt: r.attempt + 1, refreshFor: null })), []);
  const refresh = useCallback(() => setReq(r => ({ attempt: r.attempt + 1, refreshFor: key })), [key]);
  const entry = key ? cacheGet(key) : undefined;
  const hit = entry?.data ?? (stored?.requestId === requestId && stored.status !== "error" ? stored.data : undefined) ?? seeded;
  const done = stored?.requestId === requestId ? stored : null;
  let view: PriceHistoryView;
  let refreshError: ChartError | null = null;
  if (!key) view = { status: "idle", key: null, data: null, error: null };
  else if (done?.status === "error" && hit?.candles.length) {
    view = { status: "ready", key, data: hit, error: null };
    refreshError = done.error;
  } else if (done?.status === "error") view = { status: "error", key, data: null, error: done.error };
  else if (hit) view = { status: hit.candles.length ? "ready" : "empty", key, data: hit, error: null };
  else view = { status: "loading", key, data: null, error: null };
  const needsMore = hit && !historyCovers(hit, entry?.depth ?? 1, target);
  const isRefreshing = Boolean(hit && (refreshing || needsMore) && finished !== requestId);
  return { view, retry, refresh, isRefreshing, refreshError };
}
