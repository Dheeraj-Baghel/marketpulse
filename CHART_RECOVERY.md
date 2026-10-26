# Hosted chart recovery — AARTIIND

## User report and reproduction

The user supplied a hosted screenshot for **AARTIIND EQ**, showing an NSE upstream
MCP error and a misleading “Historical price data is not available” chart state.
The report was valid: the previous release's successful RELIANCE test did not
prove reliable loading for stocks without local CSV fallback.

Narrow real hosted reproduction (26 October 2026): AARTIIND `range=3M` returned
63 real NSE candles in **1,337 ms**; the old `range=MAX` path took **31,930 ms**.
An intermittent older chunk failure previously discarded the entire in-progress
load. A no-CSV upstream failure was returned as HTTP 200 with zero candles, which
the client treated/cached as no historical data.

## Implemented correction

- **Recent-first chart:** fetch the 3M window first and paint validated candles.
  Extend to the selected 6M/1Y window in the background. Only explicitly choosing
  ALL requests MAX. Short/day filters reuse loaded candles.
- **Bounded server extension:** stop starting older chunks after about 15 seconds
  of work (an in-flight chunk may finish later). Return verified partial data
  with its true date range, incomplete status and explicit retry warning, not an
  invented full-history claim. No unlimited retry loop.
- **Preserve each accepted chunk:** intermediate validated candles are cached
  before the next request. A later failure retains those candles; the cursor is
  retained for a later older-history retry where that warm instance is available.
- **Connection recovery:** a stale session/connection or NSE JSON-RPC `-32000`
  upstream error gets at most one fresh-session retry. Timeouts and rate limits
  are not retried by this recovery path. An old session's close event cannot
  remove a newer replacement from the connection inventory.
- **Honest API errors:** no local CSV + provider outage is a typed retryable
  provider failure, not a successful empty dataset. Actual symbol-not-found and
  series-mismatch responses remain distinct genuine unavailable states.
- **Client recovery:** one bounded recent-load retry for transient 502/503/network
  failures, no rate-limit retry. An unsuccessful extension keeps the chart and
  exposes “Retry loading older data”. A failed first load exposes “Retry”.
- **No stale mixing:** same-symbol/series/provider windows merge without losing
  recent candles. A stale CSV fallback cannot erase newer accepted NSE candles,
  and another security's response cannot enter the current chart/cache.
- **Real bounds:** browser entries expire; empty provider-error responses are
  never cached as valid no-data results. Local CSV ranges still extend to the
  requested window (3M isn't falsely treated as an entire local dataset).
- **Company page seed:** 3M instead of MAX; it no longer launches an unnecessary
  full-history traversal before client rendering.

The dashboard, data sources, quote/news functionality, original local DB and
read-only hosted snapshot otherwise remain unchanged.

## Verification

- Lint, types and **104/104 unit tests** pass, including failure/partial/history
  range regressions and a native loopback MCP client test proving exactly one
  `-32000` reconnection and no rate-limit retry.
- **5/5 native production chart-recovery workflows** pass against intercepted
  synthetic responses: recent canvas before held 1Y; failed extension retention
  and Retry; partial ALL and Retry; failed first chunk/error/not empty; and
  company-switch isolation. These are explicitly synthetic, not live data proof.
- **5/5 real hosted reported-stock workflows** pass on the deployed fix with no
  mocked providers: AARTIIND recent-first paint, day/month/year controls, explicit
  ALL with truthful partial status, AARTIDRUGS, and fresh phone-sized AARTIIND.
  Source badges are NSE Bhavcopy and canvases contain real rendered candles.
- Measured whole-page first-chart paints in the final hosted run: AARTIIND
  **8,238 ms**, AARTIDRUGS **1,484 ms**, phone-sized AARTIIND **1,684 ms**. These
  are observed cold/warm laboratory samples, not a latency SLA or every-stock
  availability guarantee. No page errors were recorded.
- Hosted AARTIIND ALL screenshot was visually inspected: real candles/volume
  remained visible and a partial-history warning/Retry was present. ALL is not
  falsely represented as complete if an older request did not finish.

Local-only evidence is under `artifacts/testing/chart-recovery/`: before API
responses, unit/cloud logs, synthetic browser run, real hosted results and captures.
Run `npx tsx tests/e2e/chart-recovery.mts` against an owned local production server
with providers disabled; run `npx tsx tests/e2e/aartiind-hosted.mts` manually only
for real provider verification (it consumes NSE traffic).

The older full browser suite had two immediate-final-data assertions that did
not wait for the new progressive window to finish. They now await the exact
expected final candle count before comparing values. Its outage check now asserts
that newer accepted NSE candles remain visible while the API CSV fallback remains
truthfully labelled, and that no-fallback outages return retryable failures.
The initial superseded full-suite attempts were stopped before rerunning the
updated assertions. The broader suite also caught a genuine metadata bug: a
complete server cache can return a sliced 3M response, which is not complete
client history. Client coverage now checks the response's reported beginning
against the actually loaded candles; a unit regression covers this condition.
This is not a claim that old test failures were ignored. A later 42/43 run found
that the quote-outage check assumed the quote TTL had expired while history
loaded. Faster charts make that assumption invalid; the check now explicitly
refreshes the quote before asserting its stale/error state, rather than waiting
out a cache TTL. The real quote/data implementation was not weakened for the test.

## Remaining limits

NSE can still be unavailable or slow. The correction bounds work, preserves real
accepted data and offers meaningful recovery; it does not guarantee upstream
uptime or complete five-year history in one request. Serverless caches are
per-instance, so a retry may land on a different cache and take longer. Physical
phones, other browsers and sustained traffic remain manual checks. No substitute
feed, fabricated data, scraping bypass or paid service was added.
