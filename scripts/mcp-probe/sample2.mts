/**
 * Stage 2C step 2b: follow-up schema questions (manual, small, paced).
 * - chunk paging via next_end_date; earliest available date (5-year claim)
 * - SME history, multi-series symbols (HAMPTON EQ+BZ, PARSVNATH BE+BZ), '&' symbols
 * Writes raw responses to docs/nse-mcp/samples/ (redact before committing).
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const OUT = path.resolve("docs/nse-mcp/samples");
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withClient(url: string, fn: (c: Client) => Promise<void>) {
  const client = new Client({ name: "marketpulse-probe", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport, { timeout: 20_000 });
  try {
    await fn(client);
  } finally {
    await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}

async function call(client: Client, name: string, args: Record<string, unknown>, file?: string) {
  const started = Date.now();
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
  const text = ((result.content as { type: string; text?: string }[]) ?? []).find((c) => c.type === "text")?.text ?? "";
  if (file) fs.writeFileSync(path.join(OUT, file), JSON.stringify({ tool: name, args, ms: Date.now() - started, at: new Date().toISOString(), result }, null, 2));
  await pause(1200);
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  return { json, text, ms: Date.now() - started, isError: Boolean(result.isError) };
}

await withClient("https://mcp.nseindia.in/bhavcopy/cm/mcp", async (c) => {
  // 3-month chunk + paging cursor
  const a = await call(c, "get_stock_history", { symbol: "RELIANCE", months: 3, endDate: "today" }, "bhavcopy-history-RELIANCE-3m.json");
  const rows = (a.json?.data as { date: string }[]) ?? [];
  console.log(`RELIANCE 3m: ${rows.length} rows ${rows[0]?.date}..${rows.at(-1)?.date} next_end_date=${String(a.json?.next_end_date)} keys=${Object.keys(a.json ?? {}).join(",")}`);
  const b = await call(c, "get_stock_history", { symbol: "RELIANCE", months: 3, endDate: a.json?.next_end_date }, "bhavcopy-history-RELIANCE-3m-page2.json");
  const rows2 = (b.json?.data as { date: string }[]) ?? [];
  console.log(`RELIANCE page2: ${rows2.length} rows ${rows2[0]?.date}..${rows2.at(-1)?.date} next=${String(b.json?.next_end_date)} overlap=${rows2.some((r) => rows.some((x) => x.date === r.date))}`);
  // Earliest data: request a chunk ending ~5y ago and ~6y ago.
  for (const end of ["2021-12-31", "2021-10-31", "2020-12-31"]) {
    const r = await call(c, "get_stock_history", { symbol: "TCS", months: 1, endDate: end }, `bhavcopy-history-TCS-end-${end}.json`);
    const d = (r.json?.data as { date: string }[]) ?? [];
    console.log(`TCS end ${end}: ${d.length} rows ${d[0]?.date ?? "-"}..${d.at(-1)?.date ?? "-"} ${r.json?.error ? `error=${String(r.json.error)}` : ""} next=${String(r.json?.next_end_date)}`);
  }
  // SME (older listing), multi-series and '&' symbols
  for (const s of ["EMKAYTOOLS", "HAMPTON", "PARSVNATH", "ARE&M"]) {
    const r = await call(c, "get_stock_history", { symbol: s, months: 1, endDate: "today" }, `bhavcopy-history-${s.replace(/&/g, "_")}.json`);
    const d = (r.json?.data as { date: string; series: string }[]) ?? [];
    const series = [...new Set(d.map((x) => x.series))];
    const dupDates = d.length - new Set(d.map((x) => x.date)).size;
    console.log(`${s}: ${d.length} rows series=${series.join("/")} duplicateDates=${dupDates} ${r.json?.error ? `error=${String(r.json.error)}` : ""}`);
  }
  // Invalid symbol format / unknown
  const bad = await call(c, "get_stock_history", { symbol: "ZZZZNOTREAL", months: 1, endDate: "today" });
  console.log(`unknown: ${bad.text.slice(0, 160)}`);
});

await withClient("https://mcp.nseindia.in/cmmkt/mcp", async (c) => {
  for (const s of ["HAMPTON", "PARSVNATH", "ARE&M", "EMKAYTOOLS"]) {
    const r = await call(c, "cm_get_stock_quote", { symbol: s }, `cmmkt-quote-${s.replace(/&/g, "_")}.json`);
    const st = r.json?.stock as Record<string, unknown> | undefined;
    console.log(`${s}: ${st ? `series=${String(st.series)} type=${String(st.type)} ltp=${String(st.lastTradedPrice)} ts=${String(st.latestTimestamp)}` : r.text.slice(0, 160)}`);
  }
});
