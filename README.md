# MarketPulse — NSE directory, prices, charts, news and annual-report redirect (Stages 1–4)

A personal NSE stock research workspace.

## Working real-data website — 26 October 2026

**[Open MarketPulse](https://marketpulse-softtech10.vercel.app)** — now connected
to the same real NSE/GNews provider paths as localhost, as explicitly requested
by the user. The disabled preview and unshipped browser-import alternative are
not used in production. No visitor import is required.

[Private GitHub source](https://github.com/Dheeraj-Baghel/marketpulse) automatically
deploys `main` to the dedicated Vercel Hobby project. The real directory/CSV
history is a read-only server snapshot: **3,193 active securities, 492 stored
candles**. Existing NSE MCP history/quotes and GNews fetch automatically server-side;
the encrypted news key never ships to the browser. Source local DB and dotenv
files remain unchanged. Snapshot files have no public download route.

Verified real hosted HTTP 200 responses: **19 RELIANCE history candles through
26 October 2026** from NSE Bhavcopy (not CSV fallback), an actual NSE delayed quote
with exchange timestamp, and **10 GNews company articles**. Native desktop/phone
UI checks exercise search, charts/ranges, quote, company news and report links.
**92 unit tests and 8 hosted workflow groups pass**; the cloud clean build passes.

Public-display permission remains unconfirmed; technical connectivity is not
licensing approval. Cold full-history requests and free-provider quotas can vary.
Physical devices, other browsers and sustained public load remain unverified.
See [hosting, snapshot refresh, verification and limits](DEPLOYMENT.md).

## Chart day ranges — 1D / 2D / 7D

The stock chart range bar is now **1D · 2D · 7D · 1M · 3M · 6M · 1Y · ALL**.
The earlier 1H / 3H / 5H controls (which were always unavailable, because the
sources only provide daily candles) were removed. 1D / 2D / 7D show the latest
1, 2 or 7 stored NSE trading sessions, skipping weekends and holidays; 1D is the
latest daily candle, not an intraday chart. Tooltips and the chart footer say so.
Short windows are centred at a readable candle width, and line mode adds point
markers so a single close is visible. Reset view restores that framing.

Verified: lint, TypeScript, 82 unit tests, production build and the full
43-check browser E2E suite (local CSV import plus local MCP/GNews test doubles;
no NSE or GNews traffic). The E2E suite was updated for the editorial dashboard
heading, the Stage 4 Annual Reports card, and the chart's below-the-fold position
at 1440x900 (it is scrolled into view before hover/zoom checks). Range screenshots:
artifacts/screenshots/day-ranges/.

## Stage 4 — official NSE annual-report redirect

Company pages now replace the annual-report placeholder with an external anchor
to NSE's official annual-report listing. Mainboard links use the database symbol
with `tabIndex=equity`; RELIANCE, TCS, INFY, HDFCBANK and ITC were checked in the
MarketPulse browser UI. NSE's site rejected direct automated browser navigation
from this environment with `ERR_HTTP2_PROTOCOL_ERROR`, so the final filter state
inside NSE could not be independently inspected here. SME `tabIndex=sme` was
therefore not treated as verified: SME pages use the general NSE annual-report
page and show the symbol for manual search. RAVITA was the SME test case.

All links are real anchors with a new-tab target and `noopener noreferrer`.
Mobile at 390px had no horizontal overflow. Lint, TypeScript, 80 unit tests and
the production build pass. The existing dynamic SQLite path build warning remains.
No reports are downloaded, stored, scraped or represented as available.

## Editorial UI refresh — 23 October 2026

The supplied Mastercard-inspired brief is adapted to a research dashboard:
warm #F3F0EE canvas, #FCFBFA panels, floating white pill navigation, 40px
research containers, ink pill actions, orange-dot eyebrows, tight medium-weight
headlines and a warm-black informational footer. Local OFL Sofia Sans variable
font supplies true 450 body weight; its license is in public/fonts/OFL.txt.
MarketPulse keeps its own identity. No proprietary font or Mastercard logo is used.
Circular photographic service cards and decorative orbit sections are deliberately
not inserted into the working directory/table/chart flow. Navigation offers only
existing routes, so a hamburger hiding a single link is unnecessary.

Search, filters, pagination, selection, company details and data-provider logic
are unchanged. Charts and loading/error surfaces use cream with readable semantic
gain/loss colors. Desktop/tablet/mobile browser checks at 1440/768/390px found no
horizontal overflow or page errors; search and company details were exercised.
Screenshots are in artifacts/screenshots/editorial-redesign/. Client prices/quotes
were blocked in this focused UI check to avoid external provider requests; live
provider/chart success and full end-to-end suites were not rerun for this refresh.
Lint, type checks, all 74 unit tests and production build passed. Build reports
a dynamic SQLite path filesystem-tracing warning. No deployment or unrelated
app changes.

- **Stage 1** — research dashboard over the official NSE equity directory
  (search, pagination, selection, company pages).
- **Stage 2A** — authentic daily price history imported from manually
  downloaded NSE security-wise CSVs, served by `GET /api/prices`.
- **Stage 2B** — interactive candlestick/line charts with volume, built on
  TradingView Lightweight Charts **5.2.1**, on the dashboard and company pages.
- **Stage 2C** — automatic data from NSE's **official MCP servers**:
  - daily EOD history from **NSE Bhavcopy** (about 5 years);
  - a separate **delayed quote** from **NSE CM Market** (NSE: about 1–3 minutes
    behind real time).

  Both are fetched on demand and held only transiently in memory. The local CSV
  data stays as the fallback.
- **Stage 3** — **company news from the last 14 days** on `/stocks/[symbol]`.
  It uses the GNews API (server-side), deterministic relevance matching and
  de-duplication, with a 2-hour transient cache. Details are in
  [Company news](#company-news-stage-3).

Annual reports and AI insights are **not implemented**; they remain clearly
labelled, non-interactive placeholders. Nothing is labelled live:

- history is **Historical EOD — NSE Bhavcopy** (or **Local CSV — Historical EOD**);
- the quote is **NSE CM Market — Delayed Quote**, stamped with NSE's own
  exchange time.

For private, informational, non-commercial use only. See [NSE MCP and terms](#nse-mcp-stage-2c).

Stack: Next.js 16 (App Router) · strict TypeScript · Tailwind CSS 4 · shadcn/ui
component pattern (`components.json`, primitives in `src/components/ui`) ·
Lucide · SQLite (better-sqlite3) with Drizzle ORM · lightweight-charts 5.2.1 ·
`@modelcontextprotocol/sdk` 1.32.1 (Streamable HTTP client) · zod.

## Run locally

```bash
npm install
npm run import:nse      # after placing the official CSVs in data/nse/ (see below)
npm run import:prices -- --symbol RELIANCE --series EQ data/prices/Reliance.csv
npm run dev             # http://127.0.0.1:4327
# or: npm run build && npm run start
# news: put GNEWS_API_KEY=... in .env.local (git-ignored), then restart dev
```

The database is created and migrated automatically on first use, so an empty
checkout shows the onboarding screen instead of an error.

## Importing the official NSE directory

1. Download manually from NSE's
   [Securities available for trading](https://www.nseindia.com/static/market-data/securities-available-for-trading)
   page: the **Equity** list (`EQUITY_L.csv`) and the **SME** list (`SME_EQUITY_L.csv`).
2. Place them unchanged in `data/nse/`.
3. Run:

```bash
npm run import:nse                                   # imports both default files
npm run import:nse -- path/EQUITY_L.csv path/SME_EQUITY_L.csv
npm run import:nse -- --segment SME renamed-file.csv # explicit segment
```

The app **never contacts NSE**. Files are not scraped or auto-fetched.

What the importer does:

- Reads the **actual headers**, normalised (`NAME OF COMPANY`, ` NAME_OF_COMPANY`
  both map to `NAME_OF_COMPANY`); column order doesn't matter. Rejects any file
  without SYMBOL / NAME OF COMPANY / SERIES / ISIN NUMBER, so ETF, bond,
  REIT/InvIT and other lists can't be imported as companies.
- Detects Mainboard vs SME from the series codes (EQ/BE/BZ vs SM/ST/SZ) and
  cross-checks the filename.
- Validates per row: symbol shape, non-empty name (whitespace collapsed), series
  allowed for the segment, equity ISIN (`INE…`/`IN9…`, ISO 6166 check digit;
  `INF…` fund units rejected). Parses both date formats (`06-OCT-2008`,
  `22-Oct-26`) and positive face/paid-up/lot values. Bad rows are rejected and
  reported, never guessed.
- Upserts in one transaction on the unique `(segment, symbol, series)` key.
  Repeat imports insert nothing. Securities missing from a newer file are marked
  inactive, not deleted.
- Logs each run in `directory_imports`: file name, SHA-256, file mtime, import
  timestamp, and total/inserted/updated/unchanged/rejected/duplicate/deactivated
  counts plus warnings.

## Database

- File: `data/marketpulse.sqlite` (git-ignored). Override with
  `MARKETPULSE_DB_PATH=/path/to/file.sqlite`.
- Schema: [src/db/schema.ts](src/db/schema.ts). Migration:
  [drizzle/0000_initial_securities.sql](drizzle/0000_initial_securities.sql).
  `npm run db:migrate` applies migrations explicitly. `npm run db:generate`
  creates new migrations after schema changes.
- `securities`: id, symbol, name, isin, segment (`MAINBOARD`/`SME`), series,
  instrument_kind (equity share / DVR-partly-paid / rights entitlement),
  issuer_code (ISIN chars 4–7), listing_date, face/paid-up value, market lot,
  is_active, first_imported_at, imported_at, last_import_id. Unique index on
  `(segment, symbol, series)`, plus indexes on symbol, ISIN, name and issuer.
- **Securities vs companies:** one row per traded security. The dashboard
  groups series per symbol (e.g. HAMPTON EQ + BZ appear as one row), and the
  details page lists other securities from the same issuer (e.g. a DVR or
  `-RE` rights entitlement) via the ISIN issuer code. No separate company table
  is invented.
- `daily_prices` (Stage 2A, migration
  [0001_daily_prices.sql](drizzle/0001_daily_prices.sql)): security_id →
  securities, trade_date (`YYYY-MM-DD`, the exchange session date), open/high/
  low/close as **exact integers in 1/10,000 rupee** (parsed from strings, never
  floats), nullable volume, source, adjustment_status (`UNADJUSTED`),
  imported_at, last_import_id. Unique `(security_id, trade_date, source)`; CHECK
  constraints enforce positive prices, low ≤ open/close ≤ high and volume ≥ 0.
- `price_imports`: every price import run including failures — file name,
  SHA-256, mtime, timestamp, security, status (`SUCCEEDED`/`PARTIAL`/`FAILED`),
  inserted/updated/skipped/rejected counts, source date range, messages.

## Importing historical prices (Stage 2A)

Download a **security-wise historical CSV** manually from
[NSE report-detail/eq_security](https://www.nseindia.com/report-detail/eq_security)
and place it in `data/prices/` (git-ignored). The actual header is
`DATE,SERIES,OPEN,HIGH,LOW,PREV. CLOSE,LTP,CLOSE,VWAP,52 WEEK HIGH,52 WEEK LOW,VOLUME,VALUE,NO. OF  TRADES`
(UTF-8 BOM, newest first, Indian digit grouping). It has **no symbol column**,
so the symbol is passed explicitly (or taken from a file named exactly
`<SYMBOL>.csv`) and validated against the directory:

```bash
npm run import:prices -- --symbol RELIANCE --series EQ data/prices/Reliance.csv
npm run import:prices -- --symbol TCS --series EQ data/prices/TCS.csv
npm run import:prices -- --strict --symbol TCS file.csv   # abort on any bad row
```

Rows are validated (real dates, not future; positive prices; high ≥ low;
open/close within the range with **no tolerance**, which exact integers allow;
non-negative whole volume; missing volume → null, never 0). Bad rows are
reported with line numbers. Repeats are idempotent (identical rows skipped,
corrected rows updated). Each file is imported in one transaction, so a failure
changes nothing. Weekend dates are kept exactly as NSE reports them, e.g. the
Sunday **1 Feb 2026** Union Budget special session.

## Price API (Stage 2A)

`GET /api/prices?symbol=RELIANCE&series=EQ&range=1Y` with range
`1M|3M|6M|YTD|1Y|2Y|5Y|MAX` (default `1Y`), anchored on the latest stored
session. It returns `{symbol, series, name, isin, segment, currency: "INR",
interval: "1d", source, dataMode: "HISTORICAL_EOD", adjustmentStatus:
"UNADJUSTED", range, from, to, latestTradingDate, earliestTradingDate, count,
candles: [{date, open, high, low, close, volume}]}` with ascending candles. A
valid security with no data returns `candles: []` and null dates.

Errors are explicit:

- 400 `INVALID_SYMBOL` / `INVALID_SERIES` / `UNSUPPORTED_RANGE`
- 404 `UNKNOWN_SECURITY` / `UNKNOWN_SERIES`
- 409 `AMBIGUOUS_SERIES` (e.g. HAMPTON without `series`)
- 500 `INTERNAL_ERROR`

It never falls back to another series or security. Behind it,
`HistoricalPriceProvider` ([types](src/lib/market-data/types.ts)) has one
implementation, `LocalNseHistoricalProvider` (SQLite).

## Charts (Stage 2B)

- Reusable [StockPriceChart](src/components/charts/StockPriceChart.tsx) is used
  by both the dashboard preview (~60% column) and `/stocks/[symbol]`. The chart
  engine ([price-chart-canvas.tsx](src/components/charts/price-chart-canvas.tsx))
  is loaded with `next/dynamic({ ssr: false })`. It uses the v5 API
  (`createChart`, `addSeries(CandlestickSeries | LineSeries | HistogramSeries)`,
  pane index 1 for volume, `autoSize`). It is created once per mount and
  destroyed with `chart.remove()` on unmount; data changes update series in place.
- **Data:**
  - Only `GET /api/prices?range=MAX` for the selected security. Nothing is
    preloaded for the other 3,193 securities.
  - Responses are validated before rendering
    ([candles.ts](src/lib/charts/candles.ts)): identity must match the
    requested symbol+series; candles must be strictly ascending and unique,
    with valid OHLC.
  - Dates are passed as `YYYY-MM-DD` business-day strings and formatted by
    string arithmetic, so no timezone can shift a session.
  - No gaps are filled and no candles are invented.
- **Switching companies:** the previous request is aborted with
  `AbortController`, and results are keyed by symbol+series and shown only for
  the selected key. Successful results are cached per page load.
- **Controls:**
  - Ranges 1D / 2D / 7D / 1M / 3M / 6M / 1Y / ALL are applied client-side,
    anchored on the latest stored session. The footer states the real stored
    coverage and warns if a range exceeds it.
  - **1D / 2D / 7D** are the latest 1, 2 or 7 stored **trading sessions** of
    daily EOD data, not calendar days and not intraday prices. 1D is the
    latest daily candle; weekends and exchange holidays are skipped, so these
    ranges are never empty while history exists. The footer states this, and
    sparse candles are centred at a readable width (line mode shows point
    markers so a single close stays visible). The earlier unavailable
    1H / 3H / 5H placeholders were removed: the sources provide no intraday
    candles.
  - Candlestick/line toggle (line = closes).
  - Crosshair OHLCV readout, which shows the latest session when not hovering.
  - Volume pane coloured by direction, hidden if the source has no volume.
  - Wheel zoom, drag/touch pan, reset view, full screen (Fullscreen API with a
    CSS fallback), responsive sizing.
  - The dashboard keeps range and mode when you switch companies.
- **Header:** symbol — name, "Historical close" with session date, change vs
  the previous available session (omitted with fewer than two sessions), a
  **HISTORICAL EOD** badge, and "Source: Imported NSE historical data ·
  Unadjusted".
- **States:** loading skeleton (20 s timeout, never an endless spinner),
  "Historical price data is not available for this security.", no sessions in
  range, unknown/ambiguous security, API/database error with **Retry**,
  invalid response, missing volume. Company metadata stays visible in every
  state.

Charts currently work for the two imported securities:

- **RELIANCE EQ** and **TCS EQ**, 246 sessions each, 23 Oct 2025 – 21 Oct 2026
  (about one year).
- **ALL** therefore equals about 1Y. No longer history is claimed.
- Every other security shows the no-data state until its CSV is imported.

(With Stage 2C enabled, charts are available for any security NSE Bhavcopy
serves; the list above is the **local CSV** coverage used when MCP is disabled
or unavailable.)

## NSE MCP (Stage 2C)

Connectivity, discovered tools, real response shapes and the cross-check
against the CSV import are documented in
[docs/nse-mcp/FINDINGS.md](docs/nse-mcp/FINDINGS.md). To re-run discovery
(listTools only, no data calls): `npm run probe:nse-mcp`.

**Tools used** (exact names discovered via `listTools`):

- `get_stock_history` on `https://mcp.nseindia.in/bhavcopy/cm/mcp`
- `cm_get_stock_quote` on `https://mcp.nseindia.in/cmmkt/mcp`

The client
([nse-mcp-client.ts](src/lib/market-data/nse-mcp-client.ts)) runs **only on
the server** (`server-only`); the browser only calls `/api/*`. It:

- uses the official SDK's Streamable HTTP transport and verifies tools at connect;
- reuses one connection per server, reconnecting lazily;
- applies per-call timeouts and 150 ms polite pacing per server;
- retries only NSE's intermittent `404 Session not found` on a valid session
  (at most 3 times; see [FINDINGS](docs/nse-mcp/FINDINGS.md)), and never
  retries 429/5xx;
- trips a circuit breaker after 3 consecutive failures;
- validates every payload ([normalize.ts](src/lib/market-data/normalize.ts));
- exposes health at `GET /api/market-data/status`, which makes no upstream calls.

**Source priority** ([provider.ts](src/lib/market-data/provider.ts)):

| Data | 1st | 2nd | 3rd |
| --- | --- | --- | --- |
| Daily candles (`/api/prices`) | NSE Bhavcopy — Historical EOD | Local CSV — Historical EOD (`isStale` + `fallbackReason` when MCP failed) | Unavailable |
| Quote (`/api/quotes`) | NSE CM Market — Delayed Quote | Cached — Stale (last good quote, **original** exchange timestamp, ≤ 6 h) | Unavailable |

Every response states its `sourceId`/`sourceLabel`; categories never switch
silently. A quote is never turned into, or appended as, a candle.

**APIs:**

- `GET /api/prices` keeps its 2A contract and adds `sourceId`, `sourceLabel`,
  `isStale`, `fallbackReason`, `provider` (`fetchedAt`, `cached`, `complete`,
  excluded other-series rows) and `refresh=1`.
- `GET /api/quotes?symbol=&series=[&refresh=1]` returns
  `{dataMode: "DELAYED_QUOTE", sourceLabel, quote{lastPrice, previousClose, change, changePct, changeComputed, open, high, low, volume, exchangeTimestamp}, fetchedAt, cached, marketSession, delayNote, attribution}`.
- New error codes: `NO_HISTORICAL_DATA`, `UNSUPPORTED_SERIES`,
  `PROVIDER_TIMEOUT` (504), `PROVIDER_RATE_LIMITED` (429),
  `PROVIDER_INVALID_RESPONSE` / `PROVIDER_TOOL_MISSING` /
  `PROVIDER_UNAVAILABLE` (502), `PROVIDER_DISABLED` (503).
- Symbols are validated against the directory **before** any MCP call.
- In development only, `source=auto|nse-mcp|local-csv` forces a source.

**Refresh and caching** (all transient, in memory, never written to SQLite):

- **History:**
  - Fetched for the selected security only, newest 3-month chunk first, just
    far enough for the requested range.
  - 1Y takes about 4–5 calls; ALL takes about 21 calls once, about 2–4 s live.
  - Cached for 30 minutes per security, with concurrent identical requests
    merged.
  - Bhavcopy changes once per trading day (the previous session's final
    data), so this fetches nothing new intraday.
  - Cached data is reused within its TTL even if NSE goes down. "Refresh
    historical data" bypasses the cache; if NSE is then unreachable the chart
    switches, labelled, to the local CSV.
- **Quote:**
  - One call when a stock is selected, cached 60 s server-side with
    concurrent identical requests merged.
  - The manual refresh button bypasses the cache.
  - Background refresh runs every 120 s, only for the selected stock, only
    while the IST clock says the market is open or in pre-open, and only
    while the tab is visible. Nothing is polled across the directory.
  - After the close, at weekends and on holidays the quote shows NSE's last
    exchange timestamp with "market closed". NSE holidays are not modelled;
    the timestamp is the truth.
- **Disabling all external fetching:** set `ENABLE_NSE_MCP=false` or
  `MARKET_DATA_SOURCE=local-csv` (see [.env.example](.env.example)). Only the
  two exact official URLs are accepted; any other configured URL disables MCP.

**Correctness rules applied to MCP data:**

- **Identity:** the symbol and series must match the request. NSE reports
  some symbols only in their current series (e.g. HAMPTON → EQ) and returns
  T+0 (`T0`) rows on some days. Those rows are excluded and counted, never
  relabelled.
- **Validation:**
  - Prices are converted exactly to 1/10,000-rupee integers.
  - OHLC values must be within the day's high–low range.
  - Dates are real sessions, never in the future; duplicates are removed and
    conflicting rows rejected.
  - Missing volume is left as null.
  - No candles are created or interpolated.
- **Unadjusted prices:** the history is raw bhavcopy, the same as the CSV.
  The chart flags close-to-close moves of 35% or more as possible corporate
  actions (e.g. RELIANCE's 1:1 bonus, ex-date 28 Oct 2024) without altering
  any price.

**Terms:**

- NSE states MCP data is for informational use, not commercial use, real-time
  trading or AI training/fine-tuning.
- MarketPulse does not redistribute data or provide trading functionality, and
  attributes NSE.
- It keeps MCP data out of persistent storage because retention rights are not
  established.
- Committed probe samples in `docs/nse-mcp/samples/` are redacted to shapes
  only.

## Company news (Stage 3)

`/stocks/[symbol]` shows **Recent News**, articles from the past 14 days,
beneath the chart. It is loaded by its own request, so news never delays or
breaks charts or quotes. The real GNews probe results are in
[docs/news/FINDINGS.md](docs/news/FINDINGS.md).

**Setup:** put your free GNews key in **`.env.local`** (git-ignored, read only
by the server), then restart `npm run dev`:

```env
GNEWS_API_KEY=your_key_here
```

Never put the key in `.env.example` (committed) or in a `NEXT_PUBLIC_`
variable. Optional settings: `NEWS_PROVIDER=gnews`, `NEWS_LOOKBACK_DAYS=14`,
`NEWS_CACHE_TTL_SECONDS=7200`, `NEWS_DAILY_REQUEST_BUDGET=90` (see
[.env.example](.env.example)). Without a key the section says "News provider
not configured." and shows these instructions.

**Pipeline** ([src/lib/news/](src/lib/news/)):

1. The symbol is validated against the NSE directory; unknown symbols return 404.
2. The company is resolved by symbol. All series of a symbol count as one
   company.
3. A query is built from the **verified directory name**, with suffixes such as
   "Limited" removed for search only
   ([company-query.ts](src/lib/news/company-query.ts)).
4. GNews `GET https://gnews.io/api/v4/search` is called with
   `q, lang=en, max=10, sortby=publishedAt, from, to, in=title,description,
   nullable`. The key goes in the `X-Api-Key` header, never in the URL.
5. Responses are validated:
   - http(s) links only, with no credentials, localhost or bare IPs;
   - strict ISO timestamps;
   - tags stripped from text.
6. Articles are re-checked against the rolling 14-day window (UTC) and
   relevance-matched.
7. Duplicates are removed: same id, canonical URL (tracking parameters and AMP
   variants removed), identical title, or ≥ 90% title similarity from the same
   publisher or within 30 minutes.
8. Results are sorted newest first.

**Company matching** ([matching.ts](src/lib/news/matching.ts)) is
deterministic and uses no AI:

- **Verified:** the headline names the company (full name or a strong alias),
  or the headline has a weak alias right next to a market word, e.g. "TCS
  shares" or "stake in ITC".
- **Likely:** the summary names the company. These are shown with a "Mentions
  company" tag.
- **Rejected:** only a different listed company with a similar name is
  mentioned (Reliance Power, ITC Hotels, HDFC Life). Also rejected: a bare
  acronym without company context (e.g. "TCS" meaning tax collected at
  source), or no mention at all.

The query never adds the bare symbol. The alias list is small and hand-verified:

| Symbol | Aliases |
| --- | --- |
| RELIANCE | "RIL" (strong) |
| TCS | "TCS" (weak) |
| ITC | "ITC Ltd"/"ITC Limited" (strong), "ITC" (weak) |

Weak aliases are matched case-sensitively and only together with market
context.

**Quota and cache:**

- **Cache:** news is fetched only when a company page opens, and kept in a
  transient in-memory cache per company for 2 h (configurable). Empty results
  are cached too, concurrent requests share one call, and cached articles are
  re-filtered against the current 14-day window. Nothing is written to SQLite,
  because GNews's free terms neither grant nor forbid retention.
- **Pacing:** requests are spaced 1.1 s apart (the free limit is 1 per second).
- **Daily budget:** a local guard allows at most `NEWS_DAILY_REQUEST_BUDGET`
  (90) requests per UTC day, leaving headroom under the 100/day limit.
- **On HTTP 403** (quota reached) no further calls are made until 00:00 UTC.
  Cached articles are shown with "Daily news API limit reached…" and their
  original "Last checked" time.
- **On 429** there is a 5-second cool-down. On 5xx or a timeout the section
  shows "Unable to fetch recent news." with Retry.
- Provider errors are never reported as "no news".

**UI** ([src/components/news/](src/components/news/)): text-first cards with
headline, publisher, IST time, domain and a short summary.

- Article images are never shown (third-party copyright).
- Links open the original publisher in a new tab with
  `rel="noopener noreferrer nofollow"`.
- The header shows the provider status, "Last checked" and a refresh button.
- The footer notes the ~12-hour free-plan delay, the 10-result limit per
  request when the provider reports more matches, and attribution.
- Empty state: "No matching company news found in the previous 14 days", with
  a note that this does not mean no news exists.

## Features (Stage 1)

- Sidebar (MarketPulse brand, Dashboard), header with title, debounced search
  (250 ms, `/` shortcut, Esc/clear) and an import-status disclosure
  (per-segment counts, last import time, row counts).
- Directory table (~40% desktop width): symbol, company, segment, optional
  ISIN column toggle. Server-side pagination of 25 rows. Search is a
  case-insensitive partial match on name, symbol or ISIN, ranking exact and
  prefix symbol matches first. Mainboard/SME filter. State lives in the URL
  (`?q=&page=&segment=&selected=`).
- Row selection by click or keyboard (arrows/Home/End/Enter, roving tabindex)
  updates the preview panel. The company name links to `/stocks/[symbol]`.
- Chart area (~60%) — superseded by the Stage 2B chart (above).
- `/stocks/[symbol]`: name, symbol, ISIN, segment, series with meaning,
  instrument, listing date, face/paid-up value, market lot, directory timestamp,
  related issuer securities, back link. News / Annual report / AI insights are
  inert "Not available yet" placeholders. Lower-case URLs redirect to canonical
  ones; unknown symbols return a real 404.
- Empty-database onboarding, incomplete-directory warning (one segment missing),
  no-results state, loading skeletons, error boundary.
- Responsive: fixed sidebar ≥1024 px; top bar and stacked table → preview
  below that. Tapping a row on mobile scrolls to the preview.

## Tests

```bash
npm run lint
npm run typecheck
npm test                  # unit: directory parser, price parser/importer/API service, chart data layer
npm run test:integration  # real RELIANCE/TCS CSVs on a copy of the live DB (skips if absent)
npm run test:e2e          # Chromium acceptance run (needs data/nse/*.csv; chart checks need data/prices/*.csv)
```

`test:e2e` starts an isolated `next dev` on port 4329 (separate build folder,
throwaway database, so it can run alongside `npm run dev`). It runs 42 checks
plus a zero-console-error check, and **never contacts NSE or GNews** (the real
`GNEWS_API_KEY` from `.env.local` is explicitly blanked for test servers):

- Stage 1 directory behaviour.
- Stage 2A import/API.
- Stage 2B charts: every plotted candle and volume compared with SQLite;
  crosshair values; TCS replacing RELIANCE; line toggle; ranges; zoom/pan/reset;
  full screen; delayed-response race; injected 500 + retry; chart-instance
  cleanup; details page; 1440/1280/820/390 px layouts.
- Stages 1–2B run with MCP disabled.
- Stage 2C (checks 27–34) starts a second app server pointed at a **local
  synthetic MCP double**, [mcp-double.mts](tests/e2e/mcp-double.mts). The
  double is a real MCP server built with the official SDK, using NSE's tool
  names and payload shapes with invented prices. The checks cover:
  - history and quote rendering and labels;
  - caches and refresh;
  - races with delayed responses;
  - outage → labelled CSV fallback and stale quote;
  - malformed payloads;
  - unsupported securities;
  - the details page and 390 px layout.
- Stage 3 (checks 35–42) uses the same second server plus a **local synthetic
  GNews double**, [gnews-double.mts](tests/e2e/gnews-double.mts). Its headlines
  are tagged `[TEST]` and its URLs are on `example.com`. The checks cover:
  - relevance (a sibling company, a TCS tax story, a duplicate and a 20-day-old
    story are all rejected);
  - newest-first order and IST timestamps;
  - safe outbound links and no images;
  - the key sent as a header and never leaked;
  - cache revisits making 0 calls;
  - the SME empty state;
  - fast company switching;
  - quota → stale articles with the original "Last checked", plus no further calls;
  - not-configured state;
  - 820/390 px layouts.

Unit tests run with `--conditions=react-server` so server-only modules load
outside Next.

Real NSE calls are limited to the manual probes in `scripts/mcp-probe/` and
[tests/e2e/probe-2c.mts](tests/e2e/probe-2c.mts), which run against the
running app. Its screenshots contain real NSE data, so they go to the
git-ignored `artifacts/local-only/` folder.

Synthetic fixtures exist only inside explicitly labelled unit tests. It writes
`artifacts/testing/results.json` and screenshots to `artifacts/screenshots/`.

## Extending in later stages

- Another price source: implement `HistoricalPriceProvider`, add a
  `PRICE_SOURCES` value; the API, chart and tests are source-agnostic.
- News, reports, AI: add tables referencing `securities.id` / `issuer_code` and
  fill the `FutureSection` slots.

## Known issues / limits

- The NSE files have no "as of" field, so the source timestamp stored is the
  file's modification time plus the import time.
- `HAMPTON` and `PARSVNATH` each appear in two Mainboard series. They're stored
  as separate securities and shown as one directory row with both series.
- SQLite `LIKE` case-folding is ASCII-only. That's fine for current NSE names,
  but non-ASCII names would match case-sensitively.
- Tested in Chromium (desktop, 820 px tablet, 390 px mobile emulation) only.
  Safari/Firefox, real touch devices and screen readers have not been checked.
- Prices are **unadjusted**: splits/bonuses appear as price jumps. The chart
  flags them but does not adjust them.
- Local CSV: only about 1 year (246 sessions) is imported for RELIANCE/TCS.
  With MCP, NSE serves about 5 years (e.g. RELIANCE 13 Aug 2021 – 21 Oct 2026,
  1,264 sessions).
- MCP history lacks a few genuine EQ sessions:
  - On 2025-11-21 and 2026-04-23 NSE returned only `T0` rows for RELIANCE;
    these are excluded and noted in the footer.
  - The Sunday 1 Feb 2026 budget session is absent from Bhavcopy MCP, although
    the CSV has it.
- MCP data is not persisted, so the first ALL load after a server restart
  re-fetches about 21 chunks.
- Market-session detection is clock-based (09:15–15:30 IST, Mon–Fri) and does
  not know NSE holidays. It only gates background refresh; the displayed
  timestamp always comes from NSE.
- NSE's MCP front end intermittently rejects valid sessions
  (`404 Session not found`, observed 22 Oct 2026). MarketPulse retries that
  specific response a few times. If it persists, the app shows the labelled
  CSV fallback or a stale quote, so data may briefly come from the fallback.
- NSE does not publish numeric rate limits. MarketPulse paces calls and backs
  off, but heavy use could still be throttled; that surfaces as
  `PROVIDER_RATE_LIMITED`.
- Chart canvas content is not readable by screen readers beyond its summary
  `aria-label` and the textual OHLC readout.
- The Lightweight Charts attribution logo is kept, as the library's licence
  asks.
