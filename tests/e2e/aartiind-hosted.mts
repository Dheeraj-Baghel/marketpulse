// User-reported hosted chart regression. Real AARTIIND/AARTIDRUGS NSE data;
// no injected chart/provider responses. Uses normal UI and does not force-refresh.
// Run manually only: it consumes a small amount of real provider traffic.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, devices, type Page } from "playwright";
const base = "https://marketpulse-softtech10.vercel.app";
const out = "artifacts/testing/chart-recovery"; await fs.mkdir(out, { recursive: true });
const checks: string[] = [], requests: { symbol: string | null; range: string | null; started: number }[] = [], errors: string[] = [], timings: Record<string, number> = {};
const pass = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };
const browser = await chromium.launch({ headless: true });
function watch(page: Page) {
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { const url = new URL(request.url()); if (url.pathname === "/api/prices") requests.push({ symbol: url.searchParams.get("symbol"), range: url.searchParams.get("range"), started: Date.now() }); });
}
async function ready(page: Page, symbol: string, timeout = 45000) {
  await page.waitForFunction(symbol => document.querySelector(`[data-testid="stock-price-chart"][data-symbol="${symbol}"]`)?.getAttribute("data-status") === "ready", symbol, { timeout });
  const frame = page.locator(`[data-testid="stock-price-chart"][data-symbol="${symbol}"]`);
  await frame.locator('[data-testid="price-chart-canvas"] canvas').first().waitFor();
  assert.equal(await frame.locator('[data-testid="source-badge"]').getAttribute("data-source"), "nse-bhavcopy-mcp");
  return frame;
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); watch(page);
  let start = Date.now();
  await page.goto(base + "/?q=AARTIIND&selected=MAINBOARD%3AAARTIIND", { waitUntil: "domcontentloaded" });
  const frame = await ready(page, "AARTIIND"); timings.aartiindFirstPaintMs = Date.now() - start;
  assert.equal(requests.find(request => request.symbol === "AARTIIND")?.range, "3M");
  assert.ok(!requests.some(request => request.range === "MAX"));
  assert.match(await frame.locator('[data-testid="latest-close"]').innerText(), /\d/);
  const date = await frame.locator('[data-testid="latest-date"]').getAttribute("datetime"); assert.ok(date && date >= "2026-10-23");
  pass(`real AARTIIND candles/volume painted in ${timings.aartiindFirstPaintMs} ms with 3M startup—not MAX`);
  await page.screenshot({ path: `${out}/live-aartiind-first-paint.png`, fullPage: true });
  for (const range of ["1D", "2D", "7D", "3M", "1Y"]) {
    await frame.getByRole("button", { name: range, exact: true }).click();
    assert.equal(await frame.getAttribute("data-range"), range); await ready(page, "AARTIIND");
  }
  pass("reported stock's day/month/year controls keep real candles visible");
  await frame.getByRole("button", { name: "ALL", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="history-extending"]'), null, { timeout: 50000 });
  await ready(page, "AARTIIND");
  assert.ok(requests.some(request => request.symbol === "AARTIIND" && request.range === "MAX"));
  assert.equal(await page.getByText("Historical price data is not available for this security.", { exact: true }).count(), 0);
  pass("explicit ALL finishes or reports partial history without erasing AARTIIND's chart");
  await page.screenshot({ path: `${out}/live-aartiind-all.png`, fullPage: true });
  await page.locator("#directory-search").fill("AARTIDRUGS");
  start = Date.now(); await ready(page, "AARTIDRUGS"); timings.aartidrugsFirstPaintMs = Date.now() - start;
  assert.equal(await page.locator('[data-testid="stock-price-chart"]').getAttribute("data-symbol"), "AARTIDRUGS");
  pass(`another non-CSV stock AARTIDRUGS also loads real NSE history (${timings.aartidrugsFirstPaintMs} ms)`);
  const mobileContext = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await mobileContext.newPage(); watch(mobile);
  start = Date.now(); await mobile.goto(base + "/?q=AARTIIND&selected=MAINBOARD%3AAARTIIND", { waitUntil: "domcontentloaded" });
  const mobileChart = await ready(mobile, "AARTIIND"); timings.phoneFirstPaintMs = Date.now() - start;
  await mobileChart.getByRole("button", { name: "7D", exact: true }).tap();
  assert.equal(await mobileChart.getAttribute("data-range"), "7D");
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobileChart.scrollIntoViewIfNeeded();
  await mobile.screenshot({ path: `${out}/live-aartiind-phone.png`, fullPage: true });
  assert.deepEqual(errors, []);
  pass(`fresh phone-sized AARTIIND chart loads (${timings.phoneFirstPaintMs} ms), tap filters work, no overflow or page errors`);
} finally {
  await browser.close();
  await fs.writeFile(`${out}/live-browser-results.json`, JSON.stringify({ base, testedAt: new Date().toISOString(), checks, timings, requests, errors, limits: "Real provider requests, no mocks. Cold/warm timings vary with NSE and Vercel. Chromium and emulated phone only; an upstream outage can still require Retry." }, null, 2));
}
console.log(`${checks.length}/${checks.length} reported-stock live checks passed.`);
