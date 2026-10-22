/**
 * Stage 2C tests for the NSE MCP integration, with a MOCKED MCP transport.
 *
 * SYNTHETIC TEST FIXTURES: every price below is an invented round number
 * shaped like the real `get_stock_history` / `cm_get_stock_quote` payloads
 * recorded on 22 Oct 2026 (docs/nse-mcp/FINDINGS.md). No NSE data is used,
 * no network calls are made, and nothing here is shown in the app.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-mcp-"));
process.env.MARKETPULSE_DB_PATH = path.join(dir, "mcp-test.sqlite");

type Mod = {
  client: typeof import("../../src/lib/market-data/nse-mcp-client");
  norm: typeof import("../../src/lib/market-data/normalize");
  hist: typeof import("../../src/lib/market-data/nse-history-provider");
  quote: typeof import("../../src/lib/market-data/nse-quote-provider");
  prices: typeof import("../../src/lib/market-data/price-service");
  quotes: typeof import("../../src/lib/market-data/quote-service");
  cache: typeof import("../../src/lib/market-data/cache");
  series: typeof import("../../src/lib/market-data/series");
  schema: typeof import("../../src/db/schema");
  db: import("../../src/db/client").Db;
};
let m: Mod;

// ---- synthetic payload builders (shape of the real tools) -----------------
const row = (date: string, close: number, series = "EQ", symbol = "TESTCO") => ({
  symbol, series, ltp: close, open: 100, high: 120, low: 90, close, prevClose: 100, volume: 1000,
  totalTradedValue: 1, ch52WeekHigh: 0, ch52WeekLow: 0, mktType: "N", deliveryQty: 0, date,
});
const historyPayload = (rows: object[], next: string | null, symbol = "TESTCO") => ({
  symbol, from_date: "x", to_date: "y", trading_days: rows.length, source: "in-memory-cache", query_ms: 0, summary: {}, data: rows, chunk_months: 3, ...(next ? { next_end_date: next } : {}),
});
const quotePayload = (over: Record<string, unknown> = {}) => ({
  updatedAt: "2026-10-22T10:00:00.000Z",
  stock: { type: "CM", symbol: "TESTCO", series: "EQ", openPrice: 100, highPrice: 110, lowPrice: 95, preClosePrice: 100, lastTradedPrice: 105, change: 5, perChange: 5, volume: 1000, latestTimestamp: "2026-10-22 15:30:00", ...over },
});

/** Fake transport: scripted responses per tool, records every call. */
function fakeMcp(script: Record<string, (args: Record<string, unknown>, n: number) => unknown>) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    enabled: true,
    health: () => [],
    async callJson(_server: string, tool: string, args: Record<string, unknown>) {
      calls.push({ tool, args });
      const fn = script[tool];
      if (!fn) throw new Error(`unscripted tool ${tool}`);
      const out = fn(args, calls.filter((c) => c.tool === tool).length);
      if (out instanceof Error) throw out;
      return out;
    },
  };
}

before(async () => {
  const clientDb = await import("../../src/db/client");
  const schema = await import("../../src/db/schema");
  m = {
    client: await import("../../src/lib/market-data/nse-mcp-client"),
    norm: await import("../../src/lib/market-data/normalize"),
    hist: await import("../../src/lib/market-data/nse-history-provider"),
    quote: await import("../../src/lib/market-data/nse-quote-provider"),
    prices: await import("../../src/lib/market-data/price-service"),
    quotes: await import("../../src/lib/market-data/quote-service"),
    cache: await import("../../src/lib/market-data/cache"),
    series: await import("../../src/lib/market-data/series"),
    schema,
    db: clientDb.getDb(),
  };
  const [imp] = m.db
    .insert(schema.directoryImports)
    .values({ segment: "MAINBOARD", fileName: "SYNTHETIC_TEST.csv", fileSha256: "0".repeat(64), importedAt: "2026-01-01T00:00:00Z", rowsTotal: 3, rowsInserted: 3, rowsUpdated: 0, rowsUnchanged: 0, rowsRejected: 0, rowsDuplicate: 0, rowsDeactivated: 0 })
    .returning()
    .all();
  const base = { segment: "MAINBOARD" as const, instrumentKind: "EQUITY_SHARE" as const, firstImportedAt: "2026-01-01", importedAt: "2026-01-01", lastImportId: imp!.id };
  m.db.insert(schema.securities).values([
    { ...base, symbol: "TESTCO", name: "Synthetic Test Company", isin: "INE000T01019", issuerCode: "000T", series: "EQ" },
    { ...base, symbol: "CSVONLY", name: "Synthetic Csv Only Ltd", isin: "INE000W01013", issuerCode: "000W", series: "EQ" },
    { ...base, symbol: "BZONLY", name: "Synthetic Bz Ltd", isin: "INE000X01011", issuerCode: "000X", series: "BZ" },
  ]).run();
  // SYNTHETIC local CSV observations for CSVONLY (as if imported via Stage 2A).
  const sec = m.db.select().from(schema.securities).all().find((s) => s.symbol === "CSVONLY")!;
  const [pi] = m.db.insert(schema.priceImports).values({ source: "NSE_EQ_SECURITY_CSV", fileName: "SYNTHETIC.csv", fileSha256: "0".repeat(64), importedAt: "2026-01-01", status: "SUCCEEDED" }).returning().all();
  m.db.insert(schema.dailyPrices).values([
    { securityId: sec.id, tradeDate: "2026-09-01", open: 1_000_000, high: 1_100_000, low: 900_000, close: 1_050_000, volume: 5, source: "NSE_EQ_SECURITY_CSV", adjustmentStatus: "UNADJUSTED", importedAt: "2026-01-01", lastImportId: pi!.id },
    { securityId: sec.id, tradeDate: "2026-09-02", open: 1_050_000, high: 1_100_000, low: 1_000_000, close: 1_080_000, volume: null, source: "NSE_EQ_SECURITY_CSV", adjustmentStatus: "UNADJUSTED", importedAt: "2026-01-01", lastImportId: pi!.id },
  ]).run();
});

after(async () => {
  (await import("../../src/db/client")).closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const NOW = () => new Date("2026-10-22T12:00:00Z"); // 17:30 IST, market closed

describe("MCP client: tool result parsing + config allowlist", () => {
  test("parses JSON text content; maps {error} payloads and junk", () => {
    const { parseToolResult } = m.client;
    type E = { code?: string };
    assert.deepEqual(parseToolResult({ content: [{ type: "text", text: '{"a":1}' }] }, "bhavcopy", "t"), { a: 1 });
    assert.throws(() => parseToolResult({ content: [{ type: "text", text: '{"error":"Symbol not found: X"}' }] }, "bhavcopy", "t"), (e: E) => e.code === "TOOL_ERROR");
    assert.throws(() => parseToolResult({ content: [{ type: "text", text: '{"error":"Rate limit exceeded"}' }] }, "cmmkt", "t"), (e: E) => e.code === "RATE_LIMITED");
    assert.throws(() => parseToolResult({ content: [{ type: "text", text: "<html>" }] }, "bhavcopy", "t"), (e: E) => e.code === "INVALID_RESPONSE");
    assert.throws(() => parseToolResult({ content: [] }, "bhavcopy", "t"), (e: E) => e.code === "INVALID_RESPONSE");
    assert.throws(() => parseToolResult(null, "bhavcopy", "t"), (e: E) => e.code === "INVALID_RESPONSE");
  });

  test("only official NSE endpoints are accepted; disable switches work", () => {
    const readMcpConfig = (env: Record<string, string>) => m.client.readMcpConfig(env as NodeJS.ProcessEnv);
    assert.equal(readMcpConfig({}).enabled, true);
    assert.equal(readMcpConfig({ ENABLE_NSE_MCP: "false" }).enabled, false);
    assert.equal(readMcpConfig({ MARKET_DATA_SOURCE: "local-csv" }).enabled, false);
    const evil = readMcpConfig({ NSE_BHAVCOPY_MCP_URL: "https://evil.example.com/mcp" });
    assert.equal(evil.enabled, false);
    assert.match(evil.configErrors[0]!, /not an official NSE MCP endpoint/);
    assert.equal(evil.urls.bhavcopy, "https://mcp.nseindia.in/bhavcopy/cm/mcp");
    // Loopback is a test-only escape hatch and never allowed in production.
    assert.equal(readMcpConfig({ NSE_BHAVCOPY_MCP_URL: "http://127.0.0.1:9/mcp" }).enabled, false);
    assert.equal(readMcpConfig({ NSE_BHAVCOPY_MCP_URL: "http://127.0.0.1:9/mcp", MARKETPULSE_ALLOW_LOOPBACK_MCP: "1" }).enabled, true);
    assert.equal(readMcpConfig({ NSE_BHAVCOPY_MCP_URL: "http://127.0.0.1:9/mcp", MARKETPULSE_ALLOW_LOOPBACK_MCP: "1", NODE_ENV: "production" }).enabled, false);
  });
});

describe("normalisation", () => {
  test("exact scaled prices; ascending; de-duplicated; foreign series excluded", () => {
    const n = m.norm.normalizeHistoryRows(
      [row("2026-10-21", 105.05), row("2026-10-20", 101), row("2026-10-20", 101), row("2026-10-19", 100, "T0"), { date: "2026-10-18" }],
      { symbol: "TESTCO", series: "EQ" },
      "2026-10-22",
    );
    assert.deepEqual(n.candles.map((c) => c.date), ["2026-10-20", "2026-10-21"]);
    assert.equal(n.candles[1]!.close, 105.05);
    assert.equal(n.duplicates, 1);
    assert.equal(n.foreign, 1); // the T0 row is never relabelled as EQ
    assert.equal(n.rejected.length, 1); // malformed row
    assert.equal(m.norm.toScaled(1240.4), 12_404_000);
    assert.equal(m.norm.toScaled(0.1 + 0.2), null); // 0.30000000000000004 has >4 dp: rejected, not rounded
  });

  test("invalid OHLC, future dates and conflicting duplicates are rejected", () => {
    const bad = { ...row("2026-10-15", 100), high: 80 };
    const n = m.norm.normalizeHistoryRows(
      [bad, row("2026-10-30", 100), row("2026-10-14", 100), row("2026-10-14", 101), { ...row("2026-10-13", 100), volume: -1 }],
      { symbol: "TESTCO", series: "EQ" },
      "2026-10-22",
    );
    assert.equal(n.candles.length, 0);
    assert.deepEqual(n.rejected.map((r) => r.reason).sort(), ["OHLC outside high-low range", "conflicting duplicate observations", "invalid or future date", "invalid volume"].sort());
  });

  test("quote normalisation: IST timestamp, identity checks, computed change flagged", () => {
    const q = m.norm.normalizeQuote(quotePayload(), { symbol: "TESTCO", series: "EQ" });
    assert.ok(q.ok);
    assert.equal(q.quote.exchangeTimestamp, "2026-10-22T15:30:00+05:30");
    assert.equal(q.quote.changeComputed, false);
    const computed = m.norm.normalizeQuote(quotePayload({ change: undefined, perChange: undefined }), { symbol: "TESTCO", series: "EQ" });
    assert.ok(computed.ok && computed.quote.changeComputed && computed.quote.change === 5 && computed.quote.changePct === 5);
    const noTs = m.norm.normalizeQuote(quotePayload({ latestTimestamp: undefined }), { symbol: "TESTCO", series: "EQ" });
    assert.ok(noTs.ok && noTs.quote.exchangeTimestamp === null); // never invented
    const other = m.norm.normalizeQuote(quotePayload({ series: "BE" }), { symbol: "TESTCO", series: "EQ" });
    assert.ok(!other.ok && other.seriesMismatch === "BE");
    assert.ok(!m.norm.normalizeQuote(quotePayload({ symbol: "OTHER" }), { symbol: "TESTCO", series: "EQ" }).ok);
    assert.ok(!m.norm.normalizeQuote(quotePayload({ lastTradedPrice: "105" }), { symbol: "TESTCO", series: "EQ" }).ok);
    assert.ok(!m.norm.normalizeQuote({ nope: true }, { symbol: "TESTCO", series: "EQ" }).ok);
  });

  test("series preference", () => {
    assert.equal(m.series.preferredSeries(["BZ", "EQ"]), "EQ");
    assert.equal(m.series.preferredSeries(["BZ", "BE"]), "BE");
    assert.equal(m.series.preferredSeries(["ST", "SM"]), "SM");
    assert.equal(m.series.preferredSeries(["BZ", "EQ"], ["BZ"]), "BZ"); // local history wins
  });
});

describe("Bhavcopy history provider", () => {
  test("chains chunks only as far as needed; caches; extends for ALL", async () => {
    const mcp = fakeMcp({
      get_stock_history: (args) => {
        const end = String(args.endDate);
        if (end === "today") return historyPayload([row("2026-08-01", 100), row("2026-10-21", 101)], "2026-07-31");
        if (end === "2026-07-31") return historyPayload([row("2026-05-04", 99), row("2026-07-31", 100)], "2026-05-03");
        if (end === "2026-05-03") return historyPayload([row("2026-02-02", 98)], "2026-02-01");
        return new m.client.McpProviderError("TOOL_ERROR", "get_stock_history: Symbol not found: TESTCO", "bhavcopy", false);
      },
    });
    const p = new m.hist.NseBhavcopyHistoryProvider(mcp as never, { ttlMs: 60_000, now: NOW });
    const r1 = await p.getHistory({ symbol: "TESTCO", series: "EQ" }, "2026-07-01");
    assert.ok(r1.ok && r1.chunksThisCall === 2 && r1.history.nextEndDate === "2026-05-03");
    assert.deepEqual(mcp.calls.map((c) => c.args.endDate), ["today", "2026-07-31"]);
    assert.ok(mcp.calls.every((c) => c.args.months === 3 && c.args.symbol === "TESTCO"));
    const r2 = await p.getHistory({ symbol: "TESTCO", series: "EQ" }, "2026-07-01");
    assert.ok(r2.ok && r2.cached && mcp.calls.length === 2, "second request served from cache");
    const all = await p.getHistory({ symbol: "TESTCO", series: "EQ" }, null);
    assert.ok(all.ok && all.history.nextEndDate === null && all.history.candles[0]!.date === "2026-02-02");
    assert.equal(mcp.calls.length, 4); // + 2026-05-03 chunk + terminating "not found"
  });

  test("concurrent identical requests share one upstream load", async () => {
    let n = 0;
    const mcp = fakeMcp({ get_stock_history: () => (n++, historyPayload([row("2026-10-21", 100)], null)) });
    const p = new m.hist.NseBhavcopyHistoryProvider(mcp as never, { ttlMs: 60_000, now: NOW });
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => p.getHistory({ symbol: "TESTCO", series: "EQ" }, null)));
    assert.ok(a?.ok && b?.ok && c?.ok);
    assert.equal(n, 1);
  });

  test("series mismatch, not-found, malformed and wrong-symbol responses", async () => {
    const p = (script: Parameters<typeof fakeMcp>[0]) => new m.hist.NseBhavcopyHistoryProvider(fakeMcp(script) as never, { ttlMs: 60_000, now: NOW });
    const mismatch = await p({ get_stock_history: () => historyPayload([row("2026-10-21", 100, "EQ", "BZONLY")], null, "BZONLY") }).getHistory({ symbol: "BZONLY", series: "BZ" }, null);
    assert.ok(!mismatch.ok && mismatch.failure.kind === "series-mismatch" && mismatch.failure.providerSeries[0] === "EQ");
    const nf = await p({ get_stock_history: () => new m.client.McpProviderError("TOOL_ERROR", "Symbol not found: TESTCO", "bhavcopy", false) }).getHistory({ symbol: "TESTCO", series: "EQ" }, null);
    assert.ok(!nf.ok && nf.failure.kind === "not-found");
    const junk = await p({ get_stock_history: () => ({ hello: "world" }) }).getHistory({ symbol: "TESTCO", series: "EQ" }, null);
    assert.ok(!junk.ok && junk.failure.kind === "provider" && junk.failure.error.code === "INVALID_RESPONSE");
    const wrong = await p({ get_stock_history: () => historyPayload([row("2026-10-21", 100, "EQ", "OTHER")], null, "OTHER") }).getHistory({ symbol: "TESTCO", series: "EQ" }, null);
    assert.ok(!wrong.ok && wrong.failure.kind === "provider" && wrong.failure.error.code === "INVALID_RESPONSE");
  });
});

describe("price service: provider priority and fallback", () => {
  const deps = (script: Parameters<typeof fakeMcp>[0]) => ({
    mcpHistory: new m.hist.NseBhavcopyHistoryProvider(fakeMcp(script) as never, { ttlMs: 60_000, now: NOW }),
    mcpEnabled: true,
    allowSourceOverride: true,
    now: NOW,
  });

  test("MCP data is labelled NSE Bhavcopy — Historical EOD", async () => {
    const r = await m.prices.getPrices({ symbol: "TESTCO", series: "EQ", range: "MAX" }, deps({ get_stock_history: () => historyPayload([row("2026-10-20", 100), row("2026-10-21", 101)], null) }));
    assert.equal(r.sourceId, "nse-bhavcopy-mcp");
    assert.equal(r.sourceLabel, "NSE Bhavcopy — Historical EOD");
    assert.equal(r.dataMode, "HISTORICAL_EOD");
    assert.equal(r.isStale, false);
    assert.equal(r.latestTradingDate, "2026-10-21");
    assert.deepEqual(r.candles.map((c) => c.date), ["2026-10-20", "2026-10-21"]);
  });

  test("MCP outage falls back to local CSV, flagged stale with the reason", async () => {
    const r = await m.prices.getPrices(
      { symbol: "CSVONLY", series: "EQ", range: "MAX" },
      deps({ get_stock_history: () => new m.client.McpProviderError("TIMEOUT", "NSE bhavcopy MCP did not respond in time.", "bhavcopy", true) }),
    );
    assert.equal(r.sourceId, "local-csv");
    assert.equal(r.sourceLabel, "Local CSV — Historical EOD");
    assert.equal(r.isStale, true);
    assert.equal(r.fallbackReason?.code, "TIMEOUT");
    assert.equal(r.count, 2);
  });

  test("no MCP data and no CSV -> explicit unavailable; disabled -> CSV without contacting NSE", async () => {
    const none = await m.prices.getPrices({ symbol: "TESTCO", series: "EQ", range: "1Y" }, deps({ get_stock_history: () => new m.client.McpProviderError("TOOL_ERROR", "Symbol not found: TESTCO", "bhavcopy", false) }));
    assert.equal(none.sourceId, "unavailable");
    assert.equal(none.candles.length, 0);
    assert.equal(none.fallbackReason?.code, "NOT_FOUND");
    const mcp = fakeMcp({ get_stock_history: () => historyPayload([row("2026-10-21", 100, "EQ", "CSVONLY")], null, "CSVONLY") });
    const off = await m.prices.getPrices({ symbol: "CSVONLY", series: "EQ", range: "MAX" }, { mcpHistory: new m.hist.NseBhavcopyHistoryProvider(mcp as never, { ttlMs: 1000 }), mcpEnabled: false });
    assert.equal(off.sourceId, "local-csv");
    assert.equal(mcp.calls.length, 0, "disabled MCP must not be called");
    assert.equal(off.isStale, false);
  });

  test("dev source switch forces local CSV or MCP-only errors", async () => {
    const forced = await m.prices.getPrices({ symbol: "CSVONLY", series: "EQ", range: "MAX", source: "local-csv" }, deps({ get_stock_history: () => historyPayload([], null) }));
    assert.equal(forced.sourceId, "local-csv");
    await assert.rejects(
      m.prices.getPrices({ symbol: "TESTCO", series: "EQ", range: "MAX", source: "nse-mcp" }, deps({ get_stock_history: () => new m.client.McpProviderError("RATE_LIMITED", "rate limited", "bhavcopy", true) })),
      (e: { code?: string; status?: number }) => e.code === "PROVIDER_RATE_LIMITED" && e.status === 429,
    );
    // Without permission the override is ignored (production).
    const ignored = await m.prices.getPrices({ symbol: "TESTCO", series: "EQ", range: "MAX", source: "local-csv" }, { ...deps({ get_stock_history: () => historyPayload([row("2026-10-21", 100)], null) }), allowSourceOverride: false });
    assert.equal(ignored.sourceId, "nse-bhavcopy-mcp");
  });

  test("unknown security is rejected before any MCP call", async () => {
    const mcp = fakeMcp({ get_stock_history: () => historyPayload([], null) });
    await assert.rejects(
      m.prices.getPrices({ symbol: "NOSUCH", series: "EQ", range: "MAX" }, { mcpHistory: new m.hist.NseBhavcopyHistoryProvider(mcp as never, { ttlMs: 1000 }), mcpEnabled: true }),
      (e: { code?: string }) => e.code === "UNKNOWN_SECURITY",
    );
    assert.equal(mcp.calls.length, 0);
  });
});

describe("quote provider and service", () => {
  test("delayed quote is labelled, cached within TTL, single-flight", async () => {
    let t = Date.parse("2026-10-22T06:00:00Z"); // 11:30 IST, market open
    const mcp = fakeMcp({ cm_get_stock_quote: () => quotePayload() });
    const quotes = new m.quote.NseCmQuoteProvider(mcp as never, { ttlMs: 60_000, staleMaxMs: 3_600_000, now: () => new Date(t) });
    const [a, b] = await Promise.all([1, 2].map(() => m.quotes.getQuote({ symbol: "TESTCO", series: "EQ" }, { quotes, mcpEnabled: true, now: () => new Date(t) })));
    assert.equal(mcp.calls.length, 1);
    assert.equal(a!.sourceLabel, "NSE CM Market — Delayed Quote");
    assert.equal(a!.dataMode, "DELAYED_QUOTE");
    assert.equal(a!.marketSession, "open");
    assert.equal(b!.quote?.lastPrice, 105);
    await m.quotes.getQuote({ symbol: "TESTCO", series: "EQ" }, { quotes, mcpEnabled: true, now: () => new Date(t) });
    assert.equal(mcp.calls.length, 1, "cached within TTL");
    await m.quotes.getQuote({ symbol: "TESTCO", series: "EQ", refresh: true }, { quotes, mcpEnabled: true, now: () => new Date(t) });
    assert.equal(mcp.calls.length, 2, "manual refresh bypasses the cache");
    t += 61_000;
    void t;
  });

  test("outage shows the last quote as Cached — Stale with its ORIGINAL timestamp; otherwise errors", async () => {
    let fail = false;
    const mcp = fakeMcp({ cm_get_stock_quote: () => (fail ? new m.client.McpProviderError("UNAVAILABLE", "NSE cmmkt MCP unreachable.", "cmmkt", true) : quotePayload()) });
    const quotes = new m.quote.NseCmQuoteProvider(mcp as never, { ttlMs: 1, staleMaxMs: 3_600_000 });
    const ok = await m.quotes.getQuote({ symbol: "TESTCO", series: "EQ" }, { quotes, mcpEnabled: true, now: NOW });
    fail = true;
    await new Promise((r) => setTimeout(r, 5));
    const stale = await m.quotes.getQuote({ symbol: "TESTCO", series: "EQ" }, { quotes, mcpEnabled: true, now: NOW });
    assert.equal(stale.sourceId, "cached-stale");
    assert.equal(stale.sourceLabel, "Cached — Stale");
    assert.equal(stale.isStale, true);
    assert.equal(stale.quote?.exchangeTimestamp, ok.quote?.exchangeTimestamp);
    assert.equal(stale.marketSession, "closed");
    const fresh = new m.quote.NseCmQuoteProvider(mcp as never, { ttlMs: 1, staleMaxMs: 3_600_000 });
    await assert.rejects(m.quotes.getQuote({ symbol: "TESTCO", series: "EQ" }, { quotes: fresh, mcpEnabled: true, now: NOW }), (e: { code?: string; status?: number }) => e.code === "PROVIDER_UNAVAILABLE" && e.status === 502);
  });

  test("series mismatch / not found / disabled / malformed", async () => {
    const svc = (payload: unknown) => m.quotes.getQuote({ symbol: "BZONLY", series: "BZ" }, { quotes: new m.quote.NseCmQuoteProvider(fakeMcp({ cm_get_stock_quote: () => payload }) as never, { ttlMs: 1000, staleMaxMs: 0 }), mcpEnabled: true, now: NOW });
    const mismatch = await svc(quotePayload({ symbol: "BZONLY", series: "EQ" }));
    assert.equal(mismatch.sourceId, "unavailable");
    assert.match(mismatch.unavailableReason!, /series EQ, not BZ/);
    assert.equal(mismatch.quote, null);
    const nf = await svc(new m.client.McpProviderError("TOOL_ERROR", "cm_get_stock_quote: Symbol 'BZONLY' not found", "cmmkt", false));
    assert.equal(nf.sourceId, "unavailable");
    await assert.rejects(svc({ stock: { symbol: "BZONLY" } }), (e: { code?: string }) => e.code === "PROVIDER_INVALID_RESPONSE");
    const off = await m.quotes.getQuote({ symbol: "TESTCO", series: "EQ" }, { quotes: null, mcpEnabled: false, now: NOW });
    assert.equal(off.sourceId, "unavailable");
    assert.match(off.unavailableReason!, /disabled/);
  });

  test("IST market session flag", () => {
    assert.equal(m.quotes.marketSessionAt(new Date("2026-10-22T04:00:00Z")), "open"); // 09:30 IST Thu
    assert.equal(m.quotes.marketSessionAt(new Date("2026-10-22T03:35:00Z")), "pre-open"); // 09:05 IST
    assert.equal(m.quotes.marketSessionAt(new Date("2026-10-22T10:05:00Z")), "closed"); // 15:35 IST
    assert.equal(m.quotes.marketSessionAt(new Date("2026-10-24T05:00:00Z")), "closed"); // Saturday
  });
});

describe("TtlCache", () => {
  test("expiry, peek of expired values, LRU bound", () => {
    let now = 0;
    const c = new m.cache.TtlCache<number>(2, () => now);
    c.set("a", 1, 10);
    c.set("b", 2, 10);
    c.set("c", 3, 10);
    assert.equal(c.get("a"), undefined); // evicted
    now = 11;
    assert.equal(c.get("b"), undefined); // expired
    assert.deepEqual(c.peek("b"), { value: 2, storedAt: 0, expired: true });
  });
});
