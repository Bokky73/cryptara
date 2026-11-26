"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/I18nProvider";
import { createFormatters } from "@/i18n/format";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { BarChart3, Table as TableIcon } from "lucide-react";

export type AgentPoint = {
  date: string;
  score: number;
  confidence: number;
  runId: string;
};

export type AgentScoreTrendCardCanvasProps = {
  displayName: string;
  scoreKind: string;
  points: AgentPoint[];
};

function scoreKindColor(kind: string) {
  switch (kind) {
    case "risk": return "#ef4444";
    case "trust": return "#22c55e";
    case "signal": return "#f59e0b";
    case "exposure": return "#8b5cf6";
    case "decision": return "#3b82f6";
    default: return "#6b7280";
  }
}

export function AgentScoreTrendCardCanvas({ displayName, scoreKind, points }: AgentScoreTrendCardCanvasProps) {
  const { locale, timeZone } = useI18n();
  const format = useMemo(() => createFormatters(locale, timeZone), [locale, timeZone]);
  const [viewMode, setViewMode] = useState<"chart" | "table">("chart");
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const listener = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  const chartData = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        label: format.shortDate(p.date),
      })),
    [points, format],
  );

  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-white/50">{displayName}</div>
        <div className="mt-3 text-xs text-white/38">No data points yet.</div>
      </div>
    );
  }

  const latest = points[points.length - 1];
  const color = scoreKindColor(scoreKind);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-white/50">{displayName}</div>
          <div className="text-[11px] text-white/40 capitalize">{scoreKind} assessment</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color }}>{latest.score}/100</span>
          {points.length >= 2 ? (
            <div className="flex items-center rounded-md border border-white/10 bg-black/40 p-0.5 text-[10px]" role="group" aria-label={`${displayName} view mode`}>
              <button
                type="button"
                onClick={() => setViewMode("chart")}
                aria-pressed={viewMode === "chart"}
                className={`rounded px-1.5 py-0.5 transition ${viewMode === "chart" ? "bg-[#d9a441] text-black font-semibold" : "text-white/50 hover:text-white"}`}
                title="View chart"
              >
                <BarChart3 className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("table")}
                aria-pressed={viewMode === "table"}
                className={`rounded px-1.5 py-0.5 transition ${viewMode === "table" ? "bg-[#d9a441] text-black font-semibold" : "text-white/50 hover:text-white"}`}
                title="View table"
              >
                <TableIcon className="h-3 w-3" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {points.length >= 2 ? (
        <div className="mt-3">
          {viewMode === "chart" ? (
            <div>
              <div className="sr-only">
                {displayName} trend showing {points.length} evaluations. Latest score {latest.score} out of 100.
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <ReferenceArea y1={0} y2={33} fill="#10b981" fillOpacity={0.04} />
                  <ReferenceArea y1={66} y2={100} fill="#ef4444" fillOpacity={0.04} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 9, fill: "rgba(255,255,255,0.35)" }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 9, fill: "rgba(255,255,255,0.35)" }}
                    width={20}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const pt = payload[0].payload as AgentPoint & { label: string };
                        return (
                          <div className="rounded-lg border border-white/20 bg-black/90 p-2 text-[11px] shadow-lg backdrop-blur-md">
                            <div className="font-semibold text-white/70">{label}</div>
                            <div className="mt-1 flex items-center justify-between gap-3">
                              <span className="text-white/50">Score:</span>
                              <span className="font-semibold" style={{ color }}>{pt.score}/100</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-white/50">Confidence:</span>
                              <span className="text-emerald-300 font-mono">{Math.round(pt.confidence * 100)}%</span>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={color}
                    strokeWidth={2}
                    dot={{ r: 2, fill: color }}
                    name={displayName}
                    isAnimationActive={!reducedMotion}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="max-h-28 overflow-y-auto">
              <table className="w-full text-left text-[11px]" aria-label={`${displayName} score history`}>
                <thead className="border-b border-white/10 text-white/40">
                  <tr>
                    <th scope="col" className="pb-1">Date</th>
                    <th scope="col" className="pb-1">Score</th>
                    <th scope="col" className="pb-1">Conf</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {chartData.map((p, idx) => (
                    <tr key={idx} className="hover:bg-white/5">
                      <td className="py-1 text-white/60">{p.label}</td>
                      <td className="py-1 font-semibold" style={{ color }}>{p.score}</td>
                      <td className="py-1 text-white/50">{Math.round(p.confidence * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-xs text-white/42">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          Score: {latest.score}/100 &middot; Confidence: {Math.round(latest.confidence * 100)}%
        </div>
      )}
    </div>
  );
}
