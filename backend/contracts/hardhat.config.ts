import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";

// Only attach a signer when PRIVATE_KEY is provided so that `hardhat compile`
// and `hardhat test` work without any RPC or secret env vars.
const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 200 },
      // Pinned to match reproducible build scripts and provenance claims.
      evmVersion: "paris",
      metadata: {
        bytecodeHash: "ipfs",
        useLiteralContent: true,
      },
    },
  },
  networks: {
    hardhat: {},
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL ?? "https://rpc.sepolia.org",
      accounts,
    },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      accounts,
    },
    arbitrumSepolia: {
      url:
        process.env.ARBITRUM_SEPOLIA_RPC_URL ??
        "https://sepolia-rollup.arbitrum.io/rpc",
      accounts,
    },
    base: {
      url: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
      accounts,
    },
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
      accounts,
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com",
      accounts,
    },
    optimism: {
      url: process.env.OPTIMISM_RPC_URL ?? "https://mainnet.optimism.io",
      accounts,
    },
    goat: {
      url: process.env.GOAT_RPC_URL ?? "https://rpc.goat.network",
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY ?? "",
      baseSepolia: process.env.BASESCAN_API_KEY ?? "",
      base: process.env.BASESCAN_API_KEY ?? "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY ?? "",
      arbitrum: process.env.ARBISCAN_API_KEY ?? "",
      polygon: process.env.POLYGONSCAN_API_KEY ?? "",
      optimism: process.env.OPTIMISTIC_ETHERSCAN_API_KEY ?? "",
      goat: process.env.BLOCKSCOUT_API_KEY ?? "",
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
      {
        network: "arbitrum",
        chainId: 42161,
        urls: {
          apiURL: "https://api.arbiscan.io/api",
          browserURL: "https://arbiscan.io",
        },
      },
      {
        network: "goat",
        chainId: 2345,
        urls: {
          apiURL: "https://explorer.goat.network/api",
          browserURL: "https://explorer.goat.network",
        },
      },
    ],
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
