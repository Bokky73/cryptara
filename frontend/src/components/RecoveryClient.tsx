"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, Lock, RotateCcw, ShieldAlert, ShieldCheck, Trash2, AlertTriangle } from "lucide-react";
import type { RecoveryChain, RecoveryIncidentMode, RecoveryList, RecoveryNetworkFreshness, RecoveryRequest, RecoveryType } from "@/server/types";
import { RECOVERY_RULES_VERSION } from "@/server/types";
import { AuditExportButton } from "@/components/AuditExportButton";
import { useI18n, type I18nValue } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";

type RecoveryAction = {
  type: RecoveryType;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  icon: typeof ShieldCheck;
  chainFamily: RecoveryChain;
};

const RECOVERY_ACTIONS: RecoveryAction[] = [
  {
    type: "pause_agent",
    labelKey: "recoveryActionPauseAgent",
    descriptionKey: "recoveryActionPauseAgentDetail",
    icon: ShieldAlert,
    chainFamily: "evm",
  },
  {
    type: "revoke_agent",
    labelKey: "recoveryActionRevokeAgent",
    descriptionKey: "recoveryActionRevokeAgentDetail",
    icon: ShieldCheck,
    chainFamily: "any",
  },
  {
    type: "reduce_allowance",
    labelKey: "recoveryActionReduceAllowance",
    descriptionKey: "recoveryActionReduceAllowanceDetail",
    icon: CircleAlert,
    chainFamily: "evm",
  },
  {
    type: "revoke_allowance",
    labelKey: "recoveryActionRevokeAllowance",
    descriptionKey: "recoveryActionRevokeAllowanceDetail",
    icon: Trash2,
    chainFamily: "evm",
  },
  {
    type: "remove_trustline",
    labelKey: "recoveryActionRemoveTrustline",
    descriptionKey: "recoveryActionRemoveTrustlineDetail",
    icon: RotateCcw,
    chainFamily: "stellar",
  },
];

const recoveryTypeKeys: Record<RecoveryType, MessageKey> = {
  pause_agent: "recoveryTypePauseAgent",
  revoke_agent: "recoveryTypeRevokeAgent",
  reduce_allowance: "recoveryTypeReduceAllowance",
  revoke_allowance: "recoveryTypeRevokeAllowance",
  remove_trustline: "recoveryTypeRemoveTrustline",
};

const recoveryStatusKeys: Record<string, MessageKey> = {
  prepared: "statusPrepared",
  submitted: "statusSubmitted",
  confirmed: "statusConfirmed",
  failed: "statusFailed",
  stale: "statusStale",
};

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

function formatTimestamp(value: string | undefined, format: I18nValue["format"]): string {
  if (!value) return "—";
  return format.dateTime(value);
}

function localizedRecoveryType(type: RecoveryType | undefined, t: I18nValue["t"]): string {
  if (!type) return t("statusUnknown");
  return t(recoveryTypeKeys[type]);
}

function localizedRecoveryStatus(status: string | undefined, t: I18nValue["t"]): string {
  if (!status || !recoveryStatusKeys[status]) return status ? status.replaceAll("_", " ") : t("statusUnknown");
  return t(recoveryStatusKeys[status]);
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
  const { t, format } = useI18n();
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
        setPartial({ loading: false, error: payload.error ?? t("requestFailedStatus", { status: response.status }) });

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
            network: entry.request.chainId ?? t("connectedWallet"),
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
      setPartial({ loading: false, error: cause instanceof Error ? cause.message : t("recoveryApiUnreachable") });
    }
  }, [setPartial, t]);

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
        error: confirmPayload.detail ?? confirmPayload.error ?? t("confirmFailedStatus", { status: confirmResponse.status }),
        recoveryPhaseError: "confirm_failed",
        confirmation: record,
      });

      return;
    }

    setPartial({ confirmation: confirmPayload.recovery, error: null, recoveryPhaseError: null });

    await refresh(wallet);
  }, [refresh, setPartial, t]);

  const submitRecovery = useCallback(async (action: RecoveryAction) => {
    if (!state.wallet) {
      setPartial({ error: t("connectWalletBeforeRecovery") });

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
        setPartial({ submitting: null, error: payload.error ?? t("requestFailedStatus", { status: response.status }) });

        return;
      }

      setPartial({ confirmation: payload.recovery, submitting: null });
      setConfirmPrompt(payload.recovery);
    } catch (cause) {
      setPartial({ submitting: null, error: cause instanceof Error ? cause.message : t("recoverySubmissionFailed") });
    }
  }, [setPartial, state.wallet, t]);

  const handleConfirmSubmit = useCallback(async (record: RecoveryRequest, txHash: string) => {
    setConfirmPrompt(null);

    const isStellar = record.chainFamily === "stellar";
    const isValid = isStellar ? STELLAR_HASH_PATTERN.test(txHash) : EVM_HASH_PATTERN.test(txHash);

    if (!isValid) {
      setPartial({
        error: t("txHashShapeMismatch", { family: record.chainFamily ?? "evm" }),
        confirmation: record,
      });

      return;
    }

    await confirmOnchainHash(record, txHash, state.wallet);
  }, [confirmOnchainHash, setPartial, state.wallet, t]);

  const handleConfirmCancel = useCallback(() => {
    setConfirmPrompt(null);
    setPartial({
      error: t("recoveryPreparedPrompt"),
    });

    void refresh(state.wallet);
  }, [refresh, setPartial, state.wallet, t]);

  const toggleIncident = useCallback(async () => {
    if (!state.adminToken) {
      setPartial({ error: t("adminTokenRequired") });

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
          reason: state.incidentMode?.enabled ? t("incidentClearedByAdmin") : t("incidentEnabledByAdmin"),
        }),
      });
      const payload = (await response.json()) as { incidentMode?: RecoveryIncidentMode; error?: string };

      if (!response.ok) {
        setPartial({ incidentBusy: false, error: payload.error ?? t("requestFailedStatus", { status: response.status }) });

        return;
      }

      setPartial({ incidentBusy: false, incidentMode: payload.incidentMode ?? null });

      await refresh(state.wallet);
    } catch (cause) {
      setPartial({ incidentBusy: false, error: cause instanceof Error ? cause.message : t("incidentToggleFailed") });
    }
  }, [refresh, setPartial, state.adminToken, state.incidentMode, state.wallet, t]);

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
        setPartial({ error: data.error ?? t("walletDataErasureFailed") });
        return;
      }
      setErasureReceipt(data);
      setShowEraseDialog(false);
      void refresh(state.wallet);
    } catch (err) {
      setPartial({ error: err instanceof Error ? err.message : t("erasureRequestFailed") });
    } finally {
      setErasing(false);
    }
  }, [refresh, setPartial, state.wallet, t]);

  const incidentActive = Boolean(state.incidentMode?.enabled);
  const records = state.list?.requests ?? [];
  const staleCount = state.list?.staleCount ?? records.filter((record) => record.status === "stale").length;
  const degraded = [incidentActive, staleCount > 0, Boolean(state.freshness?.degraded), Boolean(state.error)].some(Boolean);

  const onchainFreshnessLabel = useMemo(() => {
    if (!state.freshness) return t("providerFreshnessUnavailable");

    return [
      state.freshness.chainFamily.toUpperCase(),
      t("updatedAt", { time: formatTimestamp(state.freshness.checkedAt, format) }),
      state.freshness.ledger ? t("lastVerifiedLedger") + " " + state.freshness.ledger : null,
      state.freshness.blockNumber ? t("lastVerifiedBlock") + " " + state.freshness.blockNumber : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [format, state.freshness, t]);

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d9a441]/25 bg-[#d9a441]/10 px-3 py-1 text-xs text-[#f2c86d]">
            <Lock className="h-3 w-3" />
            V3 Emergency Recovery \u00b7 {RECOVERY_RULES_VERSION}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t("recoveryTitle")}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">
            {t("recoveryIntro")}
          </p>
          <Link href="/insights/allowance-inventory" className="mt-3 inline-flex rounded-full border border-[#d9a441]/35 px-4 py-2 text-sm text-[#f2c86d] hover:bg-[#d9a441]/10">
            {t("inspectAllowances")}
          </Link>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="text-xs text-white/46" htmlFor="recovery-wallet">
            {t("connectedWallet")}
          </label>
          <input
            id="recovery-wallet"
            value={state.wallet}
            placeholder={t("walletAddressPlaceholder")}
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
                <div className="text-sm font-semibold text-red-100">{t("incidentModeActive")}</div>
                <div className="mt-1 text-sm leading-6 text-red-100/74">
                  {t("incidentBlockedDetail", { reason: state.incidentMode?.reason ?? t("incidentDefaultReason") })}
                </div>
                <div className="mt-1 text-xs text-red-100/64">
                  {state.incidentMode?.updatedBy
                    ? t("updatedAtBy", { time: formatTimestamp(state.incidentMode.updatedAt, format), actor: state.incidentMode.updatedBy })
                    : t("updatedAt", { time: formatTimestamp(state.incidentMode?.updatedAt, format) })}
                </div>
              </div>
            </div>
          ) : null}
          {state.error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-white/15 bg-white/6 p-4">
              <CircleAlert className="mt-0.5 h-5 w-5 text-white/74" />
              <div>
                <div className="text-sm font-semibold">{t("recoveryApiDegraded")}</div>
                <div className="mt-1 text-sm leading-6 text-white/54">
                  {t("recoveryDegradedDetail", { error: state.error ?? t("statusUnknown") })}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
          <div className="text-xs text-white/42">{t("rulesVersion")}</div>
          <div className="mt-1 text-lg font-semibold">{RECOVERY_RULES_VERSION}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
          <div className="text-xs text-white/42">{t("staleRecords")}</div>
          <div className="mt-1 text-lg font-semibold">{staleCount}</div>
          <div className="mt-1 text-xs text-white/40">{t("reprepareBeforeResubmit")}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
          <div className="text-xs text-white/42">{t("freshness")}</div>
          <div className="mt-1 text-sm font-semibold">{onchainFreshnessLabel}</div>
        </div>
      </section>

      {/* ZONE 1: EMERGENCY PAUSE & REVERSIBLE CONTROLS */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2">
        <span className="rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 px-2.5 py-0.5 text-xs font-semibold">{t("zone1")}</span>
        <h2 className="text-lg font-semibold text-white">{t("zone1Title")}</h2>
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
                  {action.chainFamily === "any" ? t("allChains") : action.chainFamily.toUpperCase()}
                </span>
              </div>
              <div>
                <h2 className="text-base font-semibold">{t(action.labelKey)}</h2>
                <p className="mt-1 text-xs leading-5 text-white/40">{t(action.descriptionKey)}</p>
              </div>
              <button
                type="button"
                onClick={() => void submitRecovery(action)}
                disabled={working || !state.wallet || state.loading}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#d9a441] px-4 text-sm font-semibold text-black transition hover:bg-[#f2c86d] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                {t("prepareInWallet")}
              </button>
              {recent ? (
                <div className={`rounded-2xl border px-3 py-2 text-xs ${statusColorClass(recent.status)}`}>
                  {t("lastRecoveryAction", {
                    type: localizedRecoveryType(recent.recoveryType, t),
                    status: localizedRecoveryStatus(recent.status, t),
                    time: formatTimestamp(recent.updatedAt, format),
                  })}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>

      {state.confirmation ? (
        <section className="rounded-2xl border border-white/10 bg-white/6 p-5">
          <div className="text-xs uppercase tracking-[0.18em] text-white/45">{t("preparedRecovery")}</div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">{localizedRecoveryType(state.confirmation.recoveryType, t)}</div>
              <div className="mt-1 text-xs text-white/46">
                {t("recoveryWalletShort", {
                  chainFamily: state.confirmation.chainFamily?.toUpperCase() ?? t("chainFamilyAny"),
                  address: `${state.confirmation.walletAddress.slice(0, 6)}…${state.confirmation.walletAddress.slice(-4)}`,
                })}
              </div>
            </div>
            <span className={`rounded-full border px-3 py-1 text-xs ${statusColorClass(state.confirmation.status)}`}>
              {localizedRecoveryStatus(state.confirmation.status, t)}
            </span>
          </div>
          <div className="mt-4 grid gap-2 rounded-xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-white/38">{t("recoveryConsequences")}</div>
            <ul className="space-y-1 text-sm leading-6 text-white/60">
              {state.confirmation.consequences.map((line) => (
                <li key={line}>\u2022 {line}</li>
              ))}
            </ul>
          </div>
          {state.confirmation.txHash ? (
            <div className="mt-3 text-xs text-white/44">
              {t("recoveryTxHashConfirmed", {
                hash: state.confirmation.txHash,
                time: formatTimestamp(state.confirmation.confirmedAt, format),
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-xl border border-[#d9a441]/25 bg-[#d9a441]/8 p-3 text-xs text-[#f2c86d]">
              {t("recoveryHashRequirement", {
                expectedHashShape: state.confirmation.chainFamily === "stellar" ? t("stellarHashShape") : t("evmHashShape"),
              })}
            </div>
          )}
        </section>
      ) : null}

      {/* ZONE 2: EXPORT MY DATA (SIGNED AUDIT BUNDLE) */}
      <section className="rounded-2xl border border-white/10 bg-white/6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-purple-400/20 text-purple-300 border border-purple-400/30 px-2.5 py-0.5 text-xs font-semibold">{t("zone2")}</span>
              <h2 className="text-lg font-semibold text-white">{t("exportMyData")}</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-white/60 max-w-2xl">
              {t("zone2Detail")}
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
              <span className="rounded-full bg-red-400/20 text-red-300 border border-red-400/30 px-2.5 py-0.5 text-xs font-semibold">{t("zone3")}</span>
              <h2 className="text-lg font-semibold text-red-200">{t("eraseTitle")}</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-white/60 max-w-2xl">
              {t("zone3Detail")}
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
              {t("eraseWalletData")}
            </button>
          </div>
        </div>

        {erasureReceipt ? (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-xs text-white/80">
            <div className="flex items-center gap-2 font-semibold text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              {t("erasureReceiptVerified")}
            </div>
            <div className="mt-2 grid gap-1 font-mono text-[11px] text-white/60">
              <div>{t("walletLabel")} {erasureReceipt.walletAddress}</div>
              <div>{t("walletDeletedAt", { time: formatTimestamp(erasureReceipt.deletedAt, format) })}</div>
              {erasureReceipt.receipt?.sha256 ? <div>{t("receiptSha256", { value: erasureReceipt.receipt.sha256 })}</div> : null}
              {erasureReceipt.receipt?.body?.receiptId ? <div>{t("receiptIdLabel", { value: erasureReceipt.receipt.body.receiptId })}</div> : null}
              {typeof erasureReceipt.receipt?.body?.totalDeleted === "number" ? <div>{t("recordsDeleted", { count: erasureReceipt.receipt.body.totalDeleted })}</div> : null}
              {typeof erasureReceipt.receipt?.body?.totalAnonymized === "number" ? <div>{t("recordsAnonymized", { count: erasureReceipt.receipt.body.totalAnonymized })}</div> : null}
            </div>
          </div>
        ) : null}
      </section>

      {records.length > 0 ? (
        <section>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
            <div className="text-sm font-semibold">{t("recoveryHistory")}</div>
            <div className="text-xs text-white/46">
              {t(records.length === 1 ? "recoveryRecordOne" : "recoveryRecordOther", { count: records.length })}
            </div>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {records.slice(0, 12).map((record) => (
              <article key={record.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">{localizedRecoveryType(record.recoveryType, t)}</div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusColorClass(record.status)}`}>{localizedRecoveryStatus(record.status, t)}</span>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-white/46">
                  <div>{t("walletLabel")} <span className="font-mono">{record.walletAddress.slice(0, 6)}…{record.walletAddress.slice(-4)}</span></div>
                  <div>{t("chainFamilyLabel")} <span className="font-mono">{record.chainFamily ?? t("chainFamilyAny")}</span></div>
                  {record.asset ? <div>{t("assetLabel")} <span className="font-mono">{record.asset}</span></div> : null}
                  {record.consumer ? <div>{t("counterparty")} <span className="font-mono">{record.consumer}</span></div> : null}
                  {record.txHash ? <div>{t("txHashShort")} <span className="font-mono">{record.txHash.slice(0, 10)}…{record.txHash.slice(-6)}</span></div> : null}
                  {record.lastVerifiedLedger ? <div>{t("lastVerifiedLedger")} {record.lastVerifiedLedger}</div> : null}
                  {record.lastVerifiedBlockNumber ? <div>{t("lastVerifiedBlock")} {record.lastVerifiedBlockNumber}</div> : null}
                  <div>{t("updatedAt", { time: formatTimestamp(record.updatedAt, format) })}</div>
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
        <div className="text-xs uppercase tracking-[0.18em] text-white/42">{t("incidentAdmin")}</div>
        <p className="mt-2 text-xs leading-5 text-white/44">
          {t("incidentAdminDetail")}
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
            {incidentActive ? t("clearIncident") : t("enableIncident")}
          </button>
        </div>
        {state.incidentMode ? (
          <div className="mt-3 text-xs text-white/44">
            {state.incidentMode.updatedBy
              ? t("updatedAtBy", { time: formatTimestamp(state.incidentMode.updatedAt, format), actor: state.incidentMode.updatedBy })
              : t("updatedAt", { time: formatTimestamp(state.incidentMode.updatedAt, format) })}
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
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const last4 = wallet.slice(-4);
  const isValid = input.trim() === "ERASE" || input.trim() === last4;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-5 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="erase-dialog-title">
      <div className="w-full max-w-md rounded-[28px] border border-red-500/30 bg-[#141010] p-6 shadow-2xl">
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-red-400">
          <AlertTriangle className="h-4 w-4" />
          {t("destructiveAction")}
        </div>
        <h2 id="erase-dialog-title" className="mt-2 text-xl font-semibold text-white">{t("eraseConfirmTitle")}</h2>
        <p className="mt-2 text-sm leading-6 text-white/70">
          {t("eraseConfirmDetail", { wallet: `${wallet.slice(0, 6)}…${last4}` })}
        </p>
        <p className="mt-2 text-xs text-white/50">
          {t("eraseConfirmHint", { last4 })}
        </p>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("typeErasePlaceholder")}
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
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={!isValid || busy}
            onClick={() => void onConfirm()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t("confirmErase")}
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
  const { t } = useI18n();
  const [value, setValue] = useState<string>("");
  const expectedLabel = record.chainFamily === "stellar" ? t("stellarHashShape") : t("evmHashShape");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#101010] p-6 shadow-2xl">
        <div className="text-xs uppercase tracking-[0.18em] text-[#d9a441]">{t("confirmOnchainBroadcast")}</div>
        <h2 className="mt-2 text-xl font-semibold">{localizedRecoveryType(record.recoveryType, t)}</h2>
        <p className="mt-2 text-sm leading-6 text-white/56">
          {t("confirmHashDetail", { expectedLabel })}
        </p>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t("hashPlaceholder")}
          className="mt-4 h-11 w-full rounded-xl border border-white/10 bg-black/30 px-4 font-mono text-sm text-white outline-none focus:border-[#d9a441]/50"
        />
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-full border border-white/10 px-4 text-sm text-white/64 transition hover:text-white"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={!value}
            onClick={() => void onConfirm(record, value.trim())}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#d9a441] px-4 text-sm font-semibold text-black transition hover:bg-[#f2c86d] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            {t("markConfirmed")}
          </button>
        </div>
      </section>
    </div>
  );
}
