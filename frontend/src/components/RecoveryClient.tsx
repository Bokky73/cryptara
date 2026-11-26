"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Download, FileText, Loader2, Lock, RotateCcw, ShieldAlert, ShieldCheck, Trash2, AlertTriangle } from "lucide-react";
import type { RecoveryChain, RecoveryIncidentMode, RecoveryList, RecoveryNetworkFreshness, RecoveryRequest, RecoveryType } from "@/server/types";
import { RECOVERY_RULES_VERSION } from "@/server/types";
import { clearPaletteRecents } from "@/lib/commandPalette/persistedRecents";
import { clearStressPresets } from "@/lib/stressPresets";
import { AuditExportButton } from "@/components/AuditExportButton";

type RecoveryAction = {
  type: RecoveryType;
  label: string;
  description: string;
  icon: typeof ShieldCheck;
  chainFamily: RecoveryChain;
};

const RECOVERY_ACTIONS: RecoveryAction[] = [
  {
    type: "pause_agent",
    label: "Pause automation",
    description: "Stop new execution preparation for this wallet. Existing previews expire.",
    icon: ShieldAlert,
    chainFamily: "evm",
  },
  {
    type: "revoke_agent",
    label: "Revoke agent authorization",
    description: "Reject future agent prepare requests for this wallet. Visible in audit log.",
    icon: ShieldCheck,
    chainFamily: "any",
  },
  {
    type: "reduce_allowance",
    label: "Reduce EVM allowance",
    description: "Reduce a spender allowance — target a non-zero, non-infinite amount.",
    icon: CircleAlert,
    chainFamily: "evm",
  },
  {
    type: "revoke_allowance",
    label: "Revoke EVM allowance",
    description: "Set allowance to zero. Always remove infinite approvals first.",
    icon: Trash2,
    chainFamily: "evm",
  },
  {
    type: "remove_trustline",
    label: "Remove Stellar trustline",
    description: "Releases XLM base reserve and prevents future payments of the asset.",
    icon: RotateCcw,
    chainFamily: "stellar",
  },
];

type RecoveryState = {
  list: RecoveryList | null;
  freshness: RecoveryNetworkFreshness | null;
  wallet: string;
  loading: boolean;
  error: string | null;
  submitting: RecoveryType | null;
  confirmation: RecoveryRequest | null;
  recoveryPhaseError: string | null;
  incidentMode: RecoveryIncidentMode | null;
  adminToken: string;
  incidentBusy: boolean;
};

const INITIAL_STATE: RecoveryState = {
  list: null,
  freshness: null,
  wallet: "",
  loading: true,
  error: null,
  submitting: null,
  confirmation: null,
  recoveryPhaseError: null,
  incidentMode: null,
  adminToken: "",
  incidentBusy: false,
};

const EVM_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const STELLAR_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
const DEMO_EVM_TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const DEMO_EVM_SPENDER = "0x3ED3E93047b4bCF2e6Ab0744Db08a132d0c97D7d";

function formatTimestamp(value: string | undefined): string {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function statusColorClass(status: RecoveryRequest["status"]): string {
  if (status === "confirmed") return "text-emerald-300 border-emerald-300/35 bg-emerald-500/10";
  if (status === "failed" || status === "stale") return "text-red-200 border-red-300/35 bg-red-500/10";
  if (status === "submitted") return "text-[#f2c86d] border-[#d9a441]/35 bg-[#d9a441]/10";

  return "text-white/74 border-white/15 bg-white/6";
}

function buildActionBody(action: RecoveryAction, wallet: string): Record<string, unknown> {
  if (action.type === "remove_trustline") {
    return {
      walletAddress: wallet,
      network: "stellar-testnet",
      asset: "USDC:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    };
  }

  if (action.type === "reduce_allowance" || action.type === "revoke_allowance") {
    return {
      walletAddress: wallet,
      action: action.type === "reduce_allowance" ? "reduce" : "revoke",
      network: "ethereum-sepolia",
      chainFamily: "evm",
      asset: DEMO_EVM_TOKEN,
      consumer: DEMO_EVM_SPENDER,
      currentAllowance: "115792089237316195423570985008687907853269984665640564039457",
      newAllowance: action.type === "reduce_allowance" ? "1000000" : "0",
      expectedFeeUsd: "1.20",
      isInfiniteApproval: true,
    };
  }

  return { walletAddress: wallet, network: "ethereum-sepolia", chainFamily: "evm" };
}

function resolveEndpoint(action: RecoveryAction): string {
  if (action.type === "pause_agent" || action.type === "revoke_agent") {
    return `/api/recovery/${action.type === "pause_agent" ? "pause" : "revoke"}`;
  }

  if (action.type === "remove_trustline") {
    return "/api/recovery/trustline";
  }

  return "/api/recovery/allowance";
}

export function RecoveryClient({ initialWallet }: { initialWallet?: string }) {
  const [state, setState] = useState<RecoveryState>(() => ({ ...INITIAL_STATE, wallet: initialWallet ?? "" }));
  const [confirmPrompt, setConfirmPrompt] = useState<RecoveryRequest | null>(null);
  const [showEraseDialog, setShowEraseDialog] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [erasureReceipt, setErasureReceipt] = useState<{
    ok: boolean;
    deletedAt: string;
    walletAddress: string;
    receipt?: {
      sha256?: string;
      body?: {
        receiptId?: string;
        totalDeleted?: number;
        totalAnonymized?: number;
        residueCheckPassed?: boolean;
      };
    };
  } | null>(null);

  const setPartial = useCallback((patch: Partial<RecoveryState>) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  const refresh = useCallback(async (refreshWallet: string) => {
    setPartial({ loading: true, error: null });

    try {
      const url = `/api/recovery${refreshWallet ? `?wallet=${encodeURIComponent(refreshWallet)}` : ""}`;
      const response = await fetch(url, { cache: "no-store" });
      const payload = (await response.json()) as RecoveryList & { summary?: { recent?: RecoveryRequest[] } } & { error?: string };

      if (!response.ok) {
        setPartial({ loading: false, error: payload.error ?? `Request failed with ${response.status}` });

        return;
      }

      const freshness = (payload.requests ?? [])
        .map((request, index) => ({
          request,
          index,
          value: request.lastVerifiedLedger ?? request.lastVerifiedBlockNumber,
        }))
        .filter((entry) => Boolean(entry.value))
        .reduce<RecoveryNetworkFreshness | null>((acc, entry) => {
          if (acc) return acc;

          return {
            network: entry.request.chainId ?? "Connected wallet",
            chainFamily: entry.request.chainFamily ?? "any",
            ledger: entry.request.lastVerifiedLedger,
            blockNumber: entry.request.lastVerifiedBlockNumber,
            checkedAt: entry.request.updatedAt,
            freshnessSeconds: 0,
            degraded: entry.request.status === "stale",
          };
        }, null);

      setPartial({
        list: payload,
        freshness,
        incidentMode: payload.incidentMode ?? null,
        loading: false,
        error: null,
      });
    } catch (cause) {
      setPartial({ loading: false, error: cause instanceof Error ? cause.message : "Recovery API unreachable." });
    }
  }, [setPartial]);

  // External-system sync: re-fetch when the connected wallet changes.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void refresh(state.wallet);
  }, [refresh, state.wallet]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const confirmOnchainHash = useCallback(async (record: RecoveryRequest, txHash: string, wallet: string) => {
    const confirmResponse = await fetch("/api/recovery/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recoveryId: record.id,
        walletAddress: wallet,
        txHash,
        chainFamily: record.chainFamily ?? "evm",
        userApproved: true,
      }),
    });
    const confirmPayload = (await confirmResponse.json()) as { recovery?: RecoveryRequest; error?: string; detail?: string };

    if (!confirmResponse.ok || !confirmPayload.recovery) {
      setPartial({
        error: confirmPayload.detail ?? confirmPayload.error ?? `Confirm failed with ${confirmResponse.status}.`,
        recoveryPhaseError: "confirm_failed",
        confirmation: record,
      });

      return;
    }

    setPartial({ confirmation: confirmPayload.recovery, error: null, recoveryPhaseError: null });

    await refresh(wallet);
  }, [refresh, setPartial]);

  const submitRecovery = useCallback(async (action: RecoveryAction) => {
    if (!state.wallet) {
      setPartial({ error: "Connect a wallet before running recovery actions." });

      return;
    }

    setPartial({ submitting: action.type, error: null, recoveryPhaseError: null, confirmation: null });
    setConfirmPrompt(null);

    try {
      const response = await fetch(resolveEndpoint(action), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildActionBody(action, state.wallet)),
      });
      const payload = (await response.json()) as { recovery?: RecoveryRequest; error?: string };

      if (!response.ok || !payload.recovery) {
        setPartial({ submitting: null, error: payload.error ?? `Request failed with ${response.status}` });

        return;
      }

      setPartial({ confirmation: payload.recovery, submitting: null });
      setConfirmPrompt(payload.recovery);
    } catch (cause) {
      setPartial({ submitting: null, error: cause instanceof Error ? cause.message : "Recovery submission failed." });
    }
  }, [setPartial, state.wallet]);

  const handleConfirmSubmit = useCallback(async (record: RecoveryRequest, txHash: string) => {
    setConfirmPrompt(null);

    const isStellar = record.chainFamily === "stellar";
    const isValid = isStellar ? STELLAR_HASH_PATTERN.test(txHash) : EVM_HASH_PATTERN.test(txHash);

    if (!isValid) {
      setPartial({
        error: `Transaction hash does not match the expected ${record.chainFamily ?? "evm"} shape. UI never marks the recovery as confirmed.`,
        confirmation: record,
      });

      return;
    }

    await confirmOnchainHash(record, txHash, state.wallet);
  }, [confirmOnchainHash, setPartial, state.wallet]);

  const handleConfirmCancel = useCallback(() => {
    setConfirmPrompt(null);
    setPartial({
      error: "Recovery prepared. Reopen the action to confirm once your wallet broadcasts the transaction.",
    });

    void refresh(state.wallet);
  }, [refresh, setPartial, state.wallet]);

  const toggleIncident = useCallback(async () => {
    if (!state.adminToken) {
      setPartial({ error: "Admin token required. Set RECOVERY_ADMIN_TOKEN in env to enable the toggle." });

      return;
    }

    setPartial({ incidentBusy: true, error: null });

    try {
      const response = await fetch("/api/recovery/incident", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: !state.incidentMode?.enabled,
          adminToken: state.adminToken,
          reason: state.incidentMode?.enabled ? "Incident cleared by admin." : "Incident mode enabled by admin.",
        }),
      });
      const payload = (await response.json()) as { incidentMode?: RecoveryIncidentMode; error?: string };

      if (!response.ok) {
        setPartial({ incidentBusy: false, error: payload.error ?? `Request failed with ${response.status}` });

        return;
      }

      setPartial({ incidentBusy: false, incidentMode: payload.incidentMode ?? null });

      await refresh(state.wallet);
    } catch (cause) {
      setPartial({ incidentBusy: false, error: cause instanceof Error ? cause.message : "Incident toggle failed." });
    }
  }, [refresh, setPartial, state.adminToken, state.incidentMode, state.wallet]);

  const executeErasure = useCallback(async () => {
    if (!state.wallet) return;
    setErasing(true);
    setPartial({ error: null });
    try {
      const isEvm = state.wallet.startsWith("0x");
      const res = await fetch("/api/wallet-privacy/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: state.wallet,
          chainFamily: isEvm ? "evm" : "stellar",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPartial({ error: data.error ?? "Wallet data erasure failed." });
        return;
      }
      clearStressPresets();
      clearPaletteRecents();
      setErasureReceipt(data);
      setShowEraseDialog(false);
      void refresh(state.wallet);
    } catch (err) {
      setPartial({ error: err instanceof Error ? err.message : "Erasure request failed." });
    } finally {
      setErasing(false);
    }
  }, [refresh, setPartial, state.wallet]);

  const incidentActive = Boolean(state.incidentMode?.enabled);
  const records = state.list?.requests ?? [];
  const staleCount = state.list?.staleCount ?? records.filter((record) => record.status === "stale").length;
  const degraded = [incidentActive, staleCount > 0, Boolean(state.freshness?.degraded), Boolean(state.error)].some(Boolean);

  const onchainFreshnessLabel = useMemo(() => {
    if (!state.freshness) return "Provider freshness unavailable";

    return `${state.freshness.chainFamily.toUpperCase()} last verified at ${formatTimestamp(state.freshness.checkedAt)}${state.freshness.ledger ? ` \u00b7 ledger ${state.freshness.ledger}` : ""}${state.freshness.blockNumber ? ` \u00b7 block ${state.freshness.blockNumber}` : ""}`;
  }, [state.freshness]);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d9a441]/25 bg-[#d9a441]/10 px-3 py-1 text-xs text-[#f2c86d]">
            <Lock className="h-3 w-3" />
            V3 Emergency Recovery \u00b7 {RECOVERY_RULES_VERSION}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Emergency pause, revoke and recovery</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">
            Stop automation, revoke agents, reduce unsafe EVM allowances, and remove Stellar trustlines. The server never signs \u2014 the connected wallet signs every action.
          </p>
          <Link href="/insights/allowance-inventory" className="mt-3 inline-flex rounded-full border border-[#d9a441]/35 px-4 py-2 text-sm text-[#f2c86d] hover:bg-[#d9a441]/10">
            Inspect current token allowances
          </Link>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-xs text-white/46" htmlFor="recovery-wallet">
            Connected wallet
          </label>
          <input
            id="recovery-wallet"
            value={state.wallet}
            placeholder="0x\u2026 or G\u2026"
            onChange={(event) => setPartial({ wallet: event.target.value })}
            className="h-10 rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-[#d9a441]/50"
          />
        </div>
      </section>

      {incidentActive || degraded ? (
        <section className="grid gap-3 sm:grid-cols-2">
          {incidentActive ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-300/30 bg-red-500/10 p-4">
              <ShieldAlert className="mt-0.5 h-5 w-5 text-red-200" />
              <div>
                <div className="text-sm font-semibold text-red-100">Incident mode active</div>
                <div className="mt-1 text-sm leading-6 text-red-100/74">
                  New execution preparation is blocked. {state.incidentMode?.reason ?? "Review the incident before clearing."}
                </div>
                <div className="mt-1 text-xs text-red-100/64">
                  Updated {formatTimestamp(state.incidentMode?.updatedAt)} {state.incidentMode?.updatedBy ? `by ${state.incidentMode.updatedBy}` : ""}.
                </div>
              </div>
            </div>
          ) : null}
          {state.error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-white/15 bg-white/6 p-4">
              <CircleAlert className="mt-0.5 h-5 w-5 text-white/74" />
              <div>
                <div className="text-sm font-semibold">Recovery API degraded</div>
                <div className="mt-1 text-sm leading-6 text-white/54">
                  {state.error}. Pause/revoke controls remain reachable. The server denied live incident-mode toggle or RPC freshness updates.
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
          <div className="text-xs text-white/42">Rules version</div>
          <div className="mt-1 text-lg font-semibold">{RECOVERY_RULES_VERSION}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
          <div className="text-xs text-white/42">Stale records</div>
          <div className="mt-1 text-lg font-semibold">{staleCount}</div>
          <div className="mt-1 text-xs text-white/40">Re-prepare before resubmit.</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
          <div className="text-xs text-white/42">Freshness</div>
          <div className="mt-1 text-sm font-semibold">{onchainFreshnessLabel}</div>
        </div>
      </section>

      {/* ZONE 1: EMERGENCY PAUSE & REVERSIBLE CONTROLS */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <span className="rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 px-2.5 py-0.5 text-xs font-semibold">Zone 1</span>
        <h2 className="text-lg font-semibold text-white">Emergency Pause &amp; Allowance Controls (Reversible)</h2>
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {RECOVERY_ACTIONS.map((action) => {
          const Icon = action.icon;
          const working = state.submitting === action.type;
          const recent = records.find((record) => record.recoveryType === action.type);

          return (
            <article key={action.type} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/6 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#d9a441]/12 text-[#d9a441]">
                  <Icon className="h-5 w-5" />
                </div>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-white/46">
                  {action.chainFamily === "any" ? "All chains" : action.chainFamily.toUpperCase()}
                </span>
              </div>
              <div>
                <h2 className="text-base font-semibold">{action.label}</h2>
                <p className="mt-1 text-xs leading-5 text-white/40">{action.description}</p>
              </div>
              <button
                type="button"
                onClick={() => void submitRecovery(action)}
                disabled={working || !state.wallet || state.loading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#d9a441] px-4 text-sm font-semibold text-black transition hover:bg-[#f2c86d] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                Prepare in wallet
              </button>
              {recent ? (
                <div className={`rounded-2xl border px-3 py-2 text-xs ${statusColorClass(recent.status)}`}>
                  Last {recent.recoveryType.replaceAll("_", " ")}: {recent.status} \u00b7 {formatTimestamp(recent.updatedAt)}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      {state.confirmation ? (
        <section className="rounded-2xl border border-white/10 bg-white/6 p-5">
          <div className="text-xs uppercase tracking-[0.18em] text-white/45">Prepared recovery</div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">{state.confirmation.recoveryType.replaceAll("_", " ")}</div>
              <div className="mt-1 text-xs text-white/46">
                {state.confirmation.chainFamily?.toUpperCase()} \u00b7 wallet {state.confirmation.walletAddress.slice(0, 6)}\u2026{state.confirmation.walletAddress.slice(-4)}
              </div>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs ${statusColorClass(state.confirmation.status)}`}>
              {state.confirmation.status}
            </span>
          </div>
          <div className="mt-4 grid gap-2 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-white/38">Consequences (do not hide reserve, fee or asset outcomes)</div>
            <ul className="space-y-1 text-sm leading-6 text-white/60">
              {state.confirmation.consequences.map((line) => (
                <li key={line}>\u2022 {line}</li>
              ))}
            </ul>
          </div>
          {state.confirmation.txHash ? (
            <div className="mt-3 text-xs text-white/44">
              tx hash: <span className="font-mono">{state.confirmation.txHash}</span> \u00b7 confirmed {formatTimestamp(state.confirmation.confirmedAt)}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-[#d9a441]/25 bg-[#d9a441]/8 p-3 text-xs text-[#f2c86d]">
              The UI will only mark this record confirmed after the user wallet broadcasts a transaction hash matching {state.confirmation.chainFamily === "stellar" ? "a Stellar 64-char hex hash" : "an EVM 0x 64-char hash"}.
            </div>
          )}
        </section>
      ) : null}

      {/* ZONE 2: EXPORT MY DATA (SIGNED AUDIT BUNDLE) */}
      <section className="rounded-2xl border border-white/10 bg-white/6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-purple-400/20 text-purple-300 border border-purple-400/30 px-2.5 py-0.5 text-xs font-semibold">Zone 2</span>
              <h2 className="text-lg font-semibold text-white">Export My Data (Signed Audit Bundle)</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-white/60 max-w-2xl">
              Generate and download a verifiable, cryptographically signed JSON audit bundle. Contains your agent decisions, approval transitions, and transaction lifecycle while redacting sensitive private material.
            </p>
          </div>
          <div>
            <AuditExportButton />
          </div>
        </div>
      </section>

      {/* ZONE 3: REVOKE & ERASE WALLET DATA (DESTRUCTIVE) */}
      <section className="rounded-2xl border border-red-500/30 bg-red-950/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-red-400/20 text-red-300 border border-red-400/30 px-2.5 py-0.5 text-xs font-semibold">Zone 3</span>
              <h2 className="text-lg font-semibold text-red-200">Revoke &amp; Erase Wallet Data (Destructive)</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-white/60 max-w-2xl">
              Permanently delete all indexed scans, cached watchlist entries, strategy preferences, and authorization records linked to this wallet. This action is irreversible. Audit logs will be irreversibly anonymized according to GDPR retention standards.
            </p>
          </div>
          <div>
            <button
              type="button"
              disabled={!state.wallet || erasing}
              onClick={() => setShowEraseDialog(true)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-red-400/40 bg-red-500/20 px-4 text-sm font-semibold text-red-200 transition hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Erase wallet data
            </button>
          </div>
        </div>

        {erasureReceipt ? (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-xs text-white/80">
            <div className="flex items-center gap-2 font-semibold text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              Erasure Receipt Verified
            </div>
            <div className="mt-2 grid gap-1 font-mono text-[11px] text-white/60">
              <div>Wallet: {erasureReceipt.walletAddress}</div>
              <div>Deleted at: {erasureReceipt.deletedAt}</div>
              {erasureReceipt.receipt?.sha256 ? <div>Receipt SHA-256: {erasureReceipt.receipt.sha256}</div> : null}
              {erasureReceipt.receipt?.body?.receiptId ? <div>Receipt ID: {erasureReceipt.receipt.body.receiptId}</div> : null}
              {typeof erasureReceipt.receipt?.body?.totalDeleted === "number" ? <div>Records deleted: {erasureReceipt.receipt.body.totalDeleted}</div> : null}
              {typeof erasureReceipt.receipt?.body?.totalAnonymized === "number" ? <div>Records anonymized: {erasureReceipt.receipt.body.totalAnonymized}</div> : null}
            </div>
          </div>
        ) : null}
      </section>

      {records.length > 0 ? (
        <section>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
            <div className="text-sm font-semibold">Recovery history</div>
            <div className="text-xs text-white/46">{records.length} record{records.length === 1 ? "" : "s"}</div>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {records.slice(0, 12).map((record) => (
              <article key={record.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{record.recoveryType.replaceAll("_", " ")}</div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusColorClass(record.status)}`}>{record.status}</span>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-white/46">
                  <div>Wallet: <span className="font-mono">{record.walletAddress.slice(0, 6)}\u2026{record.walletAddress.slice(-4)}</span></div>
                  <div>Chain family: <span className="font-mono">{record.chainFamily ?? "any"}</span></div>
                  {record.asset ? <div>Asset: <span className="font-mono">{record.asset}</span></div> : null}
                  {record.consumer ? <div>Counterparty: <span className="font-mono">{record.consumer}</span></div> : null}
                  {record.txHash ? <div>TX hash: <span className="font-mono">{record.txHash.slice(0, 10)}\u2026{record.txHash.slice(-6)}</span></div> : null}
                  {record.lastVerifiedLedger ? <div>Last verified ledger: {record.lastVerifiedLedger}</div> : null}
                  {record.lastVerifiedBlockNumber ? <div>Last verified block: {record.lastVerifiedBlockNumber}</div> : null}
                  <div>Updated {formatTimestamp(record.updatedAt)}</div>
                </div>
                {record.consequences.length > 0 ? (
                  <ul className="mt-3 space-y-1 text-xs text-white/44">
                    {record.consequences.map((line) => (
                      <li key={line}>\u2022 {line}</li>
                    ))}
                  </ul>
                ) : null}
                {record.error ? <div className="mt-3 rounded-xl border border-red-300/30 bg-red-500/8 p-2 text-xs text-red-100/80">{record.error}</div> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-white/4 p-4">
        <div className="text-xs uppercase tracking-[0.18em] text-white/42">Incident admin</div>
        <p className="mt-2 text-xs leading-5 text-white/44">
          Setting <span className="font-mono">RECOVERY_ADMIN_TOKEN</span> env enables this toggle. The toggle disables new execution preparation server-wide and remains reachable even when providers are degraded.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="password"
            placeholder="RECOVERY_ADMIN_TOKEN"
            value={state.adminToken}
            onChange={(event) => setPartial({ adminToken: event.target.value })}
            className="h-10 flex-1 rounded-full border border-white/10 bg-black/20 px-4 text-sm text-white outline-none focus:border-[#d9a441]/50"
          />
          <button
            type="button"
            disabled={state.incidentBusy || !state.adminToken}
            onClick={() => void toggleIncident()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-red-300/35 bg-red-500/10 px-4 text-sm font-semibold text-red-100 transition hover:bg-red-500/16 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.incidentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : incidentActive ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
            {incidentActive ? "Clear incident" : "Enable incident"}
          </button>
        </div>
        {state.incidentMode ? (
          <div className="mt-3 text-xs text-white/44">
            Last updated {formatTimestamp(state.incidentMode.updatedAt)} {state.incidentMode.updatedBy ? `by ${state.incidentMode.updatedBy}` : ""}.
          </div>
        ) : null}
      </section>

      {confirmPrompt ? <ConfirmHashDialog record={confirmPrompt} onConfirm={handleConfirmSubmit} onCancel={handleConfirmCancel} /> : null}
      {showEraseDialog ? (
        <EraseConfirmationDialog
          wallet={state.wallet}
          onConfirm={executeErasure}
          onCancel={() => setShowEraseDialog(false)}
          busy={erasing}
        />
      ) : null}
    </div>
  );
}

function EraseConfirmationDialog({
  wallet,
  onConfirm,
  onCancel,
  busy,
}: {
  wallet: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const [input, setInput] = useState("");
  const last4 = wallet.slice(-4);
  const isValid = input.trim() === "ERASE" || input.trim() === last4;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="erase-dialog-title">
      <div className="w-full max-w-md rounded-[28px] border border-red-500/30 bg-[#141010] p-6 shadow-2xl">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-red-400">
          <AlertTriangle className="h-4 w-4" />
          Destructive Action
        </div>
        <h2 id="erase-dialog-title" className="mt-2 text-xl font-semibold text-white">Permanently erase wallet data</h2>
        <p className="mt-2 text-sm leading-6 text-white/70">
          You are about to irreversibly erase all local and persistent data for wallet <span className="font-mono text-white font-semibold">{wallet.slice(0, 6)}…{last4}</span>.
        </p>
        <p className="mt-2 text-xs text-white/50">
          To confirm, type <strong className="text-red-300 font-mono">ERASE</strong> or the last 4 characters (<strong className="text-red-300 font-mono">{last4}</strong>) below:
        </p>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type ERASE or last 4 digits"
          className="mt-4 h-11 w-full rounded-xl border border-red-500/30 bg-black/40 px-4 font-mono text-sm text-white outline-none focus:border-red-400"
          autoFocus
        />
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-10 rounded-full border border-white/10 px-4 text-sm text-white/64 transition hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!isValid || busy}
            onClick={() => void onConfirm()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Confirm Erase
          </button>
        </div>
      </div>
    </div>
  );
}

type ConfirmDialogProps = {
  record: RecoveryRequest;
  onConfirm: (record: RecoveryRequest, txHash: string) => Promise<void>;
  onCancel: () => void;
};

function ConfirmHashDialog({ record, onConfirm, onCancel }: ConfirmDialogProps) {
  const [value, setValue] = useState<string>("");
  const expectedLabel = record.chainFamily === "stellar" ? "Stellar 64-char hex hash" : "EVM 0x 64-char hex hash";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#101010] p-6 shadow-2xl">
        <div className="text-xs uppercase tracking-[0.18em] text-[#d9a441]">Confirm onchain broadcast</div>
        <h2 className="mt-2 text-xl font-semibold">{record.recoveryType.replaceAll("_", " ")}</h2>
        <p className="mt-2 text-sm leading-6 text-white/56">
          Paste the {expectedLabel} returned by your wallet. The UI marks this record confirmed only after the onchain hash matches the expected shape and the connected wallet matches the recovery wallet.
        </p>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="0x\u2026 64 hex chars"
          className="mt-4 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 font-mono text-sm text-white outline-none focus:border-[#d9a441]/50"
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-full border border-white/10 px-4 text-sm text-white/64 transition hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!value}
            onClick={() => void onConfirm(record, value.trim())}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#d9a441] px-4 text-sm font-semibold text-black transition hover:bg-[#f2c86d] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            Mark confirmed
          </button>
        </div>
      </section>
    </div>
  );
}
