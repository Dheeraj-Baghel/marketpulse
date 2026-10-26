/**
 * Manual LIVE check of the news UI against the running dev server (real GNews
 * behind it; the server cache means revisits cost no quota). Not part of
 * `npm run test:e2e`, which uses a local synthetic GNews double.
 * Screenshots contain real third-party headlines -> git-ignored local folder.
 *   npx tsx tests/e2e/probe-3-news.mts
 */
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:4327";
const SHOTS = path.resolve("artifacts/local-only");
const browser = await chromium.launch();
const errors: string[] = [];
const watch = (p: Page) => {
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(e.message));
};

async function open(p: Page, symbol: string) {
  await p.goto(`${BASE}/stocks/${symbol}`);
  await p.locator(`[data-testid=company-news][data-symbol="${symbol}"]:not([data-state=loading])`).waitFor({ timeout: 60_000 });
  await p.locator("[data-testid=stock-price-chart] canvas, [data-testid=stock-price-chart] [data-testid=chart-message]").first().waitFor({ timeout: 90_000 });
  const state = await p.getByTestId("company-news").getAttribute("data-state");
  const cards = await p.getByTestId("news-card").count();
  const links = await p.locator("[data-testid=news-card] a").evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel") })));
  const titles = await p.locator("[data-testid=news-card] h3").allInnerTexts();
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  return { state, cards, unsafe: links.filter((l) => !/^https?:\/\//.test(l.href ?? "") || l.target !== "_blank" || !/noopener/.test(l.rel ?? "")).length, titles, overflow };
}

for (const [w, h, mobile] of [[1440, 900, false], [820, 1180, false], [390, 844, true]] as const) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const p = await ctx.newPage();
  watch(p);
  for (const s of w === 1440 ? ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ITC", "EMKAYTOOLS"] : ["HDFCBANK"]) {
    const r = await open(p, s);
    console.log(`${w}px ${s}: state=${r.state} cards=${r.cards} unsafeLinks=${r.unsafe} overflow=${r.overflow}`);
    if (w === 1440) for (const t of r.titles.slice(0, 3)) console.log(`     - ${t.replace(/\s*\(opens.*$/, "").slice(0, 110)}`);
    if (w === 1440 && (s === "RELIANCE" || s === "ITC" || s === "EMKAYTOOLS")) {
      await p.getByTestId("company-news").scrollIntoViewIfNeeded();
      await p.mouse.move(0, 0);
      await p.getByTestId("company-news").screenshot({ path: path.join(SHOTS, `40-news-${s.toLowerCase()}-1440.png`) });
    }
    if (w !== 1440) {
      await p.getByTestId("company-news").scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(SHOTS, `41-news-${s.toLowerCase()}-${w}.png`) });
    }
  }
  if (w === 1440) {
    await open(p, "TCS");
    await p.mouse.move(0, 0);
    await p.screenshot({ path: path.join(SHOTS, "42-details-tcs-full-1440.png"), fullPage: true });
  }
  await ctx.close();
}
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
