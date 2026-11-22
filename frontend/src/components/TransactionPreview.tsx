"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TransactionPreview as Preview } from "@/server/types";
import { formatUsd } from "@/lib/format";
import { SimulationResultPanel } from "@/components/SimulationResultPanel";

function useCountdown(expiresAt?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const target = new Date(expiresAt).getTime();
  if (Number.isNaN(target)) return null;
  const remainingMs = target - now;
  const expired = remainingMs <= 0;
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    expired,
    label: expired ? "Expired" : `${minutes}:${String(seconds).padStart(2, "0")}`,
  };
}

export function TransactionPreview({ preview }: { preview: Preview }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const countdown = useCountdown(preview.quote?.expiresAt ?? null);

  const buyRisk = preview.projectedRiskScore ?? preview.currentRiskScore ?? 0;
  const confidence = preview.simulation?.confidence ?? 100;
  const highRisk = buyRisk >= 60 || confidence < 50;
  const quoteExpired = countdown?.expired ?? false;
  const canReview = !preview.blockedReason && !quoteExpired && (!highRisk || acknowledged);

  const explorerUrl = preview.explorerUrl ?? null;
  const contractVerified = preview.contractVerified ?? false;
  const targetContract = preview.targetContract ?? null;

  return (
    <section className="rounded-[28px] border border-[#d9a441]/25 bg-[#d9a441]/8 p-6">
      <div className="text-sm uppercase tracking-[0.18em] text-[#d9a441]">Transaction preview</div>
      <h2 className="mt-3 text-2xl font-semibold">{preview.title}</h2>

      {highRisk ? (
        <div
          role="alert"
          className="mt-5 rounded-2xl border border-red-300/30 bg-red-500/12 px-4 py-3 text-sm text-red-100"
        >
          <div className="font-semibold">High-risk transaction</div>
          <div className="mt-1 opacity-80">
            Buy risk {buyRisk}% · Confidence {confidence}%. Review the details carefully before signing.
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-black/20 p-4">
          <div className="text-xs text-white/45">You send</div>
          <div className="mt-1 text-xl font-semibold">
            {preview.percent ? `${preview.percent}% ` : ""}
            {preview.fromToken ?? "TOKEN"}
          </div>
          <div className="mt-1 text-xs text-white/45">{formatUsd(preview.estimatedValueUsd)}</div>
        </div>
        <div className="rounded-2xl bg-black/20 p-4">
          <div className="text-xs text-white/45">Minimum you receive</div>
          <div className="mt-1 text-xl font-semibold">{preview.toToken ?? "USDC"}</div>
          <div className="mt-1 text-xs text-white/45">
            Max slippage {((preview.slippageBps ?? 0) / 100).toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-xs text-white/38">Network</div>
          <div className="mt-1 text-sm font-semibold">{preview.network}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-xs text-white/38">Target contract</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="truncate">{targetContract ?? "—"}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] ${
                contractVerified
                  ? "bg-green-500/15 text-green-200"
                  : "bg-yellow-500/15 text-yellow-200"
              }`}
            >
              {contractVerified ? "Verified" : "Unverified"}
            </span>
            {explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal underline underline-offset-2 hover:text-white"
              >
                Explorer
              </a>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-xs text-white/38">Estimated gas</div>
          <div className="mt-1 text-sm font-semibold">{formatUsd(preview.gasEstimateUsd ?? 0)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-xs text-white/38">Stellar stroops</div>
          <div className="mt-1 text-sm font-semibold">{preview.stroops ?? "—"}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-xs text-white/38">Quote expiry</div>
          <div className={`mt-1 text-sm font-semibold ${quoteExpired ? "text-red-200" : ""}`}>
            {countdown ? countdown.label : "—"}
          </div>
        </div>
      </div>

      {preview.blockedReason ? (
        <div className="mt-5 rounded-2xl border border-red-300/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {preview.blockedReason}
        </div>
      ) : null}
      {preview.policyStatus?.decisions && preview.policyStatus.decisions.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="text-xs uppercase tracking-[0.15em] text-white/35">Policy rules evaluated</div>
          {preview.policyStatus.decisions.map((d, i) => (
            <div
              key={`${d.ruleId}-${d.ruleLabel}-${i}`}
              className={`rounded-xl border px-3 py-2 text-xs ${
                d.action === "blocked"
                  ? "border-red-300/20 bg-red-500/8 text-red-100"
                  : d.action === "warned"
                    ? "border-yellow-300/20 bg-yellow-500/8 text-yellow-100"
                    : "border-green-300/20 bg-green-500/8 text-green-100"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{d.ruleLabel}</span>
                <span className="tabular-nums opacity-70">v{d.ruleVersion}</span>
              </div>
              <div className="mt-1 opacity-80">{d.reason}</div>
              <div className="mt-1 flex gap-3 text-[10px] opacity-50">
                <span>Observed: {String(d.observedValue)}</span>
                <span>Threshold: {String(d.threshold)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {preview.blockedReason ? null : (
        <div className="mt-5 rounded-2xl bg-black/20 px-4 py-3 text-sm text-white/56">
          {preview.requiresApproval ? "Approval required" : "No wallet approval required"} on {preview.network}
          {preview.percent ? ` · ${preview.percent}% ${preview.fromToken ?? "TOKEN"} to ${preview.toToken ?? "USDC"}` : null}
        </div>
      )}
      {preview.approvalSteps?.length ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {preview.approvalSteps.map((step) => (
            <div key={step} className="rounded-2xl bg-white/6 px-4 py-3 text-sm text-white/52">
              {step}
            </div>
          ))}
        </div>
      ) : null}
      {preview.policy ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="text-xs text-white/38">Max trade</div>
            <div className="mt-1 text-sm font-semibold">{preview.policy.maxTradePercent}%</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="text-xs text-white/38">Risk threshold</div>
            <div className="mt-1 text-sm font-semibold">{preview.policy.maxRiskScore}/100</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="text-xs text-white/38">Auto execute</div>
            <div className="mt-1 text-sm font-semibold">{preview.policy.autoExecute ? "On" : "Off"}</div>
          </div>
        </div>
      ) : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-xs text-white/38">Policy</div>
          <div className="mt-1 text-sm font-semibold">{preview.policyStatus?.allowed ? "Allowed" : preview.blockedReason ? "Blocked" : "Review"}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-xs text-white/38">Simulation</div>
          <div className="mt-1 text-sm font-semibold">{preview.simulation?.status?.replaceAll("_", " ") ?? "Unavailable"}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-xs text-white/38">Slippage / gas</div>
          <div className="mt-1 text-sm font-semibold">
            {preview.slippageBps ?? 0} bps · {formatUsd(preview.gasEstimateUsd ?? 0)}
          </div>
        </div>
      </div>
      {preview.quote ? (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm text-white/48">
          Route: {preview.quote.route.join(" -> ")} · Price impact {preview.quote.priceImpactBps} bps. {preview.quote.detail}
        </div>
      ) : null}
      {preview.audit ? (
        <div className="mt-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm text-white/48">
          Server cannot sign transactions. {preview.audit.approvalRequired ? "User wallet approval required before broadcast." : "No user wallet approval is required for this non-executable action."}
        </div>
      ) : null}
      {preview.simulation ? (
        <div className="mt-5">
          <SimulationResultPanel simulation={preview.simulation} />
        </div>
      ) : null}

      {highRisk ? (
        <label className="mt-5 flex items-start gap-3 rounded-2xl border border-red-300/25 bg-red-500/8 px-4 py-3 text-sm text-red-100">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-red-400"
          />
          <span>I understand this transaction is high-risk and want to proceed.</span>
        </label>
      ) : null}

      {quoteExpired ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-yellow-300/25 bg-yellow-500/8 px-4 py-3 text-sm text-yellow-100">
          <span>This quote has expired. Refresh to re-simulate before signing.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-yellow-400/20 px-3 py-1 text-xs font-semibold text-yellow-50 hover:bg-yellow-400/30"
          >
            Refresh Quote &amp; Re-simulate
          </button>
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          disabled={!canReview}
          className="rounded-full bg-[#d9a441] px-5 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          Review in Wallet
        </button>
        <p className="text-xs text-white/54">
          Approval-only: Cryptara never signs for you.{" "}
          <Link href="/insights/signing-inspector" className="underline underline-offset-2 hover:text-white">
            Inspect the unsigned payload before signing
          </Link>
        </p>
      </div>
    </section>
  );
}