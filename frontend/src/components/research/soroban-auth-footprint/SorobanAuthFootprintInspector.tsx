"use client";

import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { TreePine } from "lucide-react";
import { useWalletSession } from "@/hooks/useWalletSession";
import { isE2eTestMode, readE2eWalletOverride } from "@/lib/e2e/browserWallet";
import type { SorobanAuthResult } from "@/server/research/soroban-auth-footprint/schema";

export function SorobanAuthFootprintInspector() {
  const wallet = useWalletSession();
  const test = isE2eTestMode() ? readE2eWalletOverride() : null;
  const override = test?.family === "stellar" ? test : null;
  const address = wallet.family === "stellar" ? wallet.address ?? override?.address : override?.address;
  const walletNetwork =
    wallet.family === "stellar" ? wallet.stellar.network ?? override?.network : override?.network;

  const [network, setNetwork] = useInsightParam<"stellar-testnet" | "stellar-pubnet">("network", walletNetwork ?? "stellar-testnet", ["stellar-testnet", "stellar-pubnet"]);
  const [envelopeXdr, setEnvelopeXdr] = useState("");
  const [simulationJson, setSimulationJson] = useState("");
  const [view, setView] = useState<{
    scope: string;
    result: SorobanAuthResult | null;
    error: string | null;
    busy: boolean;
  }>({ scope: "", result: null, error: null, busy: false });
  const generation = useRef(0);
  const scope = `${address}:${network}:${envelopeXdr.length}:${simulationJson.length}`;

  useEffect(() => {
    generation.current += 1;
  }, [address]);

  const result = view.scope === scope ? view.result : null;
  const error = view.scope === scope ? view.error : null;
  const busy = view.scope === scope && view.busy;
  const connected = Boolean(address && ((wallet.family === "stellar" && wallet.isConnected) || override));
  const mismatch = Boolean(walletNetwork && walletNetwork !== network);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address || !walletNetwork || mismatch) return;
    if (!envelopeXdr.trim() && !simulationJson.trim()) return;
    const token = ++generation.current;
    setView({ scope, result: null, error: null, busy: true });
    try {
      const response = await fetch("/api/insights/soroban-auth-footprint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          network,
          walletNetwork,
          envelopeXdr: envelopeXdr.trim() || undefined,
          simulationJson: simulationJson.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as SorobanAuthResult & { error?: string };
      if (token !== generation.current) return;
      if (!response.ok && payload.state !== "unavailable") throw new Error(payload.error ?? "Inspector unavailable");
      if (payload.walletAddress !== address || payload.network !== network) return;
      setView({ scope, result: payload, error: null, busy: false });
    } catch (cause) {
      if (token === generation.current) {
        setView({
          scope,
          result: null,
          error: cause instanceof Error ? cause.message : "Inspector unavailable",
          busy: false,
        });
      }
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex gap-4 border-b border-white/10 pb-5">
        <div className="rounded-2xl border border-[#d9a441]/35 p-3 text-[#f2c86d]">
          <TreePine />
        </div>
        <div>
          <div className="text-xs uppercase tracking-[.18em] text-[#d9a441]">Soroban insight</div>
          <h1 className="text-3xl font-semibold">Authorization footprint inspector</h1>
          <p className="mt-2 text-sm text-white/55">
            Decode nested Soroban authorization from a bounded envelope and/or simulation JSON — decoding is not approval.
          </p>
        </div>
      </header>
      {!connected ? (
        <div role="status" className="rounded-xl border border-amber-300/20 p-4">
          Connect an authenticated Stellar wallet.
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-xl border border-red-300/20 p-4">
          {error}
        </div>
      ) : null}
      <form onSubmit={submit} className="glass-panel grid gap-4 rounded-2xl p-5">
        <label className="grid gap-1 text-sm">
          <span>Network</span>
          <select
            value={network}
            disabled={busy || !connected}
            onChange={(event) => {
              generation.current += 1;
              setNetwork(event.target.value as "stellar-testnet" | "stellar-pubnet");
            }}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2"
          >
            <option value="stellar-testnet">stellar-testnet</option>
            <option value="stellar-pubnet">stellar-pubnet</option>
          </select>
        </label>
        {mismatch ? (
          <div role="alert" className="rounded-xl border border-amber-300/20 p-3 text-sm">
            Selected network does not match the connected wallet network.
          </div>
        ) : null}
        <label className="grid gap-1 text-sm">
          <span>Envelope XDR (optional, bounded)</span>
          <textarea
            value={envelopeXdr}
            disabled={busy || !connected}
            onChange={(event) => setEnvelopeXdr(event.target.value)}
            rows={4}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span>Simulation JSON (auth tree)</span>
          <textarea
            value={simulationJson}
            disabled={busy || !connected}
            onChange={(event) => setSimulationJson(event.target.value)}
            rows={8}
            className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !connected || mismatch || (!envelopeXdr.trim() && !simulationJson.trim())}
          className="rounded-full border border-[#d9a441]/40 bg-[#d9a441]/15 px-4 py-2 text-sm font-medium text-[#f2c86d] disabled:opacity-40"
        >
          Inspect authorization footprint
        </button>
      </form>
      <div aria-live="polite" className="sr-only">
        {busy ? "Loading authorization footprint" : result ? result.state : ""}
      </div>
      {result ? (
        <>
          <section
            className={`rounded-2xl border p-4 ${result.state === "complete" ? "border-emerald-300/20" : "border-amber-300/20"}`}
          >
            <strong>{result.state}</strong>
            <p className="mt-1 text-sm">{result.coverageMessage}</p>
            <p className="mt-2 text-xs">decodingIsNotApproval: {String(result.decodingIsNotApproval)}</p>
            {result.warnings.length ? (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </section>
          <section aria-labelledby="auth-tree-heading" className="rounded-2xl border border-white/10 p-4">
            <h2 id="auth-tree-heading" className="text-lg font-semibold">
              Authorization tree
            </h2>
            <ul aria-label="Soroban authorization nodes" className="mt-3 space-y-2">
              {result.nodes.map((node) => (
                <li
                  key={node.id}
                  tabIndex={0}
                  style={{ marginLeft: `${node.depth * 16}px` }}
                  className="rounded-xl border border-white/10 p-3 text-sm focus:outline focus:outline-2 focus:outline-[#d9a441]"
                >
                  <div className="font-medium">
                    {node.id}
                    {node.parentId ? ` · parent ${node.parentId}` : " · root"}
                    {node.address ? ` · address ${node.address}` : ""}
                  </div>
                  <dl className="mt-2 grid gap-1 text-xs text-white/55 sm:grid-cols-2">
                    <div>
                      <dt className="inline">Contract: </dt>
                      <dd className="inline break-all font-mono">{node.contractId ?? "unknown"}</dd>
                    </div>
                    <div>
                      <dt className="inline">Function: </dt>
                      <dd className="inline font-mono">{node.functionName ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="inline">Nonce: </dt>
                      <dd className="inline font-mono">{node.nonce ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="inline">Expiration ledger: </dt>
                      <dd className="inline">{node.expirationLedger ?? "—"}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs">{node.note}</p>
                  {node.flags.length ? (
                    <p className="mt-1 text-xs text-amber-200/80">Flags: {node.flags.join(", ")}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            {!result.nodes.length ? <p className="mt-2 text-sm text-white/55">No auth nodes decoded.</p> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
