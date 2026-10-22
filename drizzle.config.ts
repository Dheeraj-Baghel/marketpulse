import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.MARKETPULSE_DB_PATH ?? "./data/marketpulse.sqlite" },
  strict: true,
});
