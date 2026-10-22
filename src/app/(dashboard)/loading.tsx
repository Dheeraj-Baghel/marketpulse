import { AppShell } from "@/components/layout/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <AppShell active="dashboard">
      <div role="status" aria-label="Loading directory" className="contents">
        <div className="border-b border-line">
          <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 sm:px-6">
            <Skeleton className="mr-auto h-5 w-32" />
            <Skeleton className="hidden h-9 w-[26rem] lg:block" />
            <Skeleton className="h-9 w-36" />
          </div>
        </div>
        <div className="mx-auto grid max-w-[1600px] gap-4 px-4 pt-4 sm:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="rounded-lg border border-line bg-panel">
            <div className="border-b border-line px-4 py-3"><Skeleton className="h-4 w-40" /></div>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="flex h-10 items-center gap-4 border-b border-line/60 px-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 flex-1" style={{ maxWidth: `${55 + ((i * 17) % 35)}%` }} />
              </div>
            ))}
          </div>
          <div className="min-h-[26rem] rounded-lg border border-line bg-panel p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-6 w-2/3" />
            <Skeleton className="mt-6 h-72 w-full" />
          </div>
        </div>
        <span className="sr-only">Loading directory…</span>
      </div>
    </AppShell>
  );
}
