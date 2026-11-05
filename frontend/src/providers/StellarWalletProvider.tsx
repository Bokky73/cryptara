"use client";

import { Networks } from "@creit.tech/stellar-wallets-kit/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { getDefaultStellarNetwork, getStellarNetwork, normalizeStellarNetworkId, type StellarNetworkId } from "@/lib/stellar/config";
import {
  createStellarWalletAdapter,
  type StellarWalletAdapter,
  type StellarWalletDescriptor,
} from "@/lib/stellar/wallet-adapter";
import {
  getWalletCapabilities,
  gateOnCapability,
  type WalletCapabilities,
} from "@/server/stellar/wallets/capabilities";
import { blocksSigning, resolveNetworkMismatch, type NetworkMismatch } from "@/server/stellar/wallets/mismatch";
import { describeInvalidation, detectSessionInvalidation } from "@/server/stellar/wallets/session";
import {
  parseRestoredStellarSession,
  stellarAdapterKind,
  STELLAR_DISPLAY_SESSION_KEY,
  type RestoredStellarSession,
  type StellarAdapterKind,
} from "@/lib/wallet/session";

type StellarWalletState = {
  address?: string;
  displayAddress?: string;
  network?: StellarNetworkId;
  configuredNetwork: StellarNetworkId;
  walletId?: string;
  walletName?: string;
  adapter?: StellarAdapterKind;
  mobileAvailable: boolean;
  isConnected: boolean;
  isRestored: boolean;
  isConnecting: boolean;
  canSign: boolean;
  mismatchMessage: string | null;
  /** What the connected wallet can actually do. */
  capabilities: WalletCapabilities;
  /** The three-state network verdict, including "wallet did not report". */
  networkStatus: NetworkMismatch | null;
  /** Set when the wallet invalidated the session from its own side. */
  sessionNotice: string | null;
  error?: string;
  connect: (walletId?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  openProfile: () => Promise<void>;
  refreshNetwork: () => Promise<StellarNetworkId>;
  prepareSigning: (expectedNetwork?: StellarNetworkId) => Promise<string>;
  signTransaction: (xdr: string, expectedNetwork?: StellarNetworkId) => Promise<string>;
};

const StellarWalletContext = createContext<StellarWalletState | null>(null);
const stellarSessionChangedEvent = "cryptara:stellar-session-changed";

function notifyStellarSessionChanged() {
  window.dispatchEvent(new Event(stellarSessionChangedEvent));
}

function subscribeToStoredSession(callback: () => void) {
  window.addEventListener(stellarSessionChangedEvent, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(stellarSessionChangedEvent, callback);
    window.removeEventListener("storage", callback);
  };
}

function getStoredSessionSnapshot() {
  return window.localStorage.getItem(STELLAR_DISPLAY_SESSION_KEY);
}

function getServerSessionSnapshot() {
  return null;
}

function kitNetwork(network: StellarNetworkId) {
  return network === "stellar-pubnet" ? Networks.PUBLIC : Networks.TESTNET;
}

function networkFromPassphrase(passphrase: string): StellarNetworkId | null {
  if (passphrase === Networks.PUBLIC) return "stellar-pubnet";
  if (passphrase === Networks.TESTNET) return "stellar-testnet";

  return normalizeStellarNetworkId(passphrase);
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof Error) return cause.message;
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") return cause.message;

  return fallback;
}

export function StellarWalletProvider({
  children,
  adapter: adapterOverride,
}: {
  children: ReactNode;
  adapter?: StellarWalletAdapter;
}) {
  const configuredNetwork = getDefaultStellarNetwork().id;
  const [adapter] = useState(() => adapterOverride ?? createStellarWalletAdapter());

  const [address, setAddress] = useState<string>();
  const [network, setNetwork] = useState<StellarNetworkId>();
  const [wallet, setWallet] = useState<StellarWalletDescriptor>();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string>();
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  // Read inside the adapter subscription, which is registered once and must not
  // close over a stale wallet.
  const walletIdRef = useRef<string | undefined>(undefined);
  const storedSessionJson = useSyncExternalStore(subscribeToStoredSession, getStoredSessionSnapshot, getServerSessionSnapshot);
  const restored = useMemo(() => parseRestoredStellarSession(storedSessionJson), [storedSessionJson]);

  const clearSession = useCallback(() => {
    setAddress(undefined);
    walletIdRef.current = undefined;
    setNetwork(undefined);
    setWallet(undefined);
    window.localStorage.removeItem(STELLAR_DISPLAY_SESSION_KEY);
    notifyStellarSessionChanged();
  }, []);

  useEffect(() => {
    const cached = parseRestoredStellarSession(window.localStorage.getItem(STELLAR_DISPLAY_SESSION_KEY));
    adapter.init({
      network: kitNetwork(configuredNetwork),
      selectedWalletId: cached?.walletId,
    });

    const stopState = adapter.onStateUpdated((event) => {
      const observed = event.payload.address ?? null;

      setAddress((current) => {
        // The first address of a connection is not a change.
        if (!current) return observed ?? current;
        if (observed === current) return current;

        // The user switched account or disconnected inside the wallet. The
        // session claims an address that is no longer the connected signer, so
        // it is discarded rather than silently repointed at the new one.
        const reason = detectSessionInvalidation(
          { walletId: walletIdRef.current ?? "", address: current, network: null },
          { address: observed },
        );

        if (reason) {
          setSessionNotice(describeInvalidation(reason, walletIdRef.current ?? ""));
          setNetwork(undefined);
          setWallet(undefined);
          window.localStorage.removeItem(STELLAR_DISPLAY_SESSION_KEY);
          notifyStellarSessionChanged();
          return undefined;
        }

        return observed ?? current;
      });
    });
    const stopWallet = adapter.onWalletSelected((event) => {
      const id = event.payload.id;
      if (!id) return;
      setWallet((current) => current?.id === id ? current : {
        id,
        name: cached?.walletId === id ? cached.walletName : id === "freighter" ? "Freighter" : id === "wallet_connect" ? "WalletConnect" : id,
      });
    });
    const stopDisconnect = adapter.onDisconnect(clearSession);

    return () => {
      stopState();
      stopWallet();
      stopDisconnect();
    };
  }, [adapter, clearSession, configuredNetwork]);

  useEffect(() => {
    if (!address || !network || !wallet) return;
    const next: RestoredStellarSession = {
      version: 1,
      walletId: wallet.id,
      walletName: wallet.name,
      adapter: stellarAdapterKind(wallet.id),
      address,
      network,
    };
    window.localStorage.setItem(STELLAR_DISPLAY_SESSION_KEY, JSON.stringify(next));
    notifyStellarSessionChanged();
  }, [address, network, wallet]);

  const connect = useCallback(async (walletId?: string) => {
    setIsConnecting(true);
    setError(undefined);

    try {
      if (walletId === "wallet_connect" && !adapter.mobileWalletId) {
        throw new Error("Mobile wallet connection is not configured. Add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID and retry.");
      }
      const result = await adapter.connect(walletId);
      const walletNetwork = await adapter.getNetwork();
      const nextNetwork = networkFromPassphrase(walletNetwork.networkPassphrase);
      if (!nextNetwork) throw new Error(`Unsupported Stellar network: ${walletNetwork.network || walletNetwork.networkPassphrase}`);
      setAddress(result.address);
      setWallet(result.wallet);
      walletIdRef.current = result.wallet.id;
      setNetwork(nextNetwork);
      setSessionNotice(null);
    } catch (cause) {
      const message = errorMessage(cause, "Stellar wallet connection was cancelled.");
      setAddress(undefined);
      setNetwork(undefined);
      setWallet(undefined);
      setError(message);
      throw cause;
    } finally {
      setIsConnecting(false);
    }
  }, [adapter]);

  const disconnect = useCallback(async () => {
    try {
      await adapter.disconnect();
    } finally {
      clearSession();
      setError(undefined);
    }
  }, [adapter, clearSession]);

  const openProfile = useCallback(async () => {
    if (!address) throw new Error("Reconnect the Stellar wallet before opening its profile.");
    if (wallet?.id) adapter.selectWallet(wallet.id);
    await adapter.openProfile();
  }, [adapter, address, wallet]);

  const refreshNetwork = useCallback(async () => {
    if (!address || !wallet?.id) throw new Error("Reconnect the Stellar wallet before checking its network.");
    adapter.selectWallet(wallet.id);
    const result = await adapter.getNetwork();
    const nextNetwork = networkFromPassphrase(result.networkPassphrase);
    if (!nextNetwork) throw new Error(`Unsupported Stellar network: ${result.network || result.networkPassphrase}`);
    setNetwork(nextNetwork);
    return nextNetwork;
  }, [adapter, address, wallet]);

  const prepareSigning = useCallback(async (expectedNetwork: StellarNetworkId = configuredNetwork) => {
    if (!address || !wallet?.id) throw new Error("Connect a Stellar wallet before signing.");
    adapter.selectWallet(wallet.id);
    const currentNetwork = await refreshNetwork();
    const mismatch = getStellarMismatchMessage(currentNetwork, expectedNetwork);
    if (mismatch) throw new Error(mismatch);
    return address;
  }, [adapter, address, configuredNetwork, refreshNetwork, wallet]);

  const signTransaction = useCallback(async (xdr: string, expectedNetwork: StellarNetworkId = configuredNetwork) => {
    const signerAddress = await prepareSigning(expectedNetwork);
    const expected = getStellarNetwork(expectedNetwork);
    if (!expected) throw new Error(`Unsupported Stellar network: ${expectedNetwork}`);
    const result = await adapter.signTransaction(xdr, {
      address: signerAddress,
      networkPassphrase: expected.networkPassphrase,
    });
    return result.signedTxXdr;
  }, [adapter, configuredNetwork, prepareSigning]);

  const displayAddress = address ?? restored?.address;
  const displayNetwork = network ?? restored?.network;
  const displayWalletId = wallet?.id ?? restored?.walletId;
  // The three-state verdict: matching, mismatched, or not reported by the
  // wallet at all. The third case used to be collapsed into an error, which
  // made every non-reporting wallet look broken.
  const networkStatus = address && displayWalletId
    ? resolveNetworkMismatch(displayWalletId, network ?? null, configuredNetwork)
    : null;
  const mismatchMessage = networkStatus?.message ?? null;
  const capabilities = getWalletCapabilities(displayWalletId ?? "");
  const signingGate = displayWalletId ? gateOnCapability(displayWalletId, "sign") : null;
  const value = useMemo<StellarWalletState>(
    () => ({
      address,
      displayAddress,
      network: displayNetwork,
      configuredNetwork,
      walletId: displayWalletId,
      walletName: wallet?.name ?? restored?.walletName,
      adapter: displayWalletId ? stellarAdapterKind(displayWalletId) : undefined,
      mobileAvailable: Boolean(adapter.mobileWalletId),
      isConnected: Boolean(address),
      isRestored: Boolean(!address && restored),
      isConnecting,
      // An unreported network is surfaced but does not block: several wallets
      // simply cannot answer, and refusing them would be a worse outcome than
      // asking the user to confirm.
      canSign: Boolean(
        address && wallet && signingGate?.allowed && (!networkStatus || !blocksSigning(networkStatus)),
      ),
      mismatchMessage,
      capabilities,
      networkStatus,
      sessionNotice,
      error,
      connect,
      disconnect,
      openProfile,
      refreshNetwork,
      prepareSigning,
      signTransaction,
    }),
    [
      adapter.mobileWalletId,
      address,
      configuredNetwork,
      connect,
      disconnect,
      displayAddress,
      displayNetwork,
      displayWalletId,
      capabilities,
      error,
      isConnecting,
      mismatchMessage,
      networkStatus,
      sessionNotice,
      signingGate,
      openProfile,
      prepareSigning,
      refreshNetwork,
      restored,
      signTransaction,
      wallet,
    ],
  );

  return <StellarWalletContext.Provider value={value}>{children}</StellarWalletContext.Provider>;
}

export function useStellarWallet() {
  const context = useContext(StellarWalletContext);
  if (!context) throw new Error("useStellarWallet must be used inside StellarWalletProvider.");
  return context;
}
