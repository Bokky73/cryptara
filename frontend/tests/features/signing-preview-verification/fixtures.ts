import {
  Account,
  Asset,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type {
  EvmPreparedTransactionPayload,
  StellarPreparedTransactionPayload,
  TransactionPreview as Preview,
} from "@/server/types";
import { hashPreparedTransactionClient } from "@/lib/signing/previewVerification";

export const EVM_WALLET = "0x5470F4AEe263f8FE432caBfE082a23601140bd50";
export const EVM_CONTRACT = "0x0000000000000000000000000000000000000001";
export const ATTACKER_CONTRACT = "0x000000000000000000000000000000000000dEaD";
export const EVM_DATA = "0x095ea7b30000000000000000000000000000000000000000000000000000000000000001";
export const TAMPERED_EVM_DATA = "0xa9059cbb0000000000000000000000000000000000000000000000000000000000000001";
export const STELLAR_NETWORK = "stellar-testnet";

// A deterministic test key — never used outside these fixtures.
const stellarKeypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
export const STELLAR_SOURCE = stellarKeypair.publicKey();

function futureIso(): string {
  return new Date(Date.now() + 10 * 60_000).toISOString();
}

export type EvmFixture = {
  preview: Preview;
  payload: EvmPreparedTransactionPayload;
  digest: string;
};

export async function createEvmFixture(): Promise<EvmFixture> {
  const digest = await hashPreparedTransactionClient({
    chainFamily: "evm",
    network: "goat",
    rawPayload: EVM_DATA,
    to: EVM_CONTRACT,
    value: "0",
    chainId: 48816,
    from: EVM_WALLET,
  });

  const payload: EvmPreparedTransactionPayload = {
    chainFamily: "evm",
    to: EVM_CONTRACT,
    data: EVM_DATA,
    value: "0",
    chainId: 48816,
    displayParams: {
      amount: "100",
      minReceive: "99",
      slippageBps: 100,
      targetContract: EVM_CONTRACT,
    },
  };

  const preview: Preview = {
    title: "Swap 30% USDC to WETH",
    action: "swap",
    fromToken: "USDC",
    toToken: "WETH",
    percent: 30,
    estimatedValueUsd: 100,
    currentRiskScore: 20,
    projectedRiskScore: 25,
    requiresApproval: true,
    network: "goat",
    targetContract: EVM_CONTRACT,
    slippageBps: 100,
    priceImpactBps: 10,
    quote: {
      provider: "none",
      route: ["USDC", "WETH"],
      exactInput: { token: "USDC", amount: 100 },
      exactOutput: { token: "WETH", amount: 99 },
      expectedOutputToken: "WETH",
      expectedOutputAmount: 99,
      minReceiveAmount: 99,
      estimatedValueUsd: 100,
      priceImpactBps: 10,
      slippageBps: 100,
      feesUsd: 1,
      gasEstimateUsd: 1,
      network: "goat",
      expiresAt: futureIso(),
      fetchedAt: new Date().toISOString(),
      quoteMismatch: false,
      status: "fresh",
      detail: "Fixture quote",
    },
    simulation: {
      provider: "eth_call",
      status: "passed",
      checks: ["Dry-run succeeded"],
      detail: "Fixture simulation",
      simulatedTxHash: digest,
      binding: { transactionHash: digest, quoteHash: "quote-fixture" },
    },
    policy: {
      maxTradePercent: 50,
      maxRiskScore: 60,
      maxMemeExposurePercent: 40,
      maxSlippageBps: 200,
      autoExecute: false,
    },
    audit: {
      approvalRequired: true,
      serverCanSign: false,
      userApproved: false,
    },
  };

  return { preview, payload, digest };
}

export type StellarFixture = {
  preview: Preview;
  payload: StellarPreparedTransactionPayload;
  xdr: string;
  digest: string;
};

export async function createStellarFixture(): Promise<StellarFixture> {
  const account = new Account(STELLAR_SOURCE, "38373288");
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(),
      sendAmount: "10",
      destination: STELLAR_SOURCE,
      destAsset: Asset.native(),
      destMin: "9.9",
      path: [],
    }))
    .setTimeout(600)
    .build();
  const xdr = transaction.toXDR();

  const digest = await hashPreparedTransactionClient({
    chainFamily: "stellar",
    network: STELLAR_NETWORK,
    rawPayload: xdr,
    sourceAccount: STELLAR_SOURCE,
    networkPassphrase: Networks.TESTNET,
  });

  const payload: StellarPreparedTransactionPayload = {
    chainFamily: "stellar",
    xdr,
    networkPassphrase: Networks.TESTNET,
    sourceAccount: STELLAR_SOURCE,
    operations: [{
      type: "path_payment_strict_send",
      asset: "native",
      amount: "10",
      destinationAmount: "9.9",
      destination: STELLAR_SOURCE,
    }],
    fee: Number(BASE_FEE),
    sequence: "38373288",
    method: "swap",
    displayParams: {
      action: "swap",
      amount: "10",
      destination: STELLAR_SOURCE,
      operationCount: 1,
      slippageBps: 100,
    },
  };

  const preview: Preview = {
    title: "Stellar swap",
    action: "swap",
    fromToken: "XLM",
    toToken: "USDC",
    percent: 30,
    estimatedValueUsd: 10,
    currentRiskScore: 20,
    projectedRiskScore: 25,
    requiresApproval: true,
    network: STELLAR_NETWORK,
    slippageBps: 100,
    quote: {
      provider: "soroswap",
      route: ["XLM", "USDC"],
      exactInput: { token: "XLM", amount: 10 },
      exactOutput: { token: "USDC", amount: 9.9 },
      expectedOutputToken: "USDC",
      expectedOutputAmount: 9.9,
      minReceiveAmount: 9.9,
      estimatedValueUsd: 10,
      priceImpactBps: 10,
      slippageBps: 100,
      feesUsd: 0.01,
      gasEstimateUsd: 0.01,
      network: STELLAR_NETWORK,
      expiresAt: futureIso(),
      fetchedAt: new Date().toISOString(),
      quoteMismatch: false,
      status: "fresh",
      detail: "Fixture Stellar quote",
    },
    simulation: {
      provider: "soroban_rpc",
      status: "passed",
      checks: ["Dry-run succeeded"],
      detail: "Fixture Stellar simulation",
      simulatedTxHash: digest,
      simulatedXdrHash: digest,
      binding: { transactionHash: digest, quoteHash: "quote-fixture" },
    },
    policy: {
      maxTradePercent: 50,
      maxRiskScore: 60,
      maxMemeExposurePercent: 40,
      maxSlippageBps: 200,
      autoExecute: false,
    },
    audit: {
      approvalRequired: true,
      serverCanSign: false,
      userApproved: false,
    },
  };

  return { preview, payload, xdr, digest };
}
