"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useAccount, useWalletClient, useSwitchChain, useChainId } from "wagmi";
import { useStellarWallet } from "@/providers/StellarWalletProvider";
import { useWalletSession } from "@/hooks/useWalletSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type {
  ApprovalValidationResult,
  PreparedTransactionPayload,
  EvmPreparedTransactionPayload,
  StellarPreparedTransactionPayload,
} from "@/server/types";

type ApprovalState =
  | { phase: "idle" }
  | { phase: "validating" }
  | { phase: "ready_for_signing"; result: ApprovalValidationResult }
  | { phase: "signing" }
  | { phase: "signed"; signedPayload: string }
  | { phase: "submitting" }
  | { phase: "submitted"; txHash: string }
  | { phase: "rejected"; reason: string }
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
  onComplete?: (txHash: string) => void;
  onDismiss?: () => void;
};

const RISK_THRESHOLD = 60;
const CONFIDENCE_THRESHOLD = 50;

function formatUsd(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function ApprovalFlowClient({
  idempotencyKey,
  walletAddress,
  chainFamily,
  network,
  sourceAccount,
  onComplete,
  onDismiss,
}: ApprovalFlowClientProps) {
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
            error: `Wrong wallet connected. Expected ${walletAddress}, got ${connectedWallet}`,
          });
        } else {
          setState({ phase: "error", error: result.blockedReason ?? "Approval denied." });
        }
        return;
      }

      setPayload(result.payload ?? null);
      setState({ phase: "ready_for_signing", result });
    } catch (error) {
      setState({
        phase: "error",
        error: error instanceof Error ? error.message : "Failed to validate approval.",
      });
    }
  }, [idempotencyKey, walletAddress, chainFamily, network, sourceAccount, session.address, stellar.network, evm.chain, evm.chainId]);

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
    const raw = displayParams.expiresAt ?? displayParams.quoteExpiresAt;
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
      const parsed = Date.parse(raw);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }, [displayParams]);

  const quoteExpired = expiresAt !== undefined && expiresAt <= now;

  const handleSignAndSubmit = useCallback(async () => {
    if (actionsDisabled || state.phase !== "ready_for_signing" || !payload) return;
    if (isHighRisk && !riskAcknowledged) return;
    if (quoteExpired) return;

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
              error: `Please switch your wallet to chain ID ${targetChainId} to sign this transaction.`,
            });
            return;
          }
        }

        if (!walletClient) {
          setState({ phase: "wallet_error", error: "EVM wallet is not connected. Connect via RainbowKit first." });
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
          setState({ phase: "wallet_error", error: "Stellar wallet is not connected. Connect via Stellar Wallets Kit first." });
          return;
        }

        // Verify the source account matches
        if (stellarPayload.sourceAccount && stellar.address !== stellarPayload.sourceAccount) {
          setState({
            phase: "wallet_error",
            error: `Wrong Stellar account connected. Expected ${stellarPayload.sourceAccount}, got ${stellar.address}.`,
          });
          return;
        }

        signedPayload = await stellar.signTransaction(stellarPayload.xdr);
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
        const errorData = await submitResponse.json().catch(() => ({ detail: "Submission failed." }));
        setState({ phase: "wallet_error", error: errorData.detail ?? errorData.error ?? "Submission failed." });
        return;
      }

      const submitResult = await submitResponse.json();
      setState({ phase: "submitted", txHash: submitResult.hash ?? submitResult.transaction?.hash });        onComplete?.(submitResult.hash ?? submitResult.transaction?.hash);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Signing failed.";

      // Detect user rejection
      if (/reject|denied|cancel/i.test(message)) {
        setState({ phase: "rejected", reason: message });
      } else {
        setState({ phase: "wallet_error", error: message });
      }
    }
  }, [actionsDisabled, state.phase, payload, isHighRisk, riskAcknowledged, quoteExpired, chainFamily, evmChainId, switchChainAsync, walletClient, stellar, network, walletAddress, sourceAccount, idempotencyKey, displayParams, onComplete]);

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
  const gasLabel = chainFamily === "stellar" ? "Stellar Stroops" : "Estimated Gas";
  const gasValue = String(displayParams.gas ?? displayParams.stroops ?? "—");

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Execution Review</h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Review the exact balance changes before signing. Nothing is signed until you approve.
        </p>
      </header>

      {isHighRisk && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p className="font-semibold">High-risk transaction</p>
          <p className="mt-1">
            Buy risk {buyRisk}% · Confidence {confidence}%. Review carefully before proceeding.
          </p>
          <label className="mt-3 flex items-start gap-2">
            <input
              type="checkbox"
              checked={riskAcknowledged}
              onChange={(e) => setRiskAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>I understand the risks and want to continue.</span>
          </label>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">You Send</dt>
          <dd className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{youSend}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">Minimum You Receive</dt>
          <dd className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {minReceive}
            {maxSlippage !== undefined && (
              <span className="ml-1 text-xs text-neutral-500">(max slippage {String(maxSlippage)}%)</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">USD Equivalent</dt>
          <dd className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {formatUsd(Number(displayParams.valueUsd ?? NaN))}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">Network &amp; Target Contract</dt>
          <dd className="flex flex-wrap items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
            <span>{network}</span>
            <span
              className={
                verified
                  ? "rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200"
                  : "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200"
              }
            >
              {verified ? "Verified" : "Unverified"}
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
                View on explorer
              </a>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">{gasLabel}</dt>
          <dd className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{gasValue}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">Quote Expiry</dt>
          <dd className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {expiresAt !== undefined ? formatCountdown(expiresAt - now) : "—"}
          </dd>
        </div>
      </dl>

      {quoteExpired && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-semibold">Quote expired</p>
          <p className="mt-1">This quote is no longer valid. Refresh to re-simulate before signing.</p>
          <button
            type="button"
            onClick={() => void validateApproval()}
            className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            Refresh Quote &amp; Re-simulate
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
          Review in Wallet
        </button>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Approval-Only: Cryptara never signs for you.
        </p>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs text-neutral-500 underline hover:text-neutral-700 dark:text-neutral-400"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
