"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Wifi, WifiOff, Clock, Database } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { readOfflineState, type OfflineReadOnlyState } from "@/lib/offlineStore";

export function OfflineBanner() {
  const { isOffline, refreshRequired, refresh } = useOnlineStatus();
  const [offlineState, setOfflineState] = useState<OfflineReadOnlyState>({ scans: [], portfolios: [] });

  useEffect(() => {
    setOfflineState(readOfflineState());
  }, [isOffline, refreshRequired]);

  if (!isOffline && !refreshRequired) return null;

  const totalCached = offlineState.scans.length + offlineState.portfolios.length;
  const mostRecentTimestamp = [...offlineState.scans, ...offlineState.portfolios]
    .map((s) => s.capturedAt)
    .sort()
    .reverse()[0];

  const formattedTime = mostRecentTimestamp ? new Date(mostRecentTimestamp).toLocaleTimeString() : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`border-b px-5 py-3 transition ${
        isOffline
          ? "border-amber-300/25 bg-amber-300/12 text-amber-50"
          : "border-emerald-400/25 bg-emerald-500/12 text-emerald-100"
      }`}
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          {isOffline ? (
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          ) : (
            <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300 animate-pulse" />
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              <span>{isOffline ? "Offline read-only mode" : "Connection restored"}</span>
              {totalCached > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[11px] font-normal text-white/70">
                  <Database className="h-3 w-3 opacity-60" />
                  {totalCached} cached item{totalCached === 1 ? "" : "s"}
                </span>
              ) : null}
              {formattedTime ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[11px] font-normal text-white/70">
                  <Clock className="h-3 w-3 opacity-60" />
                  Synced {formattedTime}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 text-xs opacity-80">
              {isOffline
                ? "Showing locally cached snapshots. Live scans, quotes, wallet approvals, and rule updates are paused to prevent stale executions."
                : "Live network is back online. Actions remain safely guarded until you refresh to synchronize current state."}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isOffline ? (
            <button
              type="button"
              data-offline-allow
              onClick={refresh}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-emerald-400 px-4 text-xs font-semibold text-black transition hover:bg-emerald-300 shadow-sm"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh now
            </button>
          ) : (
            <a
              href="/offline"
              data-offline-allow
              className="inline-flex h-8 items-center justify-center rounded-full border border-white/15 bg-black/20 px-3 text-xs text-white/80 transition hover:bg-white/10"
            >
              View cached data ({totalCached})
            </a>
          )}
        </div>
      </div>
    </div>
  );
}