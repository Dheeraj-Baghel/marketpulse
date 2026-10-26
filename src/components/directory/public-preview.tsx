import { ExternalLink, ShieldCheck } from "lucide-react";

/** Public hosting is available; NSE redistribution permission is not established. */
export function PublicPreview() {
  return (
    <section aria-labelledby="public-preview-heading" className="rounded-[40px] border border-line bg-panel p-6 sm:p-10">
      <p className="mb-5 text-xs font-semibold uppercase tracking-[0.16em] text-fg-muted">Public preview · Data services disabled</p>
      <h2 id="public-preview-heading" className="max-w-3xl text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
        MarketPulse is online.<br />Market data isn&rsquo;t enabled here.
      </h2>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-fg-muted">
        This is a public preview of the research workspace, not a functioning stock-data service.
        The NSE company directory, prices, delayed quotes and company news are unavailable on this deployment.
      </p>
      <div className="mt-8 grid gap-6 border-t border-line pt-6 md:grid-cols-2">
        <div>
          <h3 className="text-base font-semibold">Why data is unavailable</h3>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            Public-display licensing has not been established. The existing local database and provider keys have
            not been uploaded, and this preview makes no market-data or news-provider requests.
          </p>
        </div>
        <div>
          <h3 className="text-base font-semibold">What remains to be enabled</h3>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            A data licence covering public website display, an approved news plan, and a hosting-compatible
            data store are required before directory search, charts and company research can be made available.
          </p>
        </div>
      </div>
      <a className="mt-7 inline-flex items-center gap-2 rounded-full border border-line px-5 py-3 text-sm font-medium text-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
        href="https://www.nseindia.com/static/nse-terms-of-use" target="_blank" rel="noopener noreferrer">
        Read NSE&rsquo;s Terms of Use <ExternalLink className="size-4" aria-hidden="true" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <p className="mt-8 flex items-start gap-2 text-xs leading-relaxed text-fg-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        No fabricated prices, invented companies or fake news. This preview is not investment advice.
      </p>
    </section>
  );
}
