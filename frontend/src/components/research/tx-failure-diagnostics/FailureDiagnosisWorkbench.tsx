"use client";

import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DiagnosisReport } from "@/server/research/tx-failure-diagnostics/schema";
import { CoverageNotice } from "./CoverageNotice";
import { HashInput } from "./HashInput";
import { OperationDiagnosisList } from "./OperationDiagnosisList";
import { ResultSummary } from "./ResultSummary";
import { StateEvidencePanel } from "./StateEvidencePanel";
import { useWorkbenchState } from "./useWorkbenchState";

type Network = "stellar-testnet" | "stellar-pubnet";

export function FailureDiagnosisWorkbench({ initialNetwork = "stellar-testnet" }: { initialNetwork?: Network }) {
  const [hash, setHash] = useState("");
  const [network, setNetwork] = useInsightParam<Network>("network", initialNetwork, ["stellar-testnet", "stellar-pubnet"]);
  const networkRef = useRef(network);
  const { view, setView } = useWorkbenchState(network);

  useEffect(() => {
    networkRef.current = network;
  }, [network]);

  async function diagnose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedNetwork = network;
    setView({ status: "loading" });

    const response = await fetch("/api/insights/tx-failure-diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hash, network: submittedNetwork }),
    });
    const body = (await response.json()) as { report?: DiagnosisReport; message?: string; error?: string };
    if (networkRef.current !== submittedNetwork) return;
    if (!body.report) {
      setView({ status: "error", message: body.message ?? body.error ?? "Diagnosis failed." });
      return;
    }
    setView({ status: "ready", report: body.report });
  }

  return (
    <div className="flex flex-col gap-4">
      <form aria-label="Failed transaction hash" className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/4 p-4" onSubmit={diagnose}>
        <HashInput hash={hash} network={network} disabled={view.status === "loading"} onHash={setHash} onNetwork={setNetwork} />
        <button
          type="submit"
          disabled={view.status === "loading"}
          className="inline-flex w-fit rounded-full border border-[#d9a441]/35 bg-[#d9a441]/10 px-4 py-2 text-sm font-semibold text-[#f2c86d] disabled:opacity-50"
        >
          Diagnose transaction
        </button>
        <p data-testid="tx-failure-idle" className="text-sm text-muted">
          This page only reads result codes and ledger evidence. It does not submit, sign, or retry the transaction.
        </p>
      </form>

      {view.status === "error" ? (
        <p role="alert" className="rounded-2xl border border-red-300/25 bg-red-400/8 p-4 text-sm text-red-100">
          {view.message}
        </p>
      ) : null}

      {view.status === "ready" ? (
        <div className="flex flex-col gap-4">
          <ResultSummary report={view.report} />
          <OperationDiagnosisList operations={view.report.operations} />
          <StateEvidencePanel evidence={view.report.stateEvidence} />
          <CoverageNotice notice={view.report.coverageNotice} state={view.report.state} />
        </div>
      ) : null}
    </div>
  );
}
