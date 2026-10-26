// Native chart lifecycle regressions, with explicitly synthetic intercepted
// history responses. No NSE/GNews calls: verify first paint, failure recovery,
// partial extension and cross-security isolation before running live checks.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, type Page } from "playwright";
const base = process.env.MARKETPULSE_RECOVERY_URL ?? "http://127.0.0.1:4510";
const out = "artifacts/testing/chart-recovery"; await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks: string[] = [], errors: string[] = [], requested: string[] = [];
const pass = (name: string) => { checks.push(name); console.log(`PASS ${name}`); };
const bodies = (symbol: string, older: boolean, warning = false) => ({ symbol, series: "EQ", name: "Synthetic regression data", currency: "INR", interval: "1d", dataMode: "HISTORICAL_EOD", adjustmentStatus: "UNADJUSTED", sourceId: "nse-bhavcopy-mcp", sourceLabel: "Synthetic intercepted history — test only", earliestTradingDate: older ? "2025-10-24" : "2026-07-24", latestTradingDate: "2026-10-23",
  provider: { fetchedAt: new Date().toISOString(), cached: false, complete: false, ...(warning ? { loadWarning: { code: "UNAVAILABLE", message: "Synthetic older chunk outage; keeping recent history", retryable: true } } : {}) },
  candles: [...(older ? [{ date: "2025-10-24", open: 100, high: 120, low: 90, close: 101, volume: 1000 }] : []), { date: "2026-07-24", open: 100, high: 120, low: 90, close: 105, volume: 1000 }, { date: "2026-10-23", open: 105, high: 120, low: 90, close: 110, volume: 1200 }],
});
async function ready(page: Page, symbol = "AARTIIND") {
  await page.waitForFunction(symbol => document.querySelector(`[data-testid="stock-price-chart"][data-symbol="${symbol}"]`)?.getAttribute("data-status") === "ready", symbol);
  await page.locator(`[data-testid="stock-price-chart"][data-symbol="${symbol}"] [data-testid="price-chart-canvas"] canvas`).first().waitFor();
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  let yearCalls = 0, maxCalls = 0, recentCalls = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/quotes?**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ symbol: "AARTIIND", series: "EQ", sourceId: "unavailable", quote: null, unavailableReason: "Disabled in synthetic regression" }) }));
  await page.route("**/api/prices?**", async route => {
    const url = new URL(route.request().url()), range = url.searchParams.get("range")!, symbol = url.searchParams.get("symbol")!;
    requested.push(`${symbol}:${range}`);
    if (range === "3M") { recentCalls++; await route.fulfill({ contentType: "application/json", body: JSON.stringify(bodies(symbol, false)) }); return; }
    if (range === "1Y") {
      yearCalls++;
      if (yearCalls === 1) { await held; await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "PROVIDER_UNAVAILABLE", message: "Synthetic upstream failure" } }) }); return; }
    }
    if (range === "MAX") { maxCalls++; await route.fulfill({ contentType: "application/json", body: JSON.stringify(bodies(symbol, true, maxCalls === 1)) }); return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(bodies(symbol, true)) });
  });
  await page.goto(base + "/?q=AARTIIND&selected=MAINBOARD%3AAARTIIND", { waitUntil: "domcontentloaded" });
  await ready(page);
  assert.equal(recentCalls, 1); assert.equal(maxCalls, 0);
  await page.locator('[data-testid="history-extending"]').waitFor();
  pass("one recent 3M request paints a real canvas before the held longer history request; no MAX startup request");
  release(); await page.locator('[data-testid="history-partial-warning"]').waitFor();
  assert.equal(await page.locator('[data-testid="stock-price-chart"]').getAttribute("data-status"), "ready");
  assert.match(await page.locator('[data-testid="latest-close"]').innerText(), /110/);
  await page.getByRole("button", { name: "Retry loading older data", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="history-partial-warning"]'));
  assert.equal(yearCalls, 2); await ready(page);
  pass("failed 1Y extension preserves recent chart; native Retry loads older data and clears the warning");
  await page.getByRole("button", { name: "ALL", exact: true }).click();
  await page.locator('[data-testid="history-partial-warning"]').waitFor();
  await ready(page); assert.equal(maxCalls, 1);
  await page.getByRole("button", { name: "Retry loading older data", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="history-partial-warning"]'));
  assert.equal(maxCalls, 2);
  pass("explicit ALL loads separately, displays server partial-history warning, and retries without blanking the chart");
  await page.screenshot({ path: `${out}/synthetic-recovered.png`, fullPage: true });
  const second = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const failPage = await second.newPage(); failPage.on("pageerror", error => errors.push(error.message));
  let attempts = 0;
  await failPage.route("**/api/quotes?**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ quote: null, sourceId: "unavailable" }) }));
  await failPage.route("**/api/prices?**", route => { attempts++; return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "PROVIDER_UNAVAILABLE", message: "Synthetic first chunk outage" } }) }); });
  await failPage.goto(base + "/?q=AARTIIND&selected=MAINBOARD%3AAARTIIND", { waitUntil: "domcontentloaded" });
  await failPage.getByRole("button", { name: "Retry", exact: true }).waitFor();
  assert.equal(attempts, 2);
  assert.equal(await failPage.locator('[data-testid="stock-price-chart"]').getAttribute("data-status"), "error");
  assert.equal(await failPage.getByText("Historical price data is not available for this security.", { exact: true }).count(), 0);
  await failPage.unroute("**/api/prices?**");
  await failPage.route("**/api/prices?**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...bodies("AARTIIND", true), provider: { fetchedAt: new Date().toISOString(), complete: true } }) }));
  await failPage.getByRole("button", { name: "Retry", exact: true }).click(); await ready(failPage);
  pass("first chunk outage has a bounded retry, then an honest error/Retry—not a cached no-history success—and recovers");
  await page.locator("#directory-search").fill("AARTIPHARM");
  await page.waitForFunction(() => document.querySelector('[data-testid="stock-price-chart"]')?.getAttribute("data-symbol") === "AARTIPHARM");
  await ready(page, "AARTIPHARM");
  assert.equal(await page.locator('[data-testid="stock-price-chart"]').getAttribute("data-symbol"), "AARTIPHARM");
  assert.deepEqual(errors, []);
  pass("company switch uses the new trading identity and no stale chart response crosses companies");
} finally {
  await browser.close();
  await fs.writeFile(`${out}/synthetic-browser-results.json`, JSON.stringify({ base, checks, errors, requested, synthetic: true }, null, 2));
}
console.log(`${checks.length}/${checks.length} chart recovery regressions passed.`);
