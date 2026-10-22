/**
 * Tiny in-process TTL cache with in-flight de-duplication ("single flight").
 * Transient by design: NSE MCP data is never persisted (retention rights are
 * not established; see docs/nse-mcp/FINDINGS.md). Cleared on server restart.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; storedAt: number; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<V>>();
  hits = 0;
  misses = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Fresh value, or undefined. */
  get(key: string): V | undefined {
    const e = this.entries.get(key);
    if (!e || e.expiresAt <= this.now()) return undefined;
    return e.value;
  }

  /** Value regardless of expiry, with its age (for explicitly-stale fallbacks). */
  peek(key: string): { value: V; storedAt: number; expired: boolean } | undefined {
    const e = this.entries.get(key);
    return e ? { value: e.value, storedAt: e.storedAt, expired: e.expiresAt <= this.now() } : undefined;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.entries.delete(key);
    const now = this.now();
    this.entries.set(key, { value, storedAt: now, expiresAt: now + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /**
   * Returns a fresh cached value, or runs `load` once even if many callers ask
   * concurrently (they all await the same promise).
   */
  async getOrLoad(key: string, ttlMs: number, load: () => Promise<V>, opts: { force?: boolean } = {}): Promise<{ value: V; cached: boolean }> {
    if (!opts.force) {
      const fresh = this.get(key);
      if (fresh !== undefined) {
        this.hits++;
        return { value: fresh, cached: true };
      }
    }
    const pending = this.inflight.get(key);
    if (pending) {
      this.hits++;
      return { value: await pending, cached: true };
    }
    this.misses++;
    const promise = load();
    this.inflight.set(key, promise);
    try {
      const value = await promise;
      this.set(key, value, ttlMs);
      return { value, cached: false };
    } finally {
      this.inflight.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number {
    return this.entries.size;
  }
}
