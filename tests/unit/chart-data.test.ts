/**
 * Stage 2B chart data-layer tests (pure functions; no browser).
 *
 * SYNTHETIC TEST FIXTURES: the candle values below are invented, round
 * numbers used only to exercise validation, slicing and formatting. They are
 * never written to the database or shown in the app.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatInr,
  formatSessionDate,
  minusMonths,
  previousSessionChange,
  PriceResponseError,
  rangeAvailability,
  sliceRange,
  timeToIso,
  validatePriceResponse,
  type ChartCandle,
} from "../../src/lib/charts/candles";

const meta = {
  symbol: "TESTCO",
  series: "EQ",
  name: "Synthetic Test Company",
  isin: "INE000T01019",
  segment: "MAINBOARD",
  currency: "INR",
  interval: "1d",
  source: "NSE historical CSV import",
  dataMode: "HISTORICAL_EOD",
  adjustmentStatus: "UNADJUSTED",
  range: "MAX",
  latestTradingDate: "2026-10-21",
  earliestTradingDate: "2026-10-19",
};
const c = (date: string, o: number, h: number, l: number, cl: number, volume: number | null = 1000) => ({ date, open: o, high: h, low: l, close: cl, volume });

describe("validatePriceResponse", () => {
  test("accepts valid ascending candles and maps to business-day strings", () => {
    const v = validatePriceResponse({ ...meta, candles: [c("2026-10-19", 100, 110, 90, 105), c("2026-10-20", 105, 106, 100, 101, null), c("2026-10-21", 101, 120, 101, 120)] }, { symbol: "TESTCO", series: "EQ" });
    assert.deepEqual(v.candles.map((x) => x.time), ["2026-10-19", "2026-10-20", "2026-10-21"]);
    assert.equal(v.dropped.length, 0);
    assert.equal(v.hasVolume, true);
    assert.equal(v.candles[1]?.volume, null); // missing stays null, never 0
  });

  test("rejects a response for a different security or series", () => {
    assert.throws(() => validatePriceResponse({ ...meta, candles: [] }, { symbol: "OTHER", series: "EQ" }), PriceResponseError);
    assert.throws(() => validatePriceResponse({ ...meta, candles: [] }, { symbol: "TESTCO", series: "BE" }), /BE was requested/);
    assert.throws(() => validatePriceResponse({ ...meta, dataMode: "LIVE", candles: [] }, { symbol: "TESTCO", series: "EQ" }), /not daily historical/);
    assert.throws(() => validatePriceResponse(null, { symbol: "TESTCO", series: "EQ" }), /not an object/);
  });

  test("drops invalid, duplicate and unsorted candles instead of repairing them", () => {
    const v = validatePriceResponse(
      {
        ...meta,
        candles: [
          c("2026-10-19", 100, 110, 90, 105),
          c("2026-10-19", 100, 110, 90, 105), // duplicate date
          c("2026-10-18", 100, 110, 90, 105), // out of order
          c("2026-02-30", 100, 110, 90, 105), // impossible date
          c("2026-10-20", 0, 110, 90, 105), // non-positive
          c("2026-10-21", 100, 80, 90, 85), // high < low
          c("2026-10-22", 120, 110, 90, 105), // open outside range
          c("2026-10-23", 100, 110, 90, 105, -5), // negative volume
          c("2026-10-24", 100, 110, 90, 105),
        ],
      },
      { symbol: "TESTCO", series: "EQ" },
    );
    assert.deepEqual(v.candles.map((x) => x.time), ["2026-10-19", "2026-10-24"]);
    assert.equal(v.dropped.length, 7);
  });

  test("hasVolume is false when no candle reports volume", () => {
    const v = validatePriceResponse({ ...meta, candles: [c("2026-10-19", 100, 110, 90, 105, null)] }, { symbol: "TESTCO", series: "EQ" });
    assert.equal(v.hasVolume, false);
  });
});

describe("ranges", () => {
  const days = (dates: string[]): ChartCandle[] => dates.map((d) => ({ time: d, open: 100, high: 110, low: 90, close: 100, volume: 1 }));

  test("minusMonths clamps month ends without timezone math", () => {
    assert.equal(minusMonths("2026-03-31", 1), "2026-02-28");
    assert.equal(minusMonths("2024-03-31", 1), "2024-02-29");
    assert.equal(minusMonths("2026-01-15", 1), "2025-12-15");
    assert.equal(minusMonths("2026-10-21", 12), "2025-10-21");
  });

  test("sliceRange is anchored on the last stored session and never fills gaps", () => {
    const data = days(["2025-10-23", "2026-02-01", "2026-09-21", "2026-09-22", "2026-10-21"]);
    assert.deepEqual(sliceRange(data, "1M").candles.map((x) => x.time), ["2026-09-22", "2026-10-21"]);
    assert.equal(sliceRange(data, "1Y").candles.length, 5);
    assert.equal(sliceRange(data, "ALL").candles.length, 5);
    assert.deepEqual(sliceRange([], "1M"), { candles: [], from: null, to: null });
  });

  test("rangeAvailability flags windows longer than the stored history", () => {
    // ~1 year of sessions starting 2025-10-23, last 2026-10-21 (mirrors the real imported coverage)
    const data = days(["2025-10-23", "2026-01-02", "2026-06-01", "2026-09-22", "2026-10-21"]);
    const r = rangeAvailability(data);
    assert.equal(r["1M"].covered, true);
    assert.equal(r["6M"].covered, true);
    assert.equal(r["1Y"].covered, true); // cutoff 2025-10-21 is 2 days before the first session
    const short = rangeAvailability(days(["2026-08-01", "2026-10-21"]));
    assert.equal(short["1Y"].covered, false);
    assert.equal(short["1Y"].available, true);
    assert.equal(short["1M"].covered, true);
  });
});

describe("header metrics and formatting", () => {
  test("change vs previous session uses exact scaled arithmetic", () => {
    const ch = previousSessionChange([
      { time: "2026-10-19", open: 1, high: 2000, low: 1, close: 1202.0, volume: null },
      { time: "2026-10-21", open: 1, high: 2000, low: 1, close: 1209.0, volume: null },
    ]);
    assert.equal(ch?.abs, 7);
    assert.equal(ch?.previousDate, "2026-10-19");
    assert.equal(ch?.pct.toFixed(2), "0.58");
    assert.equal(previousSessionChange([{ time: "2026-10-21", open: 1, high: 1, low: 1, close: 1, volume: null }]), null);
  });

  test("session dates never shift with timezone", () => {
    const original = process.env.TZ;
    for (const tz of ["America/Los_Angeles", "Asia/Kolkata", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      assert.equal(formatSessionDate("2026-02-01"), "Sun, 01 Feb 2026");
      assert.equal(formatSessionDate("2026-10-21", false), "21 Oct 2026");
    }
    process.env.TZ = original;
    assert.equal(timeToIso({ year: 2026, month: 2, day: 1 }), "2026-02-01");
    assert.equal(timeToIso("2026-02-01"), "2026-02-01");
  });

  test("INR formatting uses Indian grouping and keeps stored precision", () => {
    assert.equal(formatInr(1209), "₹1,209.00");
    assert.equal(formatInr(123456.78), "₹1,23,456.78");
    assert.equal(formatInr(1450.0525), "₹1,450.0525");
  });
});
