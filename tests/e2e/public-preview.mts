// Black-box public preview acceptance. No NSE/GNews traffic, data fixtures or
// mocked responses. Use MARKETPULSE_PREVIEW_URL for local or hosted verification.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
const base = process.env.MARKETPULSE_PREVIEW_URL ?? "https://marketpulse-softtech10.vercel.app";
const out = "artifacts/testing/public-deployment";
await fs.mkdir(out, { recursive: true });
const checks: { name: string; status: string }[] = [], errors: string[] = [], upstream: string[] = [];
const record = (name: string) => { checks.push({ name, status: "PASS" }); console.log(`PASS ${name}`); };
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => { if (/nseindia\.(in|com)|gnews\.io/.test(new URL(request.url()).hostname)) upstream.push(request.url()); });
  const response = await page.goto(base, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200);
  await page.getByRole("heading", { name: /MarketPulse is online/ }).waitFor();
  assert.match(await page.title(), /MarketPulse/);
  record("anonymous HTTP 200 homepage with explicit public-preview heading");
  assert.match(await page.locator("main").innerText(), /not a functioning stock-data service/);
  assert.equal(await page.locator("table,canvas,input[type=search]").count(), 0);
  assert.equal(await page.getByRole("link", { name: /Read NSE.*Terms of Use/ }).getAttribute("rel"), "noopener noreferrer");
  record("truthful disabled-data explanation, no fabricated charts/table, safe terms link");
  await page.screenshot({ path: `${out}/preview-desktop.png`, fullPage: true });
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.getByRole("heading", { name: /MarketPulse is online/ }).waitFor();
  await page.goto(base + "/?q=RELIANCE&selected=RELIANCE", { waitUntil: "networkidle" });
  assert.equal(await page.locator("table,canvas").count(), 0);
  record("dashboard navigation and crafted search/selection parameters cannot enable data");
  const company = await page.goto(base + "/stocks/RELIANCE", { waitUntil: "networkidle" });
  assert.equal(company?.status(), 200);
  await page.getByRole("heading", { name: /MarketPulse is online/ }).waitFor();
  assert.match(await page.title(), /unavailable/);
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("canvas").count(), 0);
  record("direct company route/reload stays explicitly unavailable, not invented stock content");
  for (const endpoint of ["prices", "quotes", "news"]) {
    const result = await context.request.get(base + `/api/${endpoint}?symbol=RELIANCE&refresh=1&source=nse-mcp`);
    assert.equal(result.status(), 503, endpoint);
    assert.equal(result.headers()["cache-control"], "no-store");
    const body = await result.json(); assert.equal(body.code, "PUBLIC_DATA_LICENSE_REQUIRED");
    assert.equal(body.state, "disabled"); assert.ok(!body.apiKey && !body.data && !body.articles);
  }
  record("all market/news endpoints return explicit licensing-disabled 503 JSON without data or keys");
  const health = await context.request.get(base + "/api/market-data/status");
  assert.equal(health.status(), 200);
  const status = await health.json();
  assert.equal(status.publicPreview, true); assert.equal(status.mcpEnabled, false);
  assert.equal(status.quoteAutoRefreshSeconds, 0);
  assert.equal(status.cache.history.upstreamCalls, 0); assert.equal(status.cache.quotes.upstreamCalls, 0);
  assert.ok(status.servers.every((server: { state: string; calls: number }) => server.state === "disabled" && server.calls === 0));
  record("live diagnostic health confirms disabled MCP, zero calls and no background refresh");
  for (const route of ["/.env.local", "/.git/config", "/data/marketpulse.sqlite", "/data/nse/EQUITY_L.csv", "/data/Prices/Reliance.csv", "/docs/news/FINDINGS.md", "/artifacts/testing/results.json"]) {
    const result = await context.request.get(base + route);
    assert.equal(result.status(), 404, route);
  }
  record("database, CSVs, secrets, source and research captures are not publicly served");
  if (!base.includes("127.0.0.1") && !base.includes("localhost")) {
    const headers = response!.headers();
    assert.equal(headers["x-content-type-options"], "nosniff"); assert.equal(headers["x-frame-options"], "DENY");
    assert.equal(headers["permissions-policy"], "camera=(), microphone=(), geolocation=()");
    record("hosted security headers");
  }
  await page.goto(base, { waitUntil: "networkidle" });
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: width === 768 ? 1024 : 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow at ${width}`);
    await page.getByRole("heading", { name: /MarketPulse is online/ }).waitFor();
    await page.screenshot({ path: `${out}/preview-${width}.png`, fullPage: true });
  }
  record("public preview responsive at 320/390/768 pixels with no horizontal overflow");
  await page.keyboard.press("Tab");
  assert.ok(await page.evaluate(() => document.activeElement?.tagName !== "BODY"));
  assert.deepEqual(errors, []); assert.deepEqual(upstream, []);
  record("keyboard focus, no browser errors and no browser requests to NSE/GNews");
} finally {
  await browser.close();
  await fs.writeFile(`${out}/preview-results.json`, JSON.stringify({ base, testedAt: new Date().toISOString(), checks, errors, upstream, limits: "This verifies the data-disabled public preview, not a working stock-data site. Chromium viewport emulation only, no physical device." }, null, 2));
}
console.log(`${checks.length}/${checks.length} public preview checks passed.`);
