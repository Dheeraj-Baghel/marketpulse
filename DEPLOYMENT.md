# MarketPulse — public hosting boundary

26 October 2026: the user authorized GitHub/Vercel publication and specifically
selected a **public website** rather than a private data snapshot. The selected
choice said not to upload the existing database before public-data licensing and
hosting requirements are resolved. Existing NSE CSVs, SQLite data, backups and
provider keys stay local.

## Current blocker

NSE's official Terms of Use require prior written permission to copy, transmit,
distribute, display or publish its website Content. The MCP page allows educational
and informational integrations and excludes commercial deployment; it does not
establish public redistribution permission for this project. Unauthenticated
endpoints are not a redistribution licence.

Sources checked:
- https://www.nseindia.com/static/nse-terms-of-use
- https://www.nseindia.com/static/market-data/nse-data-policy
- https://www.nseindia.com/nse-mcp
- Existing project research: docs/nse-mcp/FINDINGS.md

## Safe public preview

Source is pushed to [the dedicated private GitHub repository](https://github.com/Dheeraj-Baghel/marketpulse).
The dedicated Vercel Hobby project serves [the public, data-disabled preview](https://marketpulse-softtech10.vercel.app).
It is not the complete functioning NSE research deployment. No synthetic market
prices, fake companies, fake news, or claimed live feed will be added.

A server-only public-preview policy prevents opening the local database and forces
external market/news services off, independently of provider enable flags. The
preview uses an empty in-memory schema where existing read routes require a DB,
not a writable SQLite file on the Vercel filesystem. The local application and
its imported database remain unchanged outside Vercel when preview mode is absent.
`VERCEL=1` or `MARKETPULSE_PUBLIC_PREVIEW=true` forces preview mode. Setting provider
flags or a news key cannot enable data on Vercel; activation requires a reviewed
code change after permissions are established.

The Vercel upload allowlist excludes all user data, CSVs, databases, captures,
backups, probe output and environment files. No GNews key was transferred to
this public deployment. Public news distribution and anonymous quota exposure
also need a reviewed provider plan before activation.

## What is required for full public functionality

- Written NSE permission or a provider/data licence explicitly covering public
  website display, including redistribution and anonymous downstream access.
- Approved terms for the news provider's public display and usage limits.
- A hosting-compatible data strategy: a licensed immutable read-only snapshot
  can be bundled, or a persistent hosted database can be used for updates.
  Vercel Functions cannot persist writes to the application's local SQLite file;
  `/tmp` is ephemeral and is not a persistent database.
- Operational access controls/rate limits for public provider-facing endpoints.

Until these are established, the public preview must remain fail-closed and the
existing data must not be copied into source, public assets or deployment inputs.

## Hosting and safe updates

- Team/account: `softtech10`, existing Hobby plan; no paid service or upgrade.
- Dedicated project: `marketpulse`, Next.js, **Node 24.x** pinned in source/settings.
- GitHub source stays private; `main` pushes automatically deploy production.
- Production is anonymous/public; non-production previews retain Vercel sign-in.
- Cloud gate: `npm ci`, source lint/typecheck/88 units, then Next production build.
- `check:release` isolates test child environment so tests cover normal local
  behavior and public-preview safety separately, without changing deployment env.
- `.vercelignore` and Next file-tracing exclusions both omit data, captures,
  docs and environment files. Migrations are explicitly bundled for the empty
  in-memory schema; native SQLite remains a server-side external package.
- No CLI env pull was used: the original `.env.local` was not overwritten.

```sh
# From marketpulse, on main:
npm ci
npm run check:release
MARKETPULSE_PUBLIC_PREVIEW=true npm run build
git add <intended-source-files>
git commit -m "Describe the change"
git push origin main
```

Do not add data snapshots or secrets. Changing environment variables alone must
not lift the preview boundary. Personal/non-commercial Vercel Hobby conditions
still apply; no commercial hosting or data licence is implied.

## Verification and known limitations

- Local lint/types, **88/88 unit tests**, and one real CSV integration test pass.
- Original local app: **43/43 browser regression checks** pass against throwaway
  SQLite databases, supplied CSV inputs and local MCP/GNews doubles. No NSE/GNews
  service traffic or quota was used during verification.
- Public preview: **9/9 local production checks and 10/10 hosted checks** pass:
  truthful UI, dashboard/query/company-route navigation, no fabricated data,
  explicit licensing-disabled 503 JSON, zero-call disabled health, secret/data
  URL denial, HTTP security headers, keyboard focus and 320/390/768 layouts.
- Hosted desktop and phone captures were visually inspected. No detected
  browser errors or browser requests to NSE/GNews in the preview checks.
- Vercel's Linux cloud clean installation, 88-test gate and Next build succeed.
  The initial portable lockfile was missing optional WASM/EMNAPI metadata under
  cloud npm 12. It was repaired from clean-directory npm output, preserving all
  existing package versions; Node was pinned to 24.x. Two initial cloud attempts
  failed during installation; later builds succeeded.
- Preview tests caught a 9 px overflow from the phone navigation label; only
  preview mode now uses an accessible icon label below the small breakpoint.
  Empty search/status chrome is omitted when no functional controls are present.
- Local lint's generated-output noise was fixed by ignoring all `.next*` build
  directories, without disabling any source rules.
- Exact hash comparisons confirm the original `.env.local`, SQLite file and
  source CSVs were unchanged. Current credential values were absent from
  publishable source and existing Git history. Git had no tracked database/CSV.
- Source/history and local-only files were not made public. New captures/logs
  stay local under `artifacts/testing/public-deployment/`.

Repeat hosted checks with `npx tsx tests/e2e/public-preview.mts`.
These checks verify only a **data-disabled preview**. They do not establish
public-data licensing, actual hosted search/chart/news functionality, other
browsers, physical-device behavior, or human accessibility approval.
