import type { ReactNode } from "react";

/** Editorial introduction, followed by the existing functional search/status. */
export function PageHeader({ title, subtitle, search, status }: { title: string; subtitle?: string; search?: ReactNode; status?: ReactNode }) {
  const dashboard = title === "Dashboard";
  return (
    <div className="mp-page-header mx-auto max-w-[1280px] px-6 pb-8 pt-16 sm:px-10">
      <div className="grid items-end gap-8 md:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="mp-eyebrow">{dashboard ? "The research workspace" : "Company research"}</p>
          <h1 className="mt-5 text-[40px] font-medium leading-none tracking-[-0.02em] sm:text-5xl lg:text-[64px]">{dashboard ? <>See the market.<br /><span className="text-fg-muted">Find your perspective.</span></> : title}</h1>
          <span className="sr-only">{dashboard ? title : ""}</span>
        </div>
        <div className="pb-1">
          <p className="max-w-md text-base leading-relaxed text-fg-muted">{dashboard ? "Explore NSE-listed companies, follow historical price movements and put every data point in context." : subtitle}</p>
          {dashboard && subtitle ? <p className="mt-4 text-sm font-medium">{subtitle} · Personal research</p> : null}
        </div>
      </div>
      <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-[40px] border border-line bg-panel p-5 sm:p-6">
        {search ? <div className="w-full md:max-w-lg">{search}</div> : null}
        {status ? <div>{status}</div> : null}
      </div>
    </div>
  );
}
