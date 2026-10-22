# MarketPulse — Stage 1: NSE company directory and dashboard

A personal NSE stock research workspace. **Stage 1 only:** a dark research
dashboard over the official NSE equity directory, with search, pagination,
selection and company detail pages. Charts, prices, news, annual reports and AI
features are **not implemented**; they are shown as clearly labelled,
non-interactive placeholders.

Stack: Next.js 16 (App Router) · strict TypeScript · Tailwind CSS 4 · shadcn/ui
component pattern (`components.json`, primitives in `src/components/ui`) ·
Lucide · SQLite (better-sqlite3) with Drizzle ORM.

## Run locally

```bash
npm install
npm run import:nse      # after placing the official CSVs in data/nse/ (see below)
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
- Chart area (~60%) states "Price chart not configured yet". No invented
  prices, percentages or lines.
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
npm test            # 7 unit tests: CSV, ISIN checksum, dates, parser, idempotent import
npm run test:e2e    # Chromium acceptance run (needs data/nse/*.csv)
```

`test:e2e` starts `next dev` on port 4329 against a throwaway database and runs
the ten Stage 1 checks plus a zero-console-error check. It writes
`artifacts/testing/results.json` and screenshots to `artifacts/screenshots/`.

## Extending in later stages

- Chart provider: replace the placeholder in
  `src/components/directory/selected-company-panel.tsx` and the details page;
  key data by `securities.id` or `(symbol, segment)`.
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
