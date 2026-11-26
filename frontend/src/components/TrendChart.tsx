"use client";

import dynamic from "next/dynamic";
import type { TrendChartCanvasProps } from "./charts/TrendChartCanvas";

export type TrendChartProps = TrendChartCanvasProps;

const LazyTrendChartCanvas = dynamic(() => import("./charts/TrendChartCanvas").then((module) => module.TrendChartCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center rounded-lg bg-white/5 text-sm text-white/42" role="status" aria-live="polite">
      Loading trend chart...
    </div>
  ),
});

export function TrendChart(props: TrendChartProps) {
  if (props.loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg bg-white/5 text-sm text-white/42" role="status">
        Loading trend data...
      </div>
    );
  }

  if (props.error) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-red-300/20 bg-red-500/5 text-sm text-red-200/70" role="alert">
        {props.error}
      </div>
    );
  }

  if (props.data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg bg-white/5 text-sm text-white/42">
        No trend data yet. Run token scans to populate.
      </div>
    );
  }

  return <LazyTrendChartCanvas {...props} />;
}
