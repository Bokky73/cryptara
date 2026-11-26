"use client";

import { useInsightParam } from "@/components/research/shared/useInsightQueryParams";
import { useState } from "react";
import { LiveRegion } from "@/components/a11y/LiveRegion";
import { CoverageNotice } from "./CoverageNotice";
import { FieldComparison } from "./FieldComparison";
import { LagSummary } from "./LagSummary";
import { ProviderStatus } from "./ProviderStatus";
import { TargetInput } from "./TargetInput";
import { useWorkbenchState } from "./useWorkbenchState";
import type { NetworkId } from "@/server/research/rpc-consistency/schema";

function parseKeys(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * The consistency workbench.
 *
 * Switching network or target does not keep the previous report on screen
 * after a new submit. Layout stays a single column at a phone width.
 */
export function ConsistencyWorkbench(props: {
  endpoint?: string;
  initialNetwork?: NetworkId | null;
  initialTarget?: string | null;
}) {
  const endpoint = props.endpoint ?? "/api/insights/rpc-consistency";
  const { state, compare } = useWorkbenchState(endpoint);
  const [network, setNetwork] = useInsightParam<NetworkId>("network", props.initialNetwork === "mainnet" ? "mainnet" : "testnet", ["testnet", "mainnet"]);
  const [target, setTarget] = useState(props.initialTarget ?? "");
  const [contractKeys, setContractKeys] = useState("");
  const report = state.status === "ready" ? state.report : null;

  const statusMessage =
    state.status === "loading"
      ? "Comparing Horizon and Stellar RPC."
      : state.status === "error"
        ? `Comparison failed: ${state.message}`
        : report
          ? `Comparison ready on ${report.network}. Coverage is ${report.coverage.state}. ${report.lag.note}`
          : "";

  return (
    <div data-testid="consistency-workbench" className="flex min-w-0 max-w-full flex-col gap-6">
      <TargetInput
        network={network}
        target={target}
        contractKeys={contractKeys}
        busy={state.status === "loading"}
        onNetworkChange={setNetwork}
        onTargetChange={setTarget}
        onContractKeysChange={setContractKeys}
        onSubmit={() => compare({ network, target, contractDataKeys: parseKeys(contractKeys) })}
      />

      <LiveRegion message={statusMessage} />

      {state.status === "idle" ? (
        <p data-testid="consistency-idle" className="text-sm text-white/60">
          Compare an account or contract on testnet or mainnet. The check is read-only and keeps the two networks separate.
        </p>
      ) : null}

      {state.status === "loading" ? (
        <p data-testid="consistency-loading" className="text-sm text-white/60">
          Reading Horizon and Stellar RPC…
        </p>
      ) : null}

      {state.status === "error" ? (
        <div data-testid="consistency-error" role="alert" className="rounded-[28px] border border-red-300/30 bg-red-400/10 p-4 text-sm text-red-100">
          <p className="font-semibold">The comparison could not be completed.</p>
          <p className="mt-1 break-words">{state.message}</p>
          <p className="mt-2 text-xs text-red-100/70">Error code: {state.code}</p>
        </div>
      ) : null}

      {report ? (
        <div className="flex min-w-0 flex-col gap-6">
          <p data-testid="consistency-network" className="text-xs uppercase tracking-[0.14em] text-white/45">
            {report.network} · {report.target.kind} · <span className="break-all normal-case tracking-normal">{report.target.id}</span>
          </p>
          <section className="glass-panel min-w-0 rounded-[28px] p-4 sm:p-6">
            <CoverageNotice coverage={report.coverage} />
          </section>
          <section className="glass-panel min-w-0 rounded-[28px] p-4 sm:p-6">
            <ProviderStatus providers={report.providers} />
          </section>
          <section className="glass-panel min-w-0 rounded-[28px] p-4 sm:p-6">
            <LagSummary lag={report.lag} />
          </section>
          <section aria-labelledby="field-comparison-heading" className="glass-panel min-w-0 rounded-[28px] p-4 sm:p-6">
            <h2 id="field-comparison-heading" className="text-lg font-semibold">
              Fields
            </h2>
            <div className="mt-4">
              <FieldComparison fields={report.fields} />
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
