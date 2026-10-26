// Regression coverage for the user's AARTIIND chart failure. Synthetic provider
// fixtures only: an outage must not masquerade as confirmed absence of history,
// nor discard already validated recent candles while extending older ranges.
import assert from "node:assert/strict";
import { test } from "node:test";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { McpProviderError, isRecoverableMcpSession } from "../../src/lib/market-data/nse-mcp-client";
import { NseBhavcopyHistoryProvider } from "../../src/lib/market-data/nse-history-provider";
import { historyApiRange, historyCovers, mergeLoadedHistory } from "../../src/lib/charts/history-loading";
import { validatePriceResponse } from "../../src/lib/charts/candles";
import { createServer } from "node:http";
import { NseMcpClient } from "../../src/lib/market-data/nse-mcp-client";

const now = () => new Date("2026-10-26T12:00:00Z");
const row = (date: string) => ({ symbol: "AARTIIND", series: "EQ", date, open: 100, high: 120, low: 90, close: 110, volume: 1000 });
const payload = (date: string, next: string | null) => ({ symbol: "AARTIIND", data: [row(date)], ...(next ? { next_end_date: next } : {}) });

test("proxy upstream -32000 and closed-session errors get one recoverable classification, not timeouts/rate limits", () => {
  assert.equal(isRecoverableMcpSession(new McpError(-32000, "Upstream error")), true);
  assert.equal(isRecoverableMcpSession(new McpError(ErrorCode.ConnectionClosed, "Connection closed")), true);
  assert.equal(isRecoverableMcpSession(new McpError(ErrorCode.RequestTimeout, "Timeout")), false);
  assert.equal(isRecoverableMcpSession(new McpProviderError("RATE_LIMITED", "slow down", "bhavcopy", true)), false);
  assert.equal(isRecoverableMcpSession(new McpError(-32000, "Rate limit exceeded")), false);
});

test("older chunk outage returns valid recent candles with an explicit retryable warning", async () => {
  let calls = 0;
  const mcp = { enabled: true, health: () => [], async callJson() {
    calls++;
    if (calls === 1) return payload("2026-10-23", "2026-07-22");
    throw new McpProviderError("UNAVAILABLE", "upstream error", "bhavcopy", true);
  } };
  const provider = new NseBhavcopyHistoryProvider(mcp, { ttlMs: 60_000, now });
  const result = await provider.getHistory({ symbol: "AARTIIND", series: "EQ" }, null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.history.candles.length, 1);
  assert.equal(result.history.nextEndDate, "2026-07-22");
  assert.match(result.warning?.message ?? "", /upstream/i);
  assert.equal(result.warning?.retryable, true);
  assert.equal(provider.cache.get("AARTIIND|EQ")?.candles.length, 1);
});

test("an unsuccessful history extension does not erase a previously cached range", async () => {
  let fail = false;
  const mcp = { enabled: true, health: () => [], async callJson() {
    if (fail) throw new McpProviderError("TIMEOUT", "timeout", "bhavcopy", true);
    return payload("2026-07-24", "2026-07-22");
  } };
  const provider = new NseBhavcopyHistoryProvider(mcp, { ttlMs: 60_000, now });
  assert.equal((await provider.getHistory({ symbol: "AARTIIND", series: "EQ" }, "2026-08-01")).ok, true);
  fail = true;
  const result = await provider.getHistory({ symbol: "AARTIIND", series: "EQ" }, null);
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.history.candles.length, 1); assert.equal(result.warning?.code, "TIMEOUT"); }
});

test("failed first chunk remains a provider failure, not a confirmed no-history result", async () => {
  const mcp = { enabled: true, health: () => [], async callJson() { throw new McpProviderError("UNAVAILABLE", "upstream error", "bhavcopy", true); } };
  const provider = new NseBhavcopyHistoryProvider(mcp, { ttlMs: 60_000, now });
  const result = await provider.getHistory({ symbol: "AARTIIND", series: "EQ" }, null);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.kind, "provider");
});

test("client range policy never requests MAX on startup and only ALL needs all history", () => {
  assert.equal(historyApiRange("1D"), "3M"); assert.equal(historyApiRange("7D"), "3M");
  assert.equal(historyApiRange("1Y"), "1Y"); assert.equal(historyApiRange("ALL"), "MAX");
});

const series = (date: string, symbol = "AARTIIND", sourceId = "nse-bhavcopy-mcp") => validatePriceResponse({
  symbol, series: "EQ", dataMode: "HISTORICAL_EOD", interval: "1d", currency: "INR", sourceId,
  candles: [{ date, open: 100, high: 120, low: 90, close: 110, volume: 1000 }],
  provider: { fetchedAt: now().toISOString(), complete: false },
}, { symbol, series: "EQ" });

test("merging longer windows preserves recent candles, but never merges another symbol or source", () => {
  const latest = series("2026-10-23"), older = series("2025-10-24");
  const merged = mergeLoadedHistory(latest, older);
  assert.deepEqual(merged.candles.map(candle => candle.time), ["2025-10-24", "2026-10-23"]);
  assert.equal(historyCovers(latest, 1, "1Y"), false); assert.equal(historyCovers(merged, 3, "1Y"), true);
  assert.equal(historyCovers(merged, 3, "MAX"), false);
  assert.equal(mergeLoadedHistory(latest, series("2025-10-24", "OTHER")).candles.length, 1);
  assert.equal(mergeLoadedHistory(latest, series("2025-10-24", "AARTIIND", "local-csv")).candles.length, 1);
});

test("short local CSV requests are extended for 1Y/ALL rather than falsely treated as full history", () => {
  const data = series("2026-10-23", "AARTIIND", "local-csv");
  assert.equal(historyCovers(data, 1, "1Y"), false);
  assert.equal(historyCovers(data, 3, "1Y"), true);
  assert.equal(historyCovers(data, 3, "MAX"), false);
  assert.equal(historyCovers(data, 4, "MAX"), true);
});

test("a complete SERVER cache does not mean a sliced 3M client response contains ALL history", () => {
  const sliced = series("2026-10-23");
  sliced.meta.provider!.complete = true; sliced.meta.earliestTradingDate = "2024-01-01";
  assert.equal(historyCovers(sliced, 1, "MAX"), false);
  assert.equal(historyCovers(sliced, 1, "1Y"), false);
  const merged = mergeLoadedHistory(sliced, series("2026-07-24"));
  assert.equal(merged.meta.earliestTradingDate, "2024-01-01");
  const full = { ...sliced, candles: [{ ...sliced.candles[0]!, time: "2024-01-01" }, ...sliced.candles] };
  assert.equal(historyCovers(full, 1, "MAX"), true);
});

test("an older stale CSV fallback cannot erase newer verified NSE candles", () => {
  const current = series("2026-10-23");
  const fallback = series("2025-10-24", "AARTIIND", "local-csv");
  fallback.meta.isStale = true; fallback.meta.fallbackReason = { code: "UNAVAILABLE", message: "upstream down" };
  const result = mergeLoadedHistory(current, fallback);
  assert.equal(result.meta.sourceId, "nse-bhavcopy-mcp");
  assert.deepEqual(result.candles, current.candles);
  assert.equal(result.meta.provider?.loadWarning?.code, "UNAVAILABLE");
});

test("native MCP client reconnects once after proxy -32000, and never retries a rate limit", async () => {
  let sessions = 0, calls = 0, mode = "recover";
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") { response.writeHead(405); response.end(); return; }
    let text = ""; for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    if (body.method === "notifications/initialized") { response.writeHead(202); response.end(); return; }
    response.setHeader("Content-Type", "application/json");
    const result = (value: unknown) => response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: value }));
    if (body.method === "initialize") { sessions++; response.setHeader("mcp-session-id", `session-${sessions}`); result({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "synthetic-recovery", version: "1" } }); }
    else if (body.method === "tools/list") result({ tools: [{ name: "get_stock_history", inputSchema: { type: "object" } }] });
    else if (body.method === "tools/call") {
      calls++;
      if (mode === "rate" || calls === 1) response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: mode === "rate" ? "Rate limit exceeded" : "Upstream error" } }));
      else result({ content: [{ type: "text", text: JSON.stringify({ verified: true }) }] });
    } else result({});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Loopback address missing");
  const url = `http://127.0.0.1:${address.port}`;
  const client = new NseMcpClient({ enabled: true, urls: { bhavcopy: url, cmmkt: url }, timeoutMs: 2000, cooldownMs: 0, minIntervalMs: 0 });
  try {
    assert.deepEqual(await client.callJson("bhavcopy", "get_stock_history", { symbol: "AARTIIND" }), { verified: true });
    assert.equal(sessions, 2); assert.equal(calls, 2);
    mode = "rate";
    await assert.rejects(client.callJson("bhavcopy", "get_stock_history", { symbol: "AARTIIND" }), (error: { code?: string }) => error.code === "RATE_LIMITED");
    assert.equal(calls, 3); assert.equal(sessions, 2);
  } finally { await client.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
