"use client";

import { useCallback, useEffect, useState } from "react";
import { PriceResponseError, validatePriceResponse, type ValidatedSeries } from "@/lib/charts/candles";

/**
 * Loads the full stored daily history for ONE security from the Stage 2A
 * endpoint (GET /api/prices?symbol=&series=&range=MAX). Ranges are applied
 * client-side so switching 1M/3M/... never refetches.
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
 * Stage 2C: the first ALL-history load from NSE Bhavcopy MCP chains ~21
 * three-month chunks server-side (a few seconds normally), so the client
 * budget is longer than for the local CSV path.
 */
export const REQUEST_TIMEOUT_MS = 45_000;
const CACHE_LIMIT = 24;
/** Successful results only; errors are never cached. Cleared on page reload. */
const cache = new Map<string, ValidatedSeries>();

export function securityKey(s: SecurityKey): string {
  return `${s.symbol}|${s.series}`;
}

function cacheGet(key: string): ValidatedSeries | undefined {
  return cache.get(key);
}

function cacheSet(key: string, value: ValidatedSeries) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
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

async function fetchHistory(security: SecurityKey, signal: AbortSignal, refresh: boolean): Promise<ValidatedSeries> {
  const qs = new URLSearchParams({ symbol: security.symbol, series: security.series, range: "MAX" });
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
  return validatePriceResponse(body, security);
}

function classify(error: unknown, timedOut: boolean): ChartError {
  if (timedOut) {
    return { kind: "timeout", title: "Price data took too long to load", message: `No response from the local price service within ${REQUEST_TIMEOUT_MS / 1000} seconds.`, retryable: true };
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

type Stored = { key: string; attempt: number } & (
  | { status: "ready" | "empty"; data: ValidatedSeries; error: null }
  | { status: "error"; data: null; error: ChartError }
);

/**
 * @param security  selected security, or null for none
 * @param initial   optional server-provided, already validated history for `security` (details page)
 */
export function usePriceHistory(security: SecurityKey | null, initial?: { key: string; data: ValidatedSeries } | null) {
  const key = security ? securityKey(security) : null;
  /**
   * Each attempt value is one request. `refreshFor` names the security whose
   * current attempt is a manual refresh (bypasses client + server cache);
   * switching to another security never inherits it.
   */
  const [req, setReq] = useState<{ attempt: number; refreshFor: string | null }>({ attempt: 0, refreshFor: null });
  const attempt = req.attempt;
  const [stored, setStored] = useState<Stored | null>(null);

  const refreshing = req.refreshFor !== null && req.refreshFor === key;
  const seeded = initial && key === initial.key ? initial.data : undefined;

  useEffect(() => {
    if (!security || !key) return;
    if (!refreshing && (cacheGet(key) || seeded)) return;
    const controller = new AbortController();
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    fetchHistory(security, controller.signal, refreshing)
      .then((data) => {
        cacheSet(key, data);
        if (!controller.signal.aborted) {
          setStored({ key, attempt, status: data.candles.length > 0 ? "ready" : "empty", data, error: null });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted && !timedOut) return; // superseded by a newer selection
        setStored({ key, attempt, status: "error", data: null, error: classify(error, timedOut) });
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `security` is represented by `key`; `seeded` only short-circuits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setReq((r) => ({ attempt: r.attempt + 1, refreshFor: null })), []);
  /** Manual refresh: re-request from the source (server cache bypassed) while keeping the current chart visible. */
  const refresh = useCallback(() => setReq((r) => ({ attempt: r.attempt + 1, refreshFor: key })), [key]);

  let view: PriceHistoryView;
  const done = stored && stored.key === key && stored.attempt === attempt ? stored : null;
  const hit = key ? (cacheGet(key) ?? seeded) : undefined;
  let refreshError: ChartError | null = null;
  if (!key) view = { status: "idle", key: null, data: null, error: null };
  else if (done && done.status === "error" && refreshing && hit) {
    // A failed manual refresh keeps this security's existing chart and reports the error inline.
    view = { status: hit.candles.length > 0 ? "ready" : "empty", key, data: hit, error: null };
    refreshError = done.error;
  } else if (done) {
    view = done.status === "error" ? { status: "error", key, data: null, error: done.error } : { status: done.status, key, data: done.data, error: null };
  } else if (hit) {
    // Includes a manual refresh in flight: keep showing this security's own last data.
    view = { status: hit.candles.length > 0 ? "ready" : "empty", key, data: hit, error: null };
  } else view = { status: "loading", key, data: null, error: null };

  const isRefreshing = Boolean(key) && refreshing && !done;
  return { view, retry, refresh, isRefreshing, refreshError };
}
