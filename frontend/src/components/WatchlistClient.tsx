"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckSquare, Square, RotateCw, Trash2, Download, Layers, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import type { WatchlistEntry, WatchlistScanRun } from "@/server/types";

export function WatchlistAddForm({ wallet }: { wallet: string }) {
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    const body: Record<string, string> = {
      action: "add",
      walletAddress: wallet,
      chain: formData.get("chain") as string,
      source: "manual",
    };

    const input = formData.get("input") as string;
    const chain = formData.get("chain") as string;

    // Detect asset type from input
    if (chain.startsWith("stellar")) {
      const normalized = input.trim();
      if (/^xlm$/i.test(normalized)) {
        body.assetType = "native";
        body.symbol = "XLM";
        body.assetKey = "native";
      } else if (/^[A-Za-z0-9]{1,12}:[A-Za-z0-9]{56}$/.test(normalized)) {
        const [code, issuer] = normalized.split(":");
        body.assetType = "classic";
        body.assetKey = normalized.toUpperCase();
        body.symbol = code.toUpperCase();
        body.issuer = issuer.toUpperCase();
      } else if (/^C[A-Za-z0-9]{55}$/.test(normalized)) {
        // Contract IDs starting with C can be SAC or SEP-41.
        // Default to "sac" (most common); user can override via the asset variant selector.
        const variant = formData.get("stellarVariant") as string;
        body.assetType = variant === "sep41" ? "sep41" : "sac";
        body.contractAddress = normalized.toUpperCase();
        body.assetKey = `contract:${normalized.toUpperCase()}`;
      } else {
        body.assetType = "classic";
        body.assetKey = normalized;
      }
      // Reject symbol-only Stellar inputs (e.g. just "USDC" without :ISSUER)
      if (body.assetType === "classic" && !body.issuer && !body.contractAddress && body.assetKey !== "native") {
        setError(
          "Stellar classic assets require a full CODE:ISSUER (e.g. USDC:GA5ZSE...). " +
            "Symbol-only values are not accepted.",
        );
        return;
      }
      body.network = chain;
    } else {
      const address = input.trim().toLowerCase();
      if (/^0x[a-f0-9]{40}$/.test(address)) {
        body.contractAddress = address;
        body.assetType = "contract";
      } else {
        body.contractAddress = address;
        body.assetType = "contract";
      }
    }

    // Add symbol/name if provided
    const symbol = formData.get("symbol") as string;
    const tokenName = formData.get("tokenName") as string;
    if (symbol) body.symbol = symbol;
    if (tokenName) body.tokenName = tokenName;

    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (response.ok && data.entry) {
        window.location.href = `/watchlist?wallet=${encodeURIComponent(wallet)}&added=1`;
      } else {
        setError(data.error ?? "Failed to add entry.");
      }
    } catch {
      setError("Network error. Please try again.");
    }
  }

  return (
    <>
    <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
      <div className="grid gap-3 md:grid-cols-[1fr_160px_160px]">
        <div>
          <label htmlFor="input" className="mb-1 block text-xs text-slate-400">
            Contract address / CODE:ISSUER / Contract ID / <span className="font-mono">native</span>
          </label>
          <input
            id="input"
            name="input"
            type="text"
            required
            placeholder="0x... or USDC:GA5ZSE... or C... or XLM"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
          />
        </div>
        <div>
          <label htmlFor="chain" className="mb-1 block text-xs text-slate-400">
            Chain / Network
          </label>
          <select
            id="chain"
            name="chain"
            required
            defaultValue="base"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
          >
            <optgroup label="EVM">
              <option value="ethereum">Ethereum</option>
              <option value="base">Base</option>
              <option value="bsc">BNB Chain</option>
              <option value="arbitrum">Arbitrum</option>
              <option value="polygon">Polygon</option>
              <option value="optimism">Optimism</option>
              <option value="avalanche">Avalanche</option>
              <option value="goat">GOAT Network</option>
              <option value="linea">Linea</option>
              <option value="scroll">Scroll</option>
              <option value="zksync">zkSync Era</option>
              <option value="berachain">Berachain</option>
              <option value="sonic">Sonic</option>
              <option value="unichain">Unichain</option>
              <option value="worldchain">World Chain</option>
              <option value="monad">Monad</option>
              <option value="plasma">Plasma</option>
            </optgroup>
            <optgroup label="Stellar">
              <option value="stellar-public">Stellar Pubnet</option>
              <option value="stellar-testnet">Stellar Testnet</option>
            </optgroup>
          </select>
        </div>
        <div className="flex flex-col justify-end">
          <button
            type="submit"
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
          >
            Add to watchlist
          </button>
        </div>
      </div>

      {/* Optional fields row */}
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label htmlFor="symbol" className="mb-1 block text-xs text-slate-400">
            Symbol <span className="text-slate-600">(optional)</span>
          </label>
          <input
            id="symbol"
            name="symbol"
            type="text"
            placeholder="e.g. USDC"
            maxLength={32}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
          />
        </div>
        <div>
          <label htmlFor="tokenName" className="mb-1 block text-xs text-slate-400">
            Token name <span className="text-slate-600">(optional)</span>
          </label>
          <input
            id="tokenName"
            name="tokenName"
            type="text"
            placeholder="e.g. USD Coin"
            maxLength={120}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
          />
        </div>
        <div id="stellarVariantGroup">
          <label htmlFor="stellarVariant" className="mb-1 block text-xs text-slate-400">
            Asset variant <span className="text-slate-600">(Stellar contracts)</span>
          </label>
          <select
            id="stellarVariant"
            name="stellarVariant"
            defaultValue="sac"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
          >
            <option value="sac">SAC (default)</option>
            <option value="sep41">SEP-41</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}
    </form>
    <p className="mt-4 text-xs text-white/54">
      <Link href="/insights/watchlist-collections" className="underline underline-offset-2 hover:text-white">
        Organise this watchlist into collections, tags and saved views
      </Link>
    </p>
    </>
  );
}

export function WatchlistRescanButton({ entryId, wallet }: { entryId: string; wallet: string }) {
  const [scanning, setScanning] = useState(false);

  async function handleRescan() {
    if (scanning) return;
    setScanning(true);
    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(entryId)}/rescan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet }),
      });
      if (response.ok) {
        window.location.href = `/watchlist?wallet=${encodeURIComponent(wallet)}`;
      }
      setScanning(false);
    } catch {
      setScanning(false);
    }
  }

  return (
    <button
      onClick={handleRescan}
      disabled={scanning}
      className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-center text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
    >
      {scanning ? "Scanning…" : "Rescan"}
    </button>
  );
}

export function WatchlistRemoveButton({ entryId, wallet }: { entryId: string; wallet: string }) {
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    if (removing) return;
    setRemoving(true);
    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", entryId, walletAddress: wallet }),
      });
      const data = await response.json();
      if (data.ok) {
        window.location.href = `/watchlist?wallet=${encodeURIComponent(wallet)}&removed=1`;
      }
    } catch {
      setRemoving(false);
    }
  }

  return (
    <button
      onClick={handleRemove}
      disabled={removing}
      className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-1.5 text-xs font-medium text-rose-300/70 transition-colors hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-50"
    >
      {removing ? "Removing…" : "Remove"}
    </button>
  );
}

export function WatchlistExportButton({ wallet }: { wallet: string }) {
  return (
    <a
      href={`/api/watchlist/export?wallet=${encodeURIComponent(wallet)}&format=csv`}
      className="inline-flex h-10 items-center justify-center rounded-lg bg-slate-800 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-700"
      download
    >
      Export CSV
    </a>
  );
}

export function WatchlistImportForm({ wallet }: { wallet: string }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<any>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setSuccess(null);
    setDryRunResult(null);
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const isJson = file.name.endsWith('.json');
      const text = await file.text();
      const res = await fetch(`/api/watchlist/import?wallet=${encodeURIComponent(wallet)}&dry_run=true`, {
        method: "POST",
        headers: { "Content-Type": isJson ? "application/json" : "text/csv" },
        body: text
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to parse");
      setDryRunResult({ data: text, result: data, isJson });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleApply() {
    if (!dryRunResult) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/watchlist/import?wallet=${encodeURIComponent(wallet)}`, {
        method: "POST",
        headers: { "Content-Type": dryRunResult.isJson ? "application/json" : "text/csv" },
        body: dryRunResult.data
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setSuccess(`Imported ${data.appliedCount} entries.`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <h3 className="mb-4 font-semibold text-white">Bulk Import</h3>
      <div className="space-y-4">
         <input type="file" accept=".csv,.json" onChange={handleFile} disabled={loading} className="text-sm text-slate-300" />
         
         {loading && <p className="text-sm text-blue-400">Loading...</p>}
         {error && <p className="text-sm text-rose-400">{error}</p>}
         {success && <p className="text-sm text-emerald-400">{success}</p>}

         {dryRunResult && !success && (
           <div className="rounded bg-slate-950 p-3 text-sm text-slate-300">
              <p>Valid: {dryRunResult.result.validCount}</p>
              <p>Duplicates: {dryRunResult.result.duplicateCount}</p>
              <p>Invalid: {dryRunResult.result.invalidCount}</p>
              
              {dryRunResult.result.invalidCount > 0 ? (
                <p className="mt-2 text-amber-400">Cannot apply. Fix invalid rows first.</p>
              ) : (
                <button 
                  onClick={handleApply}
                  disabled={loading}
                  className="mt-3 rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-500"
                >
                  Apply Import
                </button>
              )}
           </div>
         )}
      </div>
    </div>
  );
}

export type WatchlistRowItem = {
  entry: WatchlistEntry;
  recentRuns?: WatchlistScanRun[];
  totalRuns?: number;
};

export function WatchlistManager({
  items,
  wallet,
}: {
  items: WatchlistRowItem[];
  wallet: string;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);

  // Filter computation
  const filteredItems = items.filter(({ entry }) => {
    if (filter === "all") return true;
    if (filter === "high_risk") {
      return (
        (entry.latestScore !== undefined && entry.latestScore >= 60) ||
        entry.latestClassification === "risky" ||
        entry.latestClassification === "scam"
      );
    }
    if (filter === "stellar") return entry.chain?.startsWith("stellar");
    if (filter === "evm") return !entry.chain?.startsWith("stellar");
    if (filter === "stale") return entry.latestStatus === "stale" || entry.latestStatus === "failed";
    return true;
  });

  const highRiskCount = items.filter(
    ({ entry }) =>
      (entry.latestScore !== undefined && entry.latestScore >= 60) ||
      entry.latestClassification === "risky" ||
      entry.latestClassification === "scam"
  ).length;
  const stellarCount = items.filter(({ entry }) => entry.chain?.startsWith("stellar")).length;
  const evmCount = items.filter(({ entry }) => !entry.chain?.startsWith("stellar")).length;
  const staleCount = items.filter(
    ({ entry }) => entry.latestStatus === "stale" || entry.latestStatus === "failed"
  ).length;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((i) => i.entry.id)));
    }
  };

  // Bulk actions
  const handleBulkRescan = async () => {
    if (selectedIds.size === 0 || bulkProcessing) return;
    setBulkProcessing(true);
    setBulkStatus(`Rescanning ${selectedIds.size} assets...`);
    try {
      for (const id of Array.from(selectedIds)) {
        await fetch(`/api/watchlist/${encodeURIComponent(id)}/rescan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walletAddress: wallet }),
        }).catch(() => null);
      }
      window.location.href = `/watchlist?wallet=${encodeURIComponent(wallet)}&rescanned=${selectedIds.size}`;
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkRemove = async () => {
    if (selectedIds.size === 0 || bulkProcessing) return;
    setBulkProcessing(true);
    setBulkStatus(`Removing ${selectedIds.size} assets...`);
    try {
      for (const id of Array.from(selectedIds)) {
        await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "remove", entryId: id, walletAddress: wallet }),
        }).catch(() => null);
      }
      window.location.href = `/watchlist?wallet=${encodeURIComponent(wallet)}&removed=${selectedIds.size}`;
    } finally {
      setBulkProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Collection filter pills */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filter === "all"
                ? "bg-[#d9a441] text-black"
                : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            All <span className="opacity-75">({items.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter("high_risk")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filter === "high_risk"
                ? "bg-red-500 text-white"
                : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            High Risk <span className="opacity-75">({highRiskCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter("stellar")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filter === "stellar"
                ? "bg-[#7b61ff] text-white"
                : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            Stellar Assets <span className="opacity-75">({stellarCount})</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter("evm")}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
              filter === "evm"
                ? "bg-[#627eea] text-white"
                : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            EVM Tokens <span className="opacity-75">({evmCount})</span>
          </button>
          {staleCount > 0 && (
            <button
              type="button"
              onClick={() => setFilter("stale")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                filter === "stale"
                  ? "bg-amber-500 text-black"
                  : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              Stale / Degraded <span className="opacity-75">({staleCount})</span>
            </button>
          )}
        </div>

        {filteredItems.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs text-white/60 hover:text-white"
          >
            {selectedIds.size === filteredItems.length ? "Deselect all" : "Select all"}
          </button>
        )}
      </div>

      {/* Grid of items */}
      {filteredItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-white/50">
          No assets match the active collection filter.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map(({ entry, recentRuns, totalRuns }) => {
            const isSelected = selectedIds.has(entry.id);
            // Calculate risk delta
            let riskDelta: number | null = null;
            if (entry.latestScore !== undefined && recentRuns && recentRuns.length >= 2) {
              const prev = recentRuns[1]?.score;
              if (prev !== undefined) riskDelta = entry.latestScore - prev;
            }

            return (
              <div
                key={entry.id}
                tabIndex={0}
                role="checkbox"
                aria-checked={isSelected}
                onKeyDown={(e) => {
                  if (e.key === " ") {
                    e.preventDefault();
                    toggleSelect(entry.id);
                  }
                }}
                onClick={() => toggleSelect(entry.id)}
                className={`relative cursor-pointer rounded-xl border p-4 transition ${
                  isSelected
                    ? "border-[#d9a441] bg-[#d9a441]/10"
                    : "border-slate-800 bg-slate-950/60 hover:border-slate-600"
                }`}
              >
                {/* Top bar with selection check and chain */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isSelected ? (
                      <CheckSquare className="h-4 w-4 text-[#d9a441]" />
                    ) : (
                      <Square className="h-4 w-4 text-white/30" />
                    )}
                    <span className="font-semibold text-white">
                      {entry.symbol || entry.tokenName || entry.contractAddress?.slice(0, 8) || "Asset"}
                    </span>
                  </div>
                  <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase text-white/60">
                    {entry.chain}
                  </span>
                </div>

                {/* Sub title / address */}
                <div className="mt-1 truncate text-xs text-white/50 font-mono">
                  {entry.contractAddress || entry.assetKey || entry.identityKey}
                </div>

                {/* Metrics & Badges */}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-white/8 px-2 py-0.5 text-white">
                    Score: <span className="font-semibold">{entry.latestScore ?? "—"}</span>
                  </span>

                  {/* Risk Delta Badge */}
                  {riskDelta !== null ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${
                        riskDelta > 0
                          ? "bg-red-500/15 text-red-300 border border-red-500/25"
                          : riskDelta < 0
                          ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
                          : "bg-white/5 text-white/60 border border-white/10"
                      }`}
                    >
                      {riskDelta > 0 ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : riskDelta < 0 ? (
                        <TrendingDown className="h-3 w-3" />
                      ) : (
                        <Minus className="h-3 w-3" />
                      )}
                      {riskDelta > 0 ? `+${riskDelta}%` : `${riskDelta}%`} vs last
                    </span>
                  ) : (
                    <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-white/40">
                      baseline
                    </span>
                  )}

                  {/* Staleness badge */}
                  {(entry.latestStatus === "stale" || entry.latestStatus === "failed") && (
                    <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                      <AlertTriangle className="h-2.5 w-2.5" />
                      Stale
                    </span>
                  )}
                </div>

                {/* Single item actions (stop propagation) */}
                <div className="mt-3 flex items-center gap-2 border-t border-white/5 pt-2" onClick={(e) => e.stopPropagation()}>
                  <WatchlistRescanButton entryId={entry.id} wallet={wallet} />
                  <WatchlistRemoveButton entryId={entry.id} wallet={wallet} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Sticky Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <aside
          role="region"
          aria-label="Bulk actions"
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#d9a441]/40 bg-black/90 px-6 py-3 shadow-2xl backdrop-blur-md"
        >
          <span className="text-xs font-semibold text-[#f2c86d]">
            {selectedIds.size} selected
          </span>
          <div className="h-4 w-px bg-white/20" />
          <button
            type="button"
            disabled={bulkProcessing}
            onClick={handleBulkRescan}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#d9a441]/20 px-3 py-1 text-xs font-medium text-[#f2c86d] hover:bg-[#d9a441]/30 disabled:opacity-50"
          >
            <RotateCw className="h-3 w-3" />
            Rescan Selected
          </button>
          <a
            href={`/api/watchlist/export?wallet=${encodeURIComponent(wallet)}&format=csv`}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
          >
            <Download className="h-3 w-3" />
            Export CSV
          </a>
          <button
            type="button"
            disabled={bulkProcessing}
            onClick={handleBulkRemove}
            className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-3 py-1 text-xs font-medium text-red-300 hover:bg-red-500/30 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-white/50 hover:text-white"
          >
            Clear
          </button>
          {bulkStatus && (
            <span className="text-xs text-amber-300 animate-pulse">{bulkStatus}</span>
          )}
        </aside>
      )}
    </div>
  );
}

