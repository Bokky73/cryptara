"use client";

import { useAccount } from "wagmi";
import { getDefaultStellarNetwork } from "@/lib/stellar/config";
import { shortenWalletAddress } from "@/lib/wallet/session";
import { useStellarWallet } from "@/providers/StellarWalletProvider";
import { networkLabel } from "@/server/stellar/wallets/mismatch";
import { getWalletName } from "@/server/stellar/wallets/registry";
import { Orbit, Wallet } from "lucide-react";

function isEvmTestnet(chainId?: number, chainName?: string): boolean {
  if (!chainId && !chainName) return false;
  const name = (chainName ?? "").toLowerCase();
  if (name.includes("test") || name.includes("sepolia") || name.includes("goerli")) return true;
  // Common testnet chain IDs
  return chainId === 11155111 || chainId === 84532 || chainId === 5 || chainId === 80002;
}

export function WalletBadge() {
  const { displayAddress, walletId, network, isConnected: isStellarConnected, isRestored, capabilities } =
    useStellarWallet();
  const { address: evmAddress, chain: evmChain, isConnected: isEvmConnected, connector } = useAccount();

  const hasStellar = Boolean(displayAddress && walletId);
  const hasEvm = Boolean(isEvmConnected && evmAddress);

  if (!hasStellar && !hasEvm) return null;

  const stellarExplorerBase = getDefaultStellarNetwork().explorerUrl;
  const isStellarTestnet = (network ?? "").toLowerCase().includes("test") || network === "stellar-testnet";
  const evmTestnet = isEvmTestnet(evmChain?.id, evmChain?.name);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {/* EVM Connected Badge */}
      {hasEvm ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-950/30 px-3 py-1 text-white/80">
          <Wallet className="h-3 w-3 text-sky-400" />
          <span className="font-semibold text-white">{connector?.name ?? "EVM"}</span>
          <span
            className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono font-semibold uppercase ${
              evmTestnet
                ? "bg-amber-400/20 text-amber-200 border border-amber-400/40"
                : "bg-emerald-400/20 text-emerald-200 border border-emerald-400/40"
            }`}
          >
            {evmTestnet ? "TESTNET" : "MAINNET"}
          </span>
          <span className="text-white/50">{evmChain?.name ?? "EVM"}</span>
          <span className="font-mono text-white/70">{shortenWalletAddress(evmAddress)}</span>
        </span>
      ) : null}

      {/* Stellar Connected Badge */}
      {hasStellar ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-400/30 bg-purple-950/30 px-3 py-1 text-white/80">
          <Orbit className="h-3 w-3 text-purple-400" />
          <span className="font-semibold text-white">{getWalletName(walletId)}</span>
          <span
            className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono font-semibold uppercase ${
              isStellarTestnet
                ? "bg-amber-400/20 text-amber-200 border border-amber-400/40"
                : "bg-purple-400/20 text-purple-200 border border-purple-400/40"
            }`}
          >
            {isStellarTestnet ? "TESTNET" : "PUBNET"}
          </span>
          <a
            href={`${stellarExplorerBase}/account/${displayAddress}`}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono underline underline-offset-2 hover:text-white"
          >
            {shortenWalletAddress(displayAddress)}
          </a>
          {isRestored && !isStellarConnected ? (
            <span className="rounded-full border border-white/15 px-1.5 py-0.5 text-[10px] text-white/50">
              unverified
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

export default WalletBadge;
