import { AlertTriangle, CheckCircle2, DatabaseZap } from "lucide-react";
import type { DirectoryStatus } from "@/lib/directory/queries";
import { formatInt, formatTimestamp, SEGMENT_SHORT } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Compact, read-only import status for the page header. Uses <details> for keyboard-accessible disclosure. */
export function ImportStatus({ status }: { status: DirectoryStatus }) {
  const tone =
    status.state === "ready"
      ? { icon: CheckCircle2, label: "Directory imported", cls: "border-accent/30 text-accent" }
      : status.state === "incomplete"
        ? { icon: AlertTriangle, label: "Directory incomplete", cls: "border-amber-400/40 text-amber-300" }
        : { icon: DatabaseZap, label: "Directory empty", cls: "border-amber-400/40 text-amber-300" };
  const Icon = tone.icon;

  return (
    <details className="group relative shrink-0">
      <summary
        className={cn(
          "flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border bg-panel px-3 text-xs font-medium transition-colors hover:bg-line/50 focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden",
          tone.cls,
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        <span>{tone.label}</span>
        {status.totalSecurities > 0 ? (
          <span className="hidden font-mono tabular text-fg-muted sm:inline">{formatInt(status.totalSymbols)} symbols</span>
        ) : null}
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line bg-panel p-4 text-xs shadow-2xl shadow-black/40">
        <p className="font-medium text-fg">Official NSE securities directory</p>
        <p className="mt-1 text-fg-muted">
          Last import: <span className="text-fg">{formatTimestamp(status.lastImportedAt)}</span>
        </p>
        <dl className="mt-3 divide-y divide-line rounded-md border border-line">
          {status.segments.map((s) => (
            <div key={s.segment} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-3 py-2">
              <dt className="font-medium text-fg">{SEGMENT_SHORT[s.segment]}</dt>
              <dd className={cn("text-right font-mono tabular", s.activeSecurities ? "text-fg" : "text-amber-300")}>
                {s.activeSecurities ? `${formatInt(s.activeSecurities)} securities` : "not imported"}
              </dd>
              {s.lastImport ? (
                <dd className="col-span-2 text-fg-muted">
                  {s.lastImport.fileName} · {formatInt(s.lastImport.rowsTotal)} rows · {formatInt(s.lastImport.rowsInserted)} new ·{" "}
                  {formatInt(s.lastImport.rowsUpdated)} updated · {formatInt(s.lastImport.rowsRejected)} rejected
                  {s.lastImport.rowsDeactivated ? ` · ${formatInt(s.lastImport.rowsDeactivated)} no longer listed` : ""}
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
        {status.state !== "ready" ? (
          <p className="mt-3 text-amber-300">
            {status.state === "empty"
              ? "No securities imported. Results will be empty until you run the import."
              : `Missing ${status.missingSegments.map((s) => SEGMENT_SHORT[s]).join(", ")} list. Search results are incomplete.`}
          </p>
        ) : null}
        <p className="mt-3 text-fg-muted">
          Update with <code className="rounded bg-bg px-1 py-0.5 font-mono text-fg">npm run import:nse</code>
        </p>
      </div>
    </details>
  );
}
