# MarketPulse — NSE directory, historical prices and charts (Stages 1, 2A, 2B)

A personal NSE stock research workspace:

- **Stage 1** — dark research dashboard over the official NSE equity directory
  (search, pagination, selection, company pages).
- **Stage 2A** — authentic daily price history imported from manually
  downloaded NSE security-wise CSVs, served by `GET /api/prices`.
- **Stage 2B** — interactive candlestick/line charts with volume, built on
  TradingView Lightweight Charts **5.2.1**, on the dashboard and company pages.

News, annual reports and AI insights are **not implemented**; they remain
clearly labelled, non-interactive placeholders. There is no live or delayed
price feed: every price shown is a stored historical end-of-day value.

Stack: Next.js 16 (App Router) · strict TypeScript · Tailwind CSS 4 · shadcn/ui
component pattern (`components.json`, primitives in `src/components/ui`) ·
Lucide · SQLite (better-sqlite3) with Drizzle ORM · lightweight-charts 5.2.1.

## Run locally

```bash
npm install
npm run import:nse      # after placing the official CSVs in data/nse/ (see below)
npm run import:prices -- --symbol RELIANCE --series EQ data/prices/Reliance.csv
npm run dev             # http://127.0.0.1:4327
# or: npm run build && npm run start
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
  - Ranges 1M / 3M / 6M / 1Y / ALL are applied client-side, anchored on the
    latest stored session. The footer states the real stored coverage and
    warns if a range exceeds it.
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
throwaway database, so it can run alongside `npm run dev`). It runs 26 checks
plus a zero-console-error check:

- Stage 1 directory behaviour.
- Stage 2A import/API.
- Stage 2B charts: every plotted candle and volume compared with SQLite;
  crosshair values; TCS replacing RELIANCE; line toggle; ranges; zoom/pan/reset;
  full screen; delayed-response race; injected 500 + retry; chart-instance
  cleanup; details page; 1440/1280/820/390 px layouts.

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
- Prices are **unadjusted**: splits/bonuses would appear as price jumps.
- Only ~1 year (246 sessions) is imported for RELIANCE/TCS; longer ranges need
  additional NSE downloads. Several files can be imported for one symbol, and
  overlapping dates are de-duplicated.
- Chart canvas content is not readable by screen readers beyond its summary
  `aria-label` and the textual OHLC readout.
- The Lightweight Charts attribution logo is kept, as the library's licence
  asks.
