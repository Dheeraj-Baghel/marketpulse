import { AlertTriangle, KeyRound, Newspaper, RefreshCw, Timer } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type NewsMessageKind = "empty" | "not-configured" | "quota-exhausted" | "rate-limited" | "unavailable" | "error";

const COPY: Record<NewsMessageKind, { icon: LucideIcon; title: string; tone: "muted" | "warn" | "error" }> = {
  empty: { icon: Newspaper, title: "No matching company news found in the previous 14 days.", tone: "muted" },
  "not-configured": { icon: KeyRound, title: "News provider not configured.", tone: "warn" },
  "quota-exhausted": { icon: Timer, title: "Daily news API limit reached. Previously retrieved articles are shown where available.", tone: "warn" },
  "rate-limited": { icon: Timer, title: "News refresh is temporarily unavailable because the provider limit has been reached.", tone: "warn" },
  unavailable: { icon: AlertTriangle, title: "Unable to fetch recent news.", tone: "error" },
  error: { icon: AlertTriangle, title: "Unable to fetch recent news.", tone: "error" },
};

/** Informative non-article states. Never shown as "no news exists". */
export function NewsEmptyState({ kind, detail, onRetry, windowDays = 14 }: { kind: NewsMessageKind; detail?: string | null; onRetry?: () => void; windowDays?: number }) {
  const c = COPY[kind];
  const Icon = c.icon;
  const title = kind === "empty" ? `No matching company news found in the previous ${windowDays} days.` : c.title;
  return (
    <div data-testid="news-message" data-kind={kind} role={c.tone === "error" ? "alert" : "status"} className="flex flex-col items-center px-4 py-8 text-center">
      <span className={cn("grid size-9 place-items-center rounded-full border bg-bg/70", c.tone === "error" ? "border-red-400/30" : c.tone === "warn" ? "border-amber-400/30" : "border-line")}>
        <Icon className={cn("size-4", c.tone === "error" ? "text-red-300" : c.tone === "warn" ? "text-amber-300" : "text-fg-muted")} aria-hidden="true" />
      </span>
      <p className="mt-3 max-w-md text-sm font-medium text-fg">{title}</p>
      {kind === "empty" ? (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-fg-muted">
          No matching articles found by this news provider in the last {windowDays} days. This does not mean no news exists — coverage of
          smaller and SME companies is limited.
        </p>
      ) : null}
      {kind === "not-configured" ? (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-fg-muted">
          Add a free GNews key as <code className="rounded bg-bg px-1 font-mono text-fg">GNEWS_API_KEY=…</code> in{" "}
          <code className="rounded bg-bg px-1 font-mono text-fg">.env.local</code> (never in <code className="font-mono">.env.example</code>), then restart{" "}
          <code className="font-mono">npm run dev</code>. Keys: gnews.io.
        </p>
      ) : null}
      {detail && kind !== "empty" && kind !== "not-configured" ? <p className="mt-1 max-w-md text-xs text-fg-muted">{detail}</p> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-3 py-1.5 text-xs font-medium text-fg hover:bg-line/50 focus-visible:outline-2"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Retry
        </button>
      ) : null}
    </div>
  );
}
