import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <AppShell active={null}>
      <main id="main" className="grid min-h-[70dvh] place-items-center px-6">
        <div className="max-w-md text-center">
          <SearchX className="mx-auto size-6 text-fg-muted" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-semibold">Security not found</h1>
          <p className="mt-1 text-sm text-fg-muted">
            No security with this NSE symbol is in the imported directory. The symbol may be misspelt, delisted, or from a list that
            has not been imported.
          </p>
          <Link href="/" className={`${buttonVariants({ variant: "outline" })} mt-5`}>
            <ArrowLeft aria-hidden="true" /> Back to dashboard
          </Link>
        </div>
      </main>
    </AppShell>
  );
}
