"use client";

import Link from "next/link";
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, HelpCircle, ShieldAlert, WifiOff, WalletCards } from "lucide-react";
import type { AgentResult } from "@/server/types";
import { NoDataState } from "@/components/NoDataState";
import { StalenessStamp } from "@/components/StalenessStamp";

function isAgentResultForUi(result: AgentResult) {
  return Boolean(
    result &&
      typeof result.agent === "string" &&
      typeof result.verdict === "string" &&
      typeof result.summary === "string" &&
      typeof result.score === "number" &&
      typeof result.confidence === "number" &&
      Array.isArray(result.findings) &&
      Array.isArray(result.sources) &&
      Array.isArray(result.missingData) &&
      result.dataQuality &&
      typeof result.dataQuality.detail === "string",
  );
}

function getRawPreview(rawSignals?: Record<string, unknown>) {
  if (!rawSignals) return [];

  return Object.entries(rawSignals)
    .slice(0, 4)
    .map(([key, value]) => {
      const serialized = typeof value === "string" ? value : JSON.stringify(value);
      return `${key}: ${serialized?.slice(0, 160)}`;
    });
}

function getCriticalBlockers(result: AgentResult) {
  return [
    ...result.blockingReasons,
    ...result.findings.filter((finding) => finding.severity === "critical").map((finding) => `${finding.label}: ${finding.detail}`),
  ].slice(0, 4);
}

export function AgentResultPanel({ result }: { result: AgentResult }) {
  if (!isAgentResultForUi(result)) {
    return (
      <NoDataState
        title="Invalid agent result"
        detail="The agent result failed the UI contract boundary and cannot be treated as a safe signal."
      />
    );
  }

  // Handle optional portfolio keeper without wallet
  const isPortfolioSkipped = result.agent === "portfolio" && (
    result.status === "idle" ||
    result.missingData.some((m) => m.field.toLowerCase().includes("wallet")) ||
    result.summary.toLowerCase().includes("no wallet")
  );

  if (isPortfolioSkipped) {
    return (
      <section className="rounded-2xl border border-sky-400/25 bg-sky-950/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-sky-200">
            <WalletCards className="h-3.5 w-3.5" />
            Portfolio Keeper · Skipped
          </div>
          <span className="text-xs text-white/50">Optional evaluation</span>
        </div>
        <h3 className="mt-3 text-lg font-semibold text-white">Portfolio exposure analysis skipped</h3>
        <p className="mt-2 text-sm leading-6 text-white/65">
          Connect your EVM or Stellar wallet to inspect token balance concentration, meme exposure, and reserve safety. Token safety scan ran independently with all onchain, news, and social signals.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Link
            href="/#connect"
            className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-400"
          >
            Connect Wallet
          </Link>
          <span className="text-xs text-white/45">No mock portfolio data will ever be generated.</span>
        </div>
      </section>
    );
  }

  const isUnavailable =
    result.status === "unavailable" ||
    result.status === "error" ||
    (result.dataQuality.connectedSources === 0 && result.sources.length > 0 && result.sources.every((s) => s.status === "unavailable"));

  const isStaleOrPartial =
    !isUnavailable &&
    (result.status === "partial" ||
      result.dataQuality.mode === "stale" ||
      result.missingData.length > 0 ||
      result.sources.some((s) => s.checkedAt && Date.now() - new Date(s.checkedAt).getTime() > 300_000));

  const explanation = result.rawSignals?.explanation as
    | {
        confidenceExplanation?: string;
        evidence?: string[];
        missingData?: string[];
      }
    | undefined;
  const topFindings = result.findings.slice(0, 5);
  const rawPreview = getRawPreview(result.rawSignals);
  const criticalBlockers = getCriticalBlockers(result);
  const hasMockData = result.dataQuality.mockSources > 0 || result.sources.some((source) => source.status === "mock");
  const manualReview = result.recommendedAction === "manual_review" || result.status === "manual_review_required";

  // Card container styling based on verified / stale / unavailable state
  const containerClass = isUnavailable
    ? "rounded-2xl border-2 border-dashed border-white/20 bg-white/[0.02] p-5"
    : isStaleOrPartial
      ? "rounded-2xl border border-amber-400/30 bg-amber-950/15 p-5 shadow-sm"
      : "rounded-2xl border border-white/10 bg-black/25 p-5";

  return (
    <section className={containerClass}>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm uppercase tracking-[0.14em] text-[#d9a441] font-medium">{result.agent} agent</span>
            {isUnavailable ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-xs text-white/70">
                <WifiOff className="h-3 w-3" />
                Provider Unavailable
              </span>
            ) : isStaleOrPartial ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-400/10 px-2.5 py-0.5 text-xs text-amber-200">
                <Clock className="h-3 w-3" />
                Partial / Stale Data
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-xs text-emerald-200">
                <CheckCircle2 className="h-3 w-3" />
                Verified Live
              </span>
            )}
          </div>
          <h3 className="mt-1 text-lg font-semibold text-white">{result.verdict}</h3>
        </div>

        {/* Score & Risk Badges: NEVER show 0% or green safe for unavailable agents! */}
        <div className="flex flex-wrap gap-2">
          {isUnavailable ? (
            <>
              <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-sm font-mono text-white/50">
                Score: N/A
              </span>
              <span className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-sm text-white/60">
                Unavailable
              </span>
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-sm text-amber-200">
                Confidence: 0%
              </span>
            </>
          ) : (
            <>
              <span className="rounded-full border border-white/10 px-3 py-1 text-sm font-semibold text-white">
                {result.score}/100
              </span>
              <span className={`rounded-full border px-3 py-1 text-sm capitalize ${
                result.riskLevel === "high" || result.riskLevel === "critical"
                  ? "border-red-400/30 bg-red-400/10 text-red-200"
                  : result.riskLevel === "medium"
                    ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                    : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
              }`}>
                {result.riskLevel} risk
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1 text-sm capitalize text-white/58">
                {result.recommendedAction.replaceAll("_", " ")}
              </span>
              <span className="rounded-full border border-white/10 px-3 py-1 text-sm text-white/58">
                {Math.round(result.confidence * 100)}% confidence
              </span>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 text-sm leading-6 text-white/65">{result.summary}</div>

      {/* Staleness stamp banner for stale/partial data */}
      {isStaleOrPartial ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StalenessStamp capturedAt={result.createdAt} label="Cached snapshot" />
          <span className="text-xs text-amber-200/80">
            {result.missingData.length > 0
              ? `${result.missingData.length} missing signal${result.missingData.length === 1 ? "" : "s"} lowered confidence`
              : "Re-scan recommended for real-time verification"}
          </span>
        </div>
      ) : null}

      {/* Provider unavailable warning banner */}
      {isUnavailable ? (
        <div className="mt-4 rounded-xl border border-white/15 bg-white/5 p-4 text-xs text-white/70">
          <div className="flex items-center gap-2 font-semibold text-white">
            <WifiOff className="h-4 w-4 text-amber-400" />
            Upstream data provider is currently unreachable
          </div>
          <p className="mt-1 leading-5 text-white/60">
            This agent was unable to retrieve live audit signals. Cryptara does not substitute mock or speculative data in live mode to avoid falsely indicating security. Risk is not marked safe.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/ops"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#f2c86d] underline underline-offset-2 hover:text-white"
            >
              View Provider SLO &amp; Status
            </Link>
          </div>
        </div>
      ) : null}

      {criticalBlockers.length > 0 ? (
        <div className="mt-4 rounded-xl border border-red-300/25 bg-red-500/10 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-red-200">Critical blockers</div>
          <div className="mt-2 space-y-2">
            {criticalBlockers.map((item) => (
              <div key={item} className="text-xs leading-5 text-red-100/82">
                {item}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {manualReview ? (
        <div className="mt-4 rounded-xl border border-[#d9a441]/25 bg-[#d9a441]/10 p-3 text-xs leading-5 text-[#f2c86d]">
          Manual review required. This result shows risks, evidence, missing data and confidence; it is not a buy/sell guarantee.
        </div>
      ) : null}

      {hasMockData ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/6 p-3 text-xs leading-5 text-white/56">
          Demo/mock source data is explicitly marked in the source list and is not hidden.
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-white/6 p-3">
          <div className="text-xs text-white/38">Score breakdown</div>
          <div className="mt-2 space-y-2">
            {topFindings.slice(0, 3).map((finding) => (
              <div key={finding.label} className="text-xs leading-5 text-white/54">
                {finding.label}: {finding.scoreImpact ?? finding.severity}
              </div>
            ))}
            {topFindings.length === 0 ? (
              <div className="text-xs text-white/40">No individual score penalties reported.</div>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl bg-white/6 p-3">
          <div className="text-xs text-white/38">Source list</div>
          <div className="mt-2 space-y-2">
            {result.sources.slice(0, 4).map((source) => (
              <div key={source.label} className="text-xs leading-5 text-white/54">
                <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1.5 ${
                  source.status === "connected" ? "bg-emerald-400" : source.status === "unavailable" ? "bg-red-400" : "bg-amber-400"
                }`} />
                {source.label}: {source.status}
                {source.checkedAt ? `, checked ${source.checkedAt}` : ""}
                {typeof source.reliability === "number" ? `, ${Math.round(source.reliability * 100)}% reliability` : ""}
              </div>
            ))}
            {result.sources.length === 0 ? (
              <div className="text-xs text-white/40">No sources queried.</div>
            ) : null}
          </div>
        </div>
        <div className="rounded-xl bg-white/6 p-3">
          <div className="text-xs text-white/38">Missing data &amp; penalty</div>
          <div className="mt-2 space-y-2">
            {result.missingData.length > 0 ? (
              result.missingData.slice(0, 3).map((item) => (
                <div key={`${item.field}:${item.reason}`} className="text-xs leading-5 text-white/54">
                  <span className="font-semibold text-amber-200/80">{item.field}:</span> {item.impact} impact ({item.reason})
                </div>
              ))
            ) : (
              <div className="text-xs leading-5 text-white/54">No material missing data reported.</div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl bg-white/6 p-3">
          <div className="text-xs text-white/38">Risk and confidence</div>
          <div className="mt-2 text-xs leading-5 text-white/54">
            Risk: {isUnavailable ? "N/A" : `${result.riskScore}/100 (${result.riskLevel})`}. Confidence: {isUnavailable ? "0%" : `${Math.round(result.confidence * 100)}%`}. Data quality: {result.dataQuality.mode}.
          </div>
        </div>
        <div className="rounded-xl bg-white/6 p-3">
          <div className="text-xs text-white/38">Confidence explanation</div>
          <div className="mt-2 text-xs leading-5 text-white/54">
            {explanation?.confidenceExplanation ?? result.dataQuality.detail}
          </div>
        </div>
        <div className="rounded-xl bg-white/6 p-3">
          <div className="text-xs text-white/38">Raw evidence snippets</div>
          <div className="mt-2 space-y-2">
            {(rawPreview.length > 0 ? rawPreview : ["No raw signal preview available."]).map((item) => (
              <div key={item} className="break-words text-xs leading-5 text-white/54">
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {explanation?.evidence?.length ? (
        <div className="mt-4 rounded-xl border border-[#d9a441]/20 bg-[#d9a441]/8 p-3">
          <div className="text-xs text-[#d9a441]">Why this decision</div>
          <div className="mt-2 space-y-2">
            {explanation.evidence.slice(0, 3).map((item) => (
              <div key={item} className="text-xs leading-5 text-white/58">
                {item}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {result.agent === "news" ? (
        <p className="mt-4 text-xs text-white/54">
          <Link href="/insights/news-lineage" className="underline underline-offset-2 hover:text-white">
            Inspect story lineage and independent corroboration
          </Link>
          {" · "}
          <Link href="/insights/incident-status" className="underline underline-offset-2 hover:text-white">
            Reconcile incident claims with official status
          </Link>
        </p>
      ) : null}
    </section>
  );
}
