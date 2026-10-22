/**
 * Stage 2C step 2d: replay the exact chunk sequence the app uses (months=3,
 * endDate chained via next_end_date) and report where 2025-11-21 / 2026-04-23 go.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "marketpulse-probe", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL("https://mcp.nseindia.in/bhavcopy/cm/mcp"));
await client.connect(transport, { timeout: 20_000 });
let end = "today";
for (let i = 0; i < 5; i++) {
  const r = await client.callTool({ name: "get_stock_history", arguments: { symbol: "RELIANCE", months: 3, endDate: end } }, undefined, { timeout: 30_000 });
  const j = JSON.parse(((r.content as { type: string; text?: string }[])[0]?.text) ?? "{}") as { from_date: string; to_date: string; trading_days: number; data: { date: string }[]; next_end_date: string };
  const dates = j.data.map((d) => d.date);
  const watch = ["2025-11-21", "2026-04-23", "2026-02-01"].filter((d) => d >= j.from_date && d <= j.to_date).map((d) => `${d}:${dates.includes(d) ? "present" : "ABSENT"}`);
  console.log(`endDate=${end} -> from ${j.from_date} to ${j.to_date} rows=${dates.length} trading_days=${j.trading_days} first=${dates[0]} last=${dates.at(-1)} next=${j.next_end_date} ${watch.join(" ")}`);
  end = j.next_end_date;
  await new Promise((res) => setTimeout(res, 1200));
}
await transport.terminateSession().catch(() => undefined);
await client.close();
