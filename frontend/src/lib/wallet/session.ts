import type { StellarNetworkId } from "@/lib/stellar/config";

export type WalletFamily = "evm" | "stellar";
export type StellarAdapterKind = "freighter" | "walletconnect" | "wallets-kit";

export type RestoredStellarSession = {
  version: 1;
  walletId: string;
  walletName: string;
  adapter: StellarAdapterKind;
  address: string;
  network: StellarNetworkId;
};

export const SELECTED_WALLET_FAMILY_KEY = "cryptara:selected-wallet-family:v1";
export const STELLAR_DISPLAY_SESSION_KEY = "cryptara:stellar-display-session:v1";

export function isWalletFamily(value: unknown): value is WalletFamily {
  return value === "evm" || value === "stellar";
}
export function parseRestoredStellarSession(value: string | null): RestoredStellarSession | null {
  if (!value) return null;

  try {
    const candidate = JSON.parse(value) as Partial<RestoredStellarSession>;
    const validAdapter = candidate.adapter === "freighter" || candidate.adapter === "walletconnect" || candidate.adapter === "wallets-kit";
    const validNetwork = candidate.network === "stellar-testnet" || candidate.network === "stellar-pubnet";

    if (
      candidate.version !== 1
      || !candidate.walletId
      || !candidate.walletName
      || !candidate.address
      || !validAdapter
      || !validNetwork
    ) {
      return null;
    }

    return candidate as RestoredStellarSession;
  } catch {
    return null;
  }
}

export function stellarAdapterKind(walletId: string): StellarAdapterKind {
  if (walletId === "freighter") return "freighter";
  if (walletId === "wallet_connect") return "walletconnect";

  return "wallets-kit";
}

export function shortenWalletAddress(address?: string) {
  if (!address) return "Not connected";
  if (address.length < 13) return address;

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * @deprecated Superseded by `resolveNetworkMismatch` in
 * `@/server/stellar/wallets/mismatch`, which distinguishes a wallet that
 * reports a different network from one that reports none at all. This wrapper
 * remains for callers that only need the two-state answer.
 */
export function getStellarMismatchMessage(walletNetwork: StellarNetworkId | undefined, expectedNetwork: StellarNetworkId) {
  if (!walletNetwork || walletNetwork === expectedNetwork) return null;

  return `Wallet is on ${walletNetwork}; switch it to ${expectedNetwork} in the wallet, then retry.`;
}
