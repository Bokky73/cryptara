"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useAccount, useWalletClient, useSwitchChain, useChainId } from "wagmi";
import { useStellarWallet } from "@/providers/StellarWalletProvider";
import { useWalletSession } from "@/hooks/useWalletSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useI18n, type I18nValue } from "@/i18n/I18nProvider";
import type {
  ApprovalValidationResult,
  PreparedTransactionPayload,
  EvmPreparedTransactionPayload,
  StellarPreparedTransactionPayload,
  TransactionPreview as Preview,
} from "@/server/types";
import {
  verifyPreparedPayloadAgainstPreview,
  type SigningVerificationIssue,
  type SigningVerificationResult,
} from "@/lib/signing/previewVerification";
import { SigningVerificationWarning } from "@/components/SigningVerificationWarning";
import { normalizeStellarNetworkId } from "@/lib/stellar/config";

type ApprovalState =
  | { phase: "idle" }
  | { phase: "validating" }
  | { phase: "ready_for_signing"; result: ApprovalValidationResult }
  | { phase: "signing" }
  | { phase: "signed"; signedPayload: string }
  | { phase: "submitting" }
  | { phase: "submitted"; txHash: string }
  | { phase: "rejected"; reason: string }
  | { phase: "security_warning"; issues: SigningVerificationIssue[] }
  | { phase: "expired" }
  | { phase: "wallet_error"; error: string }
  | { phase: "network_mismatch"; expectedNetwork: string; connectedNetwork: string }
  | { phase: "error"; error: string };

type ApprovalFlowClientProps = {
  idempotencyKey: string;
  walletAddress: string;
  chainFamily: "evm" | "stellar";
  network: string;
  sourceAccount?: string;
  /** The preview the user actually reviewed. Required before any signature. */
  preview?: Preview | null;
  onComplete?: (txHash: string) => void;
  onDismiss?: () => void;
  onRefresh?: () => void;
  refreshLabel?: string;
};

const RISK_THRESHOLD = 60;
const CONFIDENCE_THRESHOLD = 50;

function formatUsd(value: number | undefined, format: I18nValue["format"]): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return format.currency(value);
}

function formatCountdown(ms: number, t: I18nValue["t"]): string {
  if (ms <= 0) return t("quoteExpired");
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseExpiry(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value > 1e12 ? value : value * 1000;
  if (typeof value !== "string" || !value.trim()) return undefined;

  if (/^\d+$/.test(value.trim())) {
    const numeric = Number(value);
    return numeric > 1e12 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function blockingIssues(verdict: SigningVerificationResult): SigningVerificationIssue[] {
  return verdict.issues.filter((issue) => issue.blocking);
}

/** Final gate: no wallet prompt unless this resolves to an empty list. */
async function verifyBeforeWallet(input: {
  preview?: Preview | null;
  payload?: PreparedTransactionPayload | null;
  walletAddress: string;
  sourceAccount?: string;
  t: I18nValue["t"];
}): Promise<SigningVerificationIssue[]> {
  if (!input.preview) {
    return [{
      code: "malformed_payload",
      field: "preview",
      message: input.t("approvalNoPreview"),
      blocking: true,
      refreshRequired: true,
    }];
  }

  if (!input.payload) {
    return [{
      code: "malformed_payload",
      field: "payload",
      message: input.t("approvalNoPayload"),
      blocking: true,
      refreshRequired: true,
    }];
  }

  return blockingIssues(await verifyPreparedPayloadAgainstPreview({
    preview: input.preview,
    payload: input.payload,
    walletAddress: input.walletAddress,
    sourceAccount: input.sourceAccount,
  }));
}

export function ApprovalFlowClient({
  idempotencyKey,
  walletAddress,
  chainFamily,
  network,
  sourceAccount,
  preview,
  onComplete,
  onDismiss,
  onRefresh,
  refreshLabel,
}: ApprovalFlowClientProps) {
  const { t, format } = useI18n();
  const session = useWalletSession();
  const evm = useAccount();
  const evmChainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const stellar = useStellarWallet();
  const { actionsDisabled } = useOnlineStatus();

  const [state, setState] = useState<ApprovalState>({ phase: "idle" });
  const [payload, setPayload] = useState<PreparedTransactionPayload | null>(null);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const expectedSourceAccount = sourceAccount ?? (chainFamily === "stellar" ? stellar.address ?? undefined : undefined);
  const verificationWalletAddress =
    chainFamily === "stellar"
      ? stellar.address ?? expectedSourceAccount ?? walletAddress
      : session.address ?? walletAddress;

  // Auto-validate when the component mounts
  const validateApproval = useCallback(async () => {
    setState({ phase: "validating" });
    setRiskAcknowledged(false);

    try {
      const connectedWallet = session.address;
      const connectedNetwork =
        chainFamily === "stellar"
          ? stellar.network
          : evm.chain?.name ?? evm.chainId?.toString();

      const response = await fetch("/api/execute/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          walletAddress,
          chainFamily,
          network,
          sourceAccount,
          connectedWallet,
          connectedNetwork,
        }),
      });

      const result: ApprovalValidationResult = await response.json();

      if (!response.ok || !result.allowed) {
        if (result.expired) {
          setState({ phase: "expired" });
        } else if (!result.networkOk) {
          setState({
            phase: "network_mismatch",
            expectedNetwork: network,
            connectedNetwork: connectedNetwork ?? "unknown",
          });
        } else if (!result.walletOk) {
          setState({
            phase: "wallet_error",
            error: t("approvalWrongWallet", { expected: walletAddress, connected: connectedWallet ?? t("statusUnknown") }),
          });
        } else {
          setState({ phase: "error", error: result.blockedReason ?? t("approvalDenied") });
        }
        return;
      }

      setPayload(result.payload ?? null);

      const issues = await verifyBeforeWallet({
        preview,
        payload: result.payload,
        walletAddress: verificationWalletAddress,
        sourceAccount: expectedSourceAccount,
        t,
      });
      if (issues.length > 0) {
        setState({ phase: "security_warning", issues });
        return;
      }

      setState({ phase: "ready_for_signing", result });
    } catch (error) {
      setState({
        phase: "error",
        error: error instanceof Error ? error.message : t("approvalValidationFailed"),
      });
    }
  }, [idempotencyKey, walletAddress, chainFamily, network, sourceAccount, preview, session.address, stellar.network, verificationWalletAddress, expectedSourceAccount, evm.chain, evm.chainId, t]);

  useEffect(() => {
    if (state.phase !== "idle") return;
    const timer = window.setTimeout(() => void validateApproval(), 0);
    return () => window.clearTimeout(timer);
  }, [state.phase, validateApproval]);

  // Tick a clock so the quote expiry countdown stays live.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const displayParams = useMemo(
    () => ((payload as { displayParams?: Record<string, unknown> })?.displayParams ?? {}) as Record<string, unknown>,
    [payload],
  );

  const buyRisk = Number(displayParams.buyRisk ?? 0);
  const confidence = Number(displayParams.confidence ?? 100);
  const isHighRisk = buyRisk >= RISK_THRESHOLD || confidence < CONFIDENCE_THRESHOLD;

  const expiresAt = useMemo(() => {
    const candidates = [
      displayParams.expiresAt,
      displayParams.quoteExpiresAt,
      displayParams.preparationExpiry,
      preview?.quote?.expiresAt,
      preview?.lifecycle?.expiresAt,
      preview?.simulation?.quoteExpiry,
    ]
      .map(parseExpiry)
      .filter((value): value is number => value !== undefined);

    return candidates.length > 0 ? Math.min(...candidates) : undefined;
  }, [displayParams, preview]);

  const quoteExpired = expiresAt !== undefined && expiresAt <= now;

  const handleSignAndSubmit = useCallback(async () => {
    if (actionsDisabled || state.phase !== "ready_for_signing" || !payload) return;
    if (isHighRisk && !riskAcknowledged) return;
    if (quoteExpired) return;

    // Re-verify at click time so an expired quote or swapped payload can never
    // slip between validation and the wallet prompt.
    const issues = await verifyBeforeWallet({
      preview,
      payload,
      walletAddress,
      sourceAccount,
      t,
    });
    if (issues.length > 0) {
      setState({ phase: "security_warning", issues });
      return;
    }

    setState({ phase: "signing" });

    try {
      let signedPayload: string;

      if (chainFamily === "evm") {
        // EVM signing via wagmi walletClient
        const evmPayload = payload as EvmPreparedTransactionPayload;
        const targetChainId = evmPayload.chainId;

        // Switch network if needed
        if (evmChainId !== targetChainId) {
          try {
            await switchChainAsync({ chainId: targetChainId });
          } catch {
            setState({
              phase: "wallet_error",
              error: t("approvalSwitchChain", { chainId: targetChainId }),
            });
            return;
          }
        }

        if (!walletClient) {
          setState({ phase: "wallet_error", error: t("approvalEvmNotConnected") });
          return;
        }

        // Sign the transaction via the connected wallet (does NOT broadcast).
        // The signed serialized tx is sent to /api/execute/submit which
        // calls sendRawTransaction to broadcast it. This keeps broadcast
        // on the server so lifecycle tracking is consistent.
        const signedTx = await walletClient.signTransaction({
          account: walletClient.account,
          to: evmPayload.to as `0x${string}`,
          data: (evmPayload.data || "0x") as `0x${string}`,
          value: BigInt(evmPayload.value || "0"),
          chainId: targetChainId,
          ...(evmPayload.gas ? { gas: BigInt(evmPayload.gas) } : {}),
          ...(evmPayload.gasPrice ? { gasPrice: BigInt(evmPayload.gasPrice) } : {}),
        } as never);

        signedPayload = signedTx;
      } else {
        // Stellar signing via Stellar Wallets Kit
        const stellarPayload = payload as StellarPreparedTransactionPayload;

        if (!stellar.isConnected || !stellar.address) {
          setState({ phase: "wallet_error", error: t("approvalStellarNotConnected") });
          return;
        }

        // Verify the source account matches
        if (stellarPayload.sourceAccount && stellar.address !== stellarPayload.sourceAccount) {
          setState({
            phase: "wallet_error",
            error: t("approvalWrongStellarAccount", { expected: stellarPayload.sourceAccount ?? t("statusUnknown"), connected: stellar.address ?? t("statusUnknown") }),
          });
          return;
        }

        signedPayload = await stellar.signTransaction(
          stellarPayload.xdr,
          normalizeStellarNetworkId(preview?.network ?? network) ?? undefined,
        );
      }

      setState({ phase: "signed", signedPayload });

      // Submit the signed payload
      setState({ phase: "submitting" });

      const submitResponse = await fetch("/api/execute/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chainFamily,
          network,
          walletAddress,
          sourceAccount,
          signedPayload,
          asset: String(displayParams.asset ?? walletAddress),
          valueUsd: Number(displayParams.valueUsd ?? 0),
          userApproved: true,
          idempotencyKey,
          decisionAction: String(displayParams.action ?? "swap"),
        }),
      });

      if (!submitResponse.ok) {
        const errorData = await submitResponse.json().catch(() => ({ detail: t("approvalSubmissionFailed") }));
        setState({ phase: "wallet_error", error: errorData.detail ?? errorData.error ?? t("approvalSubmissionFailed") });
        return;
      }

      const submitResult = await submitResponse.json();
      const txHash = submitResult.hash ?? submitResult.transaction?.hash;
      setState({ phase: "submitted", txHash });
      onComplete?.(txHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("approvalSigningFailed");

      // Detect user rejection
      if (/reject|denied|cancel/i.test(message)) {
        setState({ phase: "rejected", reason: message });
      } else {
        setState({ phase: "wallet_error", error: message });
      }
    }
  }, [actionsDisabled, state.phase, payload, preview, isHighRisk, riskAcknowledged, quoteExpired, chainFamily, evmChainId, switchChainAsync, walletClient, stellar, network, walletAddress, sourceAccount, idempotencyKey, displayParams, onComplete, t]);

  const signDisabled =
    actionsDisabled ||
    state.phase !== "ready_for_signing" ||
    !payload ||
    quoteExpired ||
    (isHighRisk && !riskAcknowledged);

  const targetContract = String(displayParams.targetContract ?? displayParams.to ?? "");
  const explorerUrl = String(displayParams.explorerUrl ?? "");
  const verified = displayParams.verified === true;
  const youSend = String(displayParams.youSend ?? displayParams.amount ?? "—");
  const minReceive = String(displayParams.minReceive ?? displayParams.minimumReceive ?? "—");
  const maxSlippage = displayParams.maxSlippagePct ?? displayParams.slippagePct;
  const gasLabel = chainFamily === "stellar" ? t("stellarStroops") : t("estimatedGas");
  const gasValue = String(displayParams.gas ?? displayParams.stroops ?? "—");

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{t("executionReview")}</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          {t("approvalReviewIntro")}
        </p>
      </header>

      {state.phase === "security_warning" ? (
        <SigningVerificationWarning
          issues={state.issues}
          onRefresh={onRefresh ?? (() => window.location.reload())}
          refreshLabel={refreshLabel}
        />
      ) : null}

      {isHighRisk && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p className="font-semibold">{t("highRiskTransaction")}</p>
          <p className="mt-1">
            {t("approvalHighRiskDetail", { risk: buyRisk, confidence })}
          </p>
          <label className="mt-3 flex items-start gap-2">
            <input
              type="checkbox"
              checked={riskAcknowledged}
              onChange={(e) => setRiskAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>{t("approvalRiskAck")}</span>
          </label>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">{t("youSend")}</dt>
          <dd className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{youSend}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">{t("minimumYouReceive")}</dt>
          <dd className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {minReceive}
            {maxSlippage !== undefined && (
              <span className="ml-1 text-xs text-neutral-500">{t("maxSlippage", { value: String(maxSlippage) })}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">{t("usdEquivalent")}</dt>
          <dd className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {formatUsd(Number(displayParams.valueUsd ?? NaN), format)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">{t("networkTargetContract")}</dt>
          <dd className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
            <span>{network}</span>
            <span
              className={
                verified
                  ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200"
                  : "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200"
              }
            >
              {verified ? t("verified") : t("unverified")}
            </span>
            {targetContract && (
              <span className="font-mono text-xs break-all text-neutral-600 dark:text-neutral-300">{targetContract}</span>
            )}
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 underline dark:text-blue-400"
              >
                {t("viewOnExplorer")}
              </a>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">{gasLabel}</dt>
          <dd className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{gasValue}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">{t("quoteExpiry")}</dt>
          <dd className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {expiresAt !== undefined ? formatCountdown(expiresAt - now, t) : "—"}
          </dd>
        </div>
      </dl>

      {quoteExpired && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-semibold">{t("quoteExpired")}</p>
          <p className="mt-1">{t("quoteExpiredDetail")}</p>
          <button
            type="button"
            onClick={onRefresh ?? (() => window.location.reload())}
            className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            {t("refreshQuoteResimulate")}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <button
          type="button"
          onClick={() => void handleSignAndSubmit()}
          disabled={signDisabled}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("reviewInWallet")}
        </button>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          {t("approvalOnlyNotice")}
        </p>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-neutral-500 underline hover:text-neutral-700 dark:text-neutral-400"
          >
            {t("cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
