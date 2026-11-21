"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Database, RefreshCw, ShieldAlert, WifiOff, ExternalLink, ArrowRight } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StalenessStamp } from "@/components/StalenessStamp";
import { readOfflineState, type OfflineReadOnlyState } from "@/lib/offlineStore";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export default function OfflinePage() {
  const [state, setState] = useState<OfflineReadOnlyState>({ scans: [], portfolios: [] });
  const [watchlistItems, setWatchlistItems] = useState<Array<{ symbol: string; chain: string; addedAt?: string }>>([]);
  const { isOffline, refresh } = useOnlineStatus();

  useEffect(() => {
    setState(readOfflineState());
    try {
      const stored = localStorage.getItem("cryptara:watchlist:v1");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed?.items)) setWatchlistItems(parsed.items);
      }
    } catch {
      // ignore
    }
  }, []);

  const totalCached = state.scans.length + state.portfolios.length;

  return (
    <AppShell>
      <div className="space-y-6">
        <section className="border-b border-white/10 pb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-amber-200">
                <WifiOff className="h-3.5 w-3.5" />
                Offline Hub
              </div>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Cached snapshot inspection</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/60">
                This local view is served directly from your device cache. Reports and portfolio holdings displayed here reflect the last synchronized state. Live scans and transactions remain safely locked until connectivity is restored.
              </p>
            </div>

            {!isOffline ? (
              <button
                type="button"
                data-offline-allow
                onClick={refresh}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#d9a441] px-5 text-sm font-semibold text-black transition hover:bg-[#f2c86d] shadow-md"
              >
                <RefreshCw className="h-4 w-4" />
                Refresh live data
              </button>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-white/50">
            <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-white/80">
              <Database className="h-3 w-3 text-[#d9a441]" />
              {totalCached} cached snapshot{totalCached === 1 ? "" : "s"}
            </span>
            <span>•</span>
            <span>Local read-only sandbox</span>
            <span>•</span>
            <span>No telemetry transmitted</span>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {/* Last known token scans */}
          <div className="glass-panel rounded-2xl border border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Cached Token Scans</h2>
              <span className="text-xs text-white/40">{state.scans.length} available</span>
            </div>

            <div className="space-y-3">
              {state.scans.map((entry) => (
                <article key={entry.id} className="rounded-xl border border-white/10 bg-black/30 p-4 transition hover:border-white/20">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-white">{entry.data.symbol}</span>
                        <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] uppercase font-mono text-white/60">{entry.data.chain}</span>
                      </div>
                      <div className="mt-1 text-xs text-white/46">Source: {entry.source}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold font-mono text-white">{entry.data.overallRiskScore}</div>
                      <div className="text-[10px] uppercase tracking-wider text-amber-300/80 font-medium">Stale risk score</div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <StalenessStamp capturedAt={entry.capturedAt} />
                  </div>

                  {entry.data.summary ? (
                    <p className="mt-3 text-xs leading-5 text-white/58 border-t border-white/5 pt-2">{entry.data.summary}</p>
                  ) : null}
                </article>
              ))}

              {state.scans.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/46">
                  No cached scans found on this device. Future online scans will automatically save snapshots here.
                </div>
              ) : null}
            </div>
          </div>

          {/* Last known portfolios & Watchlist */}
          <div className="space-y-6">
            <div className="glass-panel rounded-2xl border border-white/10 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white">Cached Portfolio Snapshots</h2>
                <span className="text-xs text-white/40">{state.portfolios.length} available</span>
              </div>

              <div className="space-y-3">
                {state.portfolios.map((entry) => (
                  <article key={entry.id} className="rounded-xl border border-white/10 bg-black/30 p-4 transition hover:border-white/20">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-xs text-white/80 truncate max-w-[200px]" title={entry.data.walletAddress}>
                          {entry.data.walletAddress}
                        </div>
                        <div className="mt-1 text-xs text-white/46">{entry.data.holdings?.length ?? 0} holdings cached</div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold font-mono text-white">{entry.data.riskScore}</div>
                        <div className="text-[10px] uppercase tracking-wider text-amber-300/80 font-medium">Portfolio risk</div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <StalenessStamp capturedAt={entry.capturedAt} />
                    </div>
                  </article>
                ))}

                {state.portfolios.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-white/46">
                    No cached portfolio snapshots found.
                  </div>
                ) : null}
              </div>
            </div>

            {/* Offline Watchlist Tokens */}
            {watchlistItems.length > 0 ? (
              <div className="glass-panel rounded-2xl border border-white/10 p-5 space-y-3">
                <h3 className="text-base font-semibold text-white">Saved Watchlist Tokens ({watchlistItems.length})</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {watchlistItems.map((item, idx) => (
                    <div key={idx} className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs">
                      <div className="font-semibold text-white">{item.symbol}</div>
                      <div className="text-[10px] text-white/40 capitalize">{item.chain}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <div className="flex items-center gap-3 pt-2">
          <Link
            href="/"
            data-offline-allow
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            Back to app shell
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </AppShell>
  );
}