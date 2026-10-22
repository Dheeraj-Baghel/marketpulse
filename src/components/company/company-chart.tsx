"use client";

import { useState } from "react";
import { StockPriceChart } from "@/components/charts/StockPriceChart";
import type { ChartMode, ChartRange, ValidatedSeries } from "@/lib/charts/candles";

/** Details-page chart: same StockPriceChart as the dashboard, with its own range/mode state. */
export function CompanyChart(props: {
  securityId: number;
  symbol: string;
  series: string;
  name: string;
  initialData: ValidatedSeries | null;
  quotes: { enabled: boolean; autoRefreshMs: number };
}) {
  const [range, setRange] = useState<ChartRange>("1Y");
  const [mode, setMode] = useState<ChartMode>("candles");
  return (
    <StockPriceChart
      {...props}
      range={range}
      onRangeChange={setRange}
      mode={mode}
      onModeChange={setMode}
      variant="full"
      className="h-[34rem] sm:h-[38rem]"
    />
  );
}
