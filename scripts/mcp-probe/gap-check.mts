/**
 * Stage 2C step 2c: are the 3 sessions missing from MCP history really absent
 * upstream, or dropped by our normaliser? Raw get_stock_history chunks + get_ltp_by_date.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "marketpulse-probe", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL("https://mcp.nseindia.in/bhavcopy/cm/mcp"));
await client.connect(transport, { timeout: 20_000 });
const text = async (name: string, args: Record<string, unknown>) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
  await new Promise((res) => setTimeout(res, 1200));
  return ((r.content as { type: string; text?: string }[]) ?? []).find((c) => c.type === "text")?.text ?? "";
};
for (const [end, dates] of [["2025-12-15", ["2025-11-20", "2025-11-21", "2025-11-24"]], ["2026-02-15", ["2026-01-30", "2026-02-01", "2026-02-02"]], ["2026-05-10", ["2026-04-22", "2026-04-23", "2026-04-24"]]] as const) {
  const j = JSON.parse(await text("get_stock_history", { symbol: "RELIANCE", months: 1, endDate: end })) as { data: { date: string; close: number }[] };
  console.log(`chunk ending ${end}:`, dates.map((d) => `${d}=${j.data.find((r) => r.date === d)?.close ?? "ABSENT"}`).join("  "));
}
for (const d of ["2025-11-21", "2026-02-01", "2026-04-23"]) console.log(`get_ltp_by_date ${d}:`, (await text("get_ltp_by_date", { symbol: "RELIANCE", date: d })).slice(0, 220));
await transport.terminateSession().catch(() => undefined);
await client.close();
