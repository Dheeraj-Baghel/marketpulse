import { AlertTriangle, ArrowLeft, Bot, FileText, LineChart, Newspaper } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { FutureSection } from "@/components/company/future-section";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCompanyBySymbol, normaliseSymbolParam } from "@/lib/directory/queries";
import { LocalNseHistoricalProvider } from "@/lib/market-data/local-nse-provider";
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

export const dynamic = "force-dynamic";

async function load(props: PageProps<"/stocks/[symbol]">) {
  const { symbol: raw } = await props.params;
  const symbol = normaliseSymbolParam(raw);
  if (!symbol) notFound();
  return { raw, symbol, company: getCompanyBySymbol(symbol) };
}

export async function generateMetadata(props: PageProps<"/stocks/[symbol]">): Promise<Metadata> {
  const { symbol, company } = await load(props);
  return { title: company ? `${company.symbol} · ${company.name}` : symbol };
}

export default async function StockPage(props: PageProps<"/stocks/[symbol]">) {
  const { raw, symbol, company } = await load(props);
  if (!company) notFound();
  // Canonical upper-case URL (e.g. /stocks/infy -> /stocks/INFY).
  if (decodeURIComponent(raw) !== symbol) permanentRedirect(stockHref(symbol));

  const primary = company.listings[0];
  // Stage 2A: dates of imported history per series. No price values are shown.
  const provider = new LocalNseHistoricalProvider();
  const coverage = company.listings.map((l) => ({ series: l.series, ...provider.coverage(l.id) }));
  const withData = coverage.filter((c) => c.count > 0);

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

      <main id="main" className="mx-auto max-w-[1200px] px-4 pb-12 pt-6 sm:px-6">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-accent">NSE: {company.symbol}</span>
            <Badge variant={company.segment === "SME" ? "sme" : "default"}>{SEGMENT_LABEL[company.segment]}</Badge>
            {primary && primary.instrumentKind !== "EQUITY_SHARE" ? <Badge variant="warn">{INSTRUMENT_LABEL[primary.instrumentKind]}</Badge> : null}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{company.name}</h1>
          {!company.isActive ? (
            <p role="status" className="mt-3 inline-flex items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/[0.06] px-3 py-1.5 text-xs text-amber-200">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              Not present in the latest imported {SEGMENT_LABEL[company.segment]} file. It may have been delisted or moved.
            </p>
          ) : null}
        </header>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
            <Card aria-labelledby="chart-heading" className="flex min-h-56 flex-col">
              <CardHeader>
                <CardTitle id="chart-heading">Price chart</CardTitle>
              </CardHeader>
              <div className="m-4 flex flex-1 flex-col items-center justify-center rounded-md border border-dashed border-line px-6 py-8 text-center chart-grid">
                <LineChart className="size-5 text-fg-muted" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium">Price chart not configured yet</p>
                <p className="mt-1 text-xs text-fg-muted">Charts arrive in a later stage.</p>
                <div data-testid="price-data-status" className="mt-3 text-[11.5px]">
                  {withData.length === 0 ? (
                    <p className="text-fg-muted">Historical price data not available</p>
                  ) : (
                    withData.map((c) => (
                      <p key={c.series} className="text-fg">
                        Historical price data available{coverage.length > 1 ? ` (${c.series})` : ""} — latest trading date:{" "}
                        <time dateTime={c.latest ?? undefined} className="font-medium">
                          {formatIsoDate(c.latest)}
                        </time>
                        <span className="block text-fg-muted">
                          {c.count} trading days from {formatIsoDate(c.earliest)} · NSE CSV import, unadjusted
                        </span>
                      </p>
                    ))
                  )}
                </div>
              </div>
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

        <h2 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">Planned research sections</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <FutureSection icon={Newspaper} title="Recent company news" description="Company announcements and news coverage will appear here once a news source is connected." />
          <FutureSection icon={FileText} title="Annual report" description="The latest annual report and its key sections will be available here in a later stage." />
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
