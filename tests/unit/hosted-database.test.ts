import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../../src/db/client";
import { isPublicPreview } from "../../src/lib/public-preview";
import { readMcpConfig } from "../../src/lib/market-data/nse-mcp-client";
import { readNewsConfig } from "../../src/lib/news/provider";
const original = { ...process.env };
let temp: string | undefined;
afterEach(() => {
  closeDb();
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
  if (temp) fs.rmSync(temp, { recursive: true, force: true }); temp = undefined;
});
test("real hosted mode requires the explicit server opt-in and preserves preview fallback", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", VERCEL: "1", MARKETPULSE_REAL_DATA_ENABLED: "true" };
  assert.equal(isPublicPreview(env), false);
  assert.equal(readMcpConfig(env).enabled, true);
  assert.equal(isPublicPreview({ ...env, MARKETPULSE_PUBLIC_PREVIEW: "true" }), true);
  assert.equal(isPublicPreview({ ...env, MARKETPULSE_REAL_DATA_ENABLED: "false" }), true);
});
test("server-only news configuration is enabled in real mode without returning the key to the browser", () => {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", VERCEL: "1", MARKETPULSE_REAL_DATA_ENABLED: "true", GNEWS_API_KEY: "a".repeat(32) };
  assert.equal(readNewsConfig(env).configured, true);
  assert.equal(readNewsConfig({ ...env, MARKETPULSE_REAL_DATA_ENABLED: "false" }).configured, false);
});
test("read-only database mode reads a migrated snapshot without writing or creating WAL files", () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-readonly-"));
  const file = path.join(temp, "test.sqlite");
  process.env.MARKETPULSE_DB_PATH = file;
  const writable = getDb();
  writable.run(sql`CREATE TABLE readonly_test (value TEXT NOT NULL)`);
  writable.run(sql`INSERT INTO readonly_test (value) VALUES ('real fixture')`);
  closeDb();
  const before = fs.readFileSync(file);
  process.env.MARKETPULSE_DB_READONLY = "true";
  const readonly = getDb();
  assert.equal((readonly.get(sql`SELECT value FROM readonly_test`) as { value: string }).value, "real fixture");
  assert.throws(() => readonly.run(sql`INSERT INTO readonly_test (value) VALUES ('forbidden')`), /readonly|read-only/i);
  closeDb();
  assert.deepEqual(fs.readFileSync(file), before);
});
test("read-only mode fails honestly for a missing snapshot instead of creating an empty database", () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-readonly-missing-"));
  const file = path.join(temp, "absent.sqlite");
  process.env.MARKETPULSE_DB_PATH = file; process.env.MARKETPULSE_DB_READONLY = "true";
  assert.throws(() => getDb()); assert.equal(fs.existsSync(file), false);
});
