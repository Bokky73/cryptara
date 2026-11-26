"use client";

import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Shield } from "lucide-react";
import { useWalletSession } from "@/hooks/useWalletSession";
import { isE2eTestMode, readE2eWalletOverride } from "@/lib/e2e/browserWallet";
import type { IssuerControlResult } from "@/server/research/issuer-control/schema";
import { ControlsPanel } from "./ControlsPanel";
import { EventTimeline } from "./EventTimeline";
import { InspectorForm } from "./InspectorForm";
import { TrustlinePanel } from "./TrustlinePanel";

export function IssuerControlInspector() {
  const wallet = useWalletSession();
  const test = isE2eTestMode() ? readE2eWalletOverride() : null;
  const override = test?.family === "stellar" ? test : null;
  const address = wallet.family === "stellar" ? wallet.address ?? override?.address : override?.address;
  const walletNetwork =
    wallet.family === "stellar" ? wallet.stellar.network ?? override?.network : override?.network;

  const [network, setNetwork] = useInsightParam<"stellar-testnet" | "stellar-pubnet">("network", walletNetwork ?? "stellar-testnet", ["stellar-testnet", "stellar-pubnet"]);
  const [accountAddress, setAccountAddress] = useState(address ?? "");
  const [assetQuery, setAssetQuery] = useInsightParam("asset", "");
  const [pageSize, setPageSize] = useState(20);
  const [maxPages, setMaxPages] = useState(3);
  const [view, setView] = useState<{
    scope: string;
    result: IssuerControlResult | null;
    error: string | null;
    busy: boolean;
  }>({ scope: "", result: null, error: null, busy: false });
  const generation = useRef(0);
  const scope = `${address}:${network}:${accountAddress}:${assetQuery}`;

  useEffect(() => {
    generation.current += 1;
    if (address) setAccountAddress(address);
  }, [address]);

  const result = view.scope === scope ? view.result : null;
  const error = view.scope === scope ? view.error : null;
  const busy = view.scope === scope && view.busy;
  const connected = Boolean(address && ((wallet.family === "stellar" && wallet.isConnected) || override));
  const mismatch = Boolean(walletNetwork && walletNetwork !== network);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address || !walletNetwork || mismatch || !assetQuery.trim()) return;
    const token = ++generation.current;
    setView({ scope, result: null, error: null, busy: true });
    try {
      const response = await fetch("/api/insights/issuer-control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          accountAddress: accountAddress || address,
          assetQuery,
          network,
          walletNetwork,
          pageSize,
          maxPages,
        }),
      });
      const payload = (await response.json()) as IssuerControlResult & { error?: string };
      if (token !== generation.current) return;
      if (!response.ok && payload.state !== "unavailable") {
        throw new Error(payload.error ?? "Inspector unavailable");
      }
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
          <Shield />
        </div>
        <div>
          <div className="text-xs uppercase tracking-[.18em] text-[#d9a441]">Stellar insight</div>
          <h1 className="text-3xl font-semibold">Issuer control and trustline exposure</h1>
          <p className="mt-2 text-sm text-white/55">
            Read current issuer flags, trustline authorization, and bounded auth/clawback evidence without signing.
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
      <InspectorForm
        network={network}
        accountAddress={accountAddress}
        assetQuery={assetQuery}
        pageSize={pageSize}
        maxPages={maxPages}
        busy={busy || !connected}
        mismatch={mismatch}
        onNetwork={(value) => {
          generation.current += 1;
          setNetwork(value);
        }}
        onAccount={setAccountAddress}
        onAsset={setAssetQuery}
        onPageSize={setPageSize}
        onMaxPages={setMaxPages}
        onSubmit={submit}
      />
      <div aria-live="polite" className="sr-only">
        {busy ? "Loading issuer control evidence" : result ? result.state : ""}
      </div>
      {result ? (
        <>
          <section
            className={`rounded-2xl border p-4 ${result.state === "complete" ? "border-emerald-300/20" : "border-amber-300/20"}`}
          >
            <strong>{result.state}</strong>
            <p className="mt-1 text-sm">{result.coverage.message}</p>
            <div className="mt-2 text-xs">
              Ledger {result.observation.ledger ?? "unavailable"} · {result.coverage.pagesRead} pages ·{" "}
              {result.coverage.recordsRead} events
              {result.asset ? ` · ${result.asset.display}` : ""}
            </div>
            {result.warnings.length ? (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </section>
          <ControlsPanel result={result} />
          <TrustlinePanel result={result} />
          <EventTimeline events={result.events} />
        </>
      ) : null}
    </div>
  );
}
