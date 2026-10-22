import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Application frame: fixed sidebar on desktop, compact top bar on tablet/mobile.
 * Navigation is intentionally limited to the pages that exist in Stage 1.
 */
export function AppShell({ active, children }: { active: "dashboard" | null; children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:pl-[220px]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-bg"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[220px] flex-col border-r border-line bg-sidebar lg:flex">
        <Brand className="h-14 border-b border-line px-5" />
        <nav aria-label="Primary" className="flex-1 px-3 py-4">
          <p className="px-2 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-muted/70">Research</p>
          <NavLink href="/" active={active === "dashboard"} />
        </nav>
        <div className="border-t border-line px-5 py-4 text-[11px] leading-relaxed text-fg-muted/80">
          Directory data: NSE &ldquo;Securities available for trading&rdquo; files, imported locally.
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b border-line bg-sidebar/95 px-4 backdrop-blur lg:hidden">
        <Brand />
        <nav aria-label="Primary">
          <NavLink href="/" active={active === "dashboard"} compact />
        </nav>
      </header>

      {children}
    </div>
  );
}

function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2", className)}>
      <Mark />
      <span className="text-[15px] font-semibold tracking-tight text-fg">
        Market<span className="text-accent">Pulse</span>
      </span>
    </Link>
  );
}

/** Static logomark (a pulse line), not a data visualisation. */
function Mark() {
  return (
    <span aria-hidden="true" className="grid size-7 place-items-center rounded-md border border-accent/30 bg-accent/10">
      <svg viewBox="0 0 20 20" className="size-4 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 11h3.5l2-5 3.5 9 2.5-6H18" />
      </svg>
    </span>
  );
}

function NavLink({ href, active, compact = false }: { href: string; active: boolean; compact?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
        compact ? "h-8 px-2.5" : "h-9 px-2.5",
        active ? "bg-panel text-fg shadow-[inset_2px_0_0_var(--color-accent)]" : "text-fg-muted hover:bg-panel/60 hover:text-fg",
      )}
    >
      <LayoutDashboard className={cn("size-4", active ? "text-accent" : "")} aria-hidden="true" />
      Dashboard
    </Link>
  );
}
