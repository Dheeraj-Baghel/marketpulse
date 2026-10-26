import { Activity, ArrowUpRight, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { isPublicPreview } from "@/lib/public-preview";

/** Floating editorial navigation. Only real routes are offered, at every size. */
export function AppShell({ active, children }: { active: "dashboard" | null; children: ReactNode }) {
  const preview = isPublicPreview();
  return (
    <div className="min-h-dvh pt-6">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-6 focus:top-6 focus:z-50 focus:rounded-full focus:bg-accent focus:px-6 focus:py-3 focus:text-bg">Skip to content</a>
      <header className="mp-nav relative z-30 mx-auto flex max-w-[1280px] items-center justify-between gap-4 rounded-full bg-white px-6 py-4 sm:px-10">
        <Link href="/" className="flex min-h-11 items-center gap-3 rounded-full focus-visible:outline-2 focus-visible:outline-offset-4">
          <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-fg text-bg"><Activity className="size-6" /></span>
          <span className="text-xl font-medium tracking-[-0.04em]">MarketPulse<span className="text-[#cf4500]">.</span></span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-8">
          <span className="hidden text-sm text-fg-muted md:block">Independent thinking. Informed research.</span>
          <Link href="/" aria-current={active === "dashboard" ? "page" : undefined} className="flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium hover:bg-bg focus-visible:outline-2 focus-visible:outline-offset-4"><LayoutDashboard className="size-4" aria-hidden="true" /><span>Dashboard</span></Link>
        </nav>
      </header>
      {children}
      <footer className="mp-footer mt-16 bg-[#141413] px-6 py-16 text-[#f3f0ee] sm:px-12">
        <div className="mx-auto max-w-[1280px]">
          <p className="mp-eyebrow text-[#d1cdc7]">Research with perspective</p>
          <h2 className="mt-4 max-w-xl text-4xl font-medium leading-tight tracking-[-0.02em]">A clearer view starts with better questions.</h2>
          <div className="mt-10 grid gap-8 border-t border-white/20 pt-8 md:grid-cols-3">
            <div><h3 className="text-sm font-medium">Your workspace</h3><Link href="/" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm text-white/80">{preview ? "Public preview" : "Company directory"} <ArrowUpRight className="size-4" aria-hidden="true" /></Link></div>
            <div><h3 className="text-sm font-medium">Know your sources</h3><p className="mt-3 text-sm leading-relaxed text-white/70">{preview ? "No market data or news is served on this public preview. Data services remain disabled pending public-display licensing." : "Official NSE directory, historical EOD candles and separately labelled delayed quotes. Never presented as live data."}</p></div>
            <div><h3 className="text-sm font-medium">Keep your perspective</h3><p className="mt-3 text-sm leading-relaxed text-white/70">Personal, non-commercial research. Not investment advice. Verify source timestamps before making decisions.</p></div>
          </div>
          <p className="mt-12 border-t border-white/20 pt-6 text-xs text-white/60">MarketPulse · NSE equity research workspace</p>
        </div>
      </footer>
    </div>
  );
}
