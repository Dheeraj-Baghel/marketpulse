"use client";

import { AlertOctagon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Route error boundary, e.g. the SQLite file is locked or unreadable. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6">
      <div role="alert" className="max-w-md rounded-lg border border-red-400/30 bg-panel p-6">
        <AlertOctagon className="size-5 text-red-300" aria-hidden="true" />
        <h1 className="mt-3 text-base font-semibold">The company directory could not be loaded</h1>
        <p className="mt-1 text-sm text-fg-muted">
          MarketPulse could not read its local database. Check that <code className="font-mono">data/marketpulse.sqlite</code> is
          readable and not locked by another process, then retry.
        </p>
        {error.digest ? <p className="mt-2 font-mono text-[11px] text-fg-muted">Reference: {error.digest}</p> : null}
        <Button className="mt-4" variant="outline" onClick={reset}>
          <RotateCcw aria-hidden="true" /> Retry
        </Button>
      </div>
    </main>
  );
}
