"use client";

import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import {
  WalletConnectModule,
  WALLET_CONNECT_ID,
  WalletConnectTargetChain,
} from "@creit.tech/stellar-wallets-kit/modules/wallet-connect";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import {
  KitEventType,
  type KitEventStateUpdated,
  type KitEventWalletSelected,
  type ModuleInterface,
  type Networks,
  SwkAppDarkTheme,
} from "@creit.tech/stellar-wallets-kit/types";

export type StellarWalletDescriptor = {
  id: string;
  name: string;
};

export type StellarAdapterInit = {
  network: Networks;
  selectedWalletId?: string;
};

export interface StellarWalletAdapter {
  readonly mobileWalletId?: string;
  init: (params: StellarAdapterInit) => void;
  onStateUpdated: (callback: (event: KitEventStateUpdated) => void) => () => void;
  onWalletSelected: (callback: (event: KitEventWalletSelected) => void) => () => void;
  onDisconnect: (callback: () => void) => () => void;
  connect: (walletId?: string) => Promise<{ address: string; wallet: StellarWalletDescriptor }>;
  selectWallet: (walletId: string) => void;
  getNetwork: () => Promise<{ network: string; networkPassphrase: string }>;
  signTransaction: (xdr: string, options: { address: string; networkPassphrase: string }) => Promise<{ signedTxXdr: string }>;
  openProfile: () => Promise<void>;
  disconnect: () => Promise<void>;
};

function walletConnectModule(): ModuleInterface | null {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

  if (!projectId) return null;

  const origin = window.location.origin;
  return new WalletConnectModule({
    projectId,
    allowedChains: [WalletConnectTargetChain.TESTNET, WalletConnectTargetChain.PUBLIC],
    metadata: {
      name: "Cryptara",
      description: "AI-powered crypto risk intelligence",
      url: origin,
      icons: [`${origin}/brand/logo.png`],
    },
  });
}

function configuredModules() {
  const modules = defaultModules().filter((module) => module.productId !== FREIGHTER_ID);
  const mobile = walletConnectModule();

  return [new FreighterModule(), ...modules, ...(mobile ? [mobile] : [])];
}

function selectedWallet(): StellarWalletDescriptor {
  const selectedModule = StellarWalletsKit.selectedModule;
  return { id: selectedModule.productId, name: selectedModule.productName };
}

export function createStellarWalletAdapter(): StellarWalletAdapter {
  const hasMobileAdapter = Boolean(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim());

  return {
    mobileWalletId: hasMobileAdapter ? WALLET_CONNECT_ID : undefined,
    init({ network, selectedWalletId }) {
      const modules = configuredModules();
      const canRestoreSelection = selectedWalletId && modules.some((module) => module.productId === selectedWalletId);

      StellarWalletsKit.init({
        modules,
        network,
        selectedWalletId: canRestoreSelection ? selectedWalletId : undefined,
        authModal: { hideUnsupportedWallets: false, showInstallLabel: true },
        theme: {
          ...SwkAppDarkTheme,
          primary: "#d9a441",
          "primary-foreground": "#050505",
          background: "#101010",
          "background-secondary": "#050505",
        },
      });
    },
    onStateUpdated(callback) {
      return StellarWalletsKit.on(KitEventType.STATE_UPDATED, callback);
    },
    onWalletSelected(callback) {
      return StellarWalletsKit.on(KitEventType.WALLET_SELECTED, callback);
    },
    onDisconnect(callback) {
      return StellarWalletsKit.on(KitEventType.DISCONNECT, callback);
    },
    async connect(walletId) {
      if (walletId) {
        StellarWalletsKit.setWallet(walletId);
        const result = await StellarWalletsKit.fetchAddress();
        return { ...result, wallet: selectedWallet() };
      }

      const result = await StellarWalletsKit.authModal();
      return { ...result, wallet: selectedWallet() };
    },
    selectWallet(walletId) {
      StellarWalletsKit.setWallet(walletId);
    },
    getNetwork() {
      return StellarWalletsKit.getNetwork();
    },
    signTransaction(xdr, options) {
      return StellarWalletsKit.signTransaction(xdr, options);
    },
    openProfile() {
      return StellarWalletsKit.profileModal();
    },
    disconnect() {
      return StellarWalletsKit.disconnect();
    },
  };
}
