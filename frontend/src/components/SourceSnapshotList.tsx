"use client";

import Link from "next/link";
import type { SourceSnapshotDetail } from "@/server/types";
import { AlertCircle, CheckCircle2, Clock, ExternalLink, WifiOff } from "lucide-react";

type SourceSnapshotListProps = {
  snapshots: SourceSnapshotDetail[];
  loading?: boolean;
  error?: string | null;
};

function statusColor(status: string) {
  switch (status) {
    case "connected":
      return "bg-emerald-400";
    case "mock":
      return "bg-amber-400";
    case "unavailable":
      return "bg-red-400";
    default:
      return "bg-gray-400";
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "connected":
      return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
    case "mock":
      return "border-amber-400/30 bg-amber-400/10 text-amber-200";
    case "unavailable":
      return "border-red-400/30 bg-red-400/10 text-red-200";
    default:
      return "border-white/10 bg-white/5 text-white/50";
  }
}

export function SourceSnapshotList({ snapshots, loading, error }: SourceSnapshotListProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/42">
        Loading source snapshots...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-300/20 bg-red-500/10 p-4 text-sm text-red-200">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4" />
          Source Query Failed
        </div>
        <p className="mt-1 text-xs text-red-200/80">{error}</p>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/42">
        No source snapshots recorded for this run.
      </div>
    );
  }

  const connectedCount = snapshots.filter((s) => s.status === "connected").length;
  const unavailableCount = snapshots.filter((s) => s.status === "unavailable").length;
  const mockCount = snapshots.filter((s) => s.status === "mock").length;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-white/50">
            Source Snapshots ({snapshots.length})
          </div>
          <p className="mt-1 text-xs text-white/40">
            Verified provider signals, staleness timestamps, and network responses.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-emerald-200 font-mono">
            {connectedCount} live
          </span>
          {unavailableCount > 0 ? (
            <span className="rounded-full border border-red-400/30 bg-red-400/10 px-2.5 py-0.5 text-red-200 font-mono">
              {unavailableCount} unavailable
            </span>
          ) : null}
          {mockCount > 0 ? (
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-amber-200 font-mono">
              {mockCount} demo mock
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-2.5">
        {snapshots.map((snap, i) => (
          <div
            key={`${snap.agent}-${snap.label}-${i}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3.5 py-2.5 text-xs"
          >
            <div className="flex items-center gap-2.5 min-w-[140px]">
              <span className={`inline-block h-2 w-2 rounded-full ${statusColor(snap.status)}`} />
              <div>
                <span className="font-medium text-white/85">{snap.label}</span>
                <span className="ml-2 text-[10px] text-white/40 uppercase font-mono">{snap.agent}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${statusBadge(snap.status)}`}>
                {snap.status}
              </span>

              {snap.reliability != null && (
                <span className="text-white/50 font-mono">
                  Rel: {Math.round(snap.reliability * 100)}%
                </span>
              )}

              {snap.latencyMs != null && (
                <span className="text-white/40 font-mono">{snap.latencyMs}ms</span>
              )}

              {snap.checkedAt && (
                <span className="text-white/40 font-mono">
                  {new Date(snap.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              )}

              {snap.url && (
                <a
                  href={snap.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[#f2c86d] underline underline-offset-2 hover:text-white"
                >
                  Source <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {snap.error && (
              <div className="w-full mt-1 rounded bg-red-500/10 px-2 py-1 text-red-200/80 text-[11px]">
                {snap.error}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-white/54">
        <Link href="/insights/evidence-coverage" className="underline underline-offset-2 hover:text-white">
          Explore source coverage and contradictions
        </Link>
      </p>
    </div>
  );
}
