"use client";

import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { QuorumReport } from "@/server/research/quorum-map/schema";
import { CoverageNotice } from "./CoverageNotice";
import { DependencyPanel } from "./DependencyPanel";
import { NetworkSelector } from "./NetworkSelector";
import { OrganizationTable } from "./OrganizationTable";
import { QuorumTree } from "./QuorumTree";
import { useWorkbenchState } from "./useWorkbenchState";

type Network = "stellar-testnet" | "stellar-pubnet";

export function QuorumExplorer({ initialNetwork = "stellar-testnet" }: { initialNetwork?: Network }) {
  const [network, setNetwork] = useInsightParam<Network>("network", initialNetwork, ["stellar-testnet", "stellar-pubnet"]);
  const [selected, setSelected] = useState<string | null>(null);
  const networkRef = useRef(network);
  const { view, setView } = useWorkbenchState(network);

  useEffect(() => {
    networkRef.current = network;
  }, [network]);

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedNetwork = network;
    setView({ status: "loading" });
    const response = await fetch("/api/insights/quorum-map", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ network: submittedNetwork }),
    });
    const body = (await response.json()) as { report?: QuorumReport; message?: string; error?: string };
    if (networkRef.current !== submittedNetwork) return;
    if (!body.report) {
      setView({ status: "error", message: body.message ?? body.error ?? "Quorum map failed." });
      return;
    }
    setSelected(body.report.organizations[0]?.organization ?? null);
    setView({ status: "ready", report: body.report });
  }

  const organization = view.status === "ready" ? view.report.organizations.find((entry) => entry.organization === selected) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      <form aria-label="Quorum map" className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/4 p-4" onSubmit={load}>
        <NetworkSelector network={network} disabled={view.status === "loading"} onNetwork={setNetwork} />
        <button type="submit" disabled={view.status === "loading"} className="inline-flex w-fit rounded-full border border-[#d9a441]/35 bg-[#d9a441]/10 px-4 py-2 text-sm font-semibold text-[#f2c86d] disabled:opacity-50">
          Load quorum map
        </button>
        <p data-testid="quorum-idle" className="text-sm text-muted">
          This page shows which organizations a quorum set depends on. It does not prove network safety.
        </p>
      </form>
      {view.status === "error" ? <p role="alert" className="rounded-2xl border border-red-300/25 bg-red-400/8 p-4 text-sm text-red-100">{view.message}</p> : null}
      {view.status === "ready" && view.report.organizations.length > 0 ? (
        <div className="flex flex-col gap-4">
          <OrganizationTable organizations={view.report.organizations} selected={selected} onSelect={setSelected} />
          <QuorumTree sets={view.report.quorumSets} unresolvedKeys={view.report.unresolvedKeys} />
          <DependencyPanel organization={organization} disagreements={view.report.disagreements} sources={view.report.sources} />
          <CoverageNotice notice={view.report.coverageNotice} state={view.report.state} />
        </div>
      ) : null}
      {view.status === "ready" && view.report.organizations.length === 0 ? (
        <CoverageNotice notice={view.report.coverageNotice} state={view.report.state} />
      ) : null}
    </div>
  );
}
