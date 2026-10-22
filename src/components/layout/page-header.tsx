import type { ReactNode } from "react";

/** Page title row with optional search and status slots; wraps on narrow screens. */
export function PageHeader({ title, subtitle, search, status }: { title: string; subtitle?: string; search?: ReactNode; status?: ReactNode }) {
  return (
    <div className="border-b border-line bg-bg/90 backdrop-blur lg:sticky lg:top-0 lg:z-20">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6 lg:h-14 lg:flex-nowrap lg:py-0">
        <div className="mr-auto min-w-0">
          <h1 className="text-[17px] font-semibold leading-tight tracking-tight">{title}</h1>
          {subtitle ? <p className="text-xs text-fg-muted">{subtitle}</p> : null}
        </div>
        {status ? <div className="order-2 lg:order-3">{status}</div> : null}
        {search ? <div className="order-3 w-full lg:order-2 lg:w-[26rem]">{search}</div> : null}
      </div>
    </div>
  );
}
