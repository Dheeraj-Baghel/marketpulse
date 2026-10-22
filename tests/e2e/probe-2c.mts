/**
 * Manual, narrowly scoped LIVE check against the running dev server (real NSE
 * MCP behind it): RELIANCE + TCS on the dashboard, RELIANCE details, 390px.
 * Not part of `npm run test:e2e` (which uses a local MCP double).
 *   BASE=http://127.0.0.1:4327 npx tsx tests/e2e/probe-2c.mts
 */
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4327";
const SHOTS = path.resolve("artifacts/screenshots");
const browser = await chromium.launch();
const errors: string[] = [];
const watch = (p: Page) => {
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(e.message));
};
const ready = async (p: Page, s: string) => {
  await p.locator(`[data-testid=stock-price-chart][data-symbol="${s}"][data-status=ready] canvas`).first().waitFor({ timeout: 90_000 });
  await p.locator(`[data-testid=stock-price-chart][data-symbol="${s}"] [data-testid=delayed-quote]:not([data-status=loading])`).waitFor({ timeout: 60_000 });
  await p.waitForTimeout(600);
};
const summary = async (p: Page) => ({
  source: await p.getByTestId("source-badge").innerText(),
  close: await p.getByTestId("latest-close").innerText(),
  date: await p.getByTestId("latest-date").getAttribute("datetime"),
  quote: (await p.getByTestId("delayed-quote").innerText()).replace(/\s+/g, " "),
  footer: (await p.getByTestId("chart-footer").innerText()).replace(/\s+/g, " "),
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
watch(page);
await page.goto(`${BASE}/?q=RELIANCE&selected=MAINBOARD:RELIANCE`);
await ready(page, "RELIANCE");
await page.mouse.move(0, 0);
await page.screenshot({ path: path.join(SHOTS, "30-stage2c-dashboard-reliance-1440.png") });
console.log("RELIANCE", JSON.stringify(await summary(page)));
await page.getByRole("searchbox").fill("TCS");
await page.waitForURL((u) => u.searchParams.get("q") === "TCS");
await page.locator("tbody tr[data-symbol=TCS] td").first().click();
await ready(page, "TCS");
await page.mouse.move(0, 0);
await page.screenshot({ path: path.join(SHOTS, "31-stage2c-dashboard-tcs-1440.png") });
console.log("TCS", JSON.stringify(await summary(page)));
await page.goto(`${BASE}/stocks/RELIANCE`);
await ready(page, "RELIANCE");
await page.getByRole("button", { name: "ALL", exact: true }).click();
await page.waitForTimeout(800);
await page.mouse.move(0, 0);
await page.screenshot({ path: path.join(SHOTS, "32-stage2c-details-reliance-all.png"), fullPage: true });
console.log("DETAILS", JSON.stringify(await summary(page)));
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
watch(m);
await m.goto(`${BASE}/?q=HDFCBANK&selected=MAINBOARD:HDFCBANK`);
await ready(m, "HDFCBANK");
await m.locator("[data-testid=stock-price-chart]").scrollIntoViewIfNeeded();
await m.screenshot({ path: path.join(SHOTS, "33-stage2c-mobile-hdfcbank-390.png") });
console.log("HDFCBANK", JSON.stringify(await summary(m)), "overflow", await m.evaluate(() => document.documentElement.scrollWidth - innerWidth));
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
