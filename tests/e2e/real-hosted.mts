// User-authorized real-provider hosted verification. No mocked market/news
// responses. Narrow scope: RELIANCE only, cached requests, no forced refresh.
// This deliberately contacts NSE and GNews; do not add it to routine CI.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, devices } from "playwright";
const base = "https://marketpulse-softtech10.vercel.app";
const out = "artifacts/testing/real-hosted"; await fs.mkdir(out, { recursive: true });
const checks: string[] = [], errors: string[] = [], responses: { path: string; status: number }[] = [];
const record = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };
const secret = (await fs.readFile(".env.local", "utf8")).match(/^\s*GNEWS_API_KEY\s*=\s*([^\r\n]+)/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", response => { if (response.url().startsWith(base + "/api/")) responses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  const response = await page.goto(base + "/?q=RELIANCE&selected=MAINBOARD%3ARELIANCE", { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200);
  await page.locator('tbody tr[data-symbol="RELIANCE"]').waitFor();
  assert.equal(await page.locator("#directory-search").isEnabled(), true);
  assert.equal(await page.getByRole("heading", { name: /MarketPulse is online/ }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Data manager", exact: true }).count(), 0);
  record("normal public dashboard loads real directory/search without import or preview screens");
  const chart = page.locator('[data-testid="stock-price-chart"][data-symbol="RELIANCE"]');
  await chart.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="stock-price-chart"]')?.getAttribute("data-status") === "ready", null, { timeout: 90000 });
  assert.equal(await chart.locator('[data-testid="source-badge"]').getAttribute("data-source"), "nse-bhavcopy-mcp");
  await chart.locator('[data-testid="price-chart-canvas"] canvas').first().waitFor();
  const latest = await chart.locator('[data-testid="latest-date"]').getAttribute("datetime");
  assert.ok(latest && latest >= "2026-10-26");
  record(`real NSE history renders in the chart through ${latest}`);
  await page.waitForFunction(() => document.querySelector('[data-testid="delayed-quote"]')?.getAttribute("data-status") === "ready", null, { timeout: 35000 });
  const quote = chart.locator('[data-testid="delayed-quote"]');
  assert.equal(await quote.getAttribute("data-source"), "nse-cm-market-mcp");
  await quote.locator('[data-testid="quote-price"]').waitFor();
  assert.ok(await quote.locator('[data-testid="quote-timestamp"]').getAttribute("datetime"));
  record("real NSE delayed quote, price and exchange timestamp display separately from EOD history");
  const priceRequests = responses.filter(response => response.path === "/api/prices").length;
  for (const range of ["1D", "2D", "7D", "1Y"]) {
    await chart.getByRole("button", { name: range, exact: true }).click();
    assert.equal(await chart.getAttribute("data-range"), range);
  }
  await chart.getByRole("button", { name: "Line", exact: true }).click();
  assert.equal(await chart.getAttribute("data-mode"), "line");
  await chart.getByRole("button", { name: "Candlestick", exact: true }).click();
  assert.equal(responses.filter(response => response.path === "/api/prices").length, priceRequests);
  record("range and chart-type controls work without extra upstream price requests");
  await page.screenshot({ path: `${out}/real-dashboard-desktop.png`, fullPage: true });
  // Keep the same security while exercising actual server-side search.
  await page.locator("#directory-search").fill("INE002A01018");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("q") === "INE002A01018");
  await page.locator('tbody tr[data-symbol="RELIANCE"]').waitFor();
  record("hosted symbol/ISIN directory query works against the real read-only snapshot");
  await page.goto(base + "/stocks/RELIANCE", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /Reliance Industries Limited/ }).first().waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="company-news"]')?.getAttribute("data-state") === "ok", null, { timeout: 35000 });
  const news = page.locator('[data-testid="news-list"]');
  assert.ok((await news.locator("li").count()) > 0);
  assert.ok(await page.locator('[data-testid="news-fetched-at"]').getAttribute("datetime"));
  const reports = page.getByRole("link", { name: "View Annual Reports on NSE", exact: true });
  assert.match((await reports.getAttribute("href"))!, /symbol=RELIANCE/);
  await page.screenshot({ path: `${out}/real-company-news.png`, fullPage: true });
  record("real company page, GNews articles/fetch timestamp and official annual-report link work");
  const mobileContext = await browser.newContext({ ...devices["iPhone 13"] });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", error => errors.push(error.message));
  await mobile.goto(base + "/stocks/RELIANCE", { waitUntil: "domcontentloaded" });
  await mobile.waitForFunction(() => document.querySelector('[data-testid="stock-price-chart"]')?.getAttribute("data-status") === "ready", null, { timeout: 90000 });
  await mobile.waitForFunction(() => document.querySelector('[data-testid="company-news"]')?.getAttribute("data-state") === "ok", null, { timeout: 35000 });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.screenshot({ path: `${out}/real-company-phone.png`, fullPage: true });
  record("emulated-phone company chart/news load from real providers with no horizontal overflow");
  for (const route of ["/.env.local", "/server-data/marketpulse.sqlite", "/data/marketpulse.sqlite"]) {
    const result = await context.request.get(base + route); assert.equal(result.status(), 404, route);
  }
  const jsUrls = await page.locator("script[src]").evaluateAll(scripts => scripts.map(script => (script as HTMLScriptElement).src));
  if (secret) for (const url of jsUrls) { const result = await context.request.get(url); assert.equal((await result.text()).includes(secret), false, "server key must not ship in client JS"); }
  assert.deepEqual(errors, []);
  assert.ok(responses.every(response => response.status === 200));
  record("server snapshot/env files stay private, news key absent from client JS, no browser/API errors");
} finally {
  await browser.close();
  await fs.writeFile(`${out}/browser-results.json`, JSON.stringify({ base, testedAt: new Date().toISOString(), checks, errors, responses, limits: "Real NSE/GNews requests under user authorization; narrow named-stock verification. Chromium/emulated phone only. Public-display licensing not established by this test." }, null, 2));
}
console.log(`${checks.length}/${checks.length} real-hosted browser checks passed.`);
