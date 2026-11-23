import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

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
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    outputFile: process.env.GAS_SNAPSHOT_FILE,
    noColors: Boolean(process.env.GAS_SNAPSHOT_FILE),
  },
  networks: {
    hardhat: {},
    goat: {
      url: process.env.GOAT_RPC_URL ?? "https://rpc.goat.network",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};

export default config;
