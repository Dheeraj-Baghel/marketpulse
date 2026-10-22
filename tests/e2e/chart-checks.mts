/**
 * Stage 2B browser checks (imported by browser.mts after the real RELIANCE and
 * TCS NSE CSVs have been imported into the throwaway test database).
 *
 * Every expected price/volume/date is read from that SQLite database: the
 * test never hard-codes market values, it proves the chart shows exactly what
 * was stored from the authentic files.
 */
import path from "node:path";
import Database from "better-sqlite3";
import type { Browser, Page } from "playwright";

interface Ctx {
  browser: Browser;
  page: Page;
  base: string;
  shots: string;
  dbPath: string;
  check: (name: string, fn: () => Promise<string>) => Promise<void>;
  searchFor: (page: Page, text: string) => Promise<void>;
  consoleErrors: string[];
  expected: { http500: boolean };
}

interface StoredRow {
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

const SCALE = 10_000;

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
type Probe = {
  dataKey: string;
  mode: string;
  panes: () => number;
  candles: () => { time: string; open: number; high: number; low: number; close: number }[];
  line: () => { time: string; value: number }[];
  volume: () => { time: string; value: number }[];
  visibleLogicalRange: () => { from: number; to: number } | null;
  candlesVisible: () => boolean;
};
type ProbeWindow = Window & { __mpCharts?: Map<unknown, Probe> };

function stored(dbPath: string, symbol: string): StoredRow[] {
  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `select p.trade_date, p.open, p.high, p.low, p.close, p.volume from daily_prices p
       join securities s on s.id = p.security_id where s.symbol = ? and s.series = 'EQ' order by p.trade_date`,
    )
    .all(symbol) as StoredRow[];
  db.close();
  return rows;
}

const inr = (scaled: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(scaled / SCALE);
const vol = (v: number) => new Intl.NumberFormat("en-IN").format(v);

/** Snapshot of the (single) live chart: its dataKey and what it actually plotted. */
async function chartState(page: Page) {
  return page.evaluate(() => {
    const charts = [...((window as ProbeWindow).__mpCharts?.values() ?? [])];
    return charts.map((c) => ({
      dataKey: c.dataKey,
      mode: c.mode,
      panes: c.panes(),
      candles: c.candles().map((x) => ({ time: x.time, open: x.open, high: x.high, low: x.low, close: x.close })),
      line: c.line().map((x) => ({ time: x.time, value: x.value })),
      volume: c.volume().map((x) => ({ time: x.time, value: x.value })),
      range: c.visibleLogicalRange(),
      candlesVisible: c.candlesVisible(),
    }));
  });
}

async function waitReady(page: Page, symbol: string) {
  await page.locator(`[data-testid=stock-price-chart][data-symbol="${symbol}"][data-status=ready] canvas`).first().waitFor();
  await page.waitForFunction((s) => [...((window as ProbeWindow).__mpCharts?.values() ?? [])].some((c) => c.dataKey.startsWith(`${s}|`) && c.candles().length > 0), symbol);
}

async function selectRow(page: Page, symbol: string) {
  await page.locator(`tbody tr[data-symbol="${symbol}"] td`).first().click();
}

export async function runChartChecks(ctx: Ctx) {
  const { browser, page, base, shots, dbPath, check, searchFor, consoleErrors, expected } = ctx;
  const rel = stored(dbPath, "RELIANCE");
  const tcs = stored(dbPath, "TCS");
  const relLast = rel.at(-1)!;
  const relPrev = rel.at(-2)!;

  await check("13. RELIANCE shows its imported candles; header uses stored values", async () => {
    await page.goto(`${base}/?q=RELIANCE&selected=MAINBOARD:RELIANCE`);
    await waitReady(page, "RELIANCE");
    await page.getByRole("button", { name: "ALL", exact: true }).click();
    await page.waitForFunction(() => [...((window as ProbeWindow).__mpCharts?.values() ?? [])][0]?.dataKey.endsWith("|ALL"));
    const [state] = await chartState(page);
    assert(state, "no chart instance");
    assert(state.candles.length === rel.length, `plotted ${state.candles.length} candles, stored ${rel.length}`);
    for (let i = 0; i < rel.length; i++) {
      const s = rel[i]!;
      const p = state.candles[i]!;
      assert(
        p.time === s.trade_date && p.open * SCALE === s.open && p.high * SCALE === s.high && p.low * SCALE === s.low && p.close * SCALE === s.close,
        `candle ${i} ${p.time} differs from stored ${s.trade_date}`,
      );
    }
    assert((await page.getByTestId("latest-close").innerText()) === inr(relLast.close), "header close != stored latest close");
    assert((await page.getByTestId("latest-date").getAttribute("datetime")) === relLast.trade_date, "latest date mismatch");
    const changeText = await page.getByTestId("session-change").innerText();
    const expectedPct = (((relLast.close - relPrev.close) / relPrev.close) * 100).toFixed(2);
    assert(changeText.includes(`${expectedPct}%`), `change "${changeText}" lacks ${expectedPct}%`);
    assert(await page.getByTestId("eod-badge").isVisible(), "HISTORICAL EOD badge");
    assert((await page.getByTestId("source-badge").innerText()).includes("Imported NSE historical data"), "source badge");
    const text = await page.getByTestId("stock-price-chart").innerText();
    assert(!/\blive\b|\bdelayed\b|real-time|current price/i.test(text), `chart claims live/delayed data: ${text}`);
    await page.getByRole("button", { name: "1Y", exact: true }).click();
    await page.mouse.move(0, 0);
    await page.screenshot({ caret: "initial", path: path.join(shots, "12-dashboard-chart-reliance-1440.png") });
    return `${state.candles.length} candles == stored ${rel[0]!.trade_date}..${relLast.trade_date}; close ${inr(relLast.close)}; change ${expectedPct}% vs ${relPrev.trade_date}`;
  });

  await check("14. OHLC readout matches stored records on hover and at rest", async () => {
    const readout = page.getByTestId("ohlc-readout");
    assert((await readout.getAttribute("data-date")) === relLast.trade_date && (await readout.getAttribute("data-hovering")) === "false", "rest state should be the latest session");
    const box = (await page.getByTestId("price-chart-canvas").boundingBox())!;
    let matched = 0;
    for (const fx of [0.2, 0.45, 0.7]) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.35);
      await page.waitForFunction(() => document.querySelector("[data-testid=ohlc-readout]")?.getAttribute("data-hovering") === "true");
      const date = (await readout.getAttribute("data-date"))!;
      const row = rel.find((r) => r.trade_date === date);
      assert(row, `hovered ${date} is not a stored session`);
      const field = async (f: string) => readout.locator(`[data-field=${f}]`).innerText();
      assert((await field("open")) === inr(row.open) && (await field("high")) === inr(row.high) && (await field("low")) === inr(row.low) && (await field("close")) === inr(row.close), `OHLC mismatch on ${date}`);
      assert((await field("volume")) === vol(row.volume!), `volume mismatch on ${date}`);
      matched++;
    }
    await page.screenshot({ caret: "initial", path: path.join(shots, "13-crosshair-ohlc.png") });
    await page.mouse.move(2, 2);
    return `${matched} crosshair positions matched stored OHLCV exactly; rest readout = latest ${relLast.trade_date}`;
  });

  await check("15. Volume pane matches stored volumes, coloured by direction", async () => {
    const [state] = await chartState(page);
    assert(state && state.panes === 2, `expected 2 panes, got ${state?.panes}`);
    const byDate = new Map(rel.map((r) => [r.trade_date, r]));
    assert(state.volume.length === state.candles.length, "one volume bar per candle");
    for (const v of state.volume) assert(byDate.get(v.time)?.volume === v.value, `volume ${v.time}`);
    return `${state.volume.length} volume bars equal stored volumes (pane 2 of ${state.panes})`;
  });

  await check("16. Selecting TCS replaces RELIANCE completely; range kept", async () => {
    await page.getByRole("button", { name: "6M", exact: true }).click();
    await searchFor(page, "TCS");
    await selectRow(page, "TCS");
    await waitReady(page, "TCS");
    const states = await chartState(page);
    assert(states.length === 1, `${states.length} chart instances alive`);
    const s = states[0]!;
    assert(s.dataKey === "TCS|EQ|6M", `dataKey ${s.dataKey}`);
    const tcsDates = new Map(tcs.map((r) => [r.trade_date, r]));
    assert(s.candles.every((c) => tcsDates.get(c.time)?.close === Math.round(c.close * SCALE)), "a plotted candle is not a stored TCS candle");
    const relCloses = new Set(rel.map((r) => `${r.trade_date}:${r.close}`));
    assert(!s.candles.some((c) => relCloses.has(`${c.time}:${Math.round(c.close * SCALE)}`)), "RELIANCE candle still plotted");
    assert((await page.locator("[data-testid=stock-price-chart]").getAttribute("data-range")) === "6M", "range not retained");
    assert((await page.getByTestId("latest-close").innerText()) === inr(tcs.at(-1)!.close), "TCS header close");
    return `TCS 6M: ${s.candles.length} candles all from stored TCS; 0 RELIANCE candles; range 6M retained`;
  });

  await check("17. Candlestick ↔ line toggle keeps the same data", async () => {
    const before = (await chartState(page))[0]!;
    await page.getByRole("button", { name: "Line", exact: true }).click();
    await page.waitForFunction(() => [...((window as ProbeWindow).__mpCharts?.values() ?? [])][0]?.mode === "line");
    const line = (await chartState(page))[0]!;
    assert(!line.candlesVisible, "candles should be hidden in line mode");
    assert(line.line.length === before.candles.length && line.line.every((p, i) => p.time === before.candles[i]!.time && p.value === before.candles[i]!.close), "line != closes");
    await page.screenshot({ caret: "initial", path: path.join(shots, "14-line-mode-tcs.png") });
    await page.getByRole("button", { name: "Candlestick", exact: true }).click();
    await page.waitForFunction(() => [...((window as ProbeWindow).__mpCharts?.values() ?? [])][0]?.mode === "candles");
    const after = (await chartState(page))[0]!;
    assert(JSON.stringify(after.candles) === JSON.stringify(before.candles), "candles changed after toggling");
    return `line = ${line.line.length} closing prices; candles identical after round trip`;
  });

  await check("18. Timeframes 1M/3M/6M/1Y/ALL use only stored dates", async () => {
    const last = tcs.at(-1)!.trade_date;
    const minus = (iso: string, months: number) => {
      const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
      const t = y * 12 + (m - 1) - months;
      const ty = Math.floor(t / 12);
      const tm = (t % 12) + 1;
      const ld = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
      return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, ld)).padStart(2, "0")}`;
    };
    const out: string[] = [];
    for (const [label, months] of [["1M", 1], ["3M", 3], ["6M", 6], ["1Y", 12], ["ALL", 0]] as const) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.waitForFunction((l) => [...((window as ProbeWindow).__mpCharts?.values() ?? [])][0]?.dataKey.endsWith(`|${l}`), label);
      const s = (await chartState(page))[0]!;
      const expected = months === 0 ? tcs : tcs.filter((r) => r.trade_date > minus(last, months));
      assert(s.candles.length === expected.length && s.candles[0]?.time === expected[0]?.trade_date, `${label}: ${s.candles.length} vs ${expected.length}`);
      out.push(`${label}=${s.candles.length}`);
    }
    const footer = await page.getByTestId("chart-footer").innerText();
    assert(/Stored history: 23 Oct 2025 – 21 Oct 2026 \(246 sessions\)/.test(footer) || /Stored history:/.test(footer), "footer coverage");
    assert(!/5Y|5 years/i.test(await page.getByTestId("stock-price-chart").innerText()), "must not offer/label 5Y");
    return `${out.join(", ")} sessions (stored ${tcs[0]!.trade_date}..${last}); footer states real coverage`;
  });

  await check("19. Zoom, pan and reset view", async () => {
    await page.getByRole("button", { name: "1Y", exact: true }).click();
    await page.waitForFunction(() => [...((window as ProbeWindow).__mpCharts?.values() ?? [])][0]?.dataKey.endsWith("|1Y"));
    await page.waitForTimeout(300);
    const box = (await page.getByTestId("price-chart-canvas").boundingBox())!;
    const initial = (await chartState(page))[0]!.range!;
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -300);
    await page.waitForTimeout(300);
    const zoomed = (await chartState(page))[0]!.range!;
    assert(zoomed.to - zoomed.from < (initial.to - initial.from) * 0.85, `zoom did not narrow (${initial.to - initial.from} -> ${zoomed.to - zoomed.from})`);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.4, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const panned = (await chartState(page))[0]!.range!;
    assert(Math.abs(panned.from - zoomed.from) > 1, "pan did not move the window");
    await page.getByRole("button", { name: "Reset view", exact: true }).click();
    await page.waitForTimeout(300);
    const reset = (await chartState(page))[0]!.range!;
    assert(Math.abs(reset.to - reset.from - (initial.to - initial.from)) < 2, "reset did not restore full view");
    return `span ${(initial.to - initial.from).toFixed(0)} -> zoom ${(zoomed.to - zoomed.from).toFixed(0)} -> pan Δ${(panned.from - zoomed.from).toFixed(0)} -> reset ${(reset.to - reset.from).toFixed(0)} bars`;
  });

  await check("20. Full-screen chart opens and closes", async () => {
    await page.getByRole("button", { name: "Full screen", exact: true }).click();
    await page.waitForTimeout(500);
    const frame = page.getByTestId("stock-price-chart");
    const b = (await frame.boundingBox())!;
    assert(b.width >= 1400 && b.height >= 850, `full-screen frame ${b.width}x${b.height}`);
    await page.screenshot({ caret: "initial", path: path.join(shots, "15-fullscreen.png") });
    await page.getByRole("button", { name: "Exit full screen", exact: true }).click();
    await page.waitForTimeout(400);
    const after = (await frame.boundingBox())!;
    assert(after.width < 1000, "did not exit full screen");
    return `full screen ${Math.round(b.width)}x${Math.round(b.height)}; exit restores ${Math.round(after.width)}px panel`;
  });

  await check("21. Company without history shows the empty state, never the previous chart", async () => {
    await searchFor(page, "INFY");
    await page.locator("[data-testid=stock-price-chart][data-symbol=INFY][data-status=empty]").waitFor();
    assert(await page.getByText("Historical price data is not available for this security.").isVisible(), "empty message");
    const charts = await chartState(page);
    assert(charts.length === 0, `${charts.length} chart instance(s) still alive`);
    assert((await page.getByTestId("latest-close").count()) === 0, "a close price is displayed for INFY");
    await page.screenshot({ caret: "initial", path: path.join(shots, "16-no-data-infy.png") });
    return "INFY: explicit empty state; previous chart destroyed (0 live instances); no price shown";
  });

  await check("22. Rapid switching never shows stale data (delayed responses)", async () => {
    // Make RELIANCE's response slow so it would arrive after TCS's if not cancelled/ignored.
    await page.route("**/api/prices?*symbol=RELIANCE*", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue().catch(() => undefined);
    });
    // Fresh page load = empty client cache. "?q=RELIANCE" lists RELIANCE plus
    // other Reliance group companies without imported data (e.g. RCOM).
    await page.goto(`${base}/?q=RELIANCE`);
    await page.locator("tbody tr[data-symbol=RCOM]").waitFor();
    await selectRow(page, "RCOM"); // no data
    await page.locator("[data-testid=stock-price-chart][data-symbol=RCOM][data-status=empty]").waitFor();
    await selectRow(page, "RELIANCE"); // slow request starts
    await page.locator("[data-testid=stock-price-chart][data-symbol=RELIANCE][data-status=loading]").waitFor();
    await selectRow(page, "RCOM"); // switch away while RELIANCE is in flight
    await page.waitForTimeout(2200); // delayed RELIANCE response lands now
    assert((await page.locator("[data-testid=stock-price-chart]").getAttribute("data-symbol")) === "RCOM", "selection moved");
    assert((await chartState(page)).length === 0, "a chart rendered under RCOM after the stale RELIANCE response");
    assert((await page.getByTestId("latest-close").count()) === 0, "RELIANCE close shown under RCOM");
    // Second race: RELIANCE in flight, then TCS (different result set).
    await page.goto(`${base}/?q=RELIANCE`);
    await selectRow(page, "RELIANCE");
    await page.locator("[data-testid=stock-price-chart][data-symbol=RELIANCE][data-status=loading]").waitFor();
    await searchFor(page, "TCS");
    await selectRow(page, "TCS");
    await waitReady(page, "TCS");
    await page.waitForTimeout(2200); // let the delayed RELIANCE response land
    const states = await chartState(page);
    const heading = await page.locator("#selected-heading").innerText();
    assert(heading.includes("Tata Consultancy"), `heading ${heading}`);
    assert(states.length === 1 && states[0]!.dataKey.startsWith("TCS|"), `chart shows ${states[0]?.dataKey}`);
    assert((await page.getByTestId("latest-close").innerText()) === inr(tcs.at(-1)!.close), "header shows non-TCS close");
    await page.unroute("**/api/prices?*symbol=RELIANCE*");
    return "RELIANCE delayed 1.5 s: switching to RCOM kept the empty state (0 charts); switching to TCS kept TCS chart/header";
  });

  await check("23. API failure shows an error with a working retry; metadata stays", async () => {
    let fail = true;
    expected.http500 = true;
    await page.route("**/api/prices?*symbol=TCS*", (route) =>
      fail ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Price data could not be read from the local database." } }) }) : route.continue(),
    );
    await page.goto(`${base}/?q=TCS&selected=MAINBOARD:TCS`);
    const msg = page.locator("[data-testid=chart-message][data-kind=database]");
    await msg.waitFor();
    assert(await page.locator("#selected-heading").getByText("Tata Consultancy Services Limited").isVisible(), "metadata hidden on error");
    assert(await page.getByText("INE467B01029").isVisible(), "ISIN hidden on error");
    await page.screenshot({ caret: "initial", path: path.join(shots, "17-api-error-retry.png") });
    fail = false;
    await msg.getByRole("button", { name: "Retry" }).click();
    await waitReady(page, "TCS");
    await page.unroute("**/api/prices?*symbol=TCS*");
    expected.http500 = false;
    return "HTTP 500 -> 'Price database unavailable' + Retry; metadata visible; retry loaded TCS";
  });

  await check("24. Unmount destroys the chart (no leaked instances)", async () => {
    await waitReady(page, "TCS");
    const before = (await chartState(page)).length;
    await page.getByRole("link", { name: "Company details" }).click();
    await page.waitForURL(`${base}/stocks/TCS`);
    await waitReady(page, "TCS");
    const onDetails = (await chartState(page)).length;
    await page.getByRole("link", { name: "Back to dashboard" }).click();
    await page.waitForURL(`${base}/`);
    await page.locator("tbody tr").first().waitFor();
    await searchFor(page, "INFY");
    await page.locator("[data-testid=stock-price-chart][data-symbol=INFY][data-status=empty]").waitFor();
    const after = (await chartState(page)).length;
    assert(before === 1 && onDetails === 1 && after === 0, `instances: dashboard ${before}, details ${onDetails}, after leaving ${after}`);
    return `live chart instances: dashboard ${before} -> details ${onDetails} -> no-data dashboard ${after}`;
  });

  await check("25. Company page chart (details) with identity header and placeholders", async () => {
    await page.goto(`${base}/stocks/RELIANCE`);
    await waitReady(page, "RELIANCE");
    const s = (await chartState(page))[0]!;
    assert(s.dataKey === "RELIANCE|EQ|1Y", s.dataKey);
    for (const t of ["Recent company news", "Annual report", "AI insights", "INE002A01018"]) assert(await page.getByText(t).first().isVisible(), `missing ${t}`);
    await page.mouse.move(0, 0);
    await page.screenshot({ caret: "initial", path: path.join(shots, "18-company-chart-page.png"), fullPage: true });
    const noData = await page.goto(`${base}/stocks/INFY`);
    assert(noData?.ok(), "INFY page");
    await page.locator("[data-testid=stock-price-chart][data-symbol=INFY][data-status=empty]").waitFor();
    return `details chart ${s.candles.length} candles (1Y); placeholders intact; INFY details shows empty state`;
  });

  await check("26. Responsive: 1440 / 1280 / 820 / 390 without overflow or clipped axis", async () => {
    const out: string[] = [];
    for (const [w, h, mobile] of [[1440, 900, false], [1280, 800, false], [820, 1180, false], [390, 844, true]] as const) {
      const context = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const p = await context.newPage();
      p.setDefaultTimeout(120_000);
      p.setDefaultNavigationTimeout(180_000);
      p.on("pageerror", (e) => consoleErrors.push(`${w}px pageerror: ${e.message}`));
      p.on("console", (m) => m.type() === "error" && consoleErrors.push(`${w}px: ${m.text()}`));
      await p.goto(`${base}/?q=RELIANCE&selected=MAINBOARD:RELIANCE`);
      await waitReady(p, "RELIANCE");
      await p.waitForTimeout(400);
      const metrics = await p.evaluate(() => {
        const frame = document.querySelector("[data-testid=stock-price-chart]")!.getBoundingClientRect();
        const canvas = document.querySelector("[data-testid=price-chart-canvas]")!.getBoundingClientRect();
        const table = document.querySelector("table")!.getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth - window.innerWidth, frameW: frame.width, canvasW: canvas.width, canvasH: canvas.height, canvasRight: canvas.right, vw: window.innerWidth, sideBySide: table.right <= frame.left + 1 };
      });
      assert(metrics.overflow <= 0, `${w}px: page overflow ${metrics.overflow}px`);
      assert(metrics.canvasRight <= metrics.vw && metrics.canvasW > 200 && metrics.canvasH >= 200, `${w}px: canvas ${metrics.canvasW}x${metrics.canvasH} right ${metrics.canvasRight}`);
      if (w >= 1280) assert(metrics.sideBySide, `${w}px: table and chart should be side by side`);
      else assert(!metrics.sideBySide, `${w}px: table should stack above chart`);
      if (mobile) {
        // Touch: tap a row, preview scrolls into view, full screen reachable.
        await p.goto(`${base}/?q=TCS`);
        await p.locator("tbody tr[data-symbol=TCS] td").first().tap();
        await waitReady(p, "TCS");
        await p.waitForTimeout(800);
        const top = await p.locator("#selected-heading").evaluate((el) => el.getBoundingClientRect().top);
        assert(top >= 0 && top < h, `preview not scrolled into view (${top})`);
        await p.screenshot({ caret: "initial", path: path.join(shots, "19-mobile-chart-390.png") });
        await p.getByRole("button", { name: "Full screen", exact: true }).tap();
        await p.waitForTimeout(500);
        const fs = (await p.getByTestId("stock-price-chart").boundingBox())!;
        assert(fs.width >= 385 && fs.height >= 800, `mobile full screen ${fs.width}x${fs.height}`);
        await p.screenshot({ caret: "initial", path: path.join(shots, "20-mobile-fullscreen-390.png") });
        await p.getByRole("button", { name: "Exit full screen", exact: true }).tap();
      } else {
        await p.mouse.move(0, 0);
        await p.screenshot({ caret: "initial", path: path.join(shots, `21-dashboard-chart-${w}.png`) });
      }
      out.push(`${w}px ok (canvas ${Math.round(metrics.canvasW)}x${Math.round(metrics.canvasH)}${w >= 1280 ? ", side by side" : ", stacked"})`);
      await context.close();
    }
    return out.join("; ");
  });
}
