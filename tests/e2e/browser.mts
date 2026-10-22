/**
 * Real-browser acceptance run for Stage 1.
 *
 *   npm run test:e2e
 *
 * Starts `next dev` against a throwaway SQLite file, then in Chromium:
 * empty onboarding -> CLI import of the official CSVs in data/nse/ -> search by
 * name / symbol / ISIN -> pagination -> selection -> details -> mobile ->
 * repeat import (no duplicates). Writes screenshots and results.json to
 * artifacts/testing/. Requires data/nse/EQUITY_L.csv and SME_EQUITY_L.csv.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { chromium, type Page } from "playwright";

const ROOT = process.cwd();
const PORT = Number(process.env.E2E_PORT ?? 4329);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(ROOT, "artifacts/testing");
const SHOTS = path.join(ROOT, "artifacts/screenshots");
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketpulse-e2e-"));
const DB = path.join(dbDir, "e2e.sqlite");
const env = { ...process.env, MARKETPULSE_DB_PATH: DB, NEXT_TELEMETRY_DISABLED: "1" };

for (const f of ["EQUITY_L.csv", "SME_EQUITY_L.csv"]) {
  if (!fs.existsSync(path.join(ROOT, "data/nse", f))) {
    console.error(`Missing data/nse/${f}. Download it from NSE first.`);
    process.exit(2);
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const results: { name: string; ok: boolean; detail: string }[] = [];
const consoleErrors: string[] = [];
let expect404 = false;

async function check(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`✓ ${name} — ${detail}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error);
    results.push({ name, ok: false, detail });
    console.log(`✗ ${name} — ${detail}`);
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function runImport(): string {
  return execFileSync("npx", ["tsx", "scripts/import-nse.ts"], { cwd: ROOT, env, encoding: "utf8" });
}

function dbCounts() {
  const db = new Database(DB, { readonly: true });
  const r = db
    .prepare(
      "select count(*) n, count(distinct segment||'|'||symbol||'|'||series) k, (select count(*) from directory_imports) imports from securities",
    )
    .get() as { n: number; k: number; imports: number };
  db.close();
  return r;
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("dev server did not start");
}

async function rowSymbols(page: Page) {
  return page.locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-symbol") ?? ""));
}

async function searchFor(page: Page, text: string) {
  const input = page.getByRole("searchbox", { name: /search nse companies/i });
  await input.fill(text);
  await page.waitForURL((u) => u.searchParams.get("q") === text.trim(), { timeout: 10_000 });
  await page.waitForFunction(() => !document.querySelector("[aria-busy='true']"));
}

const server = spawn("npx", ["next", "dev", "-p", String(PORT)], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

try {
  await waitForServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (expect404 && /status of 404/.test(m.text())) return; // deliberate unknown-symbol check
    consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await check("1. Homepage loads without runtime errors", async () => {
    const res = await page.goto(`${BASE}/`);
    assert(res?.status() === 200, `status ${res?.status()}`);
    await page.getByRole("heading", { name: "Dashboard", level: 1 }).waitFor();
    assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join(" | ")}`);
    return "HTTP 200, no console/page errors";
  });

  await check("2. Empty database shows import instructions", async () => {
    await page.getByRole("heading", { name: /directory is empty/i }).waitFor();
    assert(await page.locator("main").getByText("npm run import:nse").isVisible(), "import command not shown");
    assert(await page.getByText("Directory empty").isVisible(), "header status not empty");
    assert((await page.locator("table").count()) === 0, "table rendered with no data");
    assert(await page.getByRole("searchbox").isDisabled(), "search should be disabled when empty");
    await page.screenshot({ caret: "initial", path: path.join(SHOTS, "01-empty-onboarding.png") });
    return "onboarding, disabled search, 'Directory empty' status";
  });

  let firstImport = "";
  await check("3. Official CSV files import successfully", async () => {
    firstImport = runImport();
    assert(/EQUITY_L\.csv \[MAINBOARD\]/.test(firstImport) && /SME_EQUITY_L\.csv \[SME\]/.test(firstImport), firstImport);
    const counts = dbCounts();
    assert(counts.n > 3000, `only ${counts.n} securities`);
    await page.reload();
    await page.getByRole("table", { name: /nse listed companies/i }).waitFor();
    assert(await page.getByText("Directory imported").isVisible(), "status not 'imported'");
    await page.screenshot({ caret: "initial", path: path.join(SHOTS, "02-dashboard-desktop.png") });
    return `${counts.n} securities; ${firstImport.trim().split("\n").filter((l) => l.startsWith("✓")).join(" / ")}`;
  });

  await check("4. Company search works (name, partial, case-insensitive)", async () => {
    await searchFor(page, "tata mot");
    const symbols = await rowSymbols(page);
    assert(symbols.length > 0, "no results for 'tata mot'");
    const names = await page.locator("tbody tr td:nth-child(2) a").allInnerTexts();
    assert(names.every((n) => n.toLowerCase().includes("tata mot")), `non-matching names: ${names.join(", ")}`);
    await searchFor(page, "INE144J");
    const isinHits = await rowSymbols(page);
    assert(isinHits.includes("20MICRONS"), `ISIN partial search returned ${isinHits.join(",")}`);
    await searchFor(page, "zzqqxx");
    await page.getByText(/No securities match/).waitFor();
    return `'tata mot' -> ${symbols.join(", ")}; ISIN 'INE144J' -> 20MICRONS; no-match state shown`;
  });

  await check("5. Search by NSE symbol works", async () => {
    await searchFor(page, "infy");
    const symbols = await rowSymbols(page);
    assert(symbols[0] === "INFY", `first result ${symbols[0]}`);
    await page.screenshot({ caret: "initial", path: path.join(SHOTS, "03-search-symbol.png") });
    return `'infy' -> first row INFY (${symbols.length} rows)`;
  });

  await check("6. Pagination works", async () => {
    await page.getByRole("button", { name: "Clear search" }).click();
    await page.waitForURL((u) => !u.searchParams.has("q"));
    await page.waitForFunction(() => !document.querySelector("[aria-busy='true']"));
    const page1 = await rowSymbols(page);
    await page.getByRole("link", { name: "Next page" }).click();
    await page.waitForURL((u) => u.searchParams.get("page") === "2");
    await page.waitForFunction((first) => document.querySelector("tbody tr")?.getAttribute("data-symbol") !== first, page1[0]);
    const page2 = await rowSymbols(page);
    assert(page2.length === 25 && page1.length === 25, `page sizes ${page1.length}/${page2.length}`);
    assert(!page2.some((s) => page1.includes(s)), "page 2 overlaps page 1");
    const status = await page.getByRole("navigation", { name: "Directory pages" }).innerText();
    await page.getByRole("link", { name: "Last page" }).click();
    await page.waitForURL((u) => Number(u.searchParams.get("page")) > 2);
    const last = await page.getByRole("navigation", { name: "Directory pages" }).innerText();
    await page.getByRole("link", { name: "First page" }).click();
    await page.waitForURL((u) => !u.searchParams.has("page"));
    return `p1 ${page1[0]}…, p2 ${page2[0]}…; "${status.replace(/\s+/g, " ")}" -> last "${last.replace(/\s+/g, " ")}"`;
  });

  await check("7. Company selection works (mouse and keyboard)", async () => {
    await page.waitForFunction(() => !document.querySelector("[aria-busy='true']"));
    const rows = page.locator("tbody tr");
    const third = rows.nth(2);
    const symbol = (await third.getAttribute("data-symbol")) ?? "";
    await third.locator("td").first().click();
    await page.locator("#selected-heading").waitFor();
    assert((await third.getAttribute("aria-selected")) === "true", "row not selected");
    const panelSymbol = await page.locator("section[aria-labelledby='selected-heading'] header .font-mono").first().innerText();
    assert(panelSymbol === symbol, `panel shows ${panelSymbol}, expected ${symbol}`);
    assert(new URL(page.url()).searchParams.get("selected")?.endsWith(`:${symbol}`), "selection not in URL");
    await page.keyboard.press("ArrowDown");
    const fourth = (await rows.nth(3).getAttribute("data-symbol")) ?? "";
    const panelAfter = await page.locator("section[aria-labelledby='selected-heading'] header .font-mono").first().innerText();
    assert(panelAfter === fourth, `ArrowDown selected ${panelAfter}, expected ${fourth}`);
    assert(await page.getByText("Price chart not configured yet").isVisible(), "chart placeholder missing");
    await page.screenshot({ caret: "initial", path: path.join(SHOTS, "04-selection.png") });
    return `click -> ${symbol}, ArrowDown -> ${fourth}; chart placeholder present`;
  });

  await check("8. Company details open correctly", async () => {
    await searchFor(page, "RELIANCE");
    const link = page.locator("tbody tr[data-symbol='RELIANCE'] td:nth-child(2) a");
    const name = await link.innerText();
    await link.click();
    await page.waitForURL(`${BASE}/stocks/RELIANCE`);
    await page.getByRole("heading", { level: 1, name }).waitFor();
    const text = await page.locator("main").innerText();
    for (const expected of ["NSE symbol", "ISIN", "Listing segment", "Security series", "Recent company news", "Annual report", "AI insights"]) {
      assert(text.includes(expected), `missing "${expected}"`);
    }
    const futureButtons = await page.locator("section[aria-label$='(not available yet)'] :is(button, a)").count();
    assert(futureButtons === 0, "placeholder sections contain interactive controls");
    await page.screenshot({ caret: "initial", path: path.join(SHOTS, "05-company-details.png"), fullPage: true });
    const lower = await page.goto(`${BASE}/stocks/reliance`);
    assert(new URL(page.url()).pathname === "/stocks/RELIANCE" && lower?.ok(), "lower-case URL not canonicalised");
    expect404 = true;
    const missing = await page.goto(`${BASE}/stocks/NOTAREALSYMBOL`);
    await page.waitForLoadState("networkidle");
    expect404 = false;
    assert(missing?.status() === 404, `unknown symbol status ${missing?.status()}`);
    await page.goto(`${BASE}/stocks/RELIANCE`);
    await page.getByRole("link", { name: "Back to dashboard" }).click();
    await page.waitForURL(`${BASE}/`);
    return `"${name}" with identity fields + 3 inert placeholders; /stocks/reliance redirects; unknown symbol 404; back link works`;
  });

  await check("9. Mobile layout is usable", async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const m = await mobile.newPage();
    m.on("pageerror", (e) => consoleErrors.push(`mobile pageerror: ${e.message}`));
    await m.goto(`${BASE}/`);
    await m.getByRole("table").waitFor();
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `horizontal overflow ${overflow}px`);
    const tapTarget = await m.getByRole("link", { name: "Next page" }).boundingBox();
    assert(tapTarget && tapTarget.width >= 32 && tapTarget.height >= 32, "pagination target too small");
    await m.screenshot({ caret: "initial", path: path.join(SHOTS, "06-mobile-dashboard.png") });
    await m.getByRole("searchbox").fill("hdfc");
    await m.waitForURL((u) => u.searchParams.get("q") === "hdfc");
    await m.waitForFunction(() => !document.querySelector("[aria-busy='true']"));
    const row = m.locator("tbody tr").nth(1);
    const symbol = (await row.getAttribute("data-symbol")) ?? "";
    await row.locator("td").first().tap();
    await m.waitForTimeout(700);
    const panelTop = await m.locator("#selected-heading").evaluate((el) => el.getBoundingClientRect().top);
    assert(panelTop >= 0 && panelTop < 844, `preview not scrolled into view (top ${panelTop})`);
    await m.screenshot({ caret: "initial", path: path.join(SHOTS, "07-mobile-selected.png") });
    await m.goto(`${BASE}/stocks/${encodeURIComponent(symbol)}`);
    const detailOverflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(detailOverflow <= 0, `details overflow ${detailOverflow}px`);
    await m.screenshot({ caret: "initial", path: path.join(SHOTS, "08-mobile-details.png"), fullPage: true });
    await mobile.close();

    const tablet = await browser.newContext({ viewport: { width: 820, height: 1180 } });
    const t = await tablet.newPage();
    await t.goto(`${BASE}/`);
    await t.getByRole("table").waitFor();
    const tOverflow = await t.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(tOverflow <= 0, `tablet overflow ${tOverflow}px`);
    await t.screenshot({ caret: "initial", path: path.join(SHOTS, "09-tablet-dashboard.png") });
    await tablet.close();
    return `390px: no overflow, search+tap select scrolls preview into view, details fit; 820px tablet fits`;
  });

  await check("10. Repeat import does not create duplicates", async () => {
    const before = dbCounts();
    const output = runImport();
    const after = dbCounts();
    assert(after.n === before.n, `securities ${before.n} -> ${after.n}`);
    assert(after.n === after.k, "duplicate (segment, symbol, series) keys present");
    assert(/inserted=0/.test(output) && !/inserted=[1-9]/.test(output), output);
    assert(after.imports === before.imports + 2, "import runs not logged");
    await page.goto(`${BASE}/`);
    await page.getByRole("table").waitFor();
    return `${before.n} -> ${after.n} securities; ${after.imports} logged import runs; ${output.trim().split("\n").filter((l) => l.startsWith("✓")).join(" / ")}`;
  });

  await check("No browser console errors during the run", async () => {
    assert(consoleErrors.length === 0, consoleErrors.join(" | "));
    return "0 errors";
  });

  await browser.close();
} finally {
  server.kill("SIGTERM");
  fs.writeFileSync(
    path.join(OUT, "results.json"),
    JSON.stringify({ ranAt: new Date().toISOString(), base: BASE, results, consoleErrors }, null, 2),
  );
  fs.rmSync(dbDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed) {
  console.log(serverLog.split("\n").slice(-30).join("\n"));
  process.exit(1);
}
process.exit(0);
