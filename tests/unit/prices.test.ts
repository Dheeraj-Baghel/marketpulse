/**
 * Stage 2A price-layer tests.
 *
 * SYNTHETIC TEST FIXTURES: every CSV row written in this file is invented for
 * validation testing only. Values are deliberately round and implausible
 * ("100.00", "TESTCO") and live only in a throwaway temporary database. They
 * are never written to data/ and never shown in the app as NSE price data.
 * Real-file verification is in tests/integration/real-prices.test.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-prices-"));
process.env.MARKETPULSE_DB_PATH = path.join(dir, "prices-test.sqlite");

// Header copied verbatim from the real NSE eq_security export (including the UTF-8 BOM and double space).
const HEADER = "\uFEFFDATE,SERIES,OPEN,HIGH,LOW,PREV. CLOSE,LTP,CLOSE,VWAP,52 WEEK HIGH,52 WEEK LOW,VOLUME,VALUE,NO. OF  TRADES";
/** SYNTHETIC row builder: (date, series, open, high, low, close, volume). */
const row = (date: string, series: string, o: string, h: string, l: string, c: string, v = '"1,000"') =>
  `${date},${series},"${o}","${h}","${l}","100.00","${c}","${c}","100.00","200.00","50.00",${v},"1,00,000.00","10"`;

type Mods = {
  db: import("../../src/db/client").Db;
  importPriceFile: typeof import("../../src/lib/prices/import-prices").importPriceFile;
  PriceImportError: typeof import("../../src/lib/prices/import-prices").PriceImportError;
  getPrices: typeof import("../../src/lib/market-data/price-service").getPrices;
  parsePriceQuery: typeof import("../../src/lib/market-data/price-service").parsePriceQuery;
  rangeWindow: typeof import("../../src/lib/market-data/price-service").rangeWindow;
  schema: typeof import("../../src/db/schema");
};
let m: Mods;
let ids: Record<string, number> = {};

function write(name: string, lines: string[]): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}

before(async () => {
  const client = await import("../../src/db/client");
  const schema = await import("../../src/db/schema");
  const imp = await import("../../src/lib/prices/import-prices");
  const svc = await import("../../src/lib/market-data/price-service");
  const db = client.getDb();
  // SYNTHETIC directory: a dedicated import record and fictitious securities.
  const [dirImport] = db
    .insert(schema.directoryImports)
    .values({
      segment: "MAINBOARD", fileName: "SYNTHETIC_TEST.csv", fileSha256: "0".repeat(64), importedAt: "2026-01-01T00:00:00.000Z",
      rowsTotal: 4, rowsInserted: 4, rowsUpdated: 0, rowsUnchanged: 0, rowsRejected: 0, rowsDuplicate: 0, rowsDeactivated: 0,
    })
    .returning()
    .all();
  const base = { segment: "MAINBOARD" as const, instrumentKind: "EQUITY_SHARE" as const, firstImportedAt: "2026-01-01", importedAt: "2026-01-01", lastImportId: dirImport!.id };
  const rows = db
    .insert(schema.securities)
    .values([
      { ...base, symbol: "TESTCO", name: "Synthetic Test Company", isin: "INE000T01019", issuerCode: "000T", series: "EQ" },
      { ...base, symbol: "TWOSER", name: "Synthetic Two Series Ltd", isin: "INE000U01017", issuerCode: "000U", series: "EQ" },
      { ...base, symbol: "TWOSER", name: "Synthetic Two Series Ltd", isin: "INE000U01017", issuerCode: "000U", series: "BE" },
      { ...base, symbol: "NODATA", name: "Synthetic No Data Ltd", isin: "INE000V01015", issuerCode: "000V", series: "EQ" },
    ])
    .returning()
    .all();
  ids = Object.fromEntries(rows.map((r) => [`${r.symbol}:${r.series}`, r.id]));
  m = { db, importPriceFile: imp.importPriceFile, PriceImportError: imp.PriceImportError, getPrices: svc.getPrices, parsePriceQuery: svc.parsePriceQuery, rangeWindow: svc.rangeWindow, schema };
});

after(async () => {
  (await import("../../src/db/client")).closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date("2026-10-22T06:00:00Z");
const count = (securityId: number) =>
  m.db.select().from(m.schema.dailyPrices).all().filter((p) => p.securityId === securityId).length;

describe("CSV parsing and import", () => {
  test("valid file imports multiple dates with exact scaled prices", () => {
    const file = write("valid.csv", [
      HEADER,
      row("21-Oct-2026", "EQ", "1,212.05", "1,234.30", "1,199.30", "1,209.00", '"1,76,07,823"'),
      row("20-Oct-2026", "EQ", "100.00", "110.00", "90.00", "105.00"),
      row("19-Oct-2026", "EQ", "100.00", "100.00", "100.00", "100.00"),
    ]);
    const s = m.importPriceFile(m.db, file, { symbol: "TESTCO", now: NOW });
    assert.equal(s.status, "SUCCEEDED");
    assert.deepEqual([s.inserted, s.updated, s.skipped, s.rejected], [3, 0, 0, 0]);
    assert.deepEqual([s.dateFrom, s.dateTo], ["2026-10-19", "2026-10-21"]);
    const stored = m.db.select().from(m.schema.dailyPrices).all().find((p) => p.tradeDate === "2026-10-21");
    assert.equal(stored?.open, 12120500); // 1212.05 * 10^4, exact
    assert.equal(stored?.volume, 17607823); // Indian digit grouping
    assert.equal(stored?.adjustmentStatus, "UNADJUSTED");
    const audit = m.db.select().from(m.schema.priceImports).all().at(-1);
    assert.equal(audit?.fileSha256.length, 64);
    assert.equal(audit?.sourceDateFrom, "2026-10-19");
  });

  test("repeat import is idempotent; changed values update safely", () => {
    const file = path.join(dir, "valid.csv");
    const again = m.importPriceFile(m.db, file, { symbol: "TESTCO", now: NOW });
    assert.deepEqual([again.inserted, again.updated, again.skipped], [0, 0, 3]);
    assert.equal(count(ids["TESTCO:EQ"]!), 3);
    const corrected = write("corrected.csv", [HEADER, row("20-Oct-2026", "EQ", "100.00", "110.00", "90.00", "106.00")]);
    const upd = m.importPriceFile(m.db, corrected, { symbol: "TESTCO", now: NOW });
    assert.deepEqual([upd.inserted, upd.updated], [0, 1]);
    assert.equal(count(ids["TESTCO:EQ"]!), 3);
  });

  test("duplicate lines within a file are skipped; conflicting duplicates rejected", () => {
    const file = write("dupes.csv", [
      HEADER,
      row("16-Oct-2026", "EQ", "100.00", "110.00", "90.00", "105.00"),
      row("16-Oct-2026", "EQ", "100.00", "110.00", "90.00", "105.00"),
      row("15-Oct-2026", "EQ", "100.00", "110.00", "90.00", "105.00"),
      row("15-Oct-2026", "EQ", "101.00", "110.00", "90.00", "105.00"),
    ]);
    const s = m.importPriceFile(m.db, file, { symbol: "TESTCO", now: NOW });
    assert.equal(s.inserted, 1); // 16-Oct once
    assert.equal(s.rejected, 2); // both conflicting 15-Oct lines
    assert.equal(s.skipped, 1); // the exact repeat of 16-Oct
    assert.ok(!m.db.select().from(m.schema.dailyPrices).all().some((p) => p.tradeDate === "2026-10-15"));
    assert.ok(s.messages.some((x) => /duplicate line skipped - repeats line 2/.test(x)));
    assert.ok(s.messages.some((x) => /more than once with different values/.test(x)));
  });

  test("unknown headers are rejected with guidance and logged as FAILED", () => {
    const file = write("other.csv", ["Date,Price,Change %", "2026-10-21,100,1.0"]);
    assert.throws(() => m.importPriceFile(m.db, file, { symbol: "TESTCO", now: NOW }), /unrecognised columns, missing OPEN, HIGH, LOW, CLOSE/);
    assert.equal(m.db.select().from(m.schema.priceImports).all().at(-1)?.status, "FAILED");
    const directory = write("EQUITY_L.csv", ["SYMBOL,NAME OF COMPANY, SERIES, ISIN NUMBER", "X,Y,EQ,INE000T01019"]);
    assert.throws(() => m.importPriceFile(m.db, directory, { symbol: "TESTCO", now: NOW }), /npm run import:nse/);
  });

  test("invalid prices are rejected, never zeroed", () => {
    const file = write("bad-prices.csv", [
      HEADER,
      row("14-Oct-2026", "EQ", "0.00", "110.00", "90.00", "105.00"),
      row("13-Oct-2026", "EQ", "-5.00", "110.00", "90.00", "105.00"),
      row("12-Oct-2026", "EQ", "100.00", "80.00", "90.00", "85.00"),
      row("09-Oct-2026", "EQ", "120.00", "110.00", "90.00", "105.00"),
      row("08-Oct-2026", "EQ", "100.00", "110.00", "90.00", "89.99"),
      row("07-Oct-2026", "EQ", "abc", "110.00", "90.00", "105.00"),
      row("06-Oct-2026", "EQ", "", "110.00", "90.00", "105.00"),
      row("05-Oct-2026", "EQ", "100.12345", "110.00", "90.00", "105.00"),
      row("02-Oct-2026", "EQ", "100.00", "110.00", "90.00", "105.00", '"-10"'),
      row("01-Oct-2026", "EQ", "100.00", "110.00", "90.00", "105.00"),
    ]);
    const s = m.importPriceFile(m.db, file, { symbol: "TESTCO", now: NOW });
    assert.equal(s.status, "PARTIAL");
    assert.equal(s.inserted, 1);
    assert.equal(s.rejected, 9);
    const text = s.messages.join("\n");
    for (const expected of ["price must be positive", "negative value", "HIGH 80.00 is below LOW 90.00", "OPEN 120.00 is outside", "CLOSE 89.99 is outside", "not a number", "missing value", "more than 4 decimal places", "negative volume"]) {
      assert.match(text, new RegExp(expected));
    }
    assert.ok(!m.db.select().from(m.schema.dailyPrices).all().some((p) => p.open === 0 || p.volume === 0));
  });

  test("invalid dates are rejected; weekend dates are kept as reported", () => {
    const file = write("dates.csv", [
      HEADER,
      row("31-Feb-2026", "EQ", "100.00", "110.00", "90.00", "105.00"),
      row("2026/09/30", "EQ", "100.00", "110.00", "90.00", "105.00"),
      row("01-Dec-2026", "EQ", "100.00", "110.00", "90.00", "105.00"), // future vs NOW
      row("27-Sep-2026", "EQ", "100.00", "110.00", "90.00", "105.00"), // a Sunday, synthetic special session
    ]);
    const s = m.importPriceFile(m.db, file, { symbol: "TESTCO", now: NOW });
    assert.equal(s.inserted, 1);
    assert.match(s.messages.join("\n"), /invalid date "31-Feb-2026"/);
    assert.match(s.messages.join("\n"), /invalid date "2026\/09\/30"/);
    assert.match(s.messages.join("\n"), /is in the future/);
    assert.match(s.messages.join("\n"), /2026-09-27 is a weekend date; kept as reported/);
  });

  test("--strict fails the whole file and preserves existing data", () => {
    const before = count(ids["TESTCO:EQ"]!);
    const file = write("strict.csv", [HEADER, row("30-Sep-2026", "EQ", "100.00", "110.00", "90.00", "105.00"), row("bad", "EQ", "1", "1", "1", "1")]);
    assert.throws(() => m.importPriceFile(m.db, file, { symbol: "TESTCO", strict: true, now: NOW }), /--strict/);
    assert.equal(count(ids["TESTCO:EQ"]!), before);
  });

  test("missing volume is stored as null (column empty or absent)", () => {
    const empty = write("novol.csv", [HEADER, row("29-Sep-2026", "EQ", "100.00", "110.00", "90.00", "105.00", "")]);
    m.importPriceFile(m.db, empty, { symbol: "TESTCO", now: NOW });
    const absent = write("novolcol.csv", ["DATE,SERIES,OPEN,HIGH,LOW,CLOSE", '28-Sep-2026,EQ,"100.00","110.00","90.00","105.00"']);
    const s = m.importPriceFile(m.db, absent, { symbol: "TESTCO", now: NOW });
    assert.ok(s.messages.some((x) => /no VOLUME column/.test(x)));
    const vols = m.db.select().from(m.schema.dailyPrices).all().filter((p) => ["2026-09-29", "2026-09-28"].includes(p.tradeDate)).map((p) => p.volume);
    assert.deepEqual(vols, [null, null]);
  });

  test("empty dataset (header only) fails clearly", () => {
    const file = write("empty.csv", [HEADER]);
    assert.throws(() => m.importPriceFile(m.db, file, { symbol: "TESTCO", now: NOW }), /no price rows \(empty dataset\)/);
    assert.throws(() => m.importPriceFile(m.db, write("blank.csv", [""]), { symbol: "TESTCO", now: NOW }), /is empty/);
  });
});

describe("security matching", () => {
  test("requires a symbol when the file has none, and validates it against the directory", () => {
    const file = write("nosymbol.csv", [HEADER, row("21-Oct-2026", "EQ", "100.00", "110.00", "90.00", "105.00")]);
    assert.throws(() => m.importPriceFile(m.db, file, { now: NOW }), /no SYMBOL column.*--symbol/);
    assert.throws(() => m.importPriceFile(m.db, file, { symbol: "NOSUCHCO", now: NOW }), /not in the imported NSE directory/);
    assert.throws(() => m.importPriceFile(m.db, file, { symbol: "TESTCO", series: "BE", now: NOW }), /--series BE does not appear in the file/);
  });

  test("a SYMBOL column must agree with --symbol", () => {
    const file = write("withsymbol.csv", ["SYMBOL,SERIES,DATE,OPEN,HIGH,LOW,CLOSE,VOLUME", 'TWOSER,EQ,21-Oct-2026,"100.00","110.00","90.00","105.00","1"']);
    assert.throws(() => m.importPriceFile(m.db, file, { symbol: "TESTCO", now: NOW }), /does not match the file's SYMBOL column/);
    const s = m.importPriceFile(m.db, file, { now: NOW });
    assert.equal(s.security.id, ids["TWOSER:EQ"]);
  });

  test("ambiguous series must be chosen explicitly; only that series is imported", () => {
    const mixed = write("mixed.csv", [
      HEADER,
      row("20-Oct-2026", "EQ", "100.00", "110.00", "90.00", "105.00"),
      row("20-Oct-2026", "BE", "50.00", "55.00", "45.00", "52.00"),
    ]);
    assert.throws(() => m.importPriceFile(m.db, mixed, { symbol: "TWOSER", now: NOW }), /mixes series BE, EQ.*--series/);
    const s = m.importPriceFile(m.db, mixed, { symbol: "TWOSER", series: "BE", now: NOW });
    assert.equal(s.security.id, ids["TWOSER:BE"]);
    assert.equal(s.inserted, 1);
    assert.ok(s.messages.some((x) => /other series skipped/.test(x)));
    const noSeriesCol = write("noseries.csv", ["DATE,OPEN,HIGH,LOW,CLOSE", '20-Oct-2026,"100.00","110.00","90.00","105.00"']);
    assert.throws(() => m.importPriceFile(m.db, noSeriesCol, { symbol: "TWOSER", now: NOW }), /several series \(BE, EQ\).*--series/);
  });

  test("Stage 1 securities are untouched by price imports", () => {
    const secs = m.db.select().from(m.schema.securities).all();
    assert.equal(secs.length, 4);
    assert.ok(secs.every((s) => s.isActive && s.importedAt === "2026-01-01"));
  });
});

describe("API service", () => {
  test("query validation", () => {
    const q = (s: string) => m.parsePriceQuery(new URLSearchParams(s));
    // Stage 2C added `source` (dev switch, default auto) and `refresh` (default false).
    assert.deepEqual(q("symbol=testco"), { symbol: "TESTCO", series: null, range: "1Y", source: "auto", refresh: false });
    assert.equal(q("symbol=TCS&refresh=1").refresh, true);
    assert.throws(() => q("symbol=TCS&source=yahoo"), (e: { code?: string }) => e.code === "BAD_REQUEST");
    assert.throws(() => q(""), (e: { code?: string }) => e.code === "INVALID_SYMBOL");
    assert.throws(() => q("symbol=DROP%20TABLE"), (e: { code?: string }) => e.code === "INVALID_SYMBOL");
    assert.throws(() => q("symbol=TESTCO&series=EQUITY"), (e: { code?: string }) => e.code === "INVALID_SERIES");
    assert.throws(() => q("symbol=TESTCO&range=10D"), (e: { code?: string; status?: number }) => e.code === "UNSUPPORTED_RANGE" && e.status === 400);
  });

  test("candles are sorted ascending and come only from the requested security", async () => {
    const r = await m.getPrices({ symbol: "TESTCO", series: "EQ", range: "MAX" });
    const dates = r.candles.map((c) => c.date);
    assert.deepEqual(dates, [...dates].sort());
    assert.equal(new Set(dates).size, dates.length);
    assert.equal(r.count, count(ids["TESTCO:EQ"]!));
    assert.equal(r.latestTradingDate, "2026-10-21");
    const latest = r.candles.at(-1)!;
    assert.deepEqual(latest, { date: "2026-10-21", open: 1212.05, high: 1234.3, low: 1199.3, close: 1209, volume: 17607823 });
    assert.equal(r.dataMode, "HISTORICAL_EOD");
    assert.equal(r.adjustmentStatus, "UNADJUSTED");
  });

  test("range filtering is anchored on the latest stored date", async () => {
    // SYNTHETIC older observations so the windows differ.
    m.importPriceFile(m.db, write("older.csv", [
      HEADER,
      row("21-Sep-2026", "EQ", "100.00", "110.00", "90.00", "105.00"),
      row("22-Sep-2026", "EQ", "100.00", "110.00", "90.00", "105.00"),
      row("02-Jan-2025", "EQ", "100.00", "110.00", "90.00", "105.00"),
    ]), { symbol: "TESTCO", now: NOW });
    assert.deepEqual(m.rangeWindow("1M", "2026-10-21", "2020-01-01"), { from: "2026-09-22", to: "2026-10-21" });
    assert.deepEqual(m.rangeWindow("1Y", "2026-10-21", "2020-01-01"), { from: "2025-10-22", to: "2026-10-21" });
    assert.deepEqual(m.rangeWindow("YTD", "2026-10-21", "2020-01-01"), { from: "2026-01-01", to: "2026-10-21" });
    assert.deepEqual(m.rangeWindow("1M", "2026-03-31", "2020-01-01"), { from: "2026-03-01", to: "2026-03-31" });
    const r = await m.getPrices({ symbol: "TESTCO", series: "EQ", range: "1M" });
    assert.ok(r.candles.every((c) => c.date >= "2026-09-22" && c.date <= "2026-10-21"));
    assert.ok(r.candles.some((c) => c.date === "2026-09-22"), "inclusive lower bound");
    assert.ok(!r.candles.some((c) => c.date === "2026-09-21"));
    const y1 = await m.getPrices({ symbol: "TESTCO", series: "EQ", range: "1Y" });
    assert.ok(!y1.candles.some((c) => c.date === "2025-01-02"));
    const all = await m.getPrices({ symbol: "TESTCO", series: "EQ", range: "MAX" });
    assert.equal(all.candles[0]?.date, "2025-01-02");
    assert.ok(all.count > y1.count && y1.count > r.count);
  });

  test("valid company with no data returns an explicit empty response", async () => {
    const r = await m.getPrices({ symbol: "NODATA", series: null, range: "1Y" });
    assert.equal(r.series, "EQ");
    assert.deepEqual([r.count, r.candles.length, r.latestTradingDate, r.from], [0, 0, null, null]);
  });

  test("ambiguous, unknown series and unknown symbol errors; no cross-series fallback", async () => {
    await assert.rejects(m.getPrices({ symbol: "TWOSER", series: null, range: "1Y" }), (e: { code?: string; status?: number }) => e.code === "AMBIGUOUS_SERIES" && e.status === 409);
    await assert.rejects(m.getPrices({ symbol: "TESTCO", series: "BE", range: "1Y" }), (e: { code?: string }) => e.code === "UNKNOWN_SERIES");
    await assert.rejects(m.getPrices({ symbol: "NOSUCHCO", series: null, range: "1Y" }), (e: { code?: string; status?: number }) => e.code === "UNKNOWN_SECURITY" && e.status === 404);
    const be = await m.getPrices({ symbol: "TWOSER", series: "BE", range: "MAX" });
    const eq = await m.getPrices({ symbol: "TWOSER", series: "EQ", range: "MAX" });
    assert.deepEqual(be.candles.map((c) => c.close), [52]);
    assert.deepEqual(eq.candles.map((c) => c.close), [105]);
  });
});
