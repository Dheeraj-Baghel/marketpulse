import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { nseAnnualReportsUrl } from "../../src/lib/annual-reports";

const BASE = "https://www.nseindia.com/companies-listing/corporate-filings-annual-reports";

describe("NSE annual-report links", () => {
  for (const symbol of ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ITC"]) {
    test(`${symbol} uses the verified equity symbol filter`, () => {
      const url = new URL(nseAnnualReportsUrl(symbol, "MAINBOARD"));
      assert.equal(url.origin + url.pathname, BASE);
      assert.equal(url.searchParams.get("symbol"), symbol);
      assert.equal(url.searchParams.get("tabIndex"), "equity");
    });
  }

  test("SME uses the safe general-page fallback", () => {
    assert.equal(nseAnnualReportsUrl("RAVITA", "SME"), BASE);
  });
});
