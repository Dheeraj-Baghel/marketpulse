/**
 * Stage 2C step 1: isolated NSE MCP connectivity + tool discovery.
 *
 *   npx tsx scripts/mcp-probe/discover.mts
 *
 * Connects to each official NSE MCP server over Streamable HTTP with the
 * official TypeScript SDK, runs listTools, and writes the discovered tool
 * names, descriptions and input schemas to docs/nse-mcp/<server>-tools.json.
 * It calls NO data tools. Endpoints are fixed (official URLs only).
 */
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SERVERS = {
  bhavcopy: "https://mcp.nseindia.in/bhavcopy/cm/mcp",
  cmmkt: "https://mcp.nseindia.in/cmmkt/mcp",
} as const;

const OUT = path.resolve("docs/nse-mcp");
fs.mkdirSync(OUT, { recursive: true });

for (const [name, url] of Object.entries(SERVERS)) {
  const started = Date.now();
  const client = new Client({ name: "marketpulse-probe", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  try {
    await client.connect(transport, { timeout: 20_000 });
    const server = client.getServerVersion();
    const caps = client.getServerCapabilities();
    const tools = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: 20_000 });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    const record = {
      server: name,
      url,
      discoveredAt: new Date().toISOString(),
      connectMs: Date.now() - started,
      serverInfo: server,
      capabilities: caps,
      sessionId: transport.sessionId ? "(present)" : "(none)",
      toolCount: tools.length,
      tools: tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema, annotations: t.annotations })),
    };
    fs.writeFileSync(path.join(OUT, `${name}-tools.json`), JSON.stringify(record, null, 2));
    console.log(`✓ ${name} ${url} -> ${server?.name ?? "?"} ${server?.version ?? ""} : ${tools.length} tools in ${record.connectMs} ms`);
    for (const t of tools) console.log(`   - ${t.name}: ${(t.description ?? "").replace(/\s+/g, " ").slice(0, 140)}`);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    fs.writeFileSync(path.join(OUT, `${name}-error.json`), JSON.stringify({ server: name, url, at: new Date().toISOString(), error: message }, null, 2));
    console.log(`✗ ${name} ${url}: ${message}`);
  } finally {
    await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
}
