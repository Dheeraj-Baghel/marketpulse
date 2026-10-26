const NSE_ANNUAL_REPORTS_URL = "https://www.nseindia.com/companies-listing/corporate-filings-annual-reports";

/**
 * Mainboard query parameters were verified on NSE's public page. SME tab
 * preselection could not be confirmed from this environment, so SME links use
 * the safe general page and the UI exposes the symbol for manual search.
 */
export function nseAnnualReportsUrl(symbol: string, segment: "MAINBOARD" | "SME"): string {
  const url = new URL(NSE_ANNUAL_REPORTS_URL);
  if (segment === "MAINBOARD") {
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("tabIndex", "equity");
  }
  return url.toString();
}
