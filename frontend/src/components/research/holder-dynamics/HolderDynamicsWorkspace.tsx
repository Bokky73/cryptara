"use client";
import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { FormEvent, useRef, useState } from "react";
import { LiveRegion } from "@/components/a11y/LiveRegion";
import { useWalletSession } from "@/hooks/useWalletSession";
import { isE2eTestMode, readE2eWalletOverride } from "@/lib/e2e/browserWallet";
import type { HolderDynamicsResult } from "@/server/research/holder-dynamics";

export function HolderDynamicsWorkspace() {
  const wallet = useWalletSession();
  const override = isE2eTestMode() ? readE2eWalletOverride() : null;
  const owner = wallet.family === "evm" ? wallet.address : override?.family === "evm" ? override.address : undefined;
  const [network, setNetwork] = useInsightParam<string>("network", "ethereum", ["ethereum", "goat"]);
  const [tokenAddress, setTokenAddress] = useInsightParam("asset", "0x00000000000000000000000000000000000000ff");
  const [fromBlock, setFromBlock] = useState("100");
  const [toBlock, setToBlock] = useState("110");
  const [view, setView] = useState<{ result?: HolderDynamicsResult; error?: string; busy: boolean }>({ busy: false });
  const generation = useRef(0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!owner) return;
    const token = ++generation.current;
    setView({ busy: true });
    try {
      const response = await fetch("/api/insights/holder-dynamics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: owner,
          network,
          walletNetwork: network,
          tokenAddress,
          fromBlock: Number(fromBlock),
          toBlock: Number(toBlock),
        }),
      });
      const body = (await response.json()) as HolderDynamicsResult & { error?: string };
      if (token !== generation.current) return;
      if (!response.ok && !body.state) throw new Error(body.error ?? "Holder analysis failed");
      setView({ result: body, busy: false });
    } catch (error) {
      if (token === generation.current) setView({ error: error instanceof Error ? error.message : "Holder analysis failed", busy: false });
    }
  }

  const result = view.result;
  return (
    <div className="space-y-6">
      <header>
        <div className="text-xs uppercase text-[#d9a441]">EVM insight</div>
        <h1 className="text-3xl font-semibold">Holder concentration and supply movement</h1>
        <p className="text-sm text-white/55">Read-only snapshots. Partial lists are never total supply coverage. Transfers are not sales.</p>
      </header>
      {!owner ? <div role="status">Connect an authenticated EVM wallet.</div> : null}
      <form onSubmit={submit} className="glass-panel grid gap-4 rounded-2xl p-5">
        <label className="grid gap-1 text-sm">Network<select aria-label="Network" value={network} onChange={(e) => setNetwork(e.target.value)} className="rounded border border-white/15 bg-black/40 p-2"><option value="ethereum">Ethereum</option><option value="goat">GOAT</option></select></label>
        <label className="grid gap-1 text-sm">Token<input aria-label="Token address" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} className="rounded border border-white/15 bg-black/40 p-2 font-mono" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm">From block<input aria-label="From block" value={fromBlock} onChange={(e) => setFromBlock(e.target.value)} className="rounded border border-white/15 bg-black/40 p-2" /></label>
          <label className="grid gap-1 text-sm">To block<input aria-label="To block" value={toBlock} onChange={(e) => setToBlock(e.target.value)} className="rounded border border-white/15 bg-black/40 p-2" /></label>
        </div>
        <button type="submit" disabled={!owner || view.busy} className="rounded bg-[#d9a441] px-4 py-2 font-medium text-black disabled:opacity-50">{view.busy ? "Analyzing…" : "Analyze holders"}</button>
      </form>
      <LiveRegion message={view.busy ? "Analyzing holders" : view.error ?? (result ? `State ${result.state}` : null)} politeness={view.error ? "assertive" : "polite"} />
      {view.error ? <div role="alert">{view.error}</div> : null}
      {result ? (
        <section className="space-y-4" aria-labelledby="holder-heading">
          <h2 id="holder-heading" className="text-xl font-semibold">{result.state}</h2>
          <p className="text-sm">Top holder {result.topHolderShareBps ?? "n/a"} bps · Top10 {result.top10ShareBps ?? "n/a"} bps · Coverage {result.coverageRatio == null ? "unknown" : result.coverageRatio.toFixed(4)}</p>
          {result.warnings.map((warning) => <p key={warning} className="text-sm text-amber-200">{warning}</p>)}
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Holder balances at block {result.toBlock}</caption>
            <thead><tr><th scope="col">Address</th><th scope="col">Balance (raw)</th><th scope="col">Label</th></tr></thead>
            <tbody>{result.holders.map((holder) => <tr key={holder.key}><td className="font-mono text-xs">{holder.address}</td><td>{holder.balanceRaw}</td><td>{holder.label}</td></tr>)}</tbody>
          </table>
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Movements between snapshots</caption>
            <thead><tr><th scope="col">Kind</th><th scope="col">Amount</th><th scope="col">Tx</th><th scope="col">Note</th></tr></thead>
            <tbody>{result.movements.map((movement, index) => <tr key={`${movement.kind}-${index}`}><td>{movement.kind}</td><td>{movement.amountRaw}</td><td className="font-mono text-xs">{movement.txHash ?? "—"}</td><td>{movement.note}</td></tr>)}</tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
