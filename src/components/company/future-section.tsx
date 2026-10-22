import type { LucideIcon } from "lucide-react";

/**
 * Non-interactive placeholder for a research section planned for a later
 * stage. Deliberately contains no buttons or links.
 */
export function FutureSection({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <section aria-label={`${title} (not available yet)`} className="rounded-lg border border-dashed border-line bg-panel/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-fg-muted" aria-hidden="true" />
          <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
        </div>
        <span className="rounded border border-line px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-fg-muted">Not available yet</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-fg-muted">{description}</p>
    </section>
  );
}
