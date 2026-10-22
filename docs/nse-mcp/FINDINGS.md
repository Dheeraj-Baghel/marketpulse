# NSE MCP connectivity findings (Stage 2C)

Probed on **22 Oct 2026, ~15:56–16:05 UTC** (after the NSE close; the session
date was 22 Oct 2026). I used the official TypeScript SDK
`@modelcontextprotocol/sdk` 1.32.1 with `StreamableHTTPClientTransport`.

Scripts:

- [discover.mts](../../scripts/mcp-probe/discover.mts): `listTools` only.
- [sample.mts](../../scripts/mcp-probe/sample.mts) and
  [sample2.mts](../../scripts/mcp-probe/sample2.mts): small, paced calls of
  about 1.2–1.5 s each.

Response **shapes** are in [samples/](samples/). Every numeric market value
is redacted to `"<number>"` and arrays are truncated, so the repository keeps
schema evidence but no NSE market data. The discovered tool schemas are in
[bhavcopy-tools.json](bhavcopy-tools.json) and
[cmmkt-tools.json](cmmkt-tools.json). Nothing here is loaded by the app.

The official page text is in
[../nse-mcp-official-page-excerpt.txt](../nse-mcp-official-page-excerpt.txt).

## Connectivity

| Server | URL | Result |
| --- | --- | --- |
| NSE Bhavcopy | `https://mcp.nseindia.in/bhavcopy/cm/mcp` | ✓ connected (`nse-bhavcopy-redis-mcp` 1.0.0), 21 tools, ~1.2 s connect, no auth |
| NSE CM Market Live | `https://mcp.nseindia.in/cmmkt/mcp` | ✓ connected (`cm-market-mcp` 1.0.0), 15 tools, ~0.3 s connect, no auth |

Both servers return results only as **JSON text** in `content[0].text`. They
provide no `structuredContent` and no `outputSchema`. Tool errors come back as
`{"error": "...", "hint"?: "..."}` with `isError: false`, so the client must
detect this shape itself.

## Tools used by MarketPulse (exact discovered names)

### `get_stock_history` (Bhavcopy)

- Input: `{ symbol: string, months: integer (max 3; 0 = default 3), endDate: "yyyy-MM-dd" | "today" }`.
  All three fields are required.
- Output:
  `{ symbol, from_date, to_date, trading_days, source, query_ms, summary{...}, data: [...], chunk_months, next_end_date }`.
- Each `data[]` row:
  `{ symbol, series, ltp, open, high, low, close, prevClose, volume, totalTradedValue, ch52WeekHigh, ch52WeekLow, mktType, deliveryQty, date: "yyyy-MM-dd" }`.
  `data` is ascending by date. Prices are JSON numbers in rupees with ≤ 2 decimals.
- Paging: up to 3 months per call. Pass `next_end_date` as `endDate` to get the
  next older chunk; chunks do not overlap (verified).
- Coverage: TCS data starts at **2021-10-22**. A chunk ending 2020-12-31
  returns `{"error":"Symbol not found: TCS"}`. This matches NSE's "latest 5
  years".
- The description states: **"All prices are raw NSE bhavcopy data with NO
  corporate action adjustment."**, i.e. *unadjusted*, the same as the Stage 2A CSVs.
- Latest session available on 22 Oct after the close: **2026-10-21**. The tool
  serves the previous trading day's final data, as NSE documents.
- Unknown symbol:
  `{"hint":"Use search_symbols tool to find valid symbols","error":"Symbol not found: X"}`.

### `cm_get_stock_quote` (CM Market Live)

- Input: `{ symbol: string }` (exact NSE symbol).
- Output: `{ updatedAt: ISO-8601 UTC (crawl time), stock: { type: "CM"|"SME", symbol, series, openPrice, highPrice, lowPrice, preClosePrice, lastTradedPrice, indicativeClosePrice, change, perChange, volume, value, fiftyTwoWeekHigh, fiftyTwoWeekLow, perChange30d, latestTimestamp: "yyyy-MM-dd HH:mm:ss" } }`.
- `latestTimestamp` has **no zone**. It read `2026-10-22 16:00:28` minutes
  after 15:30 IST, while `updatedAt` read `15:56:32Z` (21:26 IST). The
  timestamp is therefore the exchange time in **IST**, and MarketPulse shows it
  explicitly as IST.
- Unknown symbol: `{"error":"Symbol 'X' not found"}`.

### Freshness tools (CM Market Live)

- `cm_get_allstocks_status`: `{available, lastCrawled, crawlIntervalMinutes: 1, segmentCounts{EQUITY 3119, SME 587, ...}}`.
- `cm_get_data_status`: gainers/losers crawl status, `crawlIntervalMinutes: 5`, `redisTtlMinutes: 15`.

## Tested securities

**Bhavcopy, 1-month chunk ending "today"** (each 20 sessions, 2026-09-22..2026-10-21):

- RELIANCE ✓, TCS ✓, INFY ✓, HDFCBANK ✓, ITC ✓
- RELIANCE 3-month chunks: 63 rows 2026-07-22..10-21, then 63 rows 2026-04-21..07-21
- TCS back to 2021-10-22

**Quotes** (`latestTimestamp` 2026-10-22 16:00:28): RELIANCE ✓, TCS ✓, INFY ✓, HDFCBANK ✓, ITC ✓.

**SME:**

- `cm_get_stock_quote` works: RAVITA ST, EMKAYTOOLS SM, both `type: "SME"`.
- Bhavcopy history works for EMKAYTOOLS (series SM, 18 rows).
- RAVITA (listed 22 Oct 2026) has no history yet: "Symbol not found".

**Multi-series symbols:** Bhavcopy and quotes return only **one** series, the
one currently listed:

- HAMPTON → EQ (the directory also has BZ)
- PARSVNATH → BE (the directory also has BZ)

So MarketPulse checks the returned series against the requested series and
never relabels it.

**`&` symbols:** ARE&M works on both servers.

## Cross-check with the Stage 2A CSV (RELIANCE EQ)

I compared MCP history against the manually downloaded NSE eq_security CSV
(246 sessions, 2025-10-23..2026-10-21):

- **243 shared sessions have identical OHLCV values** (0 mismatches).
- **2025-11-21 and 2026-04-23:** for these sessions, `get_stock_history`
  returns only a **`series: "T0"`** row (the T+0 settlement segment: volume 20
  and 1 shares) instead of the EQ row. MarketPulse rejects these rows as
  foreign series and never relabels them as EQ, so these two EQ sessions are
  missing from MCP-sourced charts. The response reports this in `providerNotes`.
- **2026-02-01** (Sunday Union Budget special session): the CSV has it, but
  Bhavcopy MCP has no row and `get_ltp_by_date` returns the 30 Jan close.
  MCP history therefore omits this genuine session.
- Full RELIANCE history through MCP: **1,264 sessions, 2021-08-13..2026-10-21**
  in 21 three-month chunks, after which NSE returns "Symbol not found" (the
  start of its 5-year window).

Neither source is a strict superset of the other, which is why the local CSV
fallback is kept.

## Restrictions and terms (from the official page)

- "for informational purpose only and not using it for any commercial purposes"
- "not intended for real-time trading, investment advice, or commercial deployment"
- No "license, right or permission to commercially exploit, train or fine-tune any AI systems ... using such Data"
- Use is subject to NSE's Terms of Use, Disclaimer and Privacy Policy.
- Rate limits are not numerically documented on the official page. Secondary
  sources say limits exist to prevent bulk extraction, and some also say
  storage is not permitted.

**Retention decision:** the official text neither grants nor clearly forbids
local retention. Because of this uncertainty, MarketPulse keeps MCP data
**transient and in-memory only** (short TTL). It never writes MCP data to
SQLite. The Stage 2A CSV data remains the only persisted price data.

## Errors and service restrictions observed

- First probe window (about 40 paced calls): no HTTP errors, rate-limit
  responses or auth challenges.
- Later: intermittent `404 Session not found` (see the next section). There
  was still no 401/403/429 and no `Retry-After`.
- Bhavcopy `source` field values seen: `"in-memory-cache"`. This is the
  server's own cache and is unrelated to our labels.
- **Bhavcopy publication timing:** at ~16:00 UTC on 22 Oct the latest session
  was 21 Oct. By ~17:30 UTC (23:00 IST) Bhavcopy also served **22 Oct**, with
  OHLC equal to that day's final CM quote (O 1206.2 / H 1208 / L 1184.5 /
  C 1184.5 for RELIANCE). The daily candle therefore appears the same evening.
  MarketPulse shows it only when Bhavcopy itself returns it; a quote is never
  turned into a candle.

## Intermittent "Session not found" (observed from 17:20 UTC, 22 Oct 2026)

About 85 minutes after the first probe, both servers began answering requests
on **valid, freshly created** sessions with
`HTTP 404 {"message":"Session not found: <id>"}`, from a Java WebFlux MCP
transport behind Apache.

- The same session was accepted moments later. Sequences of statuses for
  initialize → initialized → tools/list ×3 on fresh sessions looked like
  `[404,404,404,200]`, `[404,200,200,200]` and `[202,404,404,200]`.
- This is consistent with load-balanced backends that do not share session
  state. It is server-side behaviour, not authentication or rate limiting.
- Requests without a session are rejected with 400, so stateless use is not
  possible.

**MarketPulse's handling** (`sessionTolerantFetch` in
[nse-mcp-client.ts](../../src/lib/market-data/nse-mcp-client.ts)):

- It retries **only** that exact response (POST + session header + 404 + body
  "Session not found"), at most 3 times with 250/500/1000 ms backoff.
- It changes no headers and never retries 429, 5xx or other errors.
- Remaining failures use the normal path: labelled local CSV fallback, a stale
  quote with its original timestamp, or an explicit error, plus a 60 s
  circuit breaker.

**Observed effect:**

- **Before the fix**, the running app correctly fell back to "Local CSV —
  Historical EOD" (`fallbackReason: UNAVAILABLE`) and "Cached — Stale" quotes.
- **After the fix**, live requests for ITC, TCS and RELIANCE returned "NSE
  Bhavcopy — Historical EOD" and "NSE CM Market — Delayed Quote", while the
  NSE front end was still intermittently returning these 404s.
