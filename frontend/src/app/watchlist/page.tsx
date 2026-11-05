import Link from "next/link";
import { getScanNetwork } from "@/lib/scanNetworks";
import { listWatchlistEntries, listWatchlistScanRuns, ensureStorageReady } from "@/server/storage";
import { WatchlistAddForm, WatchlistRemoveButton, WatchlistRescanButton, WatchlistExportButton, WatchlistImportForm } from "@/components/WatchlistClient";
import type { DiscoveryClassification, RiskLevel, WatchlistEntry, WatchlistScanRun } from "@/server/types";

export const dynamic = "force-dynamic";

const DEFAULT_WALLET = "0xDemoWallet";

const classificationTone: Record<DiscoveryClassification, string> = {
  watch: "border-sky-500/60 bg-sky-500/5 text-sky-300",
  risky: "border-amber-500/60 bg-amber-500/5 text-amber-300",
  scam: "border-rose-500/60 bg-rose-500/5 text-rose-300",
  early_opportunity: "border-emerald-500/60 bg-emerald-500/5 text-emerald-300",
};

const statusTone: Record<string, string> = {
  completed: "text-emerald-300 border-emerald-500/30",
  partial: "text-orange-300 border-orange-500/30",
  failed: "text-rose-300 border-rose-500/30",
  stale: "text-amber-300 border-amber-500/30",
};

const severityTone: Record<RiskLevel, string> = {
  low: "text-sky-300",
  medium: "text-amber-300",
  high: "text-orange-300",
  critical: "text-rose-400",
};

const assetTypeLabel: Record<string, { label: string; short: string }> = {
  native: { label: "Native", short: "NAT" },
  classic: { label: "Classic", short: "CLS" },
  contract: { label: "Contract", short: "CTR" },
  issuer_account: { label: "Issuer", short: "ISS" },
  sac: { label: "SAC", short: "SAC" },
  sep41: { label: "SEP-41", short: "S41" },
};

function getChainBadge(chain: string): { label: string; color: string; mark: string } {
  const network = getScanNetwork(chain);
  if (network) {
    return { label: network.name, color: network.color, mark: network.mark };
  }
  return {
    label: chain,
    color: "bg-slate-600 text-white",
    mark: chain.charAt(0).toUpperCase(),
  };
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHour = Math.floor(diffMs / 3_600_000);
    const diffDay = Math.floor(diffMs / 86_400_000);

    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 30) return `${diffDay}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function truncateAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

function getAssetIdentityLabel(entry: WatchlistEntry): string {
  if (entry.symbol) {
    const issuerSuffix = entry.issuer ? `:${truncateAddress(entry.issuer, 4)}` : "";
    return `${entry.symbol}${issuerSuffix}`;
  }
  if (entry.contractAddress) return truncateAddress(entry.contractAddress);
  if (entry.assetKey) return entry.assetKey;
  if (entry.tokenName) return entry.tokenName;
  return entry.identityKey;
}

function getAssetSubLabel(entry: WatchlistEntry): string | null {
  if (entry.tokenName && entry.symbol) return null;
  if (entry.tokenName) return entry.tokenName;
  if (entry.contractAddress) return `CA: ${truncateAddress(entry.contractAddress, 8)}`;
  if (entry.assetKey) return entry.assetKey;
  return null;
}

async function loadWatchlistWithScanMeta(wallet: string) {
  try {
    await ensureStorageReady();
    const entries = listWatchlistEntries(wallet);
    return entries.map((entry) => {
      const recentRuns = listWatchlistScanRuns(entry.id).slice(0, 3);
      const totalRuns = listWatchlistScanRuns(entry.id).length;
      return { entry, recentRuns, totalRuns };
    });
  } catch {
    return [];
  }
}

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ wallet?: string; removed?: string; added?: string }>;
}) {
  const params = await searchParams;
  const wallet = (params.wallet ?? DEFAULT_WALLET).trim().toLowerCase();
  const watchlistData = await loadWatchlistWithScanMeta(wallet);
  const totalEntries = watchlistData.length;
  const staleEntries = watchlistData.filter(({ entry }) => entry.latestStatus === "stale" || entry.latestStatus === "failed");
  const scannedEntries = watchlistData.filter(({ entry }) => entry.lastScannedAt);
  const unscannedEntries = watchlistData.filter(({ entry }) => !entry.lastScannedAt);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-12">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
          Cryptara · V3 · Watchlist
        </p>
        <h1 className="text-3xl font-semibold text-white">Chain-aware watchlist</h1>
        <p className="max-w-3xl text-sm text-slate-300">
          Persistent wallet-scoped watchlist with chain-aware asset identity. Supports EVM contracts, native XLM,
          classic CODE:ISSUER, Stellar Asset Contracts (SAC), and SEP-41 contracts. Rescans create immutable
          audit trails. Failed provider calls preserve prior visible evidence as stale.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded border border-slate-700 px-2 py-1 text-slate-300">
            Wallet: <span className="font-mono text-emerald-300">{truncateAddress(wallet, 8)}</span>
          </span>
          <span className="rounded border border-slate-700 px-2 py-1 text-slate-400">
            {totalEntries} {totalEntries === 1 ? "entry" : "entries"}
            {staleEntries.length > 0 && ` · ${staleEntries.length} stale`}
          </span>
          <Link
            href={`/watchlist?wallet=${encodeURIComponent(wallet)}`}
            className="text-emerald-300 underline-offset-2 hover:underline"
          >
            Refresh
          </Link>
        </div>
      </header>

      {/* Status feedback */}
      {params.removed ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200">
          Watchlist entry removed.
        </div>
      ) : null}
      {params.added ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200">
          Asset added to watchlist.
        </div>
      ) : null}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="text-lg font-medium text-white">Add to watchlist</h2>
        <p className="mt-1 text-xs text-slate-400">
          Add an EVM token by contract address or a Stellar asset by CODE:ISSUER, contract ID, or native XLM.
        </p>
        <WatchlistAddForm wallet={wallet} />
        <WatchlistImportForm wallet={wallet} />
        <div className="mt-4"><WatchlistExportButton wallet={wallet} /></div>
      </section>

      {/* Watchlist entries */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium text-white">
            Watchlist entries
            {totalEntries > 0 && <span className="ml-2 text-sm font-normal text-slate-400">({totalEntries})</span>}
          </h2>
        </div>

        {totalEntries === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/50 px-6 py-10 text-center">
            <p className="text-sm font-medium text-slate-300">No watchlist entries yet</p>
            <p className="mt-1 text-xs text-slate-500">
              Add a token or asset using the form above. Entries persist across restarts.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Unscanned entries section */}
            {unscannedEntries.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                  Not yet scanned ({unscannedEntries.length})
                </h3>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {unscannedEntries.map(({ entry, totalRuns }) => (
                    <WatchlistEntryCard
                      key={entry.id}
                      entry={entry}
                      totalRuns={totalRuns}
                      wallet={wallet}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Scanned entries section */}
            {scannedEntries.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                  Scanned entries ({scannedEntries.length})
                  {staleEntries.length > 0 && (
                    <span className="ml-2 text-amber-400">· {staleEntries.length} have stale data</span>
                  )}
                </h3>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {scannedEntries.map(({ entry, recentRuns, totalRuns }) => (
                    <WatchlistEntryCard
                      key={entry.id}
                      entry={entry}
                      recentRuns={recentRuns}
                      totalRuns={totalRuns}
                      wallet={wallet}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Legend */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <h2 className="mb-3 text-sm font-medium text-white">Asset types &amp; scan status</h2>
        <div className="grid gap-4 text-xs text-slate-300 md:grid-cols-2 lg:grid-cols-3">
          <div>
            <h3 className="mb-1 font-medium text-slate-400">Chain families</h3>
            <ul className="space-y-1">
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-[#627eea]" />
                EVM chains (Ethereum, Base, BSC, Arbitrum, etc.)
              </li>
              <li className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-[#7b61ff]" />
                Stellar (Testnet / Pubnet)
              </li>
            </ul>
          </div>
          <div>
            <h3 className="mb-1 font-medium text-slate-400">Stellar asset types</h3>
            <ul className="space-y-1">
              <li><span className="font-mono text-emerald-300">native</span> — Native XLM</li>
              <li><span className="font-mono text-emerald-300">classic</span> — Classic CODE:ISSUER</li>
              <li><span className="font-mono text-emerald-300">sac</span> — Stellar Asset Contract</li>
              <li><span className="font-mono text-emerald-300">sep41</span> — SEP-41 contract</li>
            </ul>
          </div>
          <div>
            <h3 className="mb-1 font-medium text-slate-400">Scan status</h3>
            <ul className="space-y-1">
              <li><span className="text-emerald-300">completed</span> — Full scan with connected providers</li>
              <li><span className="text-orange-300">partial</span> — Scanned with some degraded sources</li>
              <li><span className="text-amber-300">stale</span> — Previous scan available; latest refresh failed</li>
              <li><span className="text-rose-300">failed</span> — No successful scan ever completed</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}

/* ─── Sub-components ─── */

function WatchlistEntryCard({
  entry,
  recentRuns = [],
  totalRuns = 0,
  wallet,
}: {
  entry: WatchlistEntry;
  recentRuns?: WatchlistScanRun[];
  totalRuns?: number;
  wallet: string;
}) {
  const chainBadge = getChainBadge(entry.chain);
  const typeInfo = entry.assetType ? assetTypeLabel[entry.assetType] : null;
  const isStaleOrFailed = entry.latestStatus === "stale" || entry.latestStatus === "failed";
  const hasPriorSuccess = entry.latestClassification && entry.latestScore !== undefined && !isStaleOrFailed;
  const hasPriorEvidence = isStaleOrFailed && (entry.latestClassification || entry.latestScore !== undefined);

  return (
    <div
      className={`group relative rounded-xl border bg-slate-950/50 p-4 transition-all hover:border-slate-600 hover:bg-slate-900/80 ${
        isStaleOrFailed ? "border-amber-500/20" : "border-slate-800"
      }`}
    >
      {/* Chain badge */}
      <div className="absolute right-3 top-3 flex items-center gap-1.5">
        {typeInfo && (
          <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {typeInfo.short}
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${chainBadge.color}`}
          title={chainBadge.label}
        >
          {chainBadge.mark}
        </span>
      </div>

      {/* Asset identity */}
      <div className="mb-2 pr-24">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">
            {getAssetIdentityLabel(entry)}
          </span>
          {entry.latestClassification && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                classificationTone[entry.latestClassification]
              }`}
            >
              {entry.latestClassification}
            </span>
          )}
        </div>
        {entry.network && (
          <p className="mt-0.5 text-[11px] text-slate-500">Network: {entry.network}</p>
        )}
        {getAssetSubLabel(entry) && (
          <p className="mt-0.5 truncate text-[11px] text-slate-500">{getAssetSubLabel(entry)}</p>
        )}
      </div>

      {/* Metrics row */}
      <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Score:</span>
          <span className={hasPriorEvidence && !hasPriorSuccess ? "text-amber-300" : "text-white"}>
            {entry.latestScore ?? "—"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Status:</span>
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] ${
              statusTone[entry.latestStatus ?? "stale"] ?? "text-slate-400 border-slate-600"
            }`}
          >
            {entry.latestStatus ?? "no scan"}
          </span>
        </div>
        {entry.lastScannedAt && (
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Scanned:</span>
            <span>{formatTime(entry.lastScannedAt)}</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <span className="text-slate-500">Runs:</span>
          <span>{totalRuns}</span>
        </div>
      </dl>

      {/* Stale evidence notice */}
      {isStaleOrFailed && hasPriorEvidence && (
        <div className="mb-3 rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300/80">
          <span className="font-medium text-amber-200">Prior evidence preserved:</span>{" "}
          {entry.latestClassification && `Classified ${entry.latestClassification}`}
          {entry.latestScore !== undefined && ` · Score ${entry.latestScore}/100`}
          . Refresh may recover full data.
        </div>
      )}

      {/* No prior evidence stale */}
      {isStaleOrFailed && !hasPriorEvidence && (
        <div className="mb-3 rounded-lg border border-rose-500/15 bg-rose-500/5 px-3 py-2 text-[11px] text-rose-300/80">
          <span className="font-medium text-rose-200">No successful scan yet.</span>{" "}
          The latest provider call failed. Trigger a rescan to retry.
        </div>
      )}

      {/* Recent scan runs */}
      {recentRuns.length > 0 && (
        <details className="mb-3 group">
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300">
            <span className="transition-transform group-open:rotate-90">▶</span>
            Recent scans ({recentRuns.length})
          </summary>
          <ul className="mt-1 space-y-1.5 pl-3">
            {recentRuns.map((run) => (
              <li
                key={run.id}
                className="rounded border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 text-[11px]"
              >
                <div className="flex items-center justify-between">
                  <span className={`font-medium ${classificationTone[run.classification]?.split(" ")[2] ?? "text-slate-300"}`}>
                    {run.classification}
                  </span>
                  <span className="text-slate-500">{formatTime(run.scannedAt)}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <span>Score {run.score}/100</span>
                  <span
                    className={`rounded border px-1 py-0.5 text-[10px] ${
                      statusTone[run.status] ?? "border-slate-600 text-slate-400"
                    }`}
                  >
                    {run.status}
                  </span>
                </div>
                {run.classificationReasons.length > 0 && (
                  <ul className="mt-0.5 list-disc pl-4 text-slate-500">
                    {run.classificationReasons.slice(0, 2).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <WatchlistRescanButton entryId={entry.id} wallet={wallet} />
        <WatchlistRemoveButton entryId={entry.id} wallet={wallet} />
      </div>
    </div>
  );
}
