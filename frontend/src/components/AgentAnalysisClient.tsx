"use client";

import Link from "next/link";
import { useState } from "react";
import { useWalletSession } from "@/hooks/useWalletSession";
import type { AgentAnalysisResult } from "@/server/agent";
import type { PreparedTransactionPayload, TransactionPreview as Preview } from "@/server/types";
import { AgentTimeline } from "@/components/AgentTimeline";
import { RiskScoreCard } from "@/components/RiskScoreCard";
import { SuggestedActionCard } from "@/components/SuggestedActionCard";
import { TransactionPreview } from "@/components/TransactionPreview";

type ExecutionStatus = "idle" | "preparing" | "ready" | "confirming" | "confirmed" | "rejected" | "error";

function createDemoWalletTxHash() {
  const left = crypto.randomUUID().replaceAll("-", "");
  const right = crypto.randomUUID().replaceAll("-", "");

  return `0x${left}${right}`;
}

export function AgentAnalysisClient() {
  const { address } = useWalletSession();
  const [analysis, setAnalysis] = useState<AgentAnalysisResult | null>(null);
  const [preparedPreview, setPreparedPreview] = useState<Preview | null>(null);
  const [preparedPayload, setPreparedPayload] = useState<PreparedTransactionPayload | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [executionStatus, setExecutionStatus] = useState<ExecutionStatus>("idle");
  const [executionError, setExecutionError] = useState<string | null>(null);

  async function runAgent() {
    setIsRunning(true);
    setTxHash(null);
    setPreparedPreview(null);
    setPreparedPayload(null);
    setExecutionStatus("preparing");
    setExecutionError(null);

    const response = await fetch("/api/agent/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: address }),
    });
    const data = (await response.json()) as AgentAnalysisResult;

    setAnalysis(data);
    const prepareResponse = await fetch("/api/execute/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletAddress: address ?? data.decision.walletAddress,
        action: data.decision.suggestedAction.type,
        fromToken: data.decision.suggestedAction.fromToken,
        toToken: data.decision.suggestedAction.toToken,
        percent: data.decision.suggestedAction.percent,
        riskScore: data.decision.riskScore,
        estimatedValueUsd: data.preview.estimatedValueUsd,
        network: data.preview.network,
      }),
    });

    if (prepareResponse.ok) {
      const prepared = (await prepareResponse.json()) as Preview & {
        payload?: PreparedTransactionPayload | null;
      };
      setPreparedPreview(prepared);
      setPreparedPayload(prepared.payload ?? null);
      setExecutionStatus("ready");
    } else {
      setPreparedPreview(data.preview);
      setPreparedPayload(null);
      setExecutionStatus("error");
      setExecutionError("Transaction plan could not be refreshed from execution policy.");
    }

    setIsRunning(false);
  }

  async function approveAction() {
    if (!analysis || !preparedPreview?.requiresApproval) {
      return;
    }

    setExecutionStatus("confirming");
    setExecutionError(null);

    const nextTxHash = createDemoWalletTxHash();
    const response = await fetch("/api/execute/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decisionId: `${analysis.decision.createdAt}:${analysis.decision.suggestedAction.fromToken}`,
        walletAddress: address ?? analysis.decision.walletAddress,
        txHash: nextTxHash,
        userApproved: true,
        network: preparedPreview.network,
        asset: preparedPreview.fromToken ?? analysis.decision.suggestedAction.fromToken,
        valueUsd: preparedPreview.estimatedValueUsd,
      }),
    });

    if (!response.ok) {
      setExecutionStatus("error");
      setExecutionError("Wallet confirmation could not be recorded.");
      return;
    }

    setTxHash(nextTxHash);
    setExecutionStatus("confirmed");
  }

  function rejectAction() {
    setTxHash(null);
    setExecutionStatus("rejected");
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="text-sm uppercase tracking-[0.2em] text-[#d9a441]">Recommendation review</div>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Run decision analysis</h1>
        </div>
        <button
          type="button"
          onClick={runAgent}
          disabled={isRunning}
          className="inline-flex h-12 items-center justify-center rounded-full bg-[#d9a441] px-6 text-sm font-semibold text-black transition hover:bg-[#f2c86d] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRunning ? "Running..." : "Run Decision Analysis"}
        </button>
      </section>

      {!analysis ? (
        <section className="glass-panel rounded-[28px] p-8">
          <div className="text-2xl font-semibold">Ready for demo analysis</div>
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
          <div className="space-y-5">
            <RiskScoreCard score={analysis.decision.riskScore} />
            <AgentTimeline steps={analysis.steps} />
          </div>
          <div className="space-y-5">
            <SuggestedActionCard decision={analysis.decision} />
            <TransactionPreview
              preview={preparedPreview ?? analysis.preview}
              payload={preparedPayload}
              walletAddress={address ?? undefined}
              onRefresh={() => void runAgent()}
            />
            <div className="flex flex-col gap-3 rounded-[28px] border border-white/10 bg-white/6 p-5 sm:flex-row">
              <button
                type="button"
                onClick={approveAction}
                disabled={executionStatus === "confirming" || !(preparedPreview ?? analysis.preview).requiresApproval}
                className="inline-flex h-11 items-center justify-center rounded-full bg-[#d9a441] px-6 text-sm font-semibold text-black transition hover:bg-[#f2c86d] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {executionStatus === "confirming" ? "Recording..." : "Approve Action"}
              </button>
              <button
                type="button"
                onClick={rejectAction}
                className="inline-flex h-11 items-center justify-center rounded-full border border-white/10 px-6 text-sm font-medium text-white transition hover:bg-white/10"
              >
                Reject
              </button>
            </div>
            {executionStatus === "preparing" ? (
              <div className="rounded-[24px] border border-[#d9a441]/25 bg-[#d9a441]/10 p-5 text-sm text-[#f2c86d]">
                Preparing approval-only transaction plan...
              </div>
            ) : null}
            {executionStatus === "rejected" ? (
              <div className="rounded-[24px] border border-white/10 bg-white/6 p-5 text-sm text-white/54">
                Action rejected. No transaction was prepared or submitted.
              </div>
            ) : null}
            {executionStatus === "error" && executionError ? (
              <div className="rounded-[24px] border border-red-300/20 bg-red-500/10 p-5 text-sm text-red-100">
                {executionError}
              </div>
            ) : null}
            {txHash ? (
              <div className="rounded-[24px] border border-emerald-400/25 bg-emerald-400/10 p-5 text-sm text-emerald-100">
                Wallet approval recorded: {txHash}
              </div>
            ) : null}
          </div>
        </div>
      )}
      <p className="mt-4 text-xs text-white/54">
        <Link href="/insights/social-coordination" className="underline underline-offset-2 hover:text-white">
          Inspect coordinated-activity patterns
        </Link>
        {" · "}
        <Link href="/insights/channel-continuity" className="underline underline-offset-2 hover:text-white">
          Inspect official channel continuity
        </Link>
      </p>
    </div>
  );
}
