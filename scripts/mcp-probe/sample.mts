/**
 * Stage 2C step 2: narrowly scoped real-data probe (manual, not part of CI).
 *
 *   npx tsx scripts/mcp-probe/sample.mts
 *
 * Calls ONLY tools discovered by discover.mts, with small requests and a
 * pause between calls so the NSE services are not flooded:
 *   bhavcopy: get_stock_history (1 chunk of 1 month) per test symbol
 *   cmmkt:    cm_get_stock_quote per test symbol, cm_get_data_status, cm_get_allstocks_status
 * Raw responses are written to docs/nse-mcp/samples/ for schema inspection and
 * then redacted to shapes only (numbers -> "<number>") before committing; they
 * are never imported into the app or the database.
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const OUT = path.resolve("docs/nse-mcp/samples");
fs.mkdirSync(OUT, { recursive: true });
const SYMBOLS = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ITC"];
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

async function call(client: Client, file: string, name: string, args: Record<string, unknown>) {
  const started = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
    const record = { tool: name, args, ms: Date.now() - started, at: new Date().toISOString(), result };
    fs.writeFileSync(path.join(OUT, file), JSON.stringify(record, null, 2));
    const content = (result.content as { type: string; text?: string }[] | undefined) ?? [];
    const text = content.find((c) => c.type === "text")?.text ?? "";
    console.log(`✓ ${name} ${JSON.stringify(args)} ${record.ms}ms isError=${Boolean(result.isError)} content=${content.map((c) => c.type).join(",")} structured=${result.structuredContent ? "yes" : "no"} text[0..200]=${text.slice(0, 200).replace(/\s+/g, " ")}`);
  } catch (error) {
    console.log(`✗ ${name} ${JSON.stringify(args)}: ${error instanceof Error ? error.message : String(error)}`);
    fs.writeFileSync(path.join(OUT, file), JSON.stringify({ tool: name, args, error: String(error) }, null, 2));
  }
  await pause(1500);
}

await withClient("https://mcp.nseindia.in/bhavcopy/cm/mcp", async (c) => {
  for (const s of SYMBOLS) await call(c, `bhavcopy-history-${s}.json`, "get_stock_history", { symbol: s, months: 1, endDate: "today" });
  // Pagination check: the next chunk for RELIANCE using the server-provided cursor is done in a follow-up probe once the field name is confirmed.
  // SME compatibility: one SME symbol from the local directory.
  await call(c, "bhavcopy-history-SME-RAVITA.json", "get_stock_history", { symbol: "RAVITA", months: 1, endDate: "today" });
});

await withClient("https://mcp.nseindia.in/cmmkt/mcp", async (c) => {
  await call(c, "cmmkt-data-status.json", "cm_get_data_status", {});
  await call(c, "cmmkt-allstocks-status.json", "cm_get_allstocks_status", {});
  for (const s of SYMBOLS) await call(c, `cmmkt-quote-${s}.json`, "cm_get_stock_quote", { symbol: s });
  await call(c, "cmmkt-quote-SME-RAVITA.json", "cm_get_stock_quote", { symbol: "RAVITA" });
  await call(c, "cmmkt-quote-UNKNOWN.json", "cm_get_stock_quote", { symbol: "ZZZZNOTREAL" });
});
