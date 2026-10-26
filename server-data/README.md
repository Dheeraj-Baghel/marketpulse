# Real hosted MarketPulse database

This folder contains the deployment-only SQLite snapshot created from the user's
existing imported NSE directory and historical CSV data after the user explicitly
requested the hosted website to use the same real data as localhost.

- Source remains the local `data/marketpulse.sqlite`; it is not modified.
- Rebuild the snapshot with `npx tsx scripts/prepare-hosted-database.mts` after
  local directory/price imports, then commit the verified snapshot to this
  **private** repository and push `main`.
- Next explicitly traces the snapshot into server functions. It is not inside
  `public/`, has no download route, and must not be published as a static asset.
- Hosted functions open it read-only, without migrations or WAL writes. This
  is not a persistent writeable cloud database.
- NSE MCP history/quotes and GNews are fetched through the existing server
  providers; fetched data stays in their transient caches, not this file.
- Provider credentials are Vercel production secrets, never database content.

Hosting and access do not establish NSE/GNews public-display licensing. The
operator remains responsible for permission, provider terms and usage limits.
