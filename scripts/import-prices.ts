/**
 * MarketPulse historical price import CLI (Stage 2A).
 *
 *   npm run import:prices -- --symbol RELIANCE --series EQ data/prices/RELIANCE.csv
 *   npm run import:prices -- data/prices/TCS.csv            # symbol inferred from file name "TCS.csv"
 *   npm run import:prices -- --strict --symbol TCS file.csv  # fail if any row is rejected
 *
 * Input: a CSV downloaded manually from NSE "Security-wise Price Volume &
 * Deliverable Data" (https://www.nseindia.com/report-detail/eq_security).
 * Those exports have no symbol column, so the symbol comes from --symbol or,
 * if omitted, from a file name that is exactly a directory symbol
 * (e.g. RELIANCE.csv). The inferred symbol is printed and still validated.
 * This command never contacts NSE.
 */
import path from "node:path";
import { closeDb, getDb, resolveDbPath } from "../src/db/client";
import { securities } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { importPriceFile, PriceImportError } from "../src/lib/prices/import-prices";

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error("Usage: npm run import:prices -- [--symbol SYMBOL] [--series EQ] [--strict] <file.csv> [...]");
  console.error("  --symbol  NSE symbol the file belongs to (required unless the file is named <SYMBOL>.csv)");
  console.error("  --series  NSE series (e.g. EQ); required when ambiguous");
  console.error("  --strict  abort the file if any row fails validation");
  process.exit(message ? 2 : 0);
}

const args = process.argv.slice(2);
let symbol: string | undefined;
let series: string | undefined;
let strict = false;
const files: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i] ?? "";
  if (arg === "-h" || arg === "--help") usage();
  else if (arg === "--symbol") symbol = args[++i] ?? usage("--symbol needs a value");
  else if (arg === "--series") series = args[++i] ?? usage("--series needs a value");
  else if (arg === "--strict") strict = true;
  else if (arg.startsWith("-")) usage(`unknown option ${arg}`);
  else files.push(arg);
}
if (files.length === 0) usage("no CSV file given");
if (symbol && files.length > 1) usage("--symbol applies to a single file; import files one at a time");

const db = getDb();
console.log(`Database: ${resolveDbPath()}`);
let failed = 0;

for (const file of files) {
  let fileSymbol = symbol;
  if (!fileSymbol) {
    const stem = path.basename(file).replace(/\.csv$/i, "").trim().toUpperCase();
    const known = /^[A-Z0-9][A-Z0-9&-]{0,19}$/.test(stem) && db.select({ id: securities.id }).from(securities).where(eq(securities.symbol, stem)).get();
    if (known) {
      fileSymbol = stem;
      console.log(`  (symbol ${stem} taken from the file name; pass --symbol to override)`);
    }
  }
  try {
    const s = importPriceFile(db, file, { symbol: fileSymbol, series, strict });
    const mark = s.status === "SUCCEEDED" ? "✓" : "!";
    console.log(
      `${mark} ${s.fileName} -> ${s.security.symbol} ${s.security.series} (${s.security.name}) [${s.status}] ` +
        `rows=${s.rowsTotal} inserted=${s.inserted} updated=${s.updated} skipped=${s.skipped} rejected=${s.rejected} ` +
        `dates=${s.dateFrom}..${s.dateTo} import#${s.importId}`,
    );
    for (const m of s.messages.slice(0, 25)) console.log(`  ${m}`);
    if (s.messages.length > 25) console.log(`  ...and ${s.messages.length - 25} more (stored in price_imports.messages)`);
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    const id = error instanceof PriceImportError && error.importId ? ` (logged as import#${error.importId})` : "";
    console.error(`✗ ${file}: ${message}${id}`);
    console.error("  Existing price data was not changed.");
  }
}
closeDb();
process.exit(failed > 0 ? 1 : 0);
