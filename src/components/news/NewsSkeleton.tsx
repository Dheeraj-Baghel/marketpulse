import { Skeleton } from "@/components/ui/skeleton";

/** 4 text-row placeholders shown during the first fetch only. */
export function NewsSkeleton() {
  return (
    <div role="status" aria-label="Loading recent news" data-testid="news-loading" className="divide-y divide-line/70">
      {[0.92, 0.78, 0.86, 0.7].map((w, i) => (
        <div key={i} className="py-3.5">
          <Skeleton className="h-4" style={{ width: `${w * 100}%` }} />
          <Skeleton className="mt-2 h-3 w-40" />
          <Skeleton className="mt-2 h-3 w-full opacity-60" />
        </div>
      ))}
      <span className="sr-only">Loading recent news…</span>
    </div>
  );
}
