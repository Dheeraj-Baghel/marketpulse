/**
 * Stage 3 browser checks. Run against the Stage 2C app server, which is also
 * pointed at a LOCAL SYNTHETIC GNews double (tests/e2e/gnews-double.mts):
 * no real GNews quota is used and no real headlines appear in automated runs.
 */
import path from "node:path";
import type { Browser, Page } from "playwright";

interface Ctx {
  browser: Browser;
  base: string;
  newsBase: string;
  shots: string;
  check: (name: string, fn: () => Promise<string>) => Promise<void>;
  consoleErrors: string[];
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

async function control(newsBase: string, body: Record<string, unknown>) {
  const r = await fetch(`${newsBase}/__control`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json()) as { calls: Record<string, number>; lastKeyHeader: string | null; lastHadKeyInUrl: boolean };
}
const totalCalls = (s: { calls: Record<string, number> }) => Object.values(s.calls).reduce((a, b) => a + b, 0);

async function newsReady(p: Page, symbol: string) {
  await p.locator(`[data-testid=company-news][data-symbol="${symbol}"]:not([data-state=loading])`).waitFor();
  return (await p.getByTestId("company-news").getAttribute("data-state")) ?? "";
}
async function titles(p: Page) {
  return (await p.locator("[data-testid=news-card] h3").allInnerTexts()).map((t) => t.replace(/\s*\(opens.*$/s, "").trim());
}

export async function runNewsChecks(ctx: Ctx) {
  const { browser, base, newsBase, shots, check, consoleErrors } = ctx;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120_000);
  page.setDefaultNavigationTimeout(180_000);
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(`[3] ${m.text()}`));
  page.on("pageerror", (e) => consoleErrors.push(`[3] pageerror: ${e.message}`));
  await control(newsBase, { reset: true });

  await check("35. 3: RELIANCE news — relevant only, deduped, in-window, newest first, safe links", async () => {
    await page.goto(`${base}/stocks/RELIANCE`);
    assert((await newsReady(page, "RELIANCE")) === "ok", "state");
    const t = await titles(page);
    assert(t.length === 2 && t[0] === "[TEST] Reliance Industries shares rise after refinery update" && t[1] === "[TEST] RIL board approves expansion plan", `titles ${JSON.stringify(t)}`);
    assert(!t.some((x) => x.includes("Reliance Power")), "sibling company leaked");
    const times = await page.locator("[data-testid=news-time]").evaluateAll((els) => els.map((e) => e.getAttribute("datetime") ?? ""));
    assert(times.length === 2 && Date.parse(times[0]!) > Date.parse(times[1]!), "not newest first");
    assert((await page.locator("[data-testid=news-time]").first().innerText()).endsWith("IST"), "IST label");
    const links = await page.locator("[data-testid=news-card] a").evaluateAll((as) => as.map((a) => [a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")]));
    assert(links.every(([h, t2, r]) => h?.startsWith("https://news.example.com/") && t2 === "_blank" && /noopener/.test(r ?? "") && /noreferrer/.test(r ?? "")), `links ${JSON.stringify(links)}`);
    assert((await page.locator("[data-testid=company-news] img").count()) === 0, "article images must not be displayed");
    assert(/delayed by approximately 12 hours/.test(await page.getByTestId("news-delay-note").innerText()), "delay note");
    assert(/Showing up to 10 retrieved results/.test(await page.getByTestId("news-limit-note").innerText()), "free-tier limit note");
    const s = await control(newsBase, {});
    assert(s.lastKeyHeader === "present" && s.lastHadKeyInUrl === false, "key must be sent as header, never in the URL");
    await page.getByTestId("company-news").screenshot({ path: path.join(shots, "26-3-news-reliance-1440.png") });
    return "2 of 5 synthetic articles shown (sibling, duplicate, 20-day-old rejected); newest first; IST; safe links; no images";
  });

  await check("36. 3: ambiguous acronym rejected (TCS tax story) ; chart unaffected", async () => {
    await page.goto(`${base}/stocks/TCS`);
    assert((await newsReady(page, "TCS")) === "ok", "state");
    const t = await titles(page);
    assert(t.includes("[TEST] TCS shares gain after large deal win") && t.includes("[TEST] Tata Consultancy Services opens new delivery centre"), JSON.stringify(t));
    assert(!t.some((x) => x.includes("foreign remittances")), "tax-collected-at-source TCS story leaked");
    await page.locator("[data-testid=stock-price-chart][data-status=ready] canvas").first().waitFor();
    return `${t.length} TCS articles; 'TCS = tax collected at source' story rejected; chart rendered alongside`;
  });

  await check("37. 3: cache — revisiting within TTL makes no provider call; API key never in responses", async () => {
    const before = totalCalls(await control(newsBase, {}));
    await page.goto(`${base}/stocks/RELIANCE`);
    await newsReady(page, "RELIANCE");
    assert((await page.getByTestId("news-status").innerText()).includes("Cached"), "cached label");
    assert(/Last checked/.test(await page.getByTestId("news-status").innerText()), "last-checked timestamp");
    const after = totalCalls(await control(newsBase, {}));
    assert(after === before, `provider called ${after - before} time(s) on a cached revisit`);
    const raw = await (await fetch(`${base}/api/news?symbol=RELIANCE`)).text();
    assert(!/e2etestgnewskey/.test(raw), "API key leaked into the response");
    const html = await page.content();
    assert(!/e2etestgnewskey/.test(html), "API key leaked into the page");
    return "0 provider calls on revisit; 'Cached' + 'Last checked' shown; key absent from API JSON and HTML";
  });

  await check("38. 3: SME company with no coverage shows the informative empty state", async () => {
    await page.goto(`${base}/stocks/EMKAYTOOLS`);
    assert((await newsReady(page, "EMKAYTOOLS")) === "empty", "state");
    const msg = await page.getByTestId("news-message").innerText();
    assert(/No matching company news found in the previous 14 days\./.test(msg) && /does not mean no news exists/.test(msg), msg);
    return "EMKAYTOOLS: 'No matching company news found in the previous 14 days.' + coverage caveat";
  });

  await check("39. 3: quick navigation between companies never shows another company's articles", async () => {
    await control(newsBase, { delayMs: { Infosys: 2500 } });
    const p = await context.newPage();
    p.setDefaultTimeout(120_000);
    await p.goto(`${base}/stocks/INFY`); // slow (uncached) news request starts
    await p.locator("[data-testid=company-news][data-symbol=INFY][data-state=loading]").waitFor();
    await p.goto(`${base}/stocks/TCS`); // navigate away while INFY news is in flight
    await newsReady(p, "TCS");
    await p.waitForTimeout(3000); // the delayed INFY response lands now
    const t = await titles(p);
    assert(t.length > 0 && t.every((x) => !x.includes("Infosys")), `TCS page shows ${JSON.stringify(t)}`);
    assert((await p.getByTestId("company-news").getAttribute("data-symbol")) === "TCS", "section symbol");
    await p.goto(`${base}/stocks/INFY`);
    await newsReady(p, "INFY");
    assert((await titles(p)).every((x) => x.includes("Infosys")), "INFY page shows other company's news");
    await p.close();
    await control(newsBase, { reset: true });
    return "INFY news delayed 2.5 s, user moved to TCS: TCS page showed only TCS articles; INFY page only INFY";
  });

  await check("40. 3: quota exhausted -> stale cached articles with original 'Last checked'; no-cache -> explicit limit state", async () => {
    await control(newsBase, { mode: "quota" });
    await page.goto(`${base}/stocks/RELIANCE`);
    await newsReady(page, "RELIANCE");
    const before = await page.getByTestId("news-fetched-at").getAttribute("datetime");
    await page.getByRole("button", { name: "Refresh news" }).click();
    await page.locator("[data-testid=company-news][data-state=stale]").waitFor();
    assert(/Daily news API limit reached\. Previously retrieved articles are shown where available\./.test(await page.getByTestId("news-stale-banner").innerText()), "quota banner");
    assert((await page.getByTestId("news-fetched-at").getAttribute("datetime")) === before, "stale data must keep its original retrieval time");
    assert((await page.getByTestId("news-card").count()) === 2, "cached articles shown");
    await page.getByTestId("company-news").screenshot({ path: path.join(shots, "27-3-news-quota-stale.png") });
    const callsBefore = totalCalls(await control(newsBase, {}));
    await page.goto(`${base}/stocks/HDFCBANK`); // never fetched -> no cache
    assert((await newsReady(page, "HDFCBANK")) === "quota-exhausted", "state");
    assert(/Daily news API limit reached/.test(await page.getByTestId("news-message").innerText()), "quota message");
    assert(totalCalls(await control(newsBase, {})) === callsBefore, "provider must not be called again until the quota resets");
    // The chart reaches its own terminal state independently (HDFCBANK has no synthetic price data -> its explicit empty state).
    await page.locator("[data-testid=stock-price-chart]:not([data-status=loading])").waitFor();
    return "refresh during quota: stale articles + banner + original timestamp; new company: explicit limit state, 0 further provider calls; chart still renders";
  });

  // After a 403 the app (correctly) blocks GNews until 00:00 UTC, so the
  // remaining check uses already-cached companies. The outage ("unavailable")
  // and timeout paths are covered by unit tests with a mocked provider.
  await control(newsBase, { reset: true });

  await check("41. 3: 390/820px news layouts are usable alongside the chart", async () => {
    for (const [w, h, mobile] of [[820, 1180, false], [390, 844, true]] as const) {
      const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const p = await c.newPage();
      p.setDefaultTimeout(120_000);
      p.on("pageerror", (e) => consoleErrors.push(`[3 ${w}] ${e.message}`));
      await p.goto(`${base}/stocks/TCS`); // cached news + chart
      await newsReady(p, "TCS");
      await p.locator("[data-testid=stock-price-chart][data-status=ready] canvas").first().waitFor();
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 0, `${w}px overflow ${overflow}`);
      const clipped = await p.evaluate(() =>
        [...document.querySelectorAll("[data-testid=news-card] h3, [data-testid=news-publisher], [data-testid=news-time]")]
          .map((e) => e.getBoundingClientRect())
          .filter((r) => r.right > window.innerWidth + 0.5 || r.left < -0.5).length,
      );
      assert(clipped === 0, `${w}px: ${clipped} clipped news elements`);
      await p.getByTestId("company-news").scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(shots, `28-3-news-tcs-${w}.png`) });
      await c.close();
    }
    return "820px and 390px: news readable, no overflow or clipped headlines; chart rendered with news";
  });

  await context.close();
}
