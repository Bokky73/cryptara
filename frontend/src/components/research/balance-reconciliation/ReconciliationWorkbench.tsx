"use client";

import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BalanceReport } from "@/server/research/balance-reconciliation/schema";
import { BalanceTimeline } from "./BalanceTimeline";
import { CategoryBreakdown } from "./CategoryBreakdown";
import { CoverageNotice } from "./CoverageNotice";
import { ReconciliationResult } from "./ReconciliationResult";
import { useWorkbenchState } from "./useWorkbenchState";
import { WindowInput } from "./WindowInput";

type Network = "stellar-testnet" | "stellar-pubnet";

export function ReconciliationWorkbench({ initialNetwork = "stellar-testnet" }: { initialNetwork?: Network }) {
  const [account, setAccount] = useState("");
  const [network, setNetwork] = useInsightParam<Network>("network", initialNetwork, ["stellar-testnet", "stellar-pubnet"]);
  const [fromLedger, setFromLedger] = useState("10");
  const [toLedger, setToLedger] = useState("20");
  const networkRef = useRef(network);
  const { view, setView } = useWorkbenchState(network);

  useEffect(() => {
    networkRef.current = network;
  }, [network]);

  async function reconcile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedNetwork = network;
    setView({ status: "loading" });
    const response = await fetch("/api/insights/balance-reconciliation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account, network: submittedNetwork, fromLedger: Number(fromLedger), toLedger: Number(toLedger) }),
    });
    const body = (await response.json()) as { report?: BalanceReport; message?: string; error?: string };
    if (networkRef.current !== submittedNetwork) return;
    if (!body.report) {
      setView({ status: "error", message: body.message ?? body.error ?? "Reconciliation failed." });
      return;
    }
    setView({ status: "ready", report: body.report });
  }

  return (
    <div className="flex flex-col gap-4">
      <form aria-label="Balance reconciliation" className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/4 p-4" onSubmit={reconcile}>
        <WindowInput account={account} network={network} fromLedger={fromLedger} toLedger={toLedger} disabled={view.status === "loading"} onAccount={setAccount} onNetwork={setNetwork} onFrom={setFromLedger} onTo={setToLedger} />
        <button type="submit" disabled={view.status === "loading"} className="inline-flex w-fit rounded-full border border-[#d9a441]/35 bg-[#d9a441]/10 px-4 py-2 text-sm font-semibold text-[#f2c86d] disabled:opacity-50">
          Reconcile balances
        </button>
        <p data-testid="balance-idle" className="text-sm text-muted">
          This page rebuilds balances from effects. It does not convert prices, report tax, or change a risk score.
        </p>
      </form>
      {view.status === "error" ? <p role="alert" className="rounded-2xl border border-red-300/25 bg-red-400/8 p-4 text-sm text-red-100">{view.message}</p> : null}
      {view.status === "ready" ? (
        <div className="flex flex-col gap-4">
          <ReconciliationResult rows={view.report.reconciliation} matched={view.report.matched} />
          <BalanceTimeline timeline={view.report.timeline} />
          <CategoryBreakdown categories={view.report.categories} />
          <CoverageNotice notice={view.report.coverageNotice} state={view.report.state} />
        </div>
      ) : null}
    </div>
  );
}
