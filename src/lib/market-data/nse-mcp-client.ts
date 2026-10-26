import "server-only";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { isPublicPreview, PUBLIC_PREVIEW_MESSAGE } from "../public-preview";

/**
 * Minimal, server-only client for NSE's two official MCP servers
 * (https://www.nseindia.com/nse-mcp). Never imported by browser code.
 *
 * Findings that shaped this client (docs/nse-mcp/FINDINGS.md):
 * - Streamable HTTP, no authentication, results are JSON *text* in content[0]
 *   (no structuredContent/outputSchema);
 * - tool-level errors arrive as {"error": "..."} with isError=false.
 *
 * Only these tool names, discovered via listTools on 22 Oct 2026, are called.
 */

export const NSE_MCP_SERVERS = {
  bhavcopy: { url: "https://mcp.nseindia.in/bhavcopy/cm/mcp", tools: ["get_stock_history"] },
  cmmkt: { url: "https://mcp.nseindia.in/cmmkt/mcp", tools: ["cm_get_stock_quote", "cm_get_allstocks_status"] },
} as const;
export type NseServer = keyof typeof NSE_MCP_SERVERS;
type ToolOf<S extends NseServer> = (typeof NSE_MCP_SERVERS)[S]["tools"][number];

/** Exact-match allowlist: a configured URL must equal an official endpoint. */
const ALLOWED_URLS = new Set<string>(Object.values(NSE_MCP_SERVERS).map((s) => s.url));

export type McpFailureCode =
  | "DISABLED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "UNAVAILABLE" // connection / HTTP 5xx / network
  | "TOOL_MISSING"
  | "TOOL_ERROR" // the tool answered with {"error": ...}
  | "INVALID_RESPONSE";

export class McpProviderError extends Error {
  constructor(
    readonly code: McpFailureCode,
    message: string,
    readonly server: NseServer,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "McpProviderError";
  }
}

export interface McpConfig {
  enabled: boolean;
  urls: Record<NseServer, string>;
  timeoutMs: number;
  /** Circuit-breaker pause after repeated failures (protects NSE and keeps the UI responsive). */
  cooldownMs: number;
  /** Minimum spacing between the starts of two calls to the same NSE server (polite pacing). */
  minIntervalMs: number;
}

/**
 * TEST-ONLY escape hatch: with MARKETPULSE_ALLOW_LOOPBACK_MCP=1 outside
 * production, a loopback URL (127.0.0.1 / localhost) is accepted so the
 * automated browser suite can talk to a local synthetic MCP double instead of
 * NSE. Any other non-NSE URL is always rejected.
 */
function isAllowedLoopback(url: string, env: NodeJS.ProcessEnv): boolean {
  if (env.MARKETPULSE_ALLOW_LOOPBACK_MCP !== "1" || env.NODE_ENV === "production") return false;
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Reads env once per call; unknown URLs are rejected, never used. */
export function readMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig & { configErrors: string[] } {
  const configErrors: string[] = [];
  const source = (env.MARKET_DATA_SOURCE ?? "nse-mcp").trim().toLowerCase();
  const flag = (env.ENABLE_NSE_MCP ?? "true").trim().toLowerCase();
  let enabled = source === "nse-mcp" && !["false", "0", "off", "no"].includes(flag);
  if (isPublicPreview(env)) {
    enabled = false;
    configErrors.push(PUBLIC_PREVIEW_MESSAGE);
  }
  const urls = {} as Record<NseServer, string>;
  for (const [server, spec] of Object.entries(NSE_MCP_SERVERS) as [NseServer, (typeof NSE_MCP_SERVERS)[NseServer]][]) {
    const key = server === "bhavcopy" ? "NSE_BHAVCOPY_MCP_URL" : "NSE_CM_MARKET_MCP_URL";
    const configured = env[key]?.trim();
    const allowed = configured ? ALLOWED_URLS.has(configured) || isAllowedLoopback(configured, env) : false;
    if (configured && !allowed) {
      configErrors.push(`${key} is not an official NSE MCP endpoint; MCP disabled.`);
      enabled = false;
    }
    urls[server] = configured && allowed ? configured : spec.url;
  }
  const t = Number(env.NSE_MCP_TIMEOUT_MS ?? 12_000);
  const c = Number(env.NSE_MCP_BREAKER_COOLDOWN_MS ?? 60_000);
  const gap = Number(env.NSE_MCP_MIN_INTERVAL_MS ?? 150);
  return {
    enabled,
    urls,
    timeoutMs: Number.isFinite(t) && t >= 1000 && t <= 60_000 ? t : 12_000,
    cooldownMs: Number.isFinite(c) && c >= 0 && c <= 600_000 ? c : 60_000,
    minIntervalMs: Number.isFinite(gap) && gap >= 0 && gap <= 5000 ? gap : 150,
    configErrors,
  };
}

export interface ServerHealth {
  server: NseServer;
  url: string;
  state: "unknown" | "connected" | "degraded" | "down" | "disabled";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailure: { code: McpFailureCode; message: string } | null;
  consecutiveFailures: number;
  calls: number;
  toolsVerified: boolean;
}

/** Minimal surface the providers depend on; lets tests inject a fake. */
export interface McpTransportLike {
  callJson<S extends NseServer>(server: S, tool: ToolOf<S>, args: Record<string, unknown>): Promise<unknown>;
  health(): ServerHealth[];
  readonly enabled: boolean;
}

interface Connection {
  client: Client;
  transport: StreamableHTTPClientTransport;
  tools: Set<string>;
}

const MAX_RESPONSE_CHARS = 2_000_000;
/** After this many consecutive failures, skip the server for config.cooldownMs. */
const BREAKER_THRESHOLD = 3;

/**
 * Observed 22 Oct 2026 (docs/nse-mcp/FINDINGS.md): NSE's MCP front end
 * intermittently answers a valid, just-created session with
 * HTTP 404 "Session not found" and accepts the same session moments later
 * (e.g. 404,404,200,200,404,200 for six requests on one session) — consistent
 * with load-balanced backends that do not share session state. This fetch
 * wrapper retries ONLY that exact response, a bounded number of times with
 * backoff. It changes no headers and bypasses no limit; 429/5xx/other 4xx
 * are returned untouched.
 */
const SESSION_RETRY_DELAYS_MS = [250, 500, 1000];
export function sessionTolerantFetch(base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const body = init?.body;
    const replayable = body === undefined || body === null || typeof body === "string";
    for (let attempt = 0; ; attempt++) {
      const res = await base(input, init);
      const method = (init?.method ?? "GET").toUpperCase();
      if (res.status !== 404 || method !== "POST" || !replayable || attempt >= SESSION_RETRY_DELAYS_MS.length) return res;
      const sessionHeader = new Headers(init?.headers).get("mcp-session-id");
      if (!sessionHeader) return res;
      const text = await res.clone().text().catch(() => "");
      if (!/Session not found/i.test(text)) return res;
      await new Promise((r) => setTimeout(r, SESSION_RETRY_DELAYS_MS[attempt]));
    }
  };
}

export class NseMcpClient implements McpTransportLike {
  private readonly connections = new Map<NseServer, Promise<Connection>>();
  private readonly state = new Map<NseServer, ServerHealth>();
  /** Pacing: tail of the per-server start queue and the last start time. */
  private readonly gates = new Map<NseServer, Promise<void>>();
  private readonly lastStart = new Map<NseServer, number>();

  constructor(private readonly config: McpConfig) {
    for (const server of Object.keys(NSE_MCP_SERVERS) as NseServer[]) {
      this.state.set(server, {
        server,
        url: config.urls[server],
        state: config.enabled ? "unknown" : "disabled",
        lastSuccessAt: null,
        lastFailureAt: null,
        lastFailure: null,
        consecutiveFailures: 0,
        calls: 0,
        toolsVerified: false,
      });
    }
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  health(): ServerHealth[] {
    return [...this.state.values()].map((h) => ({ ...h, lastFailure: h.lastFailure ? { ...h.lastFailure } : null }));
  }

  private async connect(server: NseServer): Promise<Connection> {
    const client = new Client({ name: "marketpulse", version: "0.2.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.config.urls[server]), {
      fetch: sessionTolerantFetch(),
      reconnectionOptions: { maxReconnectionDelay: 10_000, initialReconnectionDelay: 1000, reconnectionDelayGrowFactor: 2, maxRetries: 1 },
    });
    await client.connect(transport, { timeout: this.config.timeoutMs });
    // Verify every tool we rely on actually exists before the first call.
    const tools = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: this.config.timeoutMs });
      for (const t of page.tools) tools.add(t.name);
      cursor = page.nextCursor;
    } while (cursor);
    const s = this.state.get(server)!;
    s.toolsVerified = NSE_MCP_SERVERS[server].tools.every((t) => tools.has(t));
    // Closing an old session must not remove a newer replacement connection.
    const pending = this.connections.get(server);
    client.onclose = () => { if (this.connections.get(server) === pending) this.connections.delete(server); };
    return { client, transport, tools };
  }

  private getConnection(server: NseServer): Promise<Connection> {
    let pending = this.connections.get(server);
    if (!pending) {
      pending = this.connect(server);
      this.connections.set(server, pending);
      pending.catch(() => { if (this.connections.get(server) === pending) this.connections.delete(server); });
    }
    return pending;
  }

  private async drop(server: NseServer) {
    const pending = this.connections.get(server);
    this.connections.delete(server);
    if (!pending) return;
    try {
      const c = await pending;
      await c.client.close();
    } catch {
      /* already gone */
    }
  }

  /** Spaces call *starts* per server by minIntervalMs (calls may still overlap). */
  private async pace(server: NseServer): Promise<void> {
    if (this.config.minIntervalMs <= 0) return;
    const prev = this.gates.get(server) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    this.gates.set(server, prev.then(() => mine));
    await prev;
    const wait = (this.lastStart.get(server) ?? 0) + this.config.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastStart.set(server, Date.now());
    release();
  }

  async callJson<S extends NseServer>(server: S, tool: ToolOf<S>, args: Record<string, unknown>): Promise<unknown> {
    const s = this.state.get(server)!;
    if (!this.config.enabled) throw new McpProviderError("DISABLED", "NSE MCP is disabled by configuration.", server, false);
    if (s.consecutiveFailures >= BREAKER_THRESHOLD && s.lastFailureAt && Date.now() - Date.parse(s.lastFailureAt) < this.config.cooldownMs) {
      throw new McpProviderError("UNAVAILABLE", `NSE ${server} MCP is cooling down after ${s.consecutiveFailures} failures.`, server, true);
    }
    s.calls++;
    await this.pace(server);
    // One fresh-session retry for an expired session / proxy upstream failure.
    // NSE sometimes returns JSON-RPC -32000 instead of an HTTP session error.
    // Never retry timeouts, rate limits, symbol-not-found or validation failures.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const conn = await this.getConnection(server);
        if (!conn.tools.has(tool)) throw new McpProviderError("TOOL_MISSING", `NSE ${server} MCP no longer offers tool "${tool}".`, server, false);
        const result = await conn.client.callTool({ name: tool, arguments: args }, undefined, { timeout: this.config.timeoutMs });
        const json = parseToolResult(result, server, tool);
        s.state = "connected";
        s.lastSuccessAt = new Date().toISOString();
        s.consecutiveFailures = 0;
        return json;
      } catch (error) {
        const failure = classify(error, server);
        const sessionGone = failure.code === "UNAVAILABLE" && attempt === 0 && isRecoverableMcpSession(error);
        if (sessionGone) {
          await this.drop(server);
          await new Promise(resolve => setTimeout(resolve, 250));
          continue;
        }
        if (failure.code !== "TOOL_ERROR") {
          s.consecutiveFailures++;
          s.state = s.consecutiveFailures >= BREAKER_THRESHOLD ? "down" : "degraded";
          if (failure.code === "UNAVAILABLE" || failure.code === "TIMEOUT") await this.drop(server);
        } else {
          // The service answered correctly ("symbol not found"); the server is healthy.
          s.state = "connected";
          s.lastSuccessAt = new Date().toISOString();
          s.consecutiveFailures = 0;
        }
        s.lastFailureAt = new Date().toISOString();
        s.lastFailure = { code: failure.code, message: failure.message };
        throw failure;
      }
    }
    throw new McpProviderError("UNAVAILABLE", `NSE ${server} MCP session could not be re-established.`, server, true);
  }

  async close() {
    await Promise.all((Object.keys(NSE_MCP_SERVERS) as NseServer[]).map((s) => this.drop(s)));
  }
}

export function isRecoverableMcpSession(error: unknown): boolean {
  if (error instanceof StreamableHTTPError) return error.code === 404 || error.code === 400;
  if (error instanceof McpError) {
    // SDK ConnectionClosed shares -32000 with NSE's generic proxy failures.
    if (/rate.?limit|too many|timeout|timed out/i.test(error.message)) return false;
    return error.code === ErrorCode.ConnectionClosed && /upstream|session|connection closed/i.test(error.message);
  }
  return false;
}

export function classify(error: unknown, server: NseServer): McpProviderError {
  if (error instanceof McpProviderError) return error;
  if (error instanceof McpError) {
    if (/rate.?limit|too many/i.test(error.message)) return new McpProviderError("RATE_LIMITED", `NSE ${server} MCP rate limit reached; try again later.`, server, true);
    if (error.code === ErrorCode.RequestTimeout) return new McpProviderError("TIMEOUT", `NSE ${server} MCP did not respond in time.`, server, true);
    if (error.code === ErrorCode.ConnectionClosed) return new McpProviderError("UNAVAILABLE", `NSE ${server} MCP connection closed.`, server, true);
    return new McpProviderError("UNAVAILABLE", `NSE ${server} MCP error ${error.code}: ${error.message.slice(0, 200)}`, server, true);
  }
  if (error instanceof StreamableHTTPError) {
    if (error.code === 429) return new McpProviderError("RATE_LIMITED", `NSE ${server} MCP rate limit reached; try again later.`, server, true);
    return new McpProviderError("UNAVAILABLE", `NSE ${server} MCP HTTP ${error.code ?? "?"}.`, server, true);
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timed? ?out/i.test(message)) return new McpProviderError("TIMEOUT", `NSE ${server} MCP did not respond in time.`, server, true);
  return new McpProviderError("UNAVAILABLE", `NSE ${server} MCP unreachable (${message.slice(0, 160)}).`, server, true);
}

/** Extracts and parses the JSON text payload; maps {"error"} payloads to TOOL_ERROR. */
export function parseToolResult(result: unknown, server: NseServer, tool: string): unknown {
  const r = result as { isError?: boolean; content?: { type: string; text?: string }[]; structuredContent?: unknown } | null;
  if (!r || typeof r !== "object") throw new McpProviderError("INVALID_RESPONSE", `${tool}: empty result.`, server, true);
  if (r.structuredContent && typeof r.structuredContent === "object") return r.structuredContent;
  const text = r.content?.find((c) => c.type === "text")?.text;
  if (typeof text !== "string" || text.length === 0) throw new McpProviderError("INVALID_RESPONSE", `${tool}: no text content.`, server, true);
  if (text.length > MAX_RESPONSE_CHARS) throw new McpProviderError("INVALID_RESPONSE", `${tool}: response too large.`, server, false);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    if (r.isError) throw new McpProviderError("TOOL_ERROR", `${tool}: ${text.slice(0, 200)}`, server, false);
    throw new McpProviderError("INVALID_RESPONSE", `${tool}: response is not JSON.`, server, true);
  }
  if (json && typeof json === "object" && "error" in json && typeof (json as { error: unknown }).error === "string") {
    const msg = (json as { error: string }).error;
    if (/rate.?limit|too many/i.test(msg)) throw new McpProviderError("RATE_LIMITED", `${tool}: ${msg.slice(0, 200)}`, server, true);
    throw new McpProviderError("TOOL_ERROR", `${tool}: ${msg.slice(0, 200)}`, server, false);
  }
  if (r.isError) throw new McpProviderError("TOOL_ERROR", `${tool}: tool reported an error.`, server, false);
  return json;
}

const CLIENT_REVISION = 3; // 3 = bounded proxy/session recovery + replacement-safe lifecycle

// One client per server process (survives Next.js dev hot reloads).
const g = globalThis as unknown as { __mpNseMcp?: { key: string; client: NseMcpClient } };
export function getNseMcpClient(): NseMcpClient {
  const config = readMcpConfig();
  // CLIENT_REVISION: bump when client behaviour changes so dev hot reloads drop the old singleton.
  const key = JSON.stringify({ r: CLIENT_REVISION, e: config.enabled, u: config.urls, t: config.timeoutMs, c: config.cooldownMs, g: config.minIntervalMs });
  if (!g.__mpNseMcp || g.__mpNseMcp.key !== key) {
    void g.__mpNseMcp?.client.close();
    g.__mpNseMcp = { key, client: new NseMcpClient(config) };
  }
  return g.__mpNseMcp.client;
}
