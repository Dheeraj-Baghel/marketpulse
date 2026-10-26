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

The source will be pushed to a dedicated **private** GitHub repository. A dedicated
Vercel Hobby project will serve a clearly labelled public, data-disabled preview.
It is not the complete functioning NSE research deployment. No synthetic market
prices, fake companies, fake news, or claimed live feed will be added.

A server-only public-preview flag prevents opening the local database and forces
external market/news services off, independently of provider enable flags. The
preview uses an empty in-memory schema where existing read routes require a DB,
not a writable SQLite file on the Vercel filesystem. The local application and
its imported database remain unchanged when this flag is absent.

The Vercel upload allowlist excludes all user data, CSVs, databases, captures,
backups, probe output and environment files. No GNews key will be transferred to
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
