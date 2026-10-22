/**
 * MarketPulse NSE directory import CLI.
 *
 *   npm run import:nse                      # imports data/nse/EQUITY_L.csv and data/nse/SME_EQUITY_L.csv if present
 *   npm run import:nse -- path/to/EQUITY_L.csv path/to/SME_EQUITY_L.csv
 *   npm run import:nse -- --segment SME ./my-renamed-file.csv
 *
 * Files must be downloaded manually from
 * https://www.nseindia.com/static/market-data/securities-available-for-trading
 * This command never contacts NSE.
 */
import fs from "node:fs";
import path from "node:path";
import { closeDb, getDb, resolveDbPath } from "../src/db/client";
import { SEGMENTS, type Segment } from "../src/db/schema";
import { importDirectoryFile } from "../src/lib/nse/import-directory";

const DEFAULT_DIR = path.resolve(process.cwd(), "data/nse");
const DEFAULT_FILES = ["EQUITY_L.csv", "SME_EQUITY_L.csv"];

function usage(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error("Usage: npm run import:nse -- [--segment MAINBOARD|SME] [file.csv ...]");
  console.error(`With no files, imports ${DEFAULT_FILES.join(" and ")} from ${path.relative(process.cwd(), DEFAULT_DIR)}/.`);
  process.exit(message ? 2 : 0);
}

const args = process.argv.slice(2);
let segment: Segment | undefined;
const files: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i] ?? "";
  if (arg === "--help" || arg === "-h") usage();
  if (arg === "--segment") {
    const value = (args[++i] ?? "").toUpperCase();
    if (!(SEGMENTS as readonly string[]).includes(value)) usage(`--segment must be one of ${SEGMENTS.join(", ")}`);
    segment = value as Segment;
  } else if (arg.startsWith("-")) {
    usage(`unknown option ${arg}`);
  } else {
    files.push(arg);
  }
}

if (files.length === 0) {
  for (const name of DEFAULT_FILES) {
    const candidate = path.join(DEFAULT_DIR, name);
    if (fs.existsSync(candidate)) files.push(candidate);
  }
  if (files.length === 0) {
    usage(
      `no CSV files given and none found in ${path.relative(process.cwd(), DEFAULT_DIR)}/. ` +
        "Download EQUITY_L.csv and/or SME_EQUITY_L.csv from the NSE 'Securities available for trading' page first.",
    );
  }
}

const db = getDb();
console.log(`Database: ${resolveDbPath()}`);
let failed = 0;
for (const file of files) {
  if (!fs.existsSync(file)) {
    console.error(`✗ ${file}: file not found`);
    failed++;
    continue;
  }
  try {
    const s = importDirectoryFile(db, file, { segment });
    console.log(
      `✓ ${s.fileName} [${s.segment}] rows=${s.rowsTotal} inserted=${s.inserted} updated=${s.updated} ` +
        `unchanged=${s.unchanged} rejected=${s.rejected} duplicates=${s.duplicates} deactivated=${s.deactivated}`,
    );
    const notes = [
      ...s.parsed.rejected.map((r) => `  rejected line ${r.line}: ${r.reason}`),
      ...s.parsed.duplicates.map((r) => `  duplicate line ${r.line}: ${r.reason}`),
      ...s.parsed.warnings.map((w) => `  warning: ${w}`),
    ];
    for (const note of notes.slice(0, 25)) console.log(note);
    if (notes.length > 25) console.log(`  ...and ${notes.length - 25} more (stored in directory_imports.warnings)`);
  } catch (error) {
    console.error(`✗ ${file}: ${error instanceof Error ? error.message : String(error)}`);
    failed++;
  }
}
closeDb();
process.exit(failed > 0 ? 1 : 0);
