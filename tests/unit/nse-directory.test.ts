import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseCsv } from "../../src/lib/nse/csv";
import { isValidIsinChecksum, normaliseEquityIsin, parseListingDate } from "../../src/lib/nse/normalise";
import { DirectoryFormatError, parseDirectory } from "../../src/lib/nse/parse-directory";

// Header lines copied verbatim from the official NSE files (October 2026).
const EQ_HEADER = "SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE";
const SME_HEADER = "SYMBOL,NAME_OF_COMPANY,SERIES,DATE_OF_LISTING,PAID_UP_VALUE,ISIN_NUMBER,FACE_VALUE,";

test("CSV reader handles quotes, CRLF and BOM", () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
});

test("ISIN check digit validation", () => {
  assert.equal(isValidIsinChecksum("INE144J01027"), true); // 20MICRONS
  assert.equal(isValidIsinChecksum("INE144J01028"), false);
  assert.deepEqual(normaliseEquityIsin(" ine144j01027 "), { ok: true, isin: "INE144J01027" });
  assert.equal(normaliseEquityIsin("INF204KB14I2").ok, false); // ETF units are not companies
  assert.equal(normaliseEquityIsin("").ok, false);
});

test("listing dates in both NSE formats", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  assert.equal(parseListingDate("06-OCT-2008", now), "2008-10-06");
  assert.equal(parseListingDate("22-Oct-26", now), "2026-10-22");
  assert.equal(parseListingDate("01-Oct-95", now), "1995-10-01");
  assert.equal(parseListingDate("31-FEB-2020", now), null);
  assert.equal(parseListingDate("", now), null);
});

test("parses the mainboard header and validates rows", () => {
  const csv = [
    EQ_HEADER,
    "20MICRONS,20 Microns Limited,EQ,06-OCT-2008,5,1,INE144J01027,5",
    "20microns ,  20 Microns   Limited ,EQ,06-OCT-2008,5,1,INE144J01027,5", // duplicate after normalising
    ",Missing Symbol Ltd,EQ,06-OCT-2008,5,1,INE144J01027,5",
    "BADISIN,Bad Isin Ltd,EQ,06-OCT-2008,5,1,INE144J01028,5",
    "ODDSERIES,Odd Series Ltd,N1,06-OCT-2008,5,1,INE144J01027,5",
    "NONAME,,EQ,06-OCT-2008,5,1,INE144J01027,5",
    "HAMPTON,Hampton Sky Realty Limited,BZ,17-AUG-2026,1,1,INE299D01022,1",
    "HAMPTON,Hampton Sky Realty Limited,EQ,17-AUG-2026,1,1,INE299D01022,1",
  ].join("\n");
  const result = parseDirectory(csv, { fileName: "EQUITY_L.csv" });
  assert.equal(result.segment, "MAINBOARD");
  assert.equal(result.rowsTotal, 8);
  assert.deepEqual(result.records.map((r) => `${r.symbol}/${r.series}`), ["20MICRONS/EQ", "HAMPTON/BZ", "HAMPTON/EQ"]);
  assert.equal(result.records[0]?.name, "20 Microns Limited");
  assert.equal(result.records[0]?.issuerCode, "144J");
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.rejected.length, 4);
});

test("parses the SME header, including the trailing empty column", () => {
  const csv = `${SME_HEADER}\nRAVITA,Ravita Engineering Services Limited,ST,22-Oct-26,5,INE1UEL01023,5,\n`;
  const result = parseDirectory(csv, { fileName: "SME_EQUITY_L.csv", now: new Date("2026-10-22T00:00:00Z") });
  assert.equal(result.segment, "SME");
  assert.equal(result.records[0]?.listingDate, "2026-10-22");
  assert.equal(result.records[0]?.marketLot, null);
});

test("rejects non-equity lists and mismatched segments", () => {
  const etf = "Symbol,Underlying,SecurityName,DateofListing,MarketLot,ISINNumber,FaceValue\nNIFTYBEES,Nifty 50,Nippon ETF,08-JAN-2002,1,INF204KB14I2,1";
  assert.throws(() => parseDirectory(etf, { fileName: "eq_etfseclist.csv" }), DirectoryFormatError);
  const smeAsMain = `${SME_HEADER}\nRAVITA,Ravita Engineering Services Limited,ST,22-Oct-26,5,INE1UEL01023,5,`;
  assert.throws(() => parseDirectory(smeAsMain, { fileName: "EQUITY_L.csv" }), /looks like a SME directory/);
  assert.throws(() => parseDirectory("", { fileName: "EQUITY_L.csv" }), /empty/);
});

test("repeat import is idempotent and tracks delistings", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-"));
  process.env.MARKETPULSE_DB_PATH = path.join(dir, "test.sqlite");
  const { getDb, closeDb } = await import("../../src/db/client");
  const { importDirectoryFile } = await import("../../src/lib/nse/import-directory");
  const { securities, directoryImports } = await import("../../src/db/schema");
  const db = getDb();

  const file = path.join(dir, "EQUITY_L.csv");
  fs.writeFileSync(
    file,
    [EQ_HEADER, "20MICRONS,20 Microns Limited,EQ,06-OCT-2008,5,1,INE144J01027,5", "HAMPTON,Hampton Sky Realty Limited,EQ,17-AUG-2026,1,1,INE299D01022,1"].join("\n"),
  );
  const first = importDirectoryFile(db, file);
  const second = importDirectoryFile(db, file);
  assert.equal(first.inserted, 2);
  assert.equal(second.inserted, 0);
  assert.equal(second.unchanged, 2);
  assert.equal(db.select().from(securities).all().length, 2);

  fs.writeFileSync(file, [EQ_HEADER, "20MICRONS,20 Microns Ltd,EQ,06-OCT-2008,5,1,INE144J01027,5"].join("\n"));
  const third = importDirectoryFile(db, file);
  assert.equal(third.updated, 1);
  assert.equal(third.deactivated, 1);
  const rows = db.select().from(securities).all();
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.symbol === "HAMPTON")?.isActive, false);
  assert.equal(db.select().from(directoryImports).all().length, 3);
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});
