import "server-only";
import { TtlCache } from "./cache";
import { McpProviderError, type McpTransportLike } from "./nse-mcp-client";
import { normalizeQuote, type DelayedQuote } from "./normalize";

/**
 * Delayed quotes from the official NSE CM Market Live MCP tool
 * `cm_get_stock_quote` (NSE: ~1-3 minutes behind real time).
 *
 * - One symbol per call, only for the security the user selected.
 * - Short in-memory TTL + single-flight: rapid re-selection or several tabs
 *   share one upstream request. Never persisted.
 * - The last good quote is kept so an outage can show it explicitly as
 *   "Cached — Stale" with its ORIGINAL exchange timestamp (never re-dated).
 */

export interface QuoteEntry {
  quote: DelayedQuote;
  fetchedAt: string;
}

export type QuoteResult =
  | { ok: true; entry: QuoteEntry; cached: boolean }
  | { ok: false; kind: "not-found" | "series-mismatch" | "invalid"; message: string; providerSeries?: string }
  | { ok: false; kind: "provider"; error: McpProviderError; stale: QuoteEntry | null };

export class NseCmQuoteProvider {
  readonly id = "nse-cm-market-mcp";
  readonly cache = new TtlCache<QuoteEntry>(256);
  calls = 0;

  constructor(
    private readonly mcp: McpTransportLike,
    private readonly opts: { ttlMs: number; staleMaxMs: number; now?: () => Date },
  ) {}

  async getQuote(security: { symbol: string; series: string }, opts: { force?: boolean } = {}): Promise<QuoteResult> {
    const key = `${security.symbol}|${security.series}`;
    try {
      const { value, cached } = await this.cache.getOrLoad(
        key,
        this.opts.ttlMs,
        async () => {
          this.calls++;
          const payload = await this.mcp.callJson("cmmkt", "cm_get_stock_quote", { symbol: security.symbol });
          const parsed = normalizeQuote(payload, security);
          if (!parsed.ok) throw new QuoteRejected(parsed.seriesMismatch ? "series-mismatch" : "invalid", parsed.reason, parsed.seriesMismatch);
          return { quote: parsed.quote, fetchedAt: (this.opts.now?.() ?? new Date()).toISOString() };
        },
        { force: opts.force },
      );
      return { ok: true, entry: value, cached };
    } catch (error) {
      if (error instanceof QuoteRejected) return { ok: false, kind: error.kind, message: error.message, providerSeries: error.providerSeries };
      if (error instanceof McpProviderError && error.code === "TOOL_ERROR" && /not found/i.test(error.message)) {
        return { ok: false, kind: "not-found", message: `NSE CM Market has no quote for ${security.symbol}.` };
      }
      if (error instanceof McpProviderError) {
        const last = this.cache.peek(key);
        const now = (this.opts.now?.() ?? new Date()).getTime();
        const stale = last && now - last.storedAt <= this.opts.staleMaxMs ? last.value : null;
        return { ok: false, kind: "provider", error, stale };
      }
      throw error;
    }
  }
}

class QuoteRejected extends Error {
  constructor(
    readonly kind: "series-mismatch" | "invalid",
    message: string,
    readonly providerSeries?: string,
  ) {
    super(message);
  }
}
