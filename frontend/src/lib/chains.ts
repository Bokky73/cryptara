import { defineChain } from "viem";

export const goatNetwork = defineChain({
  id: 48816,
  name: "GOAT Network",
  nativeCurrency: {
    decimals: 18,
    name: "GOAT",
    symbol: "GOAT",
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_GOAT_RPC_URL ?? "https://rpc.goat.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "GOAT Explorer",
      url: process.env.NEXT_PUBLIC_GOAT_EXPLORER_URL ?? "https://explorer.goat.network",
    },
  },
});

// ---------------------------------------------------------------------------
// Chain-family helpers used by the RecentTransactions explorer link renderer.
// ---------------------------------------------------------------------------

export type ChainFamilyTag = "evm" | "stellar";

export type ChainMeta = {
  /** Human-readable display name, e.g. "Ethereum" */
  name: string;
  family: ChainFamilyTag;
  /** Base URL for a /tx/<hash> explorer deep link */
  explorerTxBaseUrl: string;
  /** Explorer brand name shown in tooltips */
  explorerName: string;
};

/**
 * Canonical per-network metadata used by the UI for explorer deep links.
 * Keys match the `network` values stored on `TransactionRecord`.
 * Stellar networks use the keys "stellar-testnet" and "stellar-pubnet"
 * (the canonical IDs from `lib/stellar/config.ts`).
 */
export const CHAIN_META: Record<string, ChainMeta> = {
  // ── EVM ──────────────────────────────────────────────────────────────────
  ethereum: {
    name: "Ethereum",
    family: "evm",
    explorerTxBaseUrl: "https://etherscan.io/tx",
    explorerName: "Etherscan",
  },
  base: {
    name: "Base",
    family: "evm",
    explorerTxBaseUrl: "https://basescan.org/tx",
    explorerName: "Basescan",
  },
  bsc: {
    name: "BNB Chain",
    family: "evm",
    explorerTxBaseUrl: "https://bscscan.com/tx",
    explorerName: "BscScan",
  },
  arbitrum: {
    name: "Arbitrum",
    family: "evm",
    explorerTxBaseUrl: "https://arbiscan.io/tx",
    explorerName: "Arbiscan",
  },
  polygon: {
    name: "Polygon",
    family: "evm",
    explorerTxBaseUrl: "https://polygonscan.com/tx",
    explorerName: "PolygonScan",
  },
  optimism: {
    name: "Optimism",
    family: "evm",
    explorerTxBaseUrl: "https://optimistic.etherscan.io/tx",
    explorerName: "Optimism Explorer",
  },
  avalanche: {
    name: "Avalanche",
    family: "evm",
    explorerTxBaseUrl: "https://snowtrace.io/tx",
    explorerName: "Snowtrace",
  },
  linea: {
    name: "Linea",
    family: "evm",
    explorerTxBaseUrl: "https://lineascan.build/tx",
    explorerName: "LineaScan",
  },
  scroll: {
    name: "Scroll",
    family: "evm",
    explorerTxBaseUrl: "https://scrollscan.com/tx",
    explorerName: "Scrollscan",
  },
  zksync: {
    name: "zkSync Era",
    family: "evm",
    explorerTxBaseUrl: "https://explorer.zksync.io/tx",
    explorerName: "zkSync Explorer",
  },
  opbnb: {
    name: "opBNB",
    family: "evm",
    explorerTxBaseUrl: "https://opbnb.bscscan.com/tx",
    explorerName: "opBNB Explorer",
  },
  mantle: {
    name: "Mantle",
    family: "evm",
    explorerTxBaseUrl: "https://mantlescan.xyz/tx",
    explorerName: "MantleScan",
  },
  blast: {
    name: "Blast",
    family: "evm",
    explorerTxBaseUrl: "https://blastscan.io/tx",
    explorerName: "Blastscan",
  },
  fantom: {
    name: "Fantom",
    family: "evm",
    explorerTxBaseUrl: "https://ftmscan.com/tx",
    explorerName: "FtmScan",
  },
  gnosis: {
    name: "Gnosis",
    family: "evm",
    explorerTxBaseUrl: "https://gnosisscan.io/tx",
    explorerName: "GnosisScan",
  },
  celo: {
    name: "Celo",
    family: "evm",
    explorerTxBaseUrl: "https://celoscan.io/tx",
    explorerName: "CeloScan",
  },
  moonbeam: {
    name: "Moonbeam",
    family: "evm",
    explorerTxBaseUrl: "https://moonscan.io/tx",
    explorerName: "Moonscan",
  },
  moonriver: {
    name: "Moonriver",
    family: "evm",
    explorerTxBaseUrl: "https://moonriver.moonscan.io/tx",
    explorerName: "Moonriver Moonscan",
  },
  berachain: {
    name: "Berachain",
    family: "evm",
    explorerTxBaseUrl: "https://berascan.com/tx",
    explorerName: "Berascan",
  },
  sonic: {
    name: "Sonic",
    family: "evm",
    explorerTxBaseUrl: "https://sonicscan.org/tx",
    explorerName: "SonicScan",
  },
  unichain: {
    name: "Unichain",
    family: "evm",
    explorerTxBaseUrl: "https://uniscan.xyz/tx",
    explorerName: "UniScan",
  },
  worldchain: {
    name: "World Chain",
    family: "evm",
    explorerTxBaseUrl: "https://worldscan.org/tx",
    explorerName: "WorldScan",
  },
  monad: {
    name: "Monad",
    family: "evm",
    explorerTxBaseUrl: "https://monadscan.com/tx",
    explorerName: "MonadScan",
  },
  plasma: {
    name: "Plasma",
    family: "evm",
    explorerTxBaseUrl: "https://plasmascan.to/tx",
    explorerName: "PlasmaScan",
  },
  goat: {
    name: "GOAT Network",
    family: "evm",
    explorerTxBaseUrl: `${(process.env.NEXT_PUBLIC_GOAT_EXPLORER_URL ?? "https://explorer.goat.network").replace(/\/$/, "")}/tx`,
    explorerName: "GOAT Explorer",
  },
  // ── Stellar ───────────────────────────────────────────────────────────────
  "stellar-testnet": {
    name: "Stellar Testnet",
    family: "stellar",
    explorerTxBaseUrl:
      (process.env.NEXT_PUBLIC_STELLAR_TESTNET_EXPLORER_URL ?? "https://stellar.expert/explorer/testnet") +
      "/tx",
    explorerName: "Stellar.Expert (Testnet)",
  },
  "stellar-pubnet": {
    name: "Stellar Pubnet",
    family: "stellar",
    explorerTxBaseUrl:
      (process.env.NEXT_PUBLIC_STELLAR_PUBNET_EXPLORER_URL ?? "https://stellar.expert/explorer/public") +
      "/tx",
    explorerName: "Stellar.Expert",
  },
};

/** Returns `ChainMeta` for a network key, or a sensible fallback. */
export function getChainMeta(network: string): ChainMeta {
  const normalized = network.trim().toLowerCase();
  return (
    CHAIN_META[normalized] ?? {
      name: network,
      family: "evm",
      explorerTxBaseUrl: `${goatNetwork.blockExplorers.default.url.replace(/\/$/, "")}/tx`,
      explorerName: "Block Explorer",
    }
  );
}

/** Builds a complete explorer deep-link URL for a transaction hash. */
export function buildExplorerTxUrl(hash: string, network: string): string {
  const meta = getChainMeta(network);
  return `${meta.explorerTxBaseUrl}/${hash}`;
}
import { defineChain } from "viem";

export const goatNetwork = defineChain({
  id: 48816,
  name: "GOAT Network",
  nativeCurrency: {
    decimals: 18,
    name: "GOAT",
    symbol: "GOAT",
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_GOAT_RPC_URL ?? "https://rpc.goat.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "GOAT Explorer",
      url: process.env.NEXT_PUBLIC_GOAT_EXPLORER_URL ?? "https://explorer.goat.network",
    },
  },
});

// ---------------------------------------------------------------------------
// Chain-family helpers used by the RecentTransactions explorer link renderer.
// ---------------------------------------------------------------------------

export type ChainFamilyTag = "evm" | "stellar";

export type ChainMeta = {
  /** Human-readable display name, e.g. "Ethereum" */
  name: string;
  family: ChainFamilyTag;
  /** Base URL for a /tx/<hash> explorer deep link */
  explorerTxBaseUrl: string;
  /** Explorer brand name shown in tooltips */
  explorerName: string;
};

/**
 * Canonical per-network metadata used by the UI for explorer deep links.
 * Keys match the `network` values stored on `TransactionRecord`.
 * Stellar networks use the keys "stellar-testnet" and "stellar-pubnet"
 * (the canonical IDs from `lib/stellar/config.ts`).
 */
export const CHAIN_META: Record<string, ChainMeta> = {
  // ── EVM ──────────────────────────────────────────────────────────────────
  ethereum: {
    name: "Ethereum",
    family: "evm",
    explorerTxBaseUrl: "https://etherscan.io/tx",
    explorerName: "Etherscan",
  },
  base: {
    name: "Base",
    family: "evm",
    explorerTxBaseUrl: "https://basescan.org/tx",
    explorerName: "Basescan",
  },
  bsc: {
    name: "BNB Chain",
    family: "evm",
    explorerTxBaseUrl: "https://bscscan.com/tx",
    explorerName: "BscScan",
  },
  arbitrum: {
    name: "Arbitrum",
    family: "evm",
    explorerTxBaseUrl: "https://arbiscan.io/tx",
    explorerName: "Arbiscan",
  },
  polygon: {
    name: "Polygon",
    family: "evm",
    explorerTxBaseUrl: "https://polygonscan.com/tx",
    explorerName: "PolygonScan",
  },
  optimism: {
    name: "Optimism",
    family: "evm",
    explorerTxBaseUrl: "https://optimistic.etherscan.io/tx",
    explorerName: "Optimism Explorer",
  },
  avalanche: {
    name: "Avalanche",
    family: "evm",
    explorerTxBaseUrl: "https://snowtrace.io/tx",
    explorerName: "Snowtrace",
  },
  linea: {
    name: "Linea",
    family: "evm",
    explorerTxBaseUrl: "https://lineascan.build/tx",
    explorerName: "LineaScan",
  },
  scroll: {
    name: "Scroll",
    family: "evm",
    explorerTxBaseUrl: "https://scrollscan.com/tx",
    explorerName: "Scrollscan",
  },
  zksync: {
    name: "zkSync Era",
    family: "evm",
    explorerTxBaseUrl: "https://explorer.zksync.io/tx",
    explorerName: "zkSync Explorer",
  },
  opbnb: {
    name: "opBNB",
    family: "evm",
    explorerTxBaseUrl: "https://opbnb.bscscan.com/tx",
    explorerName: "opBNB Explorer",
  },
  mantle: {
    name: "Mantle",
    family: "evm",
    explorerTxBaseUrl: "https://mantlescan.xyz/tx",
    explorerName: "MantleScan",
  },
  blast: {
    name: "Blast",
    family: "evm",
    explorerTxBaseUrl: "https://blastscan.io/tx",
    explorerName: "Blastscan",
  },
  fantom: {
    name: "Fantom",
    family: "evm",
    explorerTxBaseUrl: "https://ftmscan.com/tx",
    explorerName: "FtmScan",
  },
  gnosis: {
    name: "Gnosis",
    family: "evm",
    explorerTxBaseUrl: "https://gnosisscan.io/tx",
    explorerName: "GnosisScan",
  },
  celo: {
    name: "Celo",
    family: "evm",
    explorerTxBaseUrl: "https://celoscan.io/tx",
    explorerName: "CeloScan",
  },
  moonbeam: {
    name: "Moonbeam",
    family: "evm",
    explorerTxBaseUrl: "https://moonscan.io/tx",
    explorerName: "Moonscan",
  },
  moonriver: {
    name: "Moonriver",
    family: "evm",
    explorerTxBaseUrl: "https://moonriver.moonscan.io/tx",
    explorerName: "Moonriver Moonscan",
  },
  berachain: {
    name: "Berachain",
    family: "evm",
    explorerTxBaseUrl: "https://berascan.com/tx",
    explorerName: "Berascan",
  },
  sonic: {
    name: "Sonic",
    family: "evm",
    explorerTxBaseUrl: "https://sonicscan.org/tx",
    explorerName: "SonicScan",
  },
  unichain: {
    name: "Unichain",
    family: "evm",
    explorerTxBaseUrl: "https://uniscan.xyz/tx",
    explorerName: "UniScan",
  },
  worldchain: {
    name: "World Chain",
    family: "evm",
    explorerTxBaseUrl: "https://worldscan.org/tx",
    explorerName: "WorldScan",
  },
  monad: {
    name: "Monad",
    family: "evm",
    explorerTxBaseUrl: "https://monadscan.com/tx",
    explorerName: "MonadScan",
  },
  plasma: {
    name: "Plasma",
    family: "evm",
    explorerTxBaseUrl: "https://plasmascan.to/tx",
    explorerName: "PlasmaScan",
  },
  goat: {
    name: "GOAT Network",
    family: "evm",
    explorerTxBaseUrl: `${(process.env.NEXT_PUBLIC_GOAT_EXPLORER_URL ?? "https://explorer.goat.network").replace(/\/$/, "")}/tx`,
    explorerName: "GOAT Explorer",
  },
  // ── Stellar ───────────────────────────────────────────────────────────────
  "stellar-testnet": {
    name: "Stellar Testnet",
    family: "stellar",
    explorerTxBaseUrl:
      (process.env.NEXT_PUBLIC_STELLAR_TESTNET_EXPLORER_URL ?? "https://stellar.expert/explorer/testnet") +
      "/tx",
    explorerName: "Stellar.Expert (Testnet)",
  },
  "stellar-pubnet": {
    name: "Stellar Pubnet",
    family: "stellar",
    explorerTxBaseUrl:
      (process.env.NEXT_PUBLIC_STELLAR_PUBNET_EXPLORER_URL ?? "https://stellar.expert/explorer/public") +
      "/tx",
    explorerName: "Stellar.Expert",
  },
};

/** Returns `ChainMeta` for a network key, or a sensible fallback. */
export function getChainMeta(network: string): ChainMeta {
  const normalized = network.trim().toLowerCase();
  return (
    CHAIN_META[normalized] ?? {
      name: network,
      family: "evm",
      explorerTxBaseUrl: `${goatNetwork.blockExplorers.default.url.replace(/\/$/, "")}/tx`,
      explorerName: "Block Explorer",
    }
  );
}

/** Builds a complete explorer deep-link URL for a transaction hash. */
export function buildExplorerTxUrl(hash: string, network: string): string {
  const meta = getChainMeta(network);
  return `${meta.explorerTxBaseUrl}/${hash}`;
}
