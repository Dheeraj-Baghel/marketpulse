import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // better-sqlite3 is a native module; keep it out of the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  // The public preview builds its empty schema in memory. Native SQLite and
  // these exact migration files must be present in every serverless function.
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*", "./server-data/marketpulse.sqlite"] },
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./artifacts/**/*", "./docs/**/*", "./.env*", "./.git/**/*"] },
  // Allow dev-server resources (HMR websocket) when opened via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // The floating dev badge overlaps the sidebar footer; errors still surface in the overlay.
  devIndicators: false,
  // Lets the browser test suite run its own isolated dev server (separate build
  // folder) while the normal `npm run dev` server on 4327 keeps running.
  ...(process.env.MARKETPULSE_DIST_DIR ? { distDir: process.env.MARKETPULSE_DIST_DIR } : {}),
};

export default config;
