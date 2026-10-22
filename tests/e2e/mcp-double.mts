/**
 * Local SYNTHETIC MCP test double for the automated browser suite.
 *
 * Speaks real MCP over Streamable HTTP (official SDK server) and exposes the
 * same tool names and JSON-text payload shapes as NSE's servers
 * (docs/nse-mcp/FINDINGS.md), so the app's real MCP client is exercised
 * without sending a single request to NSE during automated runs.
 *
 * ALL PRICES HERE ARE INVENTED (TEST-ONLY): simple deterministic sequences
 * around round numbers, for symbols TESTMCP*, RELIANCE and TCS.
 * They exist only in this test process and its throwaway database run.
 *
 * Control (test harness only): POST /__control {mode, delayMs}
 *   mode: "ok" | "down" (HTTP 503) | "malformed" (bad JSON shape) | "empty"
 */
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export type DoubleMode = "ok" | "down" | "malformed" | "empty";
const state: { mode: Record<"bhavcopy" | "cmmkt", DoubleMode>; delayMs: Record<string, number>; calls: Record<string, number> } = {
  mode: { bhavcopy: "ok", cmmkt: "ok" },
  delayMs: {},
  calls: {},
};

/** Deterministic synthetic sessions: weekdays only, ~300 sessions ending 2026-10-21 (Wed). */
function syntheticHistory(symbol: string, base: number): { date: string; open: number; high: number; low: number; close: number; volume: number }[] {
  const out = [];
  const d = new Date(Date.UTC(2026, 9, 21));
  let i = 0;
  while (out.length < 300) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const close = base + ((i * 7) % 40) - 20 + (symbol.length % 5);
      const open = close - 2;
      out.push({ date: d.toISOString().slice(0, 10), open, high: close + 5, low: open - 5, close, volume: 100_000 + ((i * 13) % 50) * 1000 });
      i++;
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}
const BASES: Record<string, number> = { TESTMCP: 500, RELIANCE: 900, TCS: 1500 };

const text = (obj: unknown) => ({ content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj) }] });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function bhavcopyServer() {
  const server = new McpServer({ name: "synthetic-bhavcopy-double", version: "0.0.0" });
  server.registerTool(
    "get_stock_history",
    { description: "SYNTHETIC test double", inputSchema: { symbol: z.string(), months: z.number().int(), endDate: z.string() } },
    async ({ symbol, months, endDate }) => {
      state.calls[`history:${symbol}`] = (state.calls[`history:${symbol}`] ?? 0) + 1;
      await pause(state.delayMs[symbol] ?? 0);
      if (state.mode.bhavcopy === "malformed") return text({ symbol, data: "not-an-array" });
      const base = BASES[symbol];
      if (!base || state.mode.bhavcopy === "empty") return text({ hint: "Use search_symbols tool to find valid symbols", error: `Symbol not found: ${symbol}` });
      const all = syntheticHistory(symbol, base);
      const end = endDate === "today" ? all.at(-1)!.date : endDate;
      const endD = new Date(`${end}T00:00:00Z`);
      const start = new Date(endD);
      start.setUTCMonth(start.getUTCMonth() - (months > 0 ? Math.min(months, 3) : 3));
      const from = start.toISOString().slice(0, 10);
      const rows = all.filter((r) => r.date > from && r.date <= end);
      if (rows.length === 0) return text({ hint: "Use search_symbols tool to find valid symbols", error: `Symbol not found: ${symbol}` });
      return text({
        symbol,
        from_date: rows[0]!.date,
        to_date: rows.at(-1)!.date,
        trading_days: rows.length,
        source: "synthetic-test-double",
        data: rows.map((r) => ({ symbol, series: "EQ", ltp: r.close, prevClose: r.open, totalTradedValue: 0, mktType: "N", deliveryQty: 0, ...r })),
        chunk_months: 3,
        next_end_date: from,
      });
    },
  );
  return server;
}

function cmmktServer() {
  const server = new McpServer({ name: "synthetic-cmmkt-double", version: "0.0.0" });
  server.registerTool("cm_get_stock_quote", { description: "SYNTHETIC test double", inputSchema: { symbol: z.string() } }, async ({ symbol }) => {
    state.calls[`quote:${symbol}`] = (state.calls[`quote:${symbol}`] ?? 0) + 1;
    await pause(state.delayMs[`quote:${symbol}`] ?? 0);
    if (state.mode.cmmkt === "malformed") return text({ stock: { symbol } });
    const base = BASES[symbol];
    if (!base) return text({ error: `Symbol '${symbol}' not found` });
    const last = base + 3.5;
    return text({
      updatedAt: "2026-10-22T10:05:00.000Z",
      stock: { type: "CM", symbol, series: "EQ", openPrice: base, highPrice: base + 6, lowPrice: base - 4, preClosePrice: base, lastTradedPrice: last, change: 3.5, perChange: Math.round((3.5 / base) * 10000) / 100, volume: 123_456, latestTimestamp: "2026-10-22 15:29:58" },
    });
  });
  server.registerTool("cm_get_allstocks_status", { description: "SYNTHETIC test double" }, async () => text({ available: true, lastCrawled: "2026-10-22T10:05:00Z", crawlIntervalMinutes: 1 }));
  return server;
}

/** Starts the double on `port`. Each POST is handled by a fresh stateless server+transport. */
export function startMcpDouble(port: number): Promise<{ close: () => Promise<void>; state: typeof state }> {
  const httpServer = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    if (req.url === "/__control" && req.method === "POST") {
      const body = JSON.parse(raw || "{}") as { bhavcopy?: DoubleMode; cmmkt?: DoubleMode; delayMs?: Record<string, number>; reset?: boolean };
      if (body.reset) {
        state.mode = { bhavcopy: "ok", cmmkt: "ok" };
        state.delayMs = {};
      }
      if (body.bhavcopy) state.mode.bhavcopy = body.bhavcopy;
      if (body.cmmkt) state.mode.cmmkt = body.cmmkt;
      if (body.delayMs) state.delayMs = { ...state.delayMs, ...body.delayMs };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(state));
      return;
    }
    const which = req.url?.startsWith("/bhavcopy") ? "bhavcopy" : req.url?.startsWith("/cmmkt") ? "cmmkt" : null;
    if (!which) return void res.writeHead(404).end();
    if (state.mode[which] === "down") return void res.writeHead(503, { "content-type": "text/plain" }).end("synthetic outage");
    if (req.method !== "POST") return void res.writeHead(405).end();
    const server = which === "bhavcopy" ? bhavcopyServer() : cmmktServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
  });
  return new Promise((resolve) =>
    httpServer.listen(port, "127.0.0.1", () =>
      resolve({ state, close: () => new Promise<void>((r) => httpServer.close(() => r())) }),
    ),
  );
}
