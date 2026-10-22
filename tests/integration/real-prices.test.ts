/**
 * Integration test against the REAL, manually downloaded NSE eq_security CSVs
 * in data/prices/ (RELIANCE and TCS). Skips (does not fake) when absent.
 *
 * Works on a temporary COPY of data/marketpulse.sqlite so the real Stage 1
 * directory is used for security matching and the live database is untouched.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { parseCsv } from "../../src/lib/nse/csv";

const ROOT = process.cwd();
const LIVE_DB = path.join(ROOT, "data/marketpulse.sqlite");
const FILES = [
  { symbol: "RELIANCE", file: findFile("RELIANCE") },
  { symbol: "TCS", file: findFile("TCS") },
];

function findFile(symbol: string): string | null {
  const dir = path.join(ROOT, "data/prices");
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find((f) => f.toUpperCase() === `${symbol}.CSV`);
  return hit ? path.join(dir, hit) : null;
}

const available = FILES.every((f) => f.file) && fs.existsSync(LIVE_DB);

test("real NSE RELIANCE/TCS CSVs import exactly and serve through the API", { skip: available ? false : "real CSVs or live database not present" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-real-"));
  const copy = path.join(dir, "copy.sqlite");
  const src = new Database(LIVE_DB, { readonly: true });
  await src.backup(copy);
  src.close();
  process.env.MARKETPULSE_DB_PATH = copy;

  const { getDb, closeDb } = await import("../../src/db/client");
  const { importPriceFile } = await import("../../src/lib/prices/import-prices");
  const { getPrices } = await import("../../src/lib/market-data/price-service");
  const { securities } = await import("../../src/db/schema");
  const db = getDb();
  const securitiesBefore = db.select().from(securities).all().length;

  try {
    for (const { symbol, file } of FILES) {
      const csvRows = parseCsv(fs.readFileSync(file!, "utf8")).slice(1);
      const first = importPriceFile(db, file!, { symbol, series: "EQ" });
      assert.equal(first.status, "SUCCEEDED");
      assert.equal(first.rejected, 0);
      assert.equal(first.inserted + first.skipped + first.updated, csvRows.length);
      const repeat = importPriceFile(db, file!, { symbol, series: "EQ" });
      assert.deepEqual([repeat.inserted, repeat.updated, repeat.skipped], [0, 0, csvRows.length]);

      const api = await getPrices({ symbol, series: "EQ", range: "MAX" });
      assert.equal(api.count, csvRows.length);
      const dates = api.candles.map((c) => c.date);
      assert.deepEqual(dates, [...dates].sort(), "candles must be ascending");

      // Every stored candle equals its source row exactly (string compare of 2-dp values).
      const header = parseCsv(fs.readFileSync(file!, "utf8"))[0]!.map((h) => h.replace(/^\uFEFF/, "").trim());
      const col = (name: string) => header.indexOf(name);
      const byDate = new Map(api.candles.map((c) => [c.date, c]));
      for (const r of csvRows) {
        const [dd, mon, yyyy] = r[col("DATE")]!.split("-");
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const iso = `${yyyy}-${String(months.indexOf(mon!) + 1).padStart(2, "0")}-${dd!.padStart(2, "0")}`;
        const c = byDate.get(iso);
        assert.ok(c, `${symbol} ${iso} missing`);
        for (const [k, name] of [["open", "OPEN"], ["high", "HIGH"], ["low", "LOW"], ["close", "CLOSE"]] as const) {
          assert.equal(c![k].toFixed(2), r[col(name)]!.replace(/,/g, ""), `${symbol} ${iso} ${name}`);
        }
        assert.equal(c!.volume, Number(r[col("VOLUME")]!.replace(/,/g, "")), `${symbol} ${iso} VOLUME`);
      }
      const y1 = await getPrices({ symbol, series: "EQ", range: "1Y" });
      assert.ok(y1.candles.every((c) => c.date >= y1.from! && c.date <= y1.to!));
      console.log(`  ${symbol}: ${api.count} candles ${api.earliestTradingDate}..${api.latestTradingDate}; 1Y window ${y1.from}..${y1.to} (${y1.count})`);
    }
    assert.equal(db.select().from(securities).all().length, securitiesBefore, "Stage 1 directory unchanged");
  } finally {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
