"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, ExternalLink, Laptop, Orbit, RefreshCw, Smartphone, Wallet, X } from "lucide-react";
import { useWalletSession } from "@/hooks/useWalletSession";
import { shortenWalletAddress } from "@/lib/wallet/session";
import { NetworkMismatchNotice } from "@/components/NetworkMismatchNotice";
import { WalletBadge } from "@/components/WalletBadge";

function isEvmTestnet(chainName?: string): boolean {
  if (!chainName) return false;
  const name = chainName.toLowerCase();
  return name.includes("test") || name.includes("sepolia") || name.includes("goerli");
}

export function WalletConnectButton() {
  const session = useWalletSession();
  const stellar = session.stellar;
  const [isOpen, setIsOpen] = useState(false);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const hasSession = session.isConnected || session.isRestored;

  const hasEvmExtension = typeof window !== "undefined" && Boolean((window as unknown as { ethereum?: unknown }).ethereum);
  const hasFreighterExtension = typeof window !== "undefined" && Boolean((window as unknown as { freighter?: unknown }).freighter);

  useEffect(() => {
    if (!isOpen) return;
    firstActionRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  const buttonLabel = hasSession
    ? shortenWalletAddress(session.address)
    : session.isConnecting
      ? "Connecting..."
      : "Connect Wallet";

  async function connectStellar(walletId?: string) {
    session.selectFamily("stellar");
    try {
      await stellar.connect(walletId);
      setIsOpen(true);
    } catch {
      setIsOpen(true);
    }
  }

  const isStellarTestnet = Boolean(stellar.network?.toLowerCase().includes("test") || stellar.network === "stellar-testnet");
  const isEvmChainTestnet = isEvmTestnet(session.chain);

  return (
    <div className="relative">
      <ConnectButton.Custom>
        {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => (
          <>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={isOpen}
              onClick={() => setIsOpen((value) => !value)}
              className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition sm:px-5 ${
                hasSession
                  ? "border border-white/10 bg-white/8 text-white hover:bg-white/12"
                  : "bg-[#d9a441] text-black hover:bg-[#f2c86d]"
              }`}
            >
              {session.family === "stellar" ? (
                <Orbit className="h-4 w-4 text-[#a99aff]" />
              ) : (
                <Wallet className="h-4 w-4" />
              )}
              <span className="max-w-28 truncate">{buttonLabel}</span>
            </button>

            {isOpen ? (
              <div
                role="dialog"
                aria-modal="false"
                aria-label="Wallet session"
                className="fixed inset-x-4 top-20 z-50 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-3xl border border-white/15 bg-[#111116] p-5 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-14 sm:w-[480px]"
              >
                {/* Header */}
                <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#d9a441]">
                      Dual-Chain Wallet Center
                    </div>
                    <div className="text-[11px] text-white/50">EVM (27 chains) + Stellar Soroban</div>
                  </div>
                  <button
                    ref={firstActionRef}
                    type="button"
                    onClick={() => setIsOpen(false)}
                    aria-label="Close wallet selector"
                    className="rounded-lg p-1.5 text-white/60 hover:bg-white/8 hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Status Notice / Mismatch */}
                <div className="mb-4 space-y-2">
                  <NetworkMismatchNotice />
                  <WalletBadge />
                </div>

                {/* DUAL-CHAIN SLOTS: SIDE BY SIDE ON DESKTOP */}
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* SLOT 1: EVM WALLET */}
                  <div className={`rounded-2xl border p-4 transition ${
                    session.family === "evm" && session.isConnected
                      ? "border-sky-400/40 bg-sky-950/25 ring-1 ring-sky-400/30"
                      : "border-white/10 bg-white/[0.03]"
                  }`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-xs text-white">
                        <Wallet className="h-3.5 w-3.5 text-sky-400" />
                        <span>EVM Slot</span>
                      </div>
                      {account ? (
                        <span
                          className={`rounded-full px-2 py-0.2 text-[10px] font-mono font-semibold uppercase ${
                            isEvmChainTestnet
                              ? "bg-amber-400/20 text-amber-200 border border-amber-400/40"
                              : "bg-emerald-400/20 text-emerald-200 border border-emerald-400/40"
                          }`}
                        >
                          {isEvmChainTestnet ? "TESTNET" : "MAINNET"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
                          Disconnected
                        </span>
                      )}
                    </div>

                    {account ? (
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="font-mono text-white/80">{shortenWalletAddress(account.address)}</div>
                        <div className="text-[11px] text-white/50">{chain?.name ?? "EVM Network"}</div>
                        <div className="pt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={openAccountModal}
                            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
                          >
                            Manage
                          </button>
                          {chain?.unsupported ? (
                            <button
                              type="button"
                              onClick={openChainModal}
                              className="rounded-lg bg-red-500/20 text-red-200 px-2.5 py-1 text-[11px]"
                            >
                              Switch Chain
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2.5">
                        <p className="text-[11px] text-white/50">Base, Ethereum, Arbitrum &amp; 24 more.</p>
                        <button
                          type="button"
                          onClick={() => {
                            session.selectFamily("evm");
                            openConnectModal();
                          }}
                          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-sky-500/20 border border-sky-400/30 px-3 text-xs font-semibold text-sky-200 hover:bg-sky-500/30 transition"
                        >
                          Connect EVM
                        </button>
                        {!hasEvmExtension ? (
                          <a
                            href="https://metamask.io/download/"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-white/40 hover:text-[#d9a441] underline underline-offset-2"
                          >
                            Install MetaMask <Download className="h-2.5 w-2.5" />
                          </a>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {/* SLOT 2: STELLAR WALLET */}
                  <div className={`rounded-2xl border p-4 transition ${
                    session.family === "stellar" && (stellar.isConnected || stellar.isRestored)
                      ? "border-purple-400/40 bg-purple-950/25 ring-1 ring-purple-400/30"
                      : "border-white/10 bg-white/[0.03]"
                  }`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-semibold text-xs text-white">
                        <Orbit className="h-3.5 w-3.5 text-purple-400" />
                        <span>Stellar Slot</span>
                      </div>
                      {stellar.displayAddress ? (
                        <span
                          className={`rounded-full px-2 py-0.2 text-[10px] font-mono font-semibold uppercase ${
                            isStellarTestnet
                              ? "bg-amber-400/20 text-amber-200 border border-amber-400/40"
                              : "bg-purple-400/20 text-purple-200 border border-purple-400/40"
                          }`}
                        >
                          {isStellarTestnet ? "TESTNET" : "PUBNET"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
                          Disconnected
                        </span>
                      )}
                    </div>

                    {stellar.displayAddress ? (
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="font-mono text-white/80">{shortenWalletAddress(stellar.displayAddress)}</div>
                        <div className="text-[11px] text-white/50">{stellar.walletName}</div>
                        <div className="pt-2 flex flex-wrap gap-2">
                          {stellar.isRestored ? (
                            <button
                              type="button"
                              onClick={() => void connectStellar(stellar.walletId)}
                              className="rounded-lg bg-purple-600 px-2.5 py-1 text-[11px] text-white hover:bg-purple-500 font-semibold"
                            >
                              Reconnect
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void stellar.openProfile()}
                              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
                            >
                              Profile
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <button
                          type="button"
                          disabled={stellar.isConnecting}
                          onClick={() => void connectStellar("freighter")}
                          className="inline-flex h-7 w-full items-center justify-between rounded-md bg-white/5 px-2 text-[11px] text-white hover:bg-white/10 transition"
                        >
                          <span>Freighter (Desktop)</span>
                          <Laptop className="h-3 w-3 text-[#a99aff]" />
                        </button>
                        <button
                          type="button"
                          disabled={stellar.isConnecting || !stellar.mobileAvailable}
                          onClick={() => void connectStellar("wallet_connect")}
                          className="inline-flex h-7 w-full items-center justify-between rounded-md bg-white/5 px-2 text-[11px] text-white hover:bg-white/10 transition"
                        >
                          <span>Mobile Stellar wallet</span>
                          <Smartphone className="h-3 w-3 text-[#a99aff]" />
                        </button>
                        <button
                          type="button"
                          disabled={stellar.isConnecting}
                          onClick={() => void connectStellar()}
                          className="inline-flex h-7 w-full items-center justify-between rounded-md bg-white/5 px-2 text-[11px] text-white hover:bg-white/10 transition"
                        >
                          <span>All Stellar wallets</span>
                          <Orbit className="h-3 w-3 text-[#a99aff]" />
                        </button>
                        {!hasFreighterExtension ? (
                          <a
                            href="https://www.freighter.app"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-white/40 hover:text-[#d9a441] underline underline-offset-2"
                          >
                            Install Freighter Extension <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                {/* ACTIVE SIGNER SELECTION */}
                <div className="mt-4 border-t border-white/10 pt-3">
                  <div className="text-[11px] uppercase tracking-wider text-white/40 mb-2">
                    Active Execution Signer
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        session.selectFamily("evm");
                        if (!session.connectedFamilies.evm) openConnectModal();
                      }}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                        session.family === "evm"
                          ? "bg-sky-500 text-white shadow-md"
                          : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                      }`}
                    >
                      Use EVM Signer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        session.selectFamily("stellar");
                        if (!stellar.displayAddress) void connectStellar();
                      }}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                        session.family === "stellar"
                          ? "bg-purple-600 text-white shadow-md"
                          : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                      }`}
                    >
                      Use Stellar Signer
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </ConnectButton.Custom>
    </div>
  );
}
