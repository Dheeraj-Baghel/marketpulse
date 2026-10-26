import { AlertTriangle, ArrowLeft, Bot } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { CompanyChart } from "@/components/company/company-chart";
import { AnnualReports } from "@/components/company/annual-reports";
import { FutureSection } from "@/components/company/future-section";
import { CompanyNews } from "@/components/news/CompanyNews";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { validatePriceResponse, type ValidatedSeries } from "@/lib/charts/candles";
import { getCompanyBySymbol, normaliseSymbolParam } from "@/lib/directory/queries";
import { LocalNseHistoricalProvider } from "@/lib/market-data/local-nse-provider";
import { getPrices } from "@/lib/market-data/price-service";
import { getMarketDataProviders } from "@/lib/market-data/provider";
import { preferredSeries } from "@/lib/market-data/series";
import {
  formatIsoDate,
  formatRupees,
  formatTimestamp,
  INSTRUMENT_LABEL,
  SEGMENT_LABEL,
  SERIES_LABEL,
  stockHref,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { isPublicPreview } from "@/lib/public-preview";
import { PublicPreview } from "@/components/directory/public-preview";

export const dynamic = "force-dynamic";

/** Max time the server waits to pre-render chart data before handing off to the client. */
const SEED_WAIT_MS = 2500;

async function load(props: PageProps<"/stocks/[symbol]">) {
  const { symbol: raw } = await props.params;
  const symbol = normaliseSymbolParam(raw);
  if (!symbol) notFound();
  return { raw, symbol, company: getCompanyBySymbol(symbol) };
}

export async function generateMetadata(props: PageProps<"/stocks/[symbol]">): Promise<Metadata> {
  if (isPublicPreview()) return { title: "Company research unavailable — public preview" };
  const { symbol, company } = await load(props);
  return { title: company ? `${company.symbol} · ${company.name}` : symbol };
}

export default async function StockPage(props: PageProps<"/stocks/[symbol]">) {
  if (isPublicPreview()) {
    return <AppShell active={null}><main id="main" className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6"><PublicPreview /></main></AppShell>;
  }
  const { raw, symbol, company } = await load(props);
  if (!company) notFound();
  // Canonical upper-case URL (e.g. /stocks/infy -> /stocks/INFY).
  if (decodeURIComponent(raw) !== symbol) permanentRedirect(stockHref(symbol));

  const primary = company.listings[0];
  // Chart the series that actually has imported history (else the first one,
  // which then shows the explicit no-data state). Never mixes series.
  const provider = new LocalNseHistoricalProvider();
  const coverage = company.listings.map((l) => ({ series: l.series, ...provider.coverage(l.id) }));
  const chosenSeries = preferredSeries(
    company.listings.map((l) => l.series),
    coverage.filter((c) => c.count > 0).map((c) => c.series),
  );
  const chartListing = company.listings.find((l) => l.series === chosenSeries) ?? primary;

  // Seed the chart through the SAME provider-aware service + validator as
  // /api/prices (NSE Bhavcopy MCP first, local CSV fallback), so there is no
  // duplicated logic. The wait is bounded: if MCP is slow the page renders
  // immediately and the chart loads client-side instead.
  const md = getMarketDataProviders();
  let initialData: ValidatedSeries | null = null;
  if (chartListing) {
    const seed = getPrices(
      // Seed recent data only; the client extends the requested range without
      // blocking first render on the entire five-year upstream traversal.
      { symbol: chartListing.symbol, series: chartListing.series, range: "3M" },
      { provider, mcpHistory: md.config.mcpEnabled ? md.history : null, mcpEnabled: md.config.mcpEnabled },
    )
      .then((body) => validatePriceResponse(body, { symbol: chartListing.symbol, series: chartListing.series }))
      .catch(() => null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    initialData = await Promise.race([seed, new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), SEED_WAIT_MS)))]);
    clearTimeout(timer);
  }
  const quotes = { enabled: md.config.mcpEnabled, autoRefreshMs: md.config.quoteAutoRefreshMs };

  return (
    <AppShell active={null}>
      <div className="border-b border-line">
        <div className="mx-auto flex h-12 max-w-[1200px] items-center px-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to dashboard
          </Link>
        </div>
      </div>

      <main id="main" className="mx-auto max-w-[1200px] px-4 pb-12 pt-5 sm:px-6">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-accent">NSE: {company.symbol}</span>
            <Badge variant={company.segment === "SME" ? "sme" : "default"}>{SEGMENT_LABEL[company.segment]}</Badge>
            {primary && primary.instrumentKind !== "EQUITY_SHARE" ? <Badge variant="warn">{INSTRUMENT_LABEL[primary.instrumentKind]}</Badge> : null}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{company.name}</h1>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-muted">
            <div className="flex gap-1.5">
              <dt>ISIN</dt>
              <dd className="font-mono text-fg">{company.isin}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Segment</dt>
              <dd className="text-fg">{SEGMENT_LABEL[company.segment]}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Series</dt>
              <dd className="font-mono text-fg">{company.listings.map((l) => l.series).join(", ")}</dd>
            </div>
          </dl>
          {!company.isActive ? (
            <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/[0.06] px-3 py-1.5 text-xs text-amber-200">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              Not present in the latest imported {SEGMENT_LABEL[company.segment]} file. It may have been delisted or moved.
            </p>
          ) : null}
        </header>

        {chartListing ? (
          <section aria-label="Historical price chart" className="mt-5 overflow-hidden rounded-lg border border-line">
            <CompanyChart securityId={chartListing.id} symbol={chartListing.symbol} series={chartListing.series} name={company.name} initialData={initialData} quotes={quotes} />
          </section>
        ) : null}

        {/* Stage 3: full-width news beneath the chart; independent request, never blocks the chart. */}
        <div className="mt-4">
          <CompanyNews symbol={company.symbol} companyName={company.name} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card aria-labelledby="identity-heading">
            <CardHeader>
              <CardTitle id="identity-heading">Security identity</CardTitle>
              <span className="text-[11px] text-fg-muted">Source: NSE securities directory</span>
            </CardHeader>
            <CardContent className="py-1">
              <dl className="divide-y divide-line/70 text-[13px]">
                <Row label="Company name" value={company.name} />
                <Row label="NSE symbol" value={company.symbol} mono />
                <Row label="ISIN" value={company.isin} mono />
                <Row label="Listing segment" value={SEGMENT_LABEL[company.segment]} />
                <Row
                  label="Security series"
                  value={company.listings.map((l) => `${l.series} · ${SERIES_LABEL[l.series] ?? "Series as listed by NSE"}`).join("\n")}
                  mono={false}
                />
                {primary ? (
                  <>
                    <Row label="Instrument" value={INSTRUMENT_LABEL[primary.instrumentKind]} />
                    <Row label="Date of listing" value={formatIsoDate(primary.listingDate)} />
                    <Row label="Face value" value={formatRupees(primary.faceValue)} />
                    <Row label="Paid-up value" value={formatRupees(primary.paidUpValue)} />
                    {primary.marketLot !== null ? <Row label="Market lot" value={String(primary.marketLot)} /> : null}
                    <Row label="Directory updated" value={formatTimestamp(primary.importedAt)} />
                  </>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card aria-labelledby="price-data-heading">
              <CardHeader>
                <CardTitle id="price-data-heading">Local CSV import (fallback)</CardTitle>
              </CardHeader>
              <ul data-testid="price-data-status" className="divide-y divide-line/70 text-[13px]">
                {coverage.map((c) => (
                  <li key={c.series} className="px-4 py-2.5">
                    <p className="flex justify-between gap-3">
                      <span className="font-mono font-semibold">{c.series}</span>
                      <span className={c.count > 0 ? "text-fg" : "text-fg-muted"}>
                        {c.count > 0 ? (
                          <>
                            Historical price data available — latest trading date:{" "}
                            <time dateTime={c.latest ?? undefined} className="font-medium">
                              {formatIsoDate(c.latest)}
                            </time>
                          </>
                        ) : (
                          "Historical price data not available"
                        )}
                      </span>
                    </p>
                    {c.count > 0 ? (
                      <p className="mt-0.5 text-right text-[11.5px] text-fg-muted">
                        {c.count} sessions from {formatIsoDate(c.earliest)} · NSE CSV import · unadjusted EOD
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>

            {company.relatedSecurities.length > 0 ? (
              <Card aria-labelledby="related-heading">
                <CardHeader>
                  <CardTitle id="related-heading">Other securities from this issuer</CardTitle>
                </CardHeader>
                <ul className="divide-y divide-line/70 text-[13px]">
                  {company.relatedSecurities.map((s) => (
                    <li key={`${s.segment}-${s.symbol}-${s.series}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <Link href={stockHref(s.symbol)} className="font-mono text-[12.5px] font-semibold text-fg hover:text-accent focus-visible:outline-2">
                        {s.symbol}
                      </Link>
                      <span className="truncate text-xs text-fg-muted">
                        {INSTRUMENT_LABEL[s.instrumentKind]} · {s.series}
                        {!s.isActive ? " · not in latest file" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-line px-4 py-2 text-[11px] text-fg-muted">Matched by the issuer code inside the ISIN.</p>
              </Card>
            ) : null}
          </div>
        </div>

        <h2 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Reports and research</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <AnnualReports symbol={company.symbol} segment={company.segment} />
          <FutureSection icon={Bot} title="AI insights" description="Summaries generated from reports and news will appear here in a later stage." />
        </div>
      </main>
    </AppShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-3 py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={cn("whitespace-pre-line break-words text-fg", mono && "font-mono text-[12.5px]")}>{value}</dd>
    </div>
  );
}
