"use client";

import { useMemo, useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceArea,
} from "recharts";
import { BarChart3, Table as TableIcon } from "lucide-react";

type TrendPoint = {
  date: string;
  buyRisk: number;
  confidence: number;
};

type TrendChartProps = {
  data: TrendPoint[];
  loading?: boolean;
  error?: string | null;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function TrendChart({ data, loading, error }: TrendChartProps) {
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  const chartData = useMemo(
    () =>
      data.map((p) => ({
        ...p,
        label: formatDate(p.date),
      })),
    [data],
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg bg-white/5 text-sm text-white/42" role="status">
        Loading trend data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-red-300/20 bg-red-500/5 text-sm text-red-200/70" role="alert">
        {error}
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg bg-white/5 text-sm text-white/42">
        No trend data yet. Run token scans to populate.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white/90">Buy Risk &amp; Confidence Over Time</h3>
          <p className="mt-0.5 text-xs text-white/46">Historical evaluation trajectories with calibrated risk threshold bands.</p>
        </div>

        {/* Segmented View Mode Toggle */}
        <div className="flex items-center rounded-lg border border-white/10 bg-black/40 p-1 text-xs" role="group" aria-label="Chart view mode">
          <button
            type="button"
            onClick={() => setViewMode("chart")}
            aria-pressed={viewMode === "chart"}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
              viewMode === "chart" ? "bg-[#d9a441] text-black font-semibold shadow-sm" : "text-white/60 hover:text-white"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Chart
          </button>
          <button
            type="button"
            onClick={() => setViewMode("table")}
            aria-pressed={viewMode === "table"}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition ${
              viewMode === "table" ? "bg-[#d9a441] text-black font-semibold shadow-sm" : "text-white/60 hover:text-white"
            }`}
          >
            <TableIcon className="h-3.5 w-3.5" />
            Data Table
          </button>
        </div>
      </div>

      {viewMode === "chart" ? (
        <div className="relative">
          <div className="sr-only">
            Risk score chart showing {data.length} snapshots. Latest score: {data[data.length - 1]?.buyRisk}%, confidence: {data[data.length - 1]?.confidence}%. Use data table view for accessible tabular data.
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              {/* Reference Risk Bands */}
              <ReferenceArea y1={0} y2={25} fill="#10b981" fillOpacity={0.06} />
              <ReferenceArea y1={25} y2={50} fill="#f59e0b" fillOpacity={0.06} />
              <ReferenceArea y1={50} y2={100} fill="#ef4444" fillOpacity={0.07} />

              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 11, fill: "rgba(255,255,255,0.45)" }}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const buyRisk = Number(payload.find((p) => p.dataKey === "buyRisk")?.value ?? 0);
                    const confidence = Number(payload.find((p) => p.dataKey === "confidence")?.value ?? 0);
                    const zone = buyRisk >= 50 ? "High Risk" : buyRisk >= 25 ? "Medium Risk" : "Low Risk";
                    const zoneColor = buyRisk >= 50 ? "text-red-400" : buyRisk >= 25 ? "text-amber-400" : "text-emerald-400";

                    return (
                      <div className="rounded-xl border border-white/20 bg-black/90 p-3 shadow-xl backdrop-blur-md text-xs">
                        <div className="font-semibold text-white/80">{label}</div>
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-red-300">Buy Risk:</span>
                            <span className="font-mono font-semibold text-white">{buyRisk}%</span>
                          </div>
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-emerald-300">Confidence:</span>
                            <span className="font-mono font-semibold text-white">{confidence}%</span>
                          </div>
                          <div className="mt-1 pt-1 border-t border-white/10 flex items-center justify-between gap-4">
                            <span className="text-white/46">Zone:</span>
                            <span className={`font-semibold ${zoneColor}`}>{zone}</span>
                          </div>
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "rgba(255,255,255,0.6)", paddingTop: 8 }}
              />
              <Line
                type="monotone"
                dataKey="buyRisk"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 3, fill: "#ef4444" }}
                name="Buy Risk"
                isAnimationActive={!reducedMotion}
              />
              <Line
                type="monotone"
                dataKey="confidence"
                stroke="#22c55e"
                strokeWidth={2}
                dot={{ r: 3, fill: "#22c55e" }}
                name="Confidence"
                isAnimationActive={!reducedMotion}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" aria-label="Risk and confidence trajectory table">
            <thead className="border-b border-white/10 text-white/50">
              <tr>
                <th scope="col" className="pb-2 font-medium">Date</th>
                <th scope="col" className="pb-2 font-medium">Buy Risk</th>
                <th scope="col" className="pb-2 font-medium">Confidence</th>
                <th scope="col" className="pb-2 font-medium">Risk Band</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {chartData.map((row, i) => {
                const band = row.buyRisk >= 50 ? "High" : row.buyRisk >= 25 ? "Medium" : "Low";
                const bandTone = row.buyRisk >= 50 ? "text-red-300" : row.buyRisk >= 25 ? "text-amber-300" : "text-emerald-300";
                return (
                  <tr key={i} className="hover:bg-white/5">
                    <td className="py-2 font-mono text-white/80">{row.label}</td>
                    <td className="py-2 font-mono text-red-300 font-semibold">{row.buyRisk}%</td>
                    <td className="py-2 font-mono text-emerald-300">{row.confidence}%</td>
                    <td className={`py-2 font-medium ${bandTone}`}>{band}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}