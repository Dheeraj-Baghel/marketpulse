# MarketPulse — working real-data Vercel deployment

**Live:** https://marketpulse-softtech10.vercel.app
**Private source:** https://github.com/Dheeraj-Baghel/marketpulse

## Latest correction — reported AARTIIND chart failure

See [chart-recovery verification](CHART_RECOVERY.md). The normal hosted data
connection remains enabled. Initial chart loading is now recent-first (3M),
with range-driven extension and bounded proxy/session recovery. Every validated
chunk survives older-range failure, no-fallback outages return typed retryable
errors rather than empty successes, and the chart keeps existing data visible.
Only ALL requests MAX; a complete **server** cache is not confused with a sliced
client response. **104 unit tests**, five native synthetic recovery workflows and
five real hosted AARTIIND/AARTIDRUGS/phone workflows pass. No new provider key,
substitute feed or data snapshot change was needed.

## Current decision and delivered behavior

On 26 October 2026, after rejecting the data-disabled preview and browser-import
alternative, the user explicitly instructed: connect Vercel to the real data as
on localhost. Production now runs the **normal application**: directory/search,
company pages, interactive historical charts, NSE delayed quotes, GNews company
news and official annual-report links. No visitor CSV import is required.

The earlier preview-only decision is superseded by this explicit instruction.
The unshipped browser-import experiment was removed, not deployed as a substitute.

**Important:** the operational connection is verified. Public-display permission
from NSE/GNews is still not established by this task. The user was informed of
that caveat; deploying successfully is not a legal/licensing approval. The
operator remains responsible for data-provider terms, public-display rights and
Vercel Hobby's personal/non-commercial limits.

## Architecture

- Dedicated `softtech10/marketpulse` Vercel Hobby project, Next.js 16, Node 24.x.
- Private GitHub `main` automatically deploys production. No other app is included.
- The real local directory and CSV history are copied coherently with SQLite's
  backup API into `server-data/marketpulse.sqlite` (1,105,920 bytes initially).
  Initial snapshot: **3,193 active securities** (3,191 grouped symbols), **492
  stored candles** across RELIANCE/TCS. Original local DB is unchanged.
- Snapshot lives in the private source repository and the server function bundle,
  never `public/`. Direct snapshot download URLs return 404.
- Hosted SQLite is opened **read-only**, with query-only mode, no migrations or
  WAL writes. A missing snapshot fails honestly; `/tmp` is not used as storage.
- NSE Bhavcopy MCP history and CM Market delayed quotes use the same existing
  server-side clients, validation, caches and CSV fallback as localhost.
- GNews uses the existing server-side relevance/deduplication/cache pipeline.
- NSE/GNews provider responses remain transient and are not written to SQLite.
- Refreshes/caches are per serverless instance, not a global distributed cache.
  Automatic deployments do not automatically re-import NSE directory CSVs.

## Production environment

All configured in Vercel **production only**, not committed as dotenv files:

- `MARKETPULSE_REAL_DATA_ENABLED=true` — explicit opt-in to normal hosted mode.
- `MARKETPULSE_PUBLIC_PREVIEW=false`.
- `MARKET_DATA_SOURCE=nse-mcp`, `ENABLE_NSE_MCP=true`.
- `NEWS_PROVIDER=gnews`.
- `GNEWS_API_KEY` — transferred from the existing local config into Vercel's
  encrypted environment; value never printed or written into source/client JS.

Non-production Vercel deployments without the real-data opt-in remain preview
mode. `MARKETPULSE_PUBLIC_PREVIEW=true` always forces the data-disabled fallback.
All preview deployments remain Vercel-auth protected; production is public.

The release checker isolates test child environment, so tests cover both normal
and preview policy without accessing production credentials. No `.env.local`
pull/overwrite occurred. Source `.env.local` and all raw `data/` files are ignored.

## Safe source and data updates

```sh
# From marketpulse on main:
npm ci
npm run check:release
npm run build
# After local NSE directory/price imports, refresh the private server snapshot:
npx tsx scripts/prepare-hosted-database.mts
# Review source and snapshot changes; never add dotenv files or private probes.
git add <intended-source-files> server-data/marketpulse.sqlite
git commit -m "Describe the update"
git push origin main
```

Cloud performs `npm ci`, lint, types, **92 unit tests**, and the Next production
build. Credentials are configured once in project settings, not uploaded from
local files. `.vercelignore` includes only the dedicated snapshot and build
inputs; original data, backups, captures, docs and dotenv files are excluded.
Next file tracing explicitly includes the snapshot and excludes original data.

`MARKETPULSE_REAL_DATA_ENABLED` changes need a new deployment to take effect.
To roll back to the safe preview, set `MARKETPULSE_PUBLIC_PREVIEW=true` and redeploy.
Do not force-push or change another project's settings.

## Verified real hosted responses

Deployment `dpl_xAzHz9aALpQ31qM2cJa8Lpji358q`, source `8b234fa`, built successfully
from GitHub and became Ready. Its Linux cloud lint/type/92-test/build gate passed.

Narrow user-authorized real-provider checks returned HTTP 200:

- `GET /api/prices?symbol=RELIANCE&series=EQ&range=1M`: source
  `nse-bhavcopy-mcp`, label **NSE Bhavcopy — Historical EOD**, 19 daily candles,
  latest trading date **2026-10-26**. This was not the bundled CSV fallback.
- `GET /api/quotes?symbol=RELIANCE&series=EQ`: source `nse-cm-market-mcp`,
  **NSE CM Market — Delayed Quote**, actual exchange timestamp and market-closed
  status. Quotes are never labelled real time or converted to historical candles.
- `GET /api/news?symbol=RELIANCE&series=EQ`: `state: ok`, **10** articles.
- Provider health: preview false, MCP enabled, no configuration errors.

**8/8 native hosted Chromium workflow groups passed** without mocked data:
normal directory/search; native real-history chart; delayed quote/timestamp;
range/type controls without extra history requests; exact ISIN search; actual
company/news/report UI; phone-sized chart/news with no horizontal overflow;
and snapshot/env denial plus absence of the key in client JS and no browser/API
errors. Desktop and phone captures were visually inspected.

Run the real-provider suite manually only (it consumes external provider quota):

```sh
npx tsx tests/e2e/real-hosted.mts
```

Results/captures are local under `artifacts/testing/real-hosted/`, not deployed.
One foreground browser attempt hit the shell time limit after six groups; the
separate owned-process final full run completed all eight groups. The first local
clean staged-source build attempt used a node_modules symlink that Turbopack
refused as outside its root; this was a QA staging issue, not a cloud failure.
The actual cloud used clean Linux installation and passed the complete gate.

Previous local **43 browser regressions** and real-CSV integration remain the
local baseline; they were not all rerun during the final narrowly scoped live
provider check. Source local DB and credential files remain unchanged. Routine
unit tests mock providers; the live checks above did not.

## Remaining limits

- Freshness and availability follow NSE/GNews; no every-symbol/every-browser
  guarantee. NSE's intermittent session errors retain bounded retries and explicit
  fallback/error states. Cold full-history requests can be slower than localhost
  because serverless instances do not share caches.
- News quota/availability and cache state can vary by instance; there is no global
  quota ledger or comprehensive public-abuse protection. Monitor Vercel/provider
  usage. No paid plan or global cache was purchased.
- Public redistribution/display rights still require operator resolution. Sources:
  https://www.nseindia.com/static/nse-terms-of-use,
  https://www.nseindia.com/static/market-data/nse-data-policy,
  https://www.nseindia.com/nse-mcp.
- Real Safari/Firefox, physical phones, sustained production load and human
  accessibility review remain unverified.

## Earlier preview history (superseded)

Initial hosting exposed only a labelled data-disabled page; the existing data
was not uploaded then. That release passed 88 units and 10 hosted preview checks.
Its portable lock needed optional WASM/EMNAPI metadata repaired for cloud npm 12;
existing versions were preserved. The current change intentionally adds the
approved private server snapshot and production credentials to enable real data.
