"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import type { TransactionRecord } from "@/server/types";
import { formatUsd } from "@/lib/format";
import { getChainMeta } from "@/lib/chains";
import { usePendingTxPoller, isTerminalStatus } from "@/hooks/usePendingTxPoller";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortHash(hash: string) {
  return `${hash.slice(0, 7)}...${hash.slice(-5)}`;
}

const STATUS_TONE: Record<TransactionRecord["lifecycleStatus"], string> = {
  prepared: "text-white/60",
  submitted: "text-sky-300",
  pending: "text-sky-300",
  confirming: "text-amber-300",
  confirmed: "text-emerald-300",
  failed: "text-rose-300",
  replaced: "text-amber-300",
  reorged: "text-rose-300",
  dropped: "text-rose-300",
  manual_review: "text-amber-300",
  expired: "text-white/50",
  user_rejected: "text-white/50",
};

// ---------------------------------------------------------------------------
// CopyHashButton
// ---------------------------------------------------------------------------

function CopyHashButton({ hash }: { hash: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [hash]);

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied!" : "Copy transaction hash"}
      aria-label={copied ? "Hash copied" : "Copy transaction hash"}
      className="ml-1.5 inline-flex items-center rounded px-1 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40"
    >
      {copied ? (
        // checkmark
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6.5l3 3 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        // copy icon
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect x="4" y="4" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M2 8V2a1 1 0 011-1h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ExplorerLink
// ---------------------------------------------------------------------------

function ExplorerLink({ hash, network, explorerUrl }: { hash: string; network: string; explorerUrl?: string }) {
  const meta = getChainMeta(network);
  const href = explorerUrl ?? `${meta.explorerTxBaseUrl}/${hash}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`View on ${meta.explorerName}`}
      className="ml-1.5 inline-flex items-center rounded px-1 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/40"
      aria-label={`View transaction on ${meta.explorerName}`}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M8 1h3m0 0v3m0-3L5.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Filter chip types
// ---------------------------------------------------------------------------

type FamilyFilter = "all" | "evm" | "stellar";
type StatusFilter = "all" | "pending" | "confirmed" | "failed";

const FAMILY_CHIPS: { label: string; value: FamilyFilter }[] = [
  { label: "All", value: "all" },
  { label: "EVM", value: "evm" },
  { label: "Stellar", value: "stellar" },
];

const STATUS_CHIPS: { label: string; value: StatusFilter }[] = [
  { label: "All statuses", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Failed", value: "failed" },
];

function matchesStatusFilter(tx: TransactionRecord, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "pending")
    return tx.lifecycleStatus === "pending" || tx.lifecycleStatus === "submitted" || tx.lifecycleStatus === "confirming";
  if (filter === "confirmed") return tx.lifecycleStatus === "confirmed";
  if (filter === "failed")
    return (
      tx.lifecycleStatus === "failed" ||
      tx.lifecycleStatus === "dropped" ||
      tx.lifecycleStatus === "replaced" ||
      tx.lifecycleStatus === "reorged" ||
      tx.lifecycleStatus === "expired" ||
      tx.lifecycleStatus === "user_rejected"
    );
  return true;
}

// ---------------------------------------------------------------------------
// TransactionCard
// ---------------------------------------------------------------------------

function TransactionCard({ tx }: { tx: TransactionRecord }) {
  const isFailed =
    tx.lifecycleStatus === "failed" ||
    tx.lifecycleStatus === "dropped" ||
    tx.lifecycleStatus === "reorged";
  const isConfirming =
    tx.lifecycleStatus === "confirming";
  const needsReview =
    tx.lifecycleStatus === "manual_review";

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white/6 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      {/* Left column */}
      <div className="min-w-0">
        <div className="text-sm font-medium capitalize">{tx.type.replace(/_/g, " ")}</div>

        {/* Hash row: short hash + copy + explorer link */}
        <div className="mt-1 flex items-center text-xs text-white/42" title={tx.hash}>
          <span className="truncate">{shortHash(tx.hash)}</span>
          <span className="mx-1 text-white/24">·</span>
          <span>{tx.asset}</span>
          <CopyHashButton hash={tx.hash} />
          <ExplorerLink hash={tx.hash} network={tx.network} explorerUrl={tx.explorerUrl} />
        </div>

        {/* Chain family badge */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/44">
            {tx.chainFamily === "stellar" ? "Stellar" : "EVM"}
          </span>
          <span className="text-[10px] text-white/32">{tx.network}</span>
        </div>
      </div>

      {/* Right column */}
      <div className="text-left sm:text-right">
        <div className="text-sm font-medium tabular-nums">
          {tx.valueUsd ? formatUsd(tx.valueUsd) : "No value"}
        </div>

        {/* Status */}
        <div className={`mt-1 text-xs capitalize ${STATUS_TONE[tx.lifecycleStatus]}`}>
          {tx.lifecycleStatus.replace(/_/g, " ")}
        </div>

        {/* Confirmation progress */}
        {isConfirming && (
          <div className="mt-1 max-w-56 text-[11px] text-white/45">
            {tx.confirmationCount ?? 0}/{tx.requiredConfirmations ?? 1} confirmations — not final yet.
          </div>
        )}

        {/* Manual review reason */}
        {needsReview && (
          <div className="mt-1 max-w-56 text-[11px] text-white/45">
            {tx.manualReviewReason ?? "Provider evidence changed; review before acting."}
          </div>
        )}

        {/* Failure reason + diagnostics deep link */}
        {isFailed && (
          <div className="mt-1 max-w-56 text-[11px] text-rose-300/70">
            {tx.failureReason && <span>{tx.failureReason} </span>}
            <Link
              href={`/insights/tx-failure-diagnostics?hash=${encodeURIComponent(tx.hash)}`}
              className="underline underline-offset-2 hover:text-rose-200"
            >
              Diagnose
            </Link>
          </div>
        )}

        {/* Replacement hash */}
        {tx.replacementHash && (
          <div className="mt-1 truncate text-[11px] text-amber-200" title={tx.replacementHash}>
            Replacement: {shortHash(tx.replacementHash)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type RecentTransactionsProps = {
  /** Initial snapshot from SSR; the component polls for updates client-side. */
  transactions: TransactionRecord[];
  walletAddress?: string;
};

export function RecentTransactions({ transactions: initial, walletAddress }: RecentTransactionsProps) {
  const [records, setRecords] = useState<TransactionRecord[]>(initial);
  const [familyFilter, setFamilyFilter] = useState<FamilyFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { fetching, error } = usePendingTxPoller({
    walletAddress,
    onUpdate: setRecords,
  });

  const visible = records.filter((tx) => {
    if (familyFilter !== "all" && tx.chainFamily !== familyFilter) return false;
    if (!matchesStatusFilter(tx, statusFilter)) return false;
    return true;
  });

  const hasPending = records.some(
    (tx) => !isTerminalStatus(tx.lifecycleStatus),
  );

  return (
    <section className="glass-panel rounded-[28px] p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Recent transactions</h2>

        {/* Polling indicator */}
        {hasPending && !error && (
          <span className="flex items-center gap-1.5 text-xs text-white/40" aria-live="polite">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full bg-sky-400 ${fetching ? "animate-pulse" : "opacity-50"}`}
              aria-hidden="true"
            />
            {fetching ? "Checking…" : "Live"}
          </span>
        )}
        {error && (
          <span className="text-xs text-rose-400/70" role="alert">
            Poll error: {error}
          </span>
        )}
      </div>

      {/* Filter chips — family */}
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by chain family">
        {FAMILY_CHIPS.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFamilyFilter(value)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              familyFilter === value
                ? "border-white/30 bg-white/12 text-white"
                : "border-white/10 bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70"
            }`}
            aria-pressed={familyFilter === value}
          >
            {label}
          </button>
        ))}

        <span className="mx-1 self-center text-white/20" aria-hidden="true">|</span>

        {/* Filter chips — status */}
        {STATUS_CHIPS.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            onClick={() => setStatusFilter(value)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              statusFilter === value
                ? "border-white/30 bg-white/12 text-white"
                : "border-white/10 bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70"
            }`}
            aria-pressed={statusFilter === value}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Transaction cards */}
      <div className="mt-5 space-y-3">
        {visible.length === 0 ? (
          <p className="rounded-2xl border border-white/8 bg-white/4 px-4 py-6 text-center text-sm text-white/42">
            {records.length === 0 ? "No transactions yet." : "No transactions match the selected filters."}
          </p>
        ) : (
          visible.map((tx) => <TransactionCard key={tx.hash} tx={tx} />)
        )}
      </div>

      <p className="mt-5 text-xs text-white/54">
        <Link href="/insights/fee-analysis" className="underline underline-offset-2 hover:text-white">
          See what these transactions cost in network fees
        </Link>
      </p>
    </section>
  );
}
