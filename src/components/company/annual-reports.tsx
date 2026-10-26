import { ArrowUpRight, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { nseAnnualReportsUrl } from "@/lib/annual-reports";

export function AnnualReports({ symbol, segment }: { symbol: string; segment: "MAINBOARD" | "SME" }) {
  return (
    <Card aria-labelledby="annual-reports-heading">
      <CardHeader className="justify-start">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-bg text-fg">
          <FileText className="size-5" />
        </span>
        <CardTitle id="annual-reports-heading" className="text-base">Annual Reports</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 py-4">
        <p className="text-sm leading-relaxed text-fg-muted">
          Browse annual reports and filings for this company on the official National Stock Exchange website. NSE may show no records; search manually for {symbol} if the symbol filter is not retained.
        </p>
        <a
          href={nseAnnualReportsUrl(symbol, segment)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-fg px-5 text-sm font-medium text-bg focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          View Annual Reports on NSE
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </a>
      </CardContent>
    </Card>
  );
}
