"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { useStellarWallet } from "@/providers/StellarWalletProvider";
import { readE2eWalletOverride } from "@/lib/e2e/browserWallet";
import {
  isWalletFamily,
  SELECTED_WALLET_FAMILY_KEY,
  type WalletFamily,
} from "@/lib/wallet/session";

type WalletSessionState = ReturnType<typeof buildWalletSession>;

const WalletSessionContext = createContext<WalletSessionState | null>(null);
const selectedFamilyChangedEvent = "cryptara:selected-family-changed";

function subscribeToSelectedFamily(callback: () => void) {
  window.addEventListener(selectedFamilyChangedEvent, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(selectedFamilyChangedEvent, callback);
    window.removeEventListener("storage", callback);
  };
}

function getSelectedFamilySnapshot() {
  return window.localStorage.getItem(SELECTED_WALLET_FAMILY_KEY);
}

function getServerSelectedFamilySnapshot() {
  return null;
}

function buildWalletSession(
  selectedFamily: WalletFamily | null,
  selectFamily: (family: WalletFamily) => void,
  stellar: ReturnType<typeof useStellarWallet>,
  evm: ReturnType<typeof useAccount>,
) {
  const family = selectedFamily;
  const selectedIsStellar = family === "stellar";
  const selectedIsEvm = family === "evm";
  const address = selectedIsStellar ? stellar.displayAddress : selectedIsEvm ? evm.address : undefined;
  const isConnected = selectedIsStellar ? stellar.isConnected : selectedIsEvm ? evm.isConnected : false;
  const isConnecting = selectedIsStellar
    ? stellar.isConnecting
    : selectedIsEvm && (evm.status === "connecting" || evm.status === "reconnecting");
  const isRestored = selectedIsStellar && stellar.isRestored;
  const evmExplorer = evm.chain?.blockExplorers?.default.url;

  const session = {
    family,
    selectedFamily,
    selectFamily,
    address,
    chain: selectedIsStellar ? stellar.network : selectedIsEvm ? evm.chain?.name : undefined,
    chainId: selectedIsEvm ? evm.chainId : undefined,
    walletType: selectedIsStellar ? stellar.walletName : selectedIsEvm ? evm.connector?.name : undefined,
    explorerUrl: selectedIsStellar && stellar.network && address
      ? `${stellar.network === "stellar-pubnet" ? "https://stellar.expert/explorer/public" : "https://stellar.expert/explorer/testnet"}/account/${address}`
      : selectedIsEvm && address && evmExplorer
        ? `${evmExplorer}/address/${address}`
        : undefined,
    signerCapability: selectedIsStellar
      ? stellar.canSign ? "ready" : stellar.mismatchMessage ? "blocked" : stellar.isRestored ? "reconnect" : "unavailable"
      : selectedIsEvm && evm.isConnected ? "ready" : "unavailable",
    isConnected,
    isConnecting,
    isRestored,
    status: isConnected ? "connected" : isConnecting ? "connecting" : isRestored ? "restored" : "disconnected",
    connectedFamilies: {
      evm: evm.isConnected,
      stellar: stellar.isConnected,
    },
    stellar,
    evm,
  } as const;

  const e2eWallet = readE2eWalletOverride();
  if (!e2eWallet) return session;

  if (e2eWallet.family === "evm") {
    return {
      ...session,
      family: "evm" as const,
      selectedFamily: "evm" as const,
      address: e2eWallet.address,
      chain: e2eWallet.chainName ?? "Base",
      chainId: e2eWallet.chainId,
      walletType: "E2E wallet",
      explorerUrl: `https://basescan.org/address/${e2eWallet.address}`,
      signerCapability: "ready" as const,
      isConnected: true,
      isConnecting: false,
      isRestored: false,
      status: "connected" as const,
      connectedFamilies: {
        evm: true,
        stellar: session.connectedFamilies.stellar,
      },
    };
  }

  return {
    ...session,
    family: "stellar" as const,
    selectedFamily: "stellar" as const,
    address: e2eWallet.address,
    chain: e2eWallet.network,
    walletType: e2eWallet.walletName ?? "Freighter (e2e)",
    explorerUrl: `${e2eWallet.network === "stellar-pubnet" ? "https://stellar.expert/explorer/public" : "https://stellar.expert/explorer/testnet"}/account/${e2eWallet.address}`,
    signerCapability: "reconnect" as const,
    isConnected: false,
    isConnecting: false,
    isRestored: true,
    status: "restored" as const,
  };
}

export function WalletSessionProvider({ children }: { children: ReactNode }) {
  const stellar = useStellarWallet();
  const evm = useAccount();
  const storedFamily = useSyncExternalStore(subscribeToSelectedFamily, getSelectedFamilySnapshot, getServerSelectedFamilySnapshot);
  const selectedFamily = isWalletFamily(storedFamily)
    ? storedFamily
    : stellar.isConnected || stellar.isRestored
      ? "stellar"
      : evm.isConnected
        ? "evm"
        : null;

  const selectFamily = useCallback((family: WalletFamily) => {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, family);
    window.dispatchEvent(new Event(selectedFamilyChangedEvent));
  }, []);

  const value = useMemo(
    () => buildWalletSession(selectedFamily, selectFamily, stellar, evm),
    [evm, selectFamily, selectedFamily, stellar],
  );

  return <WalletSessionContext.Provider value={value}>{children}</WalletSessionContext.Provider>;
}

export function useWalletSessionContext() {
  const context = useContext(WalletSessionContext);
  if (!context) throw new Error("useWalletSession must be used inside WalletSessionProvider.");
  return context;
}
