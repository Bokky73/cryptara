"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, Info, ShieldAlert, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { RiskReport, TokenHolding } from "@/server/types";
import { getPortfolioRiskSignals } from "@/server/portfolio/riskScoring";
import { sessionKeyFor, stageExplanationReport } from "@/components/research/risk-explanations/ExplanationWorkbench";

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;

  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

function arcPath(startAngle: number, endAngle: number) {
  const start = polarToCartesian(100, 100, 74, endAngle);
  const end = polarToCartesian(100, 100, 74, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return `M ${start.x} ${start.y} A 74 74 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

/** Plain-language verdict derived from the buy-risk score. */
function verdictFor(score: number): { label: string; tone: string } {
  if (score >= 71) return { label: "Avoid", tone: "risk-tone-high" };
  if (score >= 41) return { label: "Caution", tone: "risk-tone-medium" };
  if (score >= 21) return { label: "Watch", tone: "risk-tone-medium" };
  return { label: "Favorable", tone: "risk-tone-low" };
}

/** Distinct icon + text label per risk level so color is never the only signal. */
function RiskLevelIcon({ level }: { level: "High" | "Medium" | "Low" }) {
  if (level === "High") return <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" />;
  if (level === "Medium") return <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />;
  return <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />;
}

export function RiskScoreCard({
  score,
  holdings = [],
  report,
  account,
  network,
}: {
  score: number;
  holdings?: TokenHolding[];
  /** Optional report to explain. When absent the entry link is not rendered. */
  report?: RiskReport;
  account?: string | null;
  network?: string | null;
}) {
  const router = useRouter();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showAgentDetails, setShowAgentDetails] = useState(false);
  const headingId = useId();
  const agentDetailsId = useId();
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const boundedScore = Math.min(100, Math.max(0, score));
  const level = boundedScore >= 71 ? "High" : boundedScore >= 41 ? "Medium" : "Low";
  const verdict = verdictFor(boundedScore);
  const confidence = report?.confidence ?? null;
  const lowConfidence = confidence !== null && confidence < 60;
  const markerAngle = -90 + boundedScore * 1.8;
  const marker = polarToCartesian(100, 100, 74, markerAngle);
  const markerStem = polarToCartesian(100, 100, 58, markerAngle);
  const markerColor =
    level === "High" ? "var(--color-risk-high)" : level === "Medium" ? "var(--color-risk-medium)" : "var(--color-risk-low)";
  const levelToneClass = level === "High" ? "risk-tone-high" : level === "Medium" ? "risk-tone-medium" : "risk-tone-low";
  const signals = getPortfolioRiskSignals(holdings);
  const categories = [
    { label: "Concentration", score: signals.concentrationRisk, weight: 30 },
    { label: "Asset quality", score: signals.assetQualityRisk, weight: 20 },
    { label: "Liquidity", score: signals.liquidityExitRisk, weight: 15 },
    { label: "Stable reserve", score: signals.stableReserveRisk, weight: 10 },
    { label: "Volatility", score: signals.volatilityRisk, weight: 10 },
    { label: "Correlation", score: signals.correlationRisk, weight: 10 },
    { label: "Network execution", score: signals.chainExecutionRisk, weight: 5 },
  ];

  // Tier 2: top plain-language drivers, grouped by severity.
  const criticalFlags = report?.criticalFlags ?? [];
  const warnings = report?.warnings ?? [];
  const strengths = report?.strengths ?? [];
  const missingSources = report?.missingSources ?? [];
  const hasDrivers = criticalFlags.length + warnings.length + strengths.length > 0;

  useEffect(() => {
    if (showBreakdown) {
      closeButtonRef.current?.focus();
      return;
    }
  }, [showBreakdown]);

  function closeBreakdown() {
    setShowBreakdown(false);
    toggleButtonRef.current?.focus();
  }

  /**
   * Hands the selected report to the explanation workbench in memory. The
   * report is keyed to the current wallet session, so a stale token from
   * another account or network is refused on arrival.
   */
  function openExplanationWorkbench() {
    if (!report) return;
    const sessionKey = sessionKeyFor(account, network);
    const token = stageExplanationReport(sessionKey, report);
    const query = new URLSearchParams({ handoff: token });
    if (account) query.set("account", account);
    if (network) query.set("network", network);
    router.push(`/insights/risk-explanations?${query.toString()}`);
  }

  return (
    <section className="glass-panel relative flex h-full flex-col rounded-[28px] p-6">
      {/* Tier 1: above-the-fold verdict, gauge, confidence. */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted">
            Portfolio risk
            {holdings.length > 0 ? (
              <button
                ref={toggleButtonRef}
                type="button"
                onClick={() => setShowBreakdown((visible) => !visible)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-subtle transition hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-fg)]"
                aria-label="Show risk score breakdown"
                aria-expanded={showBreakdown}
              >
                <CircleHelp className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <div className="mt-1 text-4xl font-semibold">{boundedScore}/100</div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${verdict.tone}`}>
            <RiskLevelIcon level={level} />
            <span>Verdict: {verdict.label}</span>
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${levelToneClass}`}>
            <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: markerColor }} />
            <RiskLevelIcon level={level} />
            <span>Risk level: {level}</span>
          </span>
          {confidence !== null ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                lowConfidence ? "risk-tone-medium" : "risk-tone-low"
              }`}
            >
              {lowConfidence ? <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" /> : <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />}
              <span>Confidence: {confidence}%{lowConfidence ? " — low, treat with caution" : ""}</span>
            </span>
          ) : null}
        </div>
      </div>

      {showBreakdown && holdings.length > 0 ? (
        <div
          role="dialog"
          aria-modal="false"
          aria-labelledby={headingId}
          onKeyDown={(event) => {
            if (event.key === "Escape") closeBreakdown();
          }}
          className="absolute inset-x-5 top-24 z-10 rounded-lg border border-[var(--color-border-strong)] bg-panel p-4 shadow-2xl"
        >
          <div className="flex items-center justify-between gap-3">
            <div id={headingId} className="text-sm font-semibold">Why {boundedScore}/100?</div>
            <button ref={closeButtonRef} type="button" onClick={closeBreakdown} className="touch-target rounded-full text-subtle hover:bg-[var(--color-nav-hover-bg)] hover:text-[var(--color-fg)]" aria-label="Close risk breakdown">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 space-y-2.5">
            {categories.map((category) => (
              <div key={category.label} className="grid grid-cols-[1fr_5rem] items-center gap-3 text-xs">
                <div>
                  <div className="flex justify-between gap-3 text-muted">
                    <span>{category.label}</span>
                    <span>{category.weight}% weight</span>
                  </div>
                  <div
                    role="meter"
                    aria-label={`${category.label} risk`}
                    aria-valuenow={category.score}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-gauge-track)]"
                  >
                    <div className="h-full rounded-full bg-brand" style={{ width: `${category.score}%` }} />
                  </div>
                </div>
                <div className="text-right font-semibold text-foreground">{category.score}/100</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-subtle">Overall risk uses the category weights above and portfolio safety floors.</p>
        </div>
      ) : null}

      <div className="flex flex-1 items-center justify-center">
        <svg
          viewBox="0 0 200 128"
          className="h-40 w-full max-w-xs overflow-visible"
          role="img"
          aria-label={`Portfolio risk score ${boundedScore} out of 100, ${level} risk, verdict ${verdict.label}`}
        >
          <defs>
            <linearGradient id="riskGaugeGradient" x1="24" x2="176" y1="100" y2="100" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="var(--color-risk-low)" />
              <stop offset="50%" stopColor="var(--color-risk-medium)" />
              <stop offset="100%" stopColor="var(--color-risk-high)" />
            </linearGradient>
          </defs>
          <path d={arcPath(-90, 90)} fill="none" stroke="var(--color-gauge-track)" strokeWidth="16" strokeLinecap="round" />
          <path d={arcPath(-90, 90)} fill="none" stroke="url(#riskGaugeGradient)" strokeWidth="16" strokeLinecap="round" />
          <line x1={markerStem.x} y1={markerStem.y} x2={marker.x} y2={marker.y} stroke={markerColor} strokeWidth="3" strokeLinecap="round" />
          <circle cx={marker.x} cy={marker.y} r="5" fill={markerColor} />
        </svg>
      </div>

      {/* Tier 2: plain-language key drivers. */}
      {hasDrivers ? (
        <div className="mt-2 space-y-2 text-xs">
          {criticalFlags.length > 0 ? (
            <div>
              <div className="flex items-center gap-1.5 font-semibold text-[var(--color-risk-high)]">
                <ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" />
                <span>Critical flags</span>
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                {criticalFlags.slice(0, 5).map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {warnings.length > 0 ? (
            <div>
              <div className="flex items-center gap-1.5 font-semibold text-[var(--color-risk-medium)]">
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                <span>Warnings</span>
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                {warnings.slice(0, 5).map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {strengths.length > 0 ? (
            <div>
              <div className="flex items-center gap-1.5 font-semibold text-[var(--color-risk-low)]">
                <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                <span>Strengths</span>
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                {strengths.slice(0, 5).map((strength) => (
                  <li key={strength}>{strength}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Missing data is distinct from a safe/zero-risk signal. */}
      {missingSources.length > 0 ? (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-dashed border-[var(--color-border-strong)] px-2.5 py-1.5 text-xs text-subtle">
          <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Missing data (not the same as safe): {missingSources.join(", ")}</span>
        </div>
      ) : null}

      {/* Tier 3: progressive disclosure of agent details. */}
      <div className="mt-3 border-t border-[var(--color-border-strong)] pt-2">
        <button
          type="button"
          onClick={() => setShowAgentDetails((visible) => !visible)}
          aria-expanded={showAgentDetails}
          aria-controls={agentDetailsId}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition hover:text-[var(--color-fg)]"
        >
          <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${showAgentDetails ? "rotate-180" : ""}`} />
          {showAgentDetails ? "Hide agent details" : "Show agent details"}
        </button>
        {showAgentDetails ? (
          <ul id={agentDetailsId} className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-muted">
            {["Contract Guard", "Social Scout", "News Oracle", "Portfolio Keeper", "Decision Core"].map((agent) => (
              <li key={agent} className="rounded-md border border-[var(--color-border-strong)] px-2 py-1">
                {agent}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <p className="mt-2 text-[10px] leading-4 text-subtle">Not financial advice. Always do your own research.</p>
    </section>
  );
}
