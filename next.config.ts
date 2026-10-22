import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // better-sqlite3 is a native module; keep it out of the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  // Allow dev-server resources (HMR websocket) when opened via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // The floating dev badge overlaps the sidebar footer; errors still surface in the overlay.
  devIndicators: false,
};

export default config;
