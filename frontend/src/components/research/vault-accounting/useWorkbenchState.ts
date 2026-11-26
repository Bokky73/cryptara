"use client";

import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { useRef, useState, type FormEvent } from "react";
import { useWalletSession } from "@/hooks/useWalletSession";
import type { VaultAccountingResult } from "@/server/research/vault-accounting";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SAMPLE_AMOUNT = /^[1-9]\d*$/;
export const SUPPORTED_NETWORKS = ["ethereum", "base", "arbitrum", "polygon", "optimism", "bsc", "avalanche"] as const;
const MAX_SAMPLE_AMOUNTS = 5;

/**
 * Owns all form/request state for the vault-accounting workbench. Split
 * out of the container component so the fetch/race-condition logic can
 * be exercised without rendering anything.
 */
export function useWorkbenchState() {
  const wallet = useWalletSession();
  const address = wallet.family === "evm" ? wallet.address : undefined;
  const connected = Boolean(address && wallet.family === "evm" && wallet.isConnected);

  const [network, setNetwork] = useInsightParam<string>("network", SUPPORTED_NETWORKS[0], SUPPORTED_NETWORKS);
  const [vaultAddress, setVaultAddress] = useInsightParam("asset", "");
  const [blockNumber, setBlockNumber] = useState("");
  const [sampleAmounts, setSampleAmounts] = useState<string[]>([]);
  const [sampleDraft, setSampleDraft] = useState("");
  const [result, setResult] = useState<VaultAccountingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  function addSample() {
    if (!SAMPLE_AMOUNT.test(sampleDraft)) {
      setError("Enter a positive integer amount, in the asset's smallest unit.");
      return;
    }
    if (sampleAmounts.length >= MAX_SAMPLE_AMOUNTS) {
      setError(`At most ${MAX_SAMPLE_AMOUNTS} sample amounts can be checked at once.`);
      return;
    }
    setSampleAmounts((current) => [...current, sampleDraft]);
    setSampleDraft("");
    setError(null);
  }

  function removeSample(index: number) {
    setSampleAmounts((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address || wallet.family !== "evm") return;
    if (!ADDRESS.test(vaultAddress)) {
      setError("Enter a valid vault address.");
      return;
    }
    if (blockNumber && !/^\d+$/.test(blockNumber)) {
      setError("Block number must be a positive integer.");
      return;
    }

    const requestGeneration = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/insights/vault-accounting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          network,
          walletNetwork: network,
          vaultAddress,
          blockNumber: blockNumber ? Number(blockNumber) : undefined,
          sampleAmounts,
        }),
      });
      const payload = (await response.json()) as VaultAccountingResult & { error?: string; message?: string };
      if (requestGeneration !== generation.current) return;
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? `Vault read failed (${response.status})`);
      setResult(payload);
    } catch (caught) {
      if (requestGeneration === generation.current) {
        setError(caught instanceof Error ? caught.message : "Vault read failed");
        setResult(null);
      }
    } finally {
      if (requestGeneration === generation.current) setBusy(false);
    }
  }

  return {
    connected,
    network,
    setNetwork,
    vaultAddress,
    setVaultAddress,
    blockNumber,
    setBlockNumber,
    sampleAmounts,
    sampleDraft,
    setSampleDraft,
    addSample,
    removeSample,
    result,
    error,
    busy,
    submit,
  };
}
