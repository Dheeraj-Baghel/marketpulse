/**
 * Stage 2C browser checks. The app server under test has NSE MCP enabled but
 * pointed at the LOCAL SYNTHETIC double (tests/e2e/mcp-double.mts), so these
 * runs are repeatable and never contact NSE. Values asserted here are compared
 * against what the app's own API returns (and the double's deterministic
 * synthetic sequence), never against hard-coded market prices.
 */
import path from "node:path";
import type { Browser, Page } from "playwright";

interface Ctx {
  browser: Browser;
  base: string;
  doubleBase: string;
  shots: string;
  check: (name: string, fn: () => Promise<string>) => Promise<void>;
  consoleErrors: string[];
  hasCsv: boolean;
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

type Probe = { dataKey: string; candles: () => { time: string; close: number }[] };
type ProbeWindow = Window & { __mpCharts?: Map<unknown, Probe> };

const inr = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

async function control(doubleBase: string, body: Record<string, unknown>) {
  const r = await fetch(`${doubleBase}/__control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json()) as { calls: Record<string, number> };
}

async function waitChart(page: Page, symbol: string) {
  await page.locator(`[data-testid=stock-price-chart][data-symbol="${symbol}"][data-status=ready] canvas`).first().waitFor();
  await page.waitForFunction((s) => [...((window as ProbeWindow).__mpCharts?.values() ?? [])].some((c) => c.dataKey.startsWith(`${s}|`) && c.candles().length > 0), symbol);
}
async function waitQuote(page: Page, symbol: string, status = "ready") {
  await page.locator(`[data-testid=stock-price-chart][data-symbol="${symbol}"] [data-testid=delayed-quote][data-status="${status}"]`).waitFor();
}
async function plotted(page: Page) {
  return page.evaluate(() => [...((window as ProbeWindow).__mpCharts?.values() ?? [])].map((c) => ({ dataKey: c.dataKey, candles: c.candles().map((x) => ({ time: x.time, close: x.close })) })));
}
async function api(base: string, p: string) {
  const r = await fetch(`${base}${p}`);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

export async function runMcpChecks(ctx: Ctx) {
  const { browser, base, doubleBase, shots, check, consoleErrors } = ctx;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  page.setDefaultNavigationTimeout(180_000);
  let allowProviderErrors = false;
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (allowProviderErrors && /status of (502|503|504)/.test(m.text())) return; // deliberate outages below
    consoleErrors.push(`[2C] ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`[2C] pageerror: ${e.message}`));
  await control(doubleBase, { reset: true });

  await check("27. 2C: MCP history renders through the Stage 2B chart, labelled NSE Bhavcopy", async () => {
    const prices = await api(base, "/api/prices?symbol=RELIANCE&series=EQ&range=MAX");
    assert(prices.status === 200 && prices.body.sourceId === "nse-bhavcopy-mcp" && prices.body.sourceLabel === "NSE Bhavcopy — Historical EOD", `source ${String(prices.body.sourceId)}`);
    assert(prices.body.dataMode === "HISTORICAL_EOD" && prices.body.isStale === false, "metadata");
    const apiCandles = prices.body.candles as { date: string; close: number }[];
    await page.goto(`${base}/?q=RELIANCE&selected=MAINBOARD:RELIANCE`);
    await waitChart(page, "RELIANCE");
    await page.getByRole("button", { name: "ALL", exact: true }).click();
    await page.waitForFunction(() => [...((window as ProbeWindow).__mpCharts?.values() ?? [])][0]?.dataKey.endsWith("|ALL"));
    const [s] = await plotted(page);
    assert(s && s.candles.length === apiCandles.length, `plotted ${s?.candles.length} vs API ${apiCandles.length}`);
    assert(s.candles.every((c, i) => c.time === apiCandles[i]!.date && c.close === apiCandles[i]!.close), "plotted candles differ from API");
    const badge = await page.getByTestId("source-badge").innerText();
    assert(/NSE Bhavcopy — Historical EOD/.test(badge) && (await page.getByTestId("source-badge").getAttribute("data-source")) === "nse-bhavcopy-mcp", badge);
    assert(!/\bLIVE\b/.test(await page.getByTestId("stock-price-chart").innerText()), "chart text contains LIVE");
    assert((await page.getByTestId("latest-date").getAttribute("datetime")) === prices.body.latestTradingDate, "latest date");
    await page.getByRole("button", { name: "1Y", exact: true }).click();
    return `${apiCandles.length} synthetic MCP candles ${apiCandles[0]!.date}..${apiCandles.at(-1)!.date} plotted exactly; badge "${badge.trim()}"`;
  });

  await check("28. 2C: delayed quote shown separately with source + exchange timestamp", async () => {
    await waitQuote(page, "RELIANCE");
    const q = await api(base, "/api/quotes?symbol=RELIANCE&series=EQ");
    const quote = q.body.quote as { lastPrice: number; exchangeTimestamp: string };
    assert(q.body.sourceLabel === "NSE CM Market — Delayed Quote" && q.body.dataMode === "DELAYED_QUOTE", "quote metadata");
    assert((await page.getByTestId("quote-price").innerText()) === inr(quote.lastPrice), "quote price != API");
    assert(/NSE CM MARKET · DELAYED/.test(await page.getByTestId("quote-source").innerText()), "quote badge");
    assert((await page.getByTestId("quote-timestamp").getAttribute("datetime")) === quote.exchangeTimestamp, "timestamp");
    assert(/IST/.test(await page.getByTestId("quote-timestamp").innerText()), "IST label");
    // The quote must not be appended as a candle: latest candle date is still the last EOD session.
    const [s] = await plotted(page);
    assert(s && !s.candles.some((c) => c.time === quote.exchangeTimestamp.slice(0, 10)), "quote date appears as a candle");
    assert((await page.getByTestId("latest-close").innerText()) !== (await page.getByTestId("quote-price").innerText()), "historical close and quote must be distinct values here");
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(shots, "22-2c-mcp-history-and-quote.png") });
    return `quote ${inr(quote.lastPrice)} @ ${quote.exchangeTimestamp} shown in its own block; no intraday candle appended`;
  });

  await check("29. 2C: repeated requests use the server caches; refresh bypasses them", async () => {
    const before = await control(doubleBase, {});
    await api(base, "/api/prices?symbol=RELIANCE&series=EQ&range=MAX");
    await api(base, "/api/quotes?symbol=RELIANCE&series=EQ");
    const mid = await control(doubleBase, {});
    assert(mid.calls["history:RELIANCE"] === before.calls["history:RELIANCE"], "history refetched within TTL");
    assert(mid.calls["quote:RELIANCE"] === before.calls["quote:RELIANCE"], "quote refetched within TTL");
    await page.getByRole("button", { name: "Refresh RELIANCE delayed quote" }).click();
    await page.waitForFunction(() => document.querySelector("[data-testid=delayed-quote]")?.getAttribute("data-status") === "ready");
    await page.waitForTimeout(500);
    const after = await control(doubleBase, {});
    assert((after.calls["quote:RELIANCE"] ?? 0) === (before.calls["quote:RELIANCE"] ?? 0) + 1, `manual refresh calls ${before.calls["quote:RELIANCE"]} -> ${after.calls["quote:RELIANCE"]}`);
    const status = await api(base, "/api/market-data/status");
    const cache = status.body.cache as { history: { persisted: boolean }; quotes: { persisted: boolean } };
    assert(cache.history.persisted === false && cache.quotes.persisted === false, "cache must be transient");
    return `cached reads made 0 upstream calls; manual quote refresh made exactly 1; caches are transient`;
  });

  await check("30. 2C: rapid switching never shows another security's history or quote", async () => {
    // TCS (uncached on the server so far) is made slow, then the user switches away to
    // RELIANCE and back to TCS... the decisive race: select TCS (slow, in flight), then
    // RELIANCE (fast, cached), and verify the late TCS responses never replace RELIANCE.
    await control(doubleBase, { delayMs: { TCS: 2500, "quote:TCS": 2500 } });
    const fresh = await context.newPage(); // fresh page = empty client caches
    fresh.setDefaultTimeout(120_000);
    fresh.on("pageerror", (e) => consoleErrors.push(`[2C] pageerror: ${e.message}`));
    await fresh.goto(`${base}/?q=TCS`);
    await fresh.locator("tbody tr[data-symbol=TCS] td").first().click();
    await fresh.locator("[data-testid=stock-price-chart][data-symbol=TCS][data-status=loading]").waitFor();
    await fresh.getByRole("searchbox").fill("RELIANCE");
    await fresh.waitForURL((u) => u.searchParams.get("q") === "RELIANCE");
    await fresh.locator("tbody tr[data-symbol=RELIANCE] td").first().click();
    await waitChart(fresh, "RELIANCE");
    await waitQuote(fresh, "RELIANCE");
    await fresh.waitForTimeout(3200); // the delayed TCS responses land now
    const relQuote = (await api(base, "/api/quotes?symbol=RELIANCE&series=EQ")).body.quote as { lastPrice: number };
    assert((await fresh.locator("#selected-heading").innerText()).includes("Reliance Industries"), "heading moved");
    const relCharts = await plotted(fresh);
    assert(relCharts.length === 1 && relCharts[0]!.dataKey.startsWith("RELIANCE|"), `chart shows ${relCharts[0]?.dataKey}`);
    assert((await fresh.getByTestId("quote-price").innerText()) === inr(relQuote.lastPrice), "late TCS quote replaced RELIANCE");
    // Now TCS is server-cached; switching back must show TCS's own data.
    await fresh.getByRole("searchbox").fill("TCS");
    await fresh.waitForURL((u) => u.searchParams.get("q") === "TCS");
    await fresh.locator("tbody tr[data-symbol=TCS] td").first().click();
    await waitChart(fresh, "TCS");
    await waitQuote(fresh, "TCS");
    const tcsQuote = (await api(base, "/api/quotes?symbol=TCS&series=EQ")).body.quote as { lastPrice: number };
    assert((await fresh.locator("#selected-heading").innerText()).includes("Tata Consultancy"), "heading");
    const charts = await plotted(fresh);
    assert(charts.length === 1 && charts[0]!.dataKey.startsWith("TCS|"), `chart ${charts[0]?.dataKey}`);
    assert((await fresh.getByTestId("quote-price").innerText()) === inr(tcsQuote.lastPrice), "quote shows non-TCS price");
    await fresh.close();
    await control(doubleBase, { reset: true });
    return "TCS history+quote delayed 2.5 s and superseded by RELIANCE: late TCS responses never replaced RELIANCE; switching back showed TCS's own data";
  });

  await check("31. 2C: MCP outage falls back to local CSV (labelled) and quote shows stale/unavailable", async () => {
    allowProviderErrors = true;
    await control(doubleBase, { bhavcopy: "down", cmmkt: "down" });
    // INFY has no local CSV; RELIANCE has CSV (if supplied). Use refresh=1 so caches are bypassed.
    const rel = await api(base, "/api/prices?symbol=RELIANCE&series=EQ&range=MAX&refresh=1");
    if (ctx.hasCsv) {
      assert(rel.body.sourceId === "local-csv" && rel.body.sourceLabel === "Local CSV — Historical EOD", `fallback source ${String(rel.body.sourceId)}`);
      assert(rel.body.isStale === true && (rel.body.fallbackReason as { code: string }).code === "UNAVAILABLE", "fallback flags");
    }
    const quote = await api(base, "/api/quotes?symbol=RELIANCE&series=EQ&refresh=1");
    assert(quote.status === 200 && quote.body.sourceId === "cached-stale" && quote.body.isStale === true, `stale quote ${quote.status} ${String(quote.body.sourceId)}`);
    const p2 = await context.newPage();
    p2.setDefaultTimeout(120_000);
    p2.on("console", (m) => m.type() === "error" && !/status of (502|503|504)/.test(m.text()) && consoleErrors.push(`[2C outage] ${m.text()}`));
    await p2.goto(`${base}/?q=RELIANCE&selected=MAINBOARD:RELIANCE`);
    if (ctx.hasCsv) {
      await waitChart(p2, "RELIANCE");
      // Still within the transient TTL: previously fetched Bhavcopy data is shown, labelled cached.
      assert((await p2.getByTestId("source-badge").getAttribute("data-source")) === "nse-bhavcopy-mcp", "expected cached MCP data first");
      assert(/\(cached\)/.test(await p2.getByTestId("provider-freshness").innerText()), "cached label");
      // User asks for fresh data during the outage -> explicit, labelled local CSV fallback.
      await p2.getByRole("button", { name: "Refresh historical data" }).click();
      await p2.waitForFunction(() => document.querySelector("[data-testid=source-badge]")?.getAttribute("data-source") === "local-csv");
      assert(/showing local CSV/.test(await p2.getByTestId("fallback-reason").innerText()), "fallback note");
      assert(/fallback/.test(await p2.getByTestId("source-badge").innerText()), "badge marks fallback");
      await waitChart(p2, "RELIANCE");
    }
    await p2.locator("[data-testid=delayed-quote]:not([data-status=loading])").waitFor();
    const qs = await p2.getByTestId("delayed-quote").getAttribute("data-status");
    assert(qs === "stale" || qs === "error", `quote state ${qs}`);
    if (qs === "stale") assert(/CACHED — STALE/.test(await p2.getByTestId("quote-source").innerText()), "stale label");
    await p2.mouse.move(0, 0);
    await p2.screenshot({ path: path.join(shots, "23-2c-outage-fallback.png") });
    // Company with no CSV and MCP down -> explicit unavailable, no other company's data.
    const infy = await api(base, "/api/prices?symbol=INFY&series=EQ&range=MAX&refresh=1");
    assert(infy.body.sourceId === "unavailable" && (infy.body.candles as unknown[]).length === 0, "INFY should be unavailable");
    await p2.close();
    await control(doubleBase, { reset: true });
    allowProviderErrors = false;
    return `${ctx.hasCsv ? "cached Bhavcopy shown first (labelled cached); manual refresh during outage -> Local CSV fallback (isStale, reason UNAVAILABLE); " : ""}quote '${String(quote.body.sourceLabel)}' kept original timestamp; INFY unavailable`;
  });

  await check("32. 2C: malformed MCP responses are rejected, never rendered", async () => {
    allowProviderErrors = true;
    await control(doubleBase, { bhavcopy: "malformed", cmmkt: "malformed" });
    const h = await api(base, "/api/prices?symbol=TCS&series=EQ&range=MAX&refresh=1&source=nse-mcp");
    assert(h.status === 502 && (h.body.error as { code: string }).code === "PROVIDER_INVALID_RESPONSE", `history ${h.status}`);
    const q = await api(base, "/api/quotes?symbol=TESTMCP&series=EQ&refresh=1");
    assert(q.status === 404, `unknown directory symbol must be rejected before MCP (${q.status})`);
    const q2 = await api(base, "/api/quotes?symbol=INFY&series=EQ&refresh=1");
    assert(q2.status === 502 && (q2.body.error as { code: string }).code === "PROVIDER_INVALID_RESPONSE", `quote ${q2.status} ${JSON.stringify(q2.body)}`);
    await control(doubleBase, { reset: true });
    allowProviderErrors = false;
    return "malformed history -> 502 PROVIDER_INVALID_RESPONSE; malformed quote -> 502; non-directory symbol -> 404 before any MCP call";
  });

  await check("33. 2C: unsupported security shows explicit unavailable states", async () => {
    // HAMPTON BZ: directory has BZ, double (like NSE) has no BZ data -> no relabelling.
    const p3 = await context.newPage();
    p3.setDefaultTimeout(120_000);
    await p3.goto(`${base}/stocks/INFY`);
    await p3.locator("[data-testid=stock-price-chart][data-symbol=INFY][data-status=empty]").waitFor();
    assert(await p3.getByText("Historical price data is not available for this security.").isVisible(), "empty message");
    assert(/NSE Bhavcopy has no daily history/.test(await p3.getByTestId("chart-message").innerText()), "reason text");
    await p3.locator("[data-testid=delayed-quote]:not([data-status=loading])").waitFor();
    assert((await p3.getByTestId("delayed-quote").getAttribute("data-status")) === "unavailable", "quote unavailable");
    assert((await p3.getByTestId("latest-close").count()) === 0 && (await p3.getByTestId("quote-price").count()) === 0, "a price is displayed for INFY");
    await p3.screenshot({ path: path.join(shots, "24-2c-unsupported-infy.png"), fullPage: true });
    await p3.close();
    return "INFY (not in the synthetic double): chart empty state with NSE reason; quote 'unavailable'; no prices shown";
  });

  await check("34. 2C: details page uses the same provider layer; mobile layout", async () => {
    await page.goto(`${base}/stocks/TCS`);
    await waitChart(page, "TCS");
    await waitQuote(page, "TCS");
    assert((await page.getByTestId("source-badge").getAttribute("data-source")) === "nse-bhavcopy-mcp", "details source");
    for (const t of ["Recent News", "Annual report", "AI insights"]) assert(await page.getByText(t).first().isVisible(), `missing ${t}`);
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const mp = await m.newPage();
    mp.setDefaultTimeout(120_000);
    mp.on("pageerror", (e) => consoleErrors.push(`[2C mobile] ${e.message}`));
    await mp.goto(`${base}/?q=TCS&selected=MAINBOARD:TCS`);
    await waitChart(mp, "TCS");
    await waitQuote(mp, "TCS");
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 0, `mobile overflow ${overflow}`);
    const clipped = await mp.evaluate(() =>
      ["quote-price", "quote-source", "quote-timestamp", "source-badge"]
        .map((id) => [id, document.querySelector(`[data-testid=${id}]`)?.getBoundingClientRect()] as const)
        .filter(([, r]) => r && (r.right > window.innerWidth + 0.5 || r.left < -0.5))
        .map(([id]) => id),
    );
    assert(clipped.length === 0, `clipped: ${clipped.join(",")}`);
    await mp.locator("[data-testid=stock-price-chart]").scrollIntoViewIfNeeded();
    await mp.screenshot({ path: path.join(shots, "25-2c-mobile-tcs-390.png") });
    await m.close();
    return "details page: MCP source + quote + placeholders; 390px: no overflow or clipped quote/source labels";
  });

  await context.close();
}
