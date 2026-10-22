import { DatabaseZap, ExternalLink, FileSpreadsheet, ShieldCheck, Terminal } from "lucide-react";

const NSE_PAGE = "https://www.nseindia.com/static/market-data/securities-available-for-trading";

/** Onboarding state when no securities have been imported. */
export function EmptyDirectory() {
  return (
    <section aria-labelledby="onboarding-heading" className="rounded-lg border border-amber-400/30 bg-panel">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-amber-400/30 bg-amber-400/10">
          <DatabaseZap className="size-4 text-amber-300" aria-hidden="true" />
        </span>
        <div>
          <h2 id="onboarding-heading" className="text-base font-semibold tracking-tight">
            The NSE company directory is empty
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">
            MarketPulse does not ship or download company data. Import the official NSE equity lists once and the
            directory, search and company pages will populate from your local database.
          </p>
        </div>
      </div>

      <ol className="grid gap-px bg-line md:grid-cols-3">
        <Step n={1} icon={ExternalLink} title="Download the official files">
          On NSE&rsquo;s{" "}
          <a href={NSE_PAGE} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2 hover:text-accent/80">
            Securities available for trading
            <span className="sr-only"> (opens nseindia.com in a new tab)</span>
          </a>{" "}
          page, download the <strong className="font-medium text-fg">Equity</strong> list (<Code>EQUITY_L.csv</Code>) and the{" "}
          <strong className="font-medium text-fg">SME</strong> list (<Code>SME_EQUITY_L.csv</Code>).
        </Step>
        <Step n={2} icon={FileSpreadsheet} title="Place them in the project">
          Copy both files, unchanged, into <Code>data/nse/</Code> inside the MarketPulse folder. Other lists (ETFs, bonds,
          REITs, InvITs) are not companies and are rejected by the importer.
        </Step>
        <Step n={3} icon={Terminal} title="Run the import">
          <span className="block">From the project folder:</span>
          <code className="mt-2 block rounded-md border border-line bg-bg px-3 py-2 font-mono text-[12px] text-fg">npm run import:nse</code>
          <span className="mt-2 block">Then reload this page. Re-running is safe and never duplicates securities.</span>
        </Step>
      </ol>

      <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-xs text-fg-muted">
        <ShieldCheck className="size-3.5 text-accent" aria-hidden="true" />
        No NSE website is contacted by this app. Files you provide are validated (symbols, names, ISIN check digits, series)
        and every import is logged with its timestamp and row counts.
      </p>
    </section>
  );
}

function Step({ n, icon: Icon, title, children }: { n: number; icon: typeof Terminal; title: string; children: React.ReactNode }) {
  return (
    <li className="bg-panel px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="grid size-5 place-items-center rounded-full bg-accent/15 font-mono text-[11px] font-semibold text-accent">{n}</span>
        <Icon className="size-4 text-fg-muted" aria-hidden="true" />
        <h3 className="text-[13px] font-semibold">{title}</h3>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{children}</p>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-bg px-1 py-0.5 font-mono text-[12px] text-fg">{children}</code>;
}
