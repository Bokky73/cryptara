"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { useStellarWallet } from "@/providers/StellarWalletProvider";
import type {
  EIP712Domain,
  PreparedTransactionPayload,
  SignedPolicyPayload,
  ExecutionIntentPayload,
  SignedPolicy,
  ExecutionIntent,
  TransactionPreview as Preview,
} from "@/server/types";
import { getPolicyTypedData, getIntentTypedData, hashPolicyPayload, hashIntentPayload } from "@/server/security/eip712";
import {
  SigningVerificationError,
  verifyPreparedPayloadAgainstPreview,
  verifyStellarEnvelope,
  type SigningVerificationResult,
  type VerifyPreparedPayloadInput,
  type VerifyStellarEnvelopeInput,
  type StellarEnvelopeInspection,
} from "@/lib/signing/previewVerification";
import { resolveEvmChainId } from "@/lib/evm/config";
import { getStellarNetwork, normalizeStellarNetworkId } from "@/lib/stellar/config";

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

function assertVerdict(verdict: SigningVerificationResult): void {
  if (!verdict.ok) throw new SigningVerificationError(verdict.issues);
}

/** Pure verification surface, usable from hooks and components. */
export function useSigningVerification() {
  const verifyPreparedPayload = useCallback(
    (input: VerifyPreparedPayloadInput) => verifyPreparedPayloadAgainstPreview(input),
    [],
  );
  const verifyStellar = useCallback((input: VerifyStellarEnvelopeInput) => verifyStellarEnvelope(input), []);

  return { verifyPreparedPayload, verifyStellar };
}

/**
 * Async verdict for a preview + prepared payload pair. Components use this to
 * render the security warning and disable the wallet prompt while verifying.
 */
type VerdictState = {
  key: string;
  verdict: SigningVerificationResult | null;
  isVerifying: boolean;
};

export function usePreviewSigningVerdict(input: {
  preview?: Preview | null;
  payload?: PreparedTransactionPayload | null;
  walletAddress?: string;
  sourceAccount?: string;
  enabled?: boolean;
}): { verdict: SigningVerificationResult | null; isVerifying: boolean } {
  const { preview, payload, walletAddress, sourceAccount, enabled = true } = input;
  // Deriving the active verdict from the input key prevents a stale finding
  // from one payload being briefly shown for another payload.
  const key = useMemo(
    () => JSON.stringify([preview, payload, walletAddress, sourceAccount, enabled]),
    [preview, payload, walletAddress, sourceAccount, enabled],
  );
  const [state, setState] = useState<VerdictState | null>(null);
  const active = state?.key === key;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Defer all state updates out of the effect body so a re-render is never
      // triggered synchronously from this effect.
      await Promise.resolve();
      if (cancelled) return;

      // A preview without a prepared payload is still just a plan; the
      // security gate only applies once a wallet could actually sign it.
      if (!preview || !payload || !enabled) {
        setState({ key, verdict: null, isVerifying: false });
        return;
      }

      setState({ key, verdict: null, isVerifying: true });
      try {
        const result = await verifyPreparedPayloadAgainstPreview({
          preview,
          payload,
          walletAddress,
          sourceAccount,
        });
        if (!cancelled) setState({ key, verdict: result, isVerifying: false });
      } catch (error: unknown) {
        if (!cancelled) {
          setState({
            key,
            verdict: {
              ok: false,
              issues: [{
                code: "verification_error",
                field: "verification",
                message: error instanceof Error ? error.message : "Payload verification failed.",
                blocking: true,
                refreshRequired: true,
              }],
            },
            isVerifying: false,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key, preview, payload, walletAddress, sourceAccount, enabled]);

  return {
    verdict: state && active ? state.verdict : null,
    isVerifying: state && active ? state.isVerifying : false,
  };
}

/** Verdict hook for the Stellar risk-registry publication flow. */
export function useStellarEnvelopeVerdict(input: {
  xdr?: string;
  passphrase?: string;
  expectedSourceAccount?: string;
  expectedOperationCount?: number;
  expectedContractId?: string;
  enabled?: boolean;
}): { inspection: StellarEnvelopeInspection | null; verdict: SigningVerificationResult | null } {
  const { xdr, passphrase, expectedSourceAccount, expectedOperationCount, expectedContractId, enabled = true } = input;

  const verdict = useMemo(() => {
    if (!enabled || !xdr || !passphrase) return null;

    return verifyStellarEnvelope({
      xdr,
      passphrase,
      expectedSourceAccount,
      expectedOperationCount,
      expectedContractId,
    });
  }, [xdr, passphrase, expectedSourceAccount, expectedOperationCount, expectedContractId, enabled]);

  return { inspection: verdict?.stellar ?? null, verdict };
}

type SigningDomainExpectation = {
  network?: string;
  preview?: Preview;
};

function assertDomainNetwork(domain: EIP712Domain, expectation?: SigningDomainExpectation): void {
  if (!expectation) return;

  const expectedNetwork = expectation.network ?? expectation.preview?.network;
  if (!expectedNetwork) return;

  const expectedChainId = resolveEvmChainId(expectedNetwork);
  if (expectedChainId === undefined || domain.chainId === expectedChainId) return;

  throw new SigningVerificationError([{
    code: "network_mismatch",
    field: "domain.chainId",
    message: `Signing domain chain ID ${domain.chainId} does not match the reviewed network ${expectedNetwork} (${expectedChainId}).`,
    blocking: true,
    refreshRequired: true,
  }]);
}

export function useEvmSigning() {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();

  const verifyPayload = useCallback(
    (payload: PreparedTransactionPayload, preview: Preview, walletAddressOverride?: string) =>
      verifyPreparedPayloadAgainstPreview({
        preview,
        payload,
        walletAddress: walletAddressOverride ?? address ?? undefined,
      }),
    [address],
  );

  const signPolicy = useCallback(
    async (
      payload: Omit<SignedPolicyPayload, "nonce" | "expiry">,
      domainOverrides?: Partial<EIP712Domain>,
      expectation?: SigningDomainExpectation,
    ): Promise<SignedPolicy> => {
      if (!walletClient || !address) throw new Error("Connect an EVM wallet first.");

      const domain: EIP712Domain = {
        ...DEFAULT_POLICY_DOMAIN,
        ...domainOverrides,
        chainId: domainOverrides?.chainId ?? chainId ?? DEFAULT_POLICY_DOMAIN.chainId,
      };
      assertDomainNetwork(domain, expectation);

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
      expectation?: SigningDomainExpectation,
    ): Promise<ExecutionIntent> => {
      if (!walletClient || !address) throw new Error("Connect an EVM wallet first.");

      const domain: EIP712Domain = {
        ...DEFAULT_INTENT_DOMAIN,
        ...domainOverrides,
        chainId: domainOverrides?.chainId ?? chainId ?? DEFAULT_INTENT_DOMAIN.chainId,
      };
      assertDomainNetwork(domain, expectation);

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

  /** Verify first, then ask the wallet to sign the exact prepared calldata. */
  const signPreparedTransaction = useCallback(
    async (payload: PreparedTransactionPayload, preview: Preview): Promise<string> => {
      if (!walletClient || !address) throw new Error("Connect an EVM wallet first.");

      assertVerdict(await verifyPayload(payload, preview));

      if (payload.chainFamily !== "evm") {
        throw new SigningVerificationError([{
          code: "network_family_mismatch",
          field: "payload.chainFamily",
          message: "An EVM wallet cannot sign a Stellar payload.",
          blocking: true,
          refreshRequired: true,
        }]);
      }

      return walletClient.signTransaction({
        account: walletClient.account ?? (address as `0x${string}`),
        to: payload.to as `0x${string}`,
        data: (payload.data || "0x") as `0x${string}`,
        value: BigInt(payload.value || "0"),
        chainId: payload.chainId,
        ...(payload.gas ? { gas: BigInt(payload.gas) } : {}),
        ...(payload.gasPrice ? { gasPrice: BigInt(payload.gasPrice) } : {}),
      } as never);
    },
    [walletClient, address, verifyPayload],
  );

  return {
    signPolicy,
    signExecutionIntent,
    verifyPayload,
    signPreparedTransaction,
    isReady: Boolean(walletClient && address),
  };
}

export function useStellarSigning() {
  const stellar = useStellarWallet();

  const verifyPayload = useCallback(
    (payload: PreparedTransactionPayload, preview: Preview, walletAddressOverride?: string) =>
      verifyPreparedPayloadAgainstPreview({
        preview,
        payload,
        walletAddress: walletAddressOverride,
        sourceAccount: stellar.address,
      }),
    [stellar.address],
  );

  const verifyEnvelope = useCallback(
    (input: Omit<VerifyStellarEnvelopeInput, "passphrase"> & { passphrase?: string }) =>
      verifyStellarEnvelope({
        ...input,
        passphrase: input.passphrase ?? expectedPassphrase(stellar.network) ?? "",
      }),
    [stellar.network],
  );

  const signStellarIntent = useCallback(
    async (
      intentHash: string,
      xdr: string,
      expectations?: Omit<VerifyStellarEnvelopeInput, "xdr" | "passphrase">,
    ): Promise<{ signedXdr: string }> => {
      if (!stellar.address) throw new Error("Connect a Stellar wallet first.");

      if (expectations) {
        assertVerdict(verifyStellarEnvelope({
          ...expectations,
          xdr,
          passphrase: expectedPassphrase(stellar.network) ?? "",
        }));
      }

      const signedXdr = await stellar.signTransaction(xdr, normalizeStellarNetworkId(stellar.network) ?? undefined);
      return { signedXdr };
    },
    [stellar],
  );

  /** Verify the full prepared payload and XDR before opening the wallet. */
  const signPreparedTransaction = useCallback(
    async (payload: PreparedTransactionPayload, preview: Preview): Promise<{ signedXdr: string }> => {
      if (!stellar.address) throw new Error("Connect a Stellar wallet first.");

      assertVerdict(await verifyPayload(payload, preview));

      if (payload.chainFamily !== "stellar") {
        throw new SigningVerificationError([{
          code: "network_family_mismatch",
          field: "payload.chainFamily",
          message: "A Stellar wallet cannot sign an EVM payload.",
          blocking: true,
          refreshRequired: true,
        }]);
      }

      const signedXdr = await stellar.signTransaction(
        (payload as Extract<PreparedTransactionPayload, { chainFamily: "stellar" }>).xdr,
        normalizeStellarNetworkId(preview.network) ?? undefined,
      );

      return { signedXdr };
    },
    [stellar, verifyPayload],
  );

  return {
    signStellarIntent,
    signPreparedTransaction,
    verifyPayload,
    verifyEnvelope,
    isReady: stellar.isConnected,
    address: stellar.address,
    network: stellar.network,
  };
}

function expectedPassphrase(network: string | undefined): string | undefined {
  const normalized = normalizeStellarNetworkId(network);

  return normalized ? getStellarNetwork(normalized)?.networkPassphrase : undefined;
}
