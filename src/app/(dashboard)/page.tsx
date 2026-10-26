import { AlertTriangle } from "lucide-react";
import { Suspense } from "react";
import { DirectoryNavigationProvider } from "@/components/directory/directory-navigation";
import { DirectorySearch } from "@/components/directory/directory-search";
import { DirectoryWorkspace } from "@/components/directory/directory-workspace";
import { EmptyDirectory } from "@/components/directory/empty-directory";
import { ImportStatus } from "@/components/directory/import-status";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/layout/page-header";
import { getDirectoryPage, getDirectoryStatus, parseDirectoryQuery } from "@/lib/directory/queries";
import { readMarketDataConfig } from "@/lib/market-data/provider";
import { SEGMENT_SHORT } from "@/lib/format";
import { isPublicPreview } from "@/lib/public-preview";
import { PublicPreview } from "@/components/directory/public-preview";

// Reads the local SQLite directory on every request (it changes after imports).
export const dynamic = "force-dynamic";

export default async function DashboardPage(props: PageProps<"/">) {
  if (isPublicPreview()) {
    return (
      <AppShell active="dashboard">
        <PageHeader title="MarketPulse" subtitle="Public preview — data services disabled" />
        <main id="main" className="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-4 sm:px-6">
          <PublicPreview />
        </main>
      </AppShell>
    );
  }
  const params = await props.searchParams;
  const query = parseDirectoryQuery(params);
  const status = getDirectoryStatus();
  const page = status.state === "empty" ? null : getDirectoryPage(query);
  const selectedParam = typeof params.selected === "string" ? params.selected : null;
  // Stage 2C: only these two non-secret values reach the browser.
  const md = readMarketDataConfig();
  const quotes = { enabled: md.mcpEnabled, autoRefreshMs: md.quoteAutoRefreshMs };

  return (
    <AppShell active="dashboard">
      <Suspense>
        <DirectoryNavigationProvider>
          <PageHeader
            title="Dashboard"
            subtitle="NSE listed companies"
            search={<DirectorySearch key={status.state} initialQuery={query.q} disabled={status.state === "empty"} />}
            status={<ImportStatus status={status} />}
          />
          <main id="main" className="mx-auto w-full max-w-[1600px] px-4 pb-10 pt-4 sm:px-6">
            {status.state === "incomplete" ? (
              <div role="status" className="mb-4 flex items-start gap-2.5 rounded-md border border-amber-400/30 bg-amber-400/[0.06] px-4 py-2.5 text-xs text-amber-200">
                <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-300" aria-hidden="true" />
                <p>
                  Directory incomplete: the {status.missingSegments.map((s) => SEGMENT_SHORT[s]).join(" and ")} list has not been
                  imported, so companies from that segment are missing. Add the file to <code className="font-mono">data/nse/</code> and run{" "}
                  <code className="font-mono">npm run import:nse</code>.
                </p>
              </div>
            ) : null}
            {page ? (
              <DirectoryWorkspace page={page} query={query.q} segment={query.segment} initialSelected={selectedParam} quotes={quotes} />
            ) : (
              <EmptyDirectory />
            )}
          </main>
        </DirectoryNavigationProvider>
      </Suspense>
    </AppShell>
  );
}
