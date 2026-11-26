"use client";

import { useStellarWallet } from "@/providers/StellarWalletProvider";
import { useAccount, useSwitchChain } from "wagmi";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw } from "lucide-react";

/**
 * Surfaces dual-chain network verdicts with one-click switching (issue #76 & #150).
 * Handles EVM chain mismatch with one-click switchEthereumChain, and Stellar
 * network mismatch with Freighter guidance.
 */
export function NetworkMismatchNotice() {
  const { networkStatus, sessionNotice } = useStellarWallet();
  const { chain: evmChain, chainId: evmChainId, isConnected: isEvmConnected } = useAccount();
  const { chains, switchChainAsync, isPending: isSwitching } = useSwitchChain();

  // wagmi leaves `chain` undefined for a chain outside the configured set.
  const isEvmUnsupported = isEvmConnected
    && evmChainId !== undefined
    && !chains.some((chain) => chain.id === evmChainId);

  async function handleEvmSwitch(targetChainId: number) {
    try {
      await switchChainAsync({ chainId: targetChainId });
    } catch {
      // Handled by wallet prompt
    }
  }

  // Both wallets can be connected at once, so neither notice hides the other.
  return (
    <>
      {isEvmUnsupported ? renderEvmNotice() : null}
      {renderStellarNotice()}
    </>
  );

  function renderEvmNotice() {
    const targetChain = chains[0];
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-400/30 bg-red-950/30 p-3.5 text-xs text-red-200 space-y-2"
      >
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <span>EVM Network Mismatch</span>
        </div>
        <p className="leading-5 text-red-200/80">
          Your EVM wallet is connected to an unsupported network ({evmChain?.name ?? `chain ${evmChainId}`}).
          Switch to a supported chain to evaluate tokens and sign approvals.
        </p>
        {targetChain ? (
          <button
            type="button"
            disabled={isSwitching}
            onClick={() => void handleEvmSwitch(targetChain.id)}
            className="inline-flex items-center gap-1.5 rounded-full bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            {isSwitching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Switch to {targetChain.name}
          </button>
        ) : null}
      </div>
    );
  }

  function renderStellarNotice() {
    if (sessionNotice) {
      return (
        <p
          role="status"
          className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs leading-5 text-amber-200"
        >
          {sessionNotice}
        </p>
      );
    }

    if (!networkStatus || networkStatus.kind === "match") return null;

    const blocking = networkStatus.kind === "mismatch";

    return (
      <div
        role={blocking ? "alert" : "status"}
        className={
          blocking
            ? "rounded-xl border border-red-400/30 bg-red-950/30 p-3.5 text-xs text-red-200 space-y-2"
            : "rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-xs leading-5 text-white/75"
        }
      >
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span>Stellar Network Notice</span>
        </div>
        <p className="leading-5 text-white/80">{networkStatus.message}</p>
        {blocking ? (
          <div className="mt-2 text-[11px] text-amber-200/90 font-mono">
            Tip: Open Freighter → Settings → Network → Select Testnet / Public.
          </div>
        ) : null}
      </div>
    );
  }
}

export default NetworkMismatchNotice;
