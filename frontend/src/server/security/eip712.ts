import { keccak256, toBytes, encodePacked, recoverAddress, hashTypedData, type Hex } from "viem";
import type { EIP712Domain, SignedPolicyPayload, ExecutionIntentPayload, SignedPolicy, ExecutionIntent } from "@/server/types";

const POLICY_PRIMARY_TYPE = "Policy" as const;
const INTENT_PRIMARY_TYPE = "ExecutionIntent" as const;

const POLICY_TYPES = {
  Policy: [
    { name: "wallet", type: "address" },
    { name: "chain", type: "string" },
    { name: "policyVersion", type: "uint256" },
    { name: "maxRiskScore", type: "uint256" },
    { name: "maxTradePercent", type: "uint256" },
    { name: "maxMemeExposurePercent", type: "uint256" },
    { name: "maxDailyTransactionValueUsd", type: "uint256" },
    { name: "maxSlippageBps", type: "uint256" },
    { name: "allowedChains", type: "string[]" },
    { name: "blockedTokens", type: "string[]" },
    { name: "allowedActions", type: "string[]" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};

const INTENT_TYPES = {
  ExecutionIntent: [
    { name: "wallet", type: "address" },
    { name: "chain", type: "string" },
    { name: "policyHash", type: "bytes32" },
    { name: "decisionHash", type: "bytes32" },
    { name: "fromToken", type: "string" },
    { name: "toToken", type: "string" },
    { name: "estimatedValueUsd", type: "uint256" },
    { name: "maxSlippageBps", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
};

function hashString(value: string): `0x${string}` {
  return keccak256(toBytes(value));
}

export function hashAllowedLists(payload: SignedPolicyPayload): `0x${string}` {
  const chainHash = hashString(payload.allowedChains.join(","));
  const tokenHash = hashString(payload.blockedTokens.join(","));
  const actionHash = hashString(payload.allowedActions.join(","));
  const packed = encodePacked(
    ["bytes32", "bytes32", "bytes32"],
    [chainHash, tokenHash, actionHash],
  );
  return keccak256(packed);
}

export function hashPolicyPayload(payload: SignedPolicyPayload): `0x${string}` {
  const allowedListHash = hashAllowedLists(payload);
  const packed = encodePacked(
    ["address", "bytes32", "uint256", "uint256", "uint256", "uint256", "uint256", "uint256", "bytes32", "uint256", "uint256"],
    [
      payload.wallet,
      hashString(payload.chain),
      BigInt(payload.policyVersion),
      BigInt(payload.maxRiskScore),
      BigInt(payload.maxTradePercent),
      BigInt(payload.maxMemeExposurePercent),
      BigInt(payload.maxDailyTransactionValueUsd),
      BigInt(payload.maxSlippageBps),
      allowedListHash,
      BigInt(payload.nonce),
      BigInt(payload.expiry),
    ],
  );
  return keccak256(packed);
}

export function hashIntentPayload(payload: ExecutionIntentPayload): `0x${string}` {
  const packed = encodePacked(
    ["address", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "uint256", "uint256", "uint256", "uint256"],
    [
      payload.wallet,
      hashString(payload.chain),
      payload.policyHash,
      payload.decisionHash,
      hashString(payload.fromToken),
      hashString(payload.toToken),
      BigInt(payload.estimatedValueUsd),
      BigInt(payload.maxSlippageBps),
      BigInt(payload.nonce),
      BigInt(payload.expiry),
    ],
  );
  return keccak256(packed);
}

export function buildPolicyDomain(chainId: number, contractAddress: `0x${string}`): EIP712Domain {
  return {
    name: "CryptaraPolicy",
    version: "1",
    chainId,
    verifyingContract: contractAddress,
  };
}

export function buildIntentDomain(chainId: number, contractAddress: `0x${string}`): EIP712Domain {
  return {
    name: "CryptaraExecutionIntent",
    version: "1",
    chainId,
    verifyingContract: contractAddress,
  };
}

export function getPolicyTypedData(domain: EIP712Domain, payload: SignedPolicyPayload) {
  return {
    domain: { ...domain, verifyingContract: domain.verifyingContract as Hex },
    types: POLICY_TYPES,
    primaryType: POLICY_PRIMARY_TYPE,
    message: { ...payload, allowedChains: [...payload.allowedChains], blockedTokens: [...payload.blockedTokens], allowedActions: [...payload.allowedActions] },
  };
}

export function getIntentTypedData(domain: EIP712Domain, payload: ExecutionIntentPayload) {
  return {
    domain: { ...domain, verifyingContract: domain.verifyingContract as Hex },
    types: INTENT_TYPES,
    primaryType: INTENT_PRIMARY_TYPE,
    message: { ...payload },
  };
}

export async function verifyPolicySignature(signed: SignedPolicy): Promise<`0x${string}`> {
  const now = Math.floor(Date.now() / 1000);
  if (now > signed.payload.expiry) {
    throw new Error("Policy signature has expired.");
  }
  const typedData = getPolicyTypedData(signed.domain, signed.payload);
  const hash = await hashTypedData(typedData);
  const recovered = await recoverAddress({
    hash,
    signature: signed.signature,
  });
  if (recovered.toLowerCase() !== signed.payload.wallet.toLowerCase()) {
    throw new Error("Policy signature does not match wallet address.");
  }
  const computedHash = hashPolicyPayload(signed.payload);
  return computedHash;
}

export async function verifyExecutionIntentSignature(intent: ExecutionIntent): Promise<`0x${string}`> {
  const now = Math.floor(Date.now() / 1000);
  if (now > intent.payload.expiry) {
    throw new Error("Execution intent signature has expired.");
  }
  const typedData = getIntentTypedData(intent.domain, intent.payload);
  const hash = await hashTypedData(typedData);
  const recovered = await recoverAddress({
    hash,
    signature: intent.signature,
  });
  if (recovered.toLowerCase() !== intent.payload.wallet.toLowerCase()) {
    throw new Error("Execution intent signature does not match wallet address.");
  }
  const computedHash = hashIntentPayload(intent.payload);
  return computedHash;
}

export function assertDomainMatch(domain: EIP712Domain, expectedChainId: number, expectedContract: `0x${string}`): void {
  if (domain.chainId !== expectedChainId) {
    throw new Error(`Domain chainId mismatch: expected ${expectedChainId}, got ${domain.chainId}`);
  }
  if (domain.verifyingContract.toLowerCase() !== expectedContract.toLowerCase()) {
    throw new Error(`Domain verifyingContract mismatch: expected ${expectedContract}, got ${domain.verifyingContract}`);
  }
  if (domain.name !== "CryptaraPolicy" && domain.name !== "CryptaraExecutionIntent") {
    throw new Error(`Unknown domain name: ${domain.name}`);
  }
}

export function assertNonceUnique(nonce: number, usedNonces: Map<string, Set<number>> | Set<number>, wallet: string): void {
  if (usedNonces instanceof Set) {
    if (usedNonces.has(nonce)) {
      throw new Error(`Nonce ${nonce} already used. Replay prevented.`);
    }
    usedNonces.add(nonce);
  } else {
    const walletNonces = usedNonces.get(wallet.toLowerCase()) ?? new Set<number>();
    if (walletNonces.has(nonce)) {
      throw new Error(`Nonce ${nonce} already used for wallet ${wallet}. Replay prevented.`);
    }
    walletNonces.add(nonce);
    usedNonces.set(wallet.toLowerCase(), walletNonces);
  }
}
