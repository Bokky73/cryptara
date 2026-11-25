"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { useStellarWallet } from "@/providers/StellarWalletProvider";
import { readE2eWalletOverride } from "@/lib/e2e/browserWallet";
import { clearWalletOfflineEntries, clearWalletPageCache } from "@/lib/offlineStore";
import { revokeWalletSession } from "@/lib/wallet/sessionRevocation";
import { clearX402Receipts } from "@/lib/x402ReceiptStore";
import {
  selectActiveChainFamily,
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

function clearSelectedFamily(family: WalletFamily) {
  if (window.localStorage.getItem(SELECTED_WALLET_FAMILY_KEY) !== family) return;
  window.localStorage.removeItem(SELECTED_WALLET_FAMILY_KEY);
  window.dispatchEvent(new Event(selectedFamilyChangedEvent));
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
    activeChainFamily: family,
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
      activeChainFamily: "evm" as const,
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
    activeChainFamily: "stellar" as const,
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

function clearWalletData(address: string) {
  clearWalletOfflineEntries(address);
  void clearWalletPageCache(address);
}

type ActiveIdentity = { family: WalletFamily; address: string; network?: string };

/** A network that has not been reported yet is not evidence of a change. */
function isSameIdentity(left: ActiveIdentity, right: ActiveIdentity) {
  return left.family === right.family
    && left.address === right.address
    && (!left.network || !right.network || left.network === right.network);
}

/**
 * Revokes the authenticated session when the active signer changes, and clears
 * cached data for any wallet, active or not, that was switched or disconnected.
 *
 * An EVM chain switch keeps the session, since the signer is unchanged and the
 * cookie is not chain-bound. A Stellar network switch revokes it: the challenge
 * was signed for one network passphrase.
 *
 * Layout effects run before passive effects, so the epoch is already bumped
 * when useWalletSession decides whether to challenge the new identity.
 */
function useSessionInvalidation(session: WalletSessionState) {
  const { evm, stellar } = session;
  const previousEvm = useRef<string | undefined>(undefined);
  const previousStellar = useRef<string | undefined>(undefined);
  const previousActive = useRef<ActiveIdentity | null>(null);

  // wagmi reports transient states while reconnecting; those are not disconnects.
  const evmSettling = evm.status === "connecting" || evm.status === "reconnecting";
  const evmAddress = evm.isConnected ? evm.address?.toLowerCase() : undefined;
  const stellarAddress = stellar.isConnected ? stellar.address : undefined;
  const sessionNotice = stellar.sessionNotice;

  useLayoutEffect(() => {
    if (evmSettling) return;
    const previous = previousEvm.current;
    previousEvm.current = evmAddress;
    if (!previous || previous === evmAddress) return;

    clearWalletData(previous);
    clearX402Receipts();
    if (!evmAddress) clearSelectedFamily("evm");
  }, [evmAddress, evmSettling]);

  useLayoutEffect(() => {
    const previous = previousStellar.current;
    previousStellar.current = stellarAddress;
    if (!previous || previous === stellarAddress) return;

    clearWalletData(previous);
    // After a switch inside the wallet the user is asked to reconnect. Keeping
    // the selection stops signing from moving to the EVM wallet meanwhile.
    if (!stellarAddress && !sessionNotice) clearSelectedFamily("stellar");
  }, [sessionNotice, stellarAddress]);

  const { family, isConnected } = session;
  const activeAddress = family === "evm" ? session.address?.toLowerCase() : session.address;
  const activeNetwork = family === "stellar" ? stellar.network : undefined;
  const activeSettling = family === "evm" && evmSettling;

  useLayoutEffect(() => {
    if (activeSettling) return;
    const next: ActiveIdentity | null = isConnected && family && activeAddress
      ? { family, address: activeAddress, network: activeNetwork }
      : null;
    const previous = previousActive.current;

    if (previous && next && isSameIdentity(previous, next)) {
      previousActive.current = { ...next, network: next.network ?? previous.network };
      return;
    }
    previousActive.current = next;
    if (previous) void revokeWalletSession();
  }, [activeAddress, activeNetwork, activeSettling, family, isConnected]);
}

export function WalletSessionProvider({ children }: { children: ReactNode }) {
  const stellar = useStellarWallet();
  const evm = useAccount();
  const storedFamily = useSyncExternalStore(subscribeToSelectedFamily, getSelectedFamilySnapshot, getServerSelectedFamilySnapshot);
  const selectedFamily = selectActiveChainFamily(storedFamily, {
    evmConnected: evm.isConnected,
    stellarConnected: stellar.isConnected,
    stellarRestored: stellar.isRestored,
  });

  const selectFamily = useCallback((family: WalletFamily) => {
    window.localStorage.setItem(SELECTED_WALLET_FAMILY_KEY, family);
    window.dispatchEvent(new Event(selectedFamilyChangedEvent));
  }, []);

  const value = useMemo(
    () => buildWalletSession(selectedFamily, selectFamily, stellar, evm),
    [evm, selectFamily, selectedFamily, stellar],
  );

  useSessionInvalidation(value);

  return <WalletSessionContext.Provider value={value}>{children}</WalletSessionContext.Provider>;
}

export function useWalletSessionContext() {
  const context = useContext(WalletSessionContext);
  if (!context) throw new Error("useWalletSession must be used inside WalletSessionProvider.");
  return context;
}
