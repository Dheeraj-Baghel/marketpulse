import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { isPublicPreview } from "../lib/public-preview";

/**
 * Single local SQLite file. Override with MARKETPULSE_DB_PATH (used by tests to
 * point at a throwaway database). Paths are resolved from the project root.
 */
export function resolveDbPath(): string {
  // Never read user-imported data on the unlicensed public preview, even when
  // MARKETPULSE_DB_PATH points at a real local file. No serverless disk writes.
  if (isPublicPreview()) return ":memory:";
  // Vercel's application filesystem is immutable. The dedicated server asset
  // is an actual SQLite snapshot, not a fake data envelope or a /tmp database.
  if (process.env.VERCEL === "1") return path.join(process.cwd(), "server-data", "marketpulse.sqlite");
  // Local-only path: do not let Next trace the entire workspace/user database.
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.MARKETPULSE_DB_PATH ?? "data/marketpulse.sqlite");
}

export type Db = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as unknown as { __marketpulseDb?: { path: string; readonly: boolean; db: Db; sqlite: Database.Database } };

/**
 * Opens (and migrates) the database once per process. Migrations are
 * idempotent, so a fresh checkout shows the empty-directory onboarding state
 * instead of a "no such table" error.
 */
export function getDb(): Db {
  const dbPath = resolveDbPath();
  const readonly = dbPath !== ":memory:" && (process.env.VERCEL === "1" || process.env.MARKETPULSE_DB_READONLY === "true");
  const cached = globalForDb.__marketpulseDb;
  if (cached && cached.path === dbPath && cached.readonly === readonly) return cached.db;
  cached?.sqlite.close();

  if (!readonly && dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath, { readonly, fileMustExist: readonly });
  if (!readonly) sqlite.pragma("journal_mode = WAL");
  else sqlite.pragma("query_only = ON");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  if (!readonly) migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  globalForDb.__marketpulseDb = { path: dbPath, readonly, db, sqlite };
  return db;
}

export function closeDb(): void {
  globalForDb.__marketpulseDb?.sqlite.close();
  globalForDb.__marketpulseDb = undefined;
}
