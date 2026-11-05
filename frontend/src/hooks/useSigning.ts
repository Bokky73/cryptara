"use client";

import { useCallback } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useStellarWallet } from "@/providers/StellarWalletProvider";
import type { EIP712Domain, SignedPolicyPayload, ExecutionIntentPayload, SignedPolicy, ExecutionIntent } from "@/server/types";
import { getPolicyTypedData, getIntentTypedData, hashPolicyPayload, hashIntentPayload } from "@/server/security/eip712";

const DEFAULT_POLICY_DOMAIN: EIP712Domain = {
  name: "CryptaraPolicy",
  version: "1",
  chainId: 48816,
  verifyingContract: "0x0000000000000000000000000000000000000000",
};

const DEFAULT_INTENT_DOMAIN: EIP712Domain = {
  name: "CryptaraExecutionIntent",
  version: "1",
  chainId: 48816,
  verifyingContract: "0x0000000000000000000000000000000000000000",
};

export function useEvmSigning() {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();

  const signPolicy = useCallback(
    async (payload: Omit<SignedPolicyPayload, "nonce" | "expiry">, domainOverrides?: Partial<EIP712Domain>): Promise<SignedPolicy> => {
      if (!walletClient || !address) throw new Error("Connect an EVM wallet first.");

      const domain: EIP712Domain = {
        ...DEFAULT_POLICY_DOMAIN,
        ...domainOverrides,
        chainId: domainOverrides?.chainId ?? chainId ?? DEFAULT_POLICY_DOMAIN.chainId,
      };

      const nonce = Math.floor(Date.now() * 1000);
      const expiry = Math.floor(Date.now() / 1000) + 86400 * 30;

      const fullPayload: SignedPolicyPayload = {
        ...payload,
        wallet: address as `0x${string}`,
        nonce,
        expiry,
      };

      const typedData = getPolicyTypedData(domain, fullPayload);
      const signature = await walletClient.signTypedData({
        account: address as `0x${string}`,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      const policyHash = hashPolicyPayload(fullPayload);

      return {
        payload: fullPayload,
        domain,
        signature,
        policyHash,
      };
    },
    [walletClient, address, chainId],
  );

  const signExecutionIntent = useCallback(
    async (
      payload: Omit<ExecutionIntentPayload, "nonce" | "expiry">,
      domainOverrides?: Partial<EIP712Domain>,
    ): Promise<ExecutionIntent> => {
      if (!walletClient || !address) throw new Error("Connect an EVM wallet first.");

      const domain: EIP712Domain = {
        ...DEFAULT_INTENT_DOMAIN,
        ...domainOverrides,
        chainId: domainOverrides?.chainId ?? chainId ?? DEFAULT_INTENT_DOMAIN.chainId,
      };

      const nonce = Math.floor(Date.now() * 1000);
      const expiry = Math.floor(Date.now() / 1000) + 3600;

      const fullPayload: ExecutionIntentPayload = {
        ...payload,
        wallet: address as `0x${string}`,
        nonce,
        expiry,
      };

      const typedData = getIntentTypedData(domain, fullPayload);
      const signature = await walletClient.signTypedData({
        account: address as `0x${string}`,
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
      });

      const intentHash = hashIntentPayload(fullPayload);

      return {
        payload: fullPayload,
        domain,
        signature,
        intentHash,
      };
    },
    [walletClient, address, chainId],
  );

  return { signPolicy, signExecutionIntent, isReady: Boolean(walletClient && address) };
}

export function useStellarSigning() {
  const stellar = useStellarWallet();

  const signStellarIntent = useCallback(
    async (intentHash: string, xdr: string): Promise<{ signedXdr: string }> => {
      if (!stellar.address) throw new Error("Connect a Stellar wallet first.");
      const signedXdr = await stellar.signTransaction(xdr);
      return { signedXdr };
    },
    [stellar],
  );

  return { signStellarIntent, isReady: stellar.isConnected, address: stellar.address, network: stellar.network };
}
