"use client";

import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { useWalletSession } from "@/hooks/useWalletSession";
import type { AllowanceInventoryResult, AllowancePair } from "@/server/research/allowance-inventory/schema";
import { DiscoveryCoverage } from "./DiscoveryCoverage";
import { InventoryStateNotice } from "./InventoryStateNotice";
import { ALLOWANCE_NETWORKS, ScanRangeForm } from "./ScanRangeForm";
import { SpenderTable } from "./SpenderTable";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function AllowanceInventory() {
  const wallet = useWalletSession();
  const address = wallet.family === "evm" ? wallet.address : undefined;
  const [network, setNetwork] = useInsightParam("network", "ethereum", ALLOWANCE_NETWORKS);
  const [fromBlock, setFromBlock] = useState("0");
  const [toBlock, setToBlock] = useState("1000");
  const [token, setToken] = useInsightParam("asset", "");
  const [spender, setSpender] = useState("");
  const [pairs, setPairs] = useState<AllowancePair[]>([]);
  const [view, setView] = useState<{ scope: string; result: AllowanceInventoryResult | null; error: string | null; busy: boolean }>({ scope: "", result: null, error: null, busy: false });
  const generation = useRef(0);
  const scope = `${address ?? "disconnected"}:${network}`;

  useEffect(() => {
    generation.current += 1;
  }, [address]);

  const result = view.scope === scope ? view.result : null;
  const error = view.scope === scope ? view.error : null;
  const busy = view.scope === scope && view.busy;

  function addPair() {
    if (!ADDRESS.test(token) || !ADDRESS.test(spender)) {
      setView({ scope, result: null, error: "Enter a valid token and spender address before adding the pair.", busy: false });
      return;
    }
    setPairs((current) => [...current, { token, spender }]);
    setToken("");
    setSpender("");
    setView({ scope, result, error: null, busy: false });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address || wallet.family !== "evm") return;
    const requestGeneration = ++generation.current;
    setView({ scope, result: null, error: null, busy: true });
    try {
      const response = await fetch("/api/insights/allowance-inventory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: address, network, fromBlock, toBlock, pairs }),
      });
      const payload = await response.json() as AllowanceInventoryResult & { error?: string; message?: string };
      if (requestGeneration !== generation.current) return;
      if (!response.ok) throw new Error(payload.message ?? payload.error ?? `Inventory request failed (${response.status})`);
      if (payload.walletAddress.toLowerCase() !== address.toLowerCase() || payload.network !== network) return;
      setView({ scope, result: payload, error: null, busy: false });
    } catch (caught) {
      if (requestGeneration === generation.current) setView({ scope, result: null, error: caught instanceof Error ? caught.message : "Inventory request failed", busy: false });
    } finally {
      if (requestGeneration === generation.current) setView((current) => current.scope === scope ? { ...current, busy: false } : current);
    }
  }

  const connected = Boolean(address && wallet.family === "evm" && wallet.isConnected);
  return (
    <div className="space-y-6">
      <header className="flex items-start gap-4 border-b border-white/10 pb-5">
        <div className="rounded-2xl border border-[#d9a441]/35 bg-[#d9a441]/10 p-3 text-[#f2c86d]"><ShieldCheck aria-hidden className="h-6 w-6" /></div>
        <div><div className="text-xs uppercase tracking-[0.18em] text-[#d9a441]">Security insight</div><h1 className="mt-1 text-3xl font-semibold">Token allowance inventory</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">Inspect current ERC-20 allowances without signing, approving, revoking or submitting a transaction.</p></div>
      </header>
      <InventoryStateNotice connected={connected} error={error} />
      <ScanRangeForm network={network} fromBlock={fromBlock} toBlock={toBlock} token={token} spender={spender} pairs={pairs} busy={busy || !connected} onNetwork={(value) => { generation.current += 1; setNetwork(value); }} onFromBlock={setFromBlock} onToBlock={setToBlock} onToken={setToken} onSpender={setSpender} onAddPair={addPair} onRemovePair={(index) => setPairs((current) => current.filter((_, itemIndex) => itemIndex !== index))} onSubmit={submit} />
      <div aria-live="polite" className="sr-only">{busy ? "Allowance inventory loading" : result ? `Allowance inventory ${result.state}` : error ?? ""}</div>
      {result ? <><DiscoveryCoverage coverage={result.coverage} /><SpenderTable groups={result.spenderGroups} /></> : null}
    </div>
  );
}
