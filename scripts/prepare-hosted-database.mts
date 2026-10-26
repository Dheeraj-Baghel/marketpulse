// Hosted MarketPulse uses the user's real imported directory + CSV history.
// Create a coherent immutable SQLite snapshot (including committed WAL records)
// without modifying the local source database. Upload only this dedicated file
// to the private source repo; it is NEVER a public/static download.
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const source = path.resolve(process.env.MARKETPULSE_DB_PATH ?? "data/marketpulse.sqlite");
const dir = path.resolve("server-data");
const temp = path.join(dir, "marketpulse-preparing.sqlite");
const target = path.join(dir, "marketpulse.sqlite");
const before = createHash("sha256").update(await fs.readFile(source)).digest("hex");
await fs.mkdir(dir, { recursive: true });
await fs.rm(temp, { force: true });
const input = new Database(source, { readonly: true, fileMustExist: true });
try { await input.backup(temp); } finally { input.close(); }
const snapshot = new Database(temp, { fileMustExist: true });
try {
  snapshot.pragma("journal_mode = DELETE");
  const integrity = snapshot.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error("Snapshot integrity check failed.");
  const securities = snapshot.prepare("SELECT count(*) AS n FROM securities WHERE is_active = 1").get() as { n: number };
  const prices = snapshot.prepare("SELECT count(*) AS n FROM daily_prices").get() as { n: number };
  if (!securities.n) throw new Error("The local directory is empty; import the official directory before deploying.");
  console.log(`Verified real snapshot: ${securities.n} active securities, ${prices.n} stored daily candles.`);
} finally { snapshot.close(); }
const bytes = await fs.readFile(temp);
await fs.rename(temp, target);
const after = createHash("sha256").update(await fs.readFile(source)).digest("hex");
if (before !== after) throw new Error("Source database changed during the snapshot; retry after local imports finish.");
console.log(`Hosted snapshot SHA-256: ${createHash("sha256").update(bytes).digest("hex")}`);
console.log(`Snapshot size: ${bytes.byteLength} bytes. Source database hash unchanged.`);
