"use client";

import { useState } from "react";
import { ArrowDown, ArrowRight, Bot, CheckCircle2, ChevronRight, Clock, HelpCircle, Loader2, Newspaper, RadioTower, ShieldAlert, ShieldCheck, Wallet, WalletCards, X, Zap } from "lucide-react";
import type { AgentResult } from "@/server/types";

type AgentKey = AgentResult["agent"];

type AgentModule = {
  key: AgentKey;
  name: string;
  role: string;
  weight: number; // percentage factor weight
  stage: "signal" | "synthesis" | "action";
  description: string;
  inputLabel: string;
  placeholder: string;
  defaultValue: string;
  icon: typeof Wallet;
};

const modules: AgentModule[] = [
  {
    key: "onchain",
    name: "Onchain Agent",
    role: "Contract Guard",
    weight: 40,
    stage: "signal",
    description: "Contract risk, honeypot signatures, permissions, and liquidity locks.",
    inputLabel: "Contract Address",
    placeholder: "0x contract address or Stellar asset",
    defaultValue: "",
    icon: ShieldCheck,
  },
  {
    key: "social",
    name: "Social Agent",
    role: "Hype & Shill Monitor",
    weight: 25,
    stage: "signal",
    description: "Bot farm activity, viral spam density, and phishing impersonation.",
    inputLabel: "Query / Handle",
    placeholder: "$TOKEN, @project, or cashtag",
    defaultValue: "$GOAT",
    icon: RadioTower,
  },
  {
    key: "news",
    name: "News Agent",
    role: "Catalyst Auditor",
    weight: 15,
    stage: "signal",
    description: "Independent editorial corroboration, exploit reports, and SEC filings.",
    inputLabel: "Token Symbol",
    placeholder: "GOAT, AERO, XLM",
    defaultValue: "GOAT",
    icon: Newspaper,
  },
  {
    key: "portfolio",
    name: "Portfolio Agent",
    role: "Portfolio Keeper",
    weight: 20,
    stage: "signal",
    description: "Wallet concentration, stablecoin reserve ratio, and meme allocation limits.",
    inputLabel: "Wallet Address (Optional)",
    placeholder: "0x... or G... wallet address",
    defaultValue: "",
    icon: WalletCards,
  },
  {
    key: "decision",
    name: "Decision Agent",
    role: "Deterministic Core",
    weight: 100,
    stage: "synthesis",
    description: "Synthesizes parallel agent scores with immutable non-LLM risk weights.",
    inputLabel: "Strategy Mode",
    placeholder: "conservative | balanced | aggressive",
    defaultValue: "balanced",
    icon: CheckCircle2,
  },
  {
    key: "execution",
    name: "Execution Agent",
    role: "Execution Pilot",
    weight: 100,
    stage: "action",
    description: "Generates approval-only, non-custodial transaction drafts and calldata.",
    inputLabel: "Action Preset",
    placeholder: "reduce_exposure | emergency_exit",
    defaultValue: "reduce_exposure",
    icon: Bot,
  },
];

function buildRequestBody(agent: AgentKey, value: string, results: Partial<Record<AgentKey, AgentResult>>) {
  if (agent === "portfolio") {
    return { walletAddress: value || undefined };
  }
  if (agent === "news") {
    return { symbol: value || "GOAT" };
  }
  if (agent === "social") {
    return { query: value || "$GOAT" };
  }
  if (agent === "onchain") {
    return { chain: "goat", contractAddress: value };
  }
  if (agent === "decision") {
    return { results: Object.values(results) };
  }
  return { action: value || "reduce_exposure", percent: 30 };
}

export function AgentsNetwork() {
  const [inputs, setInputs] = useState<Record<AgentKey, string>>(() =>
    modules.reduce(
      (state, module) => ({
        ...state,
        [module.key]: module.defaultValue,
      }),
      {} as Record<AgentKey, string>
    )
  );
  const [loading, setLoading] = useState<Partial<Record<AgentKey, boolean>>>({});
  const [results, setResults] = useState<Partial<Record<AgentKey, AgentResult>>>({});
  const [selectedResult, setSelectedResult] = useState<AgentResult | null>(null);

  const completedCount = Object.keys(results).length;
  const warningCount = Object.values(results).filter((result) => result?.status === "warning").length;

  const signalModules = modules.filter((m) => m.stage === "signal");
  const decisionModule = modules.find((m) => m.key === "decision")!;
  const executionModule = modules.find((m) => m.key === "execution")!;

  async function runAgent(agent: AgentKey) {
    setLoading((current) => ({ ...current, [agent]: true }));
    try {
      const response = await fetch(`/api/agents/${agent}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(agent, inputs[agent], results)),
      });

      if (!response.ok) {
        throw new Error(`Agent request failed with ${response.status}`);
      }

      const result = (await response.json()) as AgentResult;
      setResults((current) => ({ ...current, [agent]: result }));
    } finally {
      setLoading((current) => ({ ...current, [agent]: false }));
    }
  }

  async function runAllSignals() {
    await Promise.all(signalModules.map((m) => runAgent(m.key)));
  }

  function getAgentStatusBadge(agentKey: AgentKey) {
    const isLoading = Boolean(loading[agentKey]);
    const res = results[agentKey];

    if (isLoading) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/10 border border-sky-400/30 px-2.5 py-0.5 text-xs text-sky-200">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </span>
      );
    }
    if (!res) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/10 px-2.5 py-0.5 text-xs text-white/40">
          Idle
        </span>
      );
    }
    if (res.status === "warning" || res.status === "manual_review_required") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 border border-amber-400/30 px-2.5 py-0.5 text-xs text-amber-200">
          <ShieldAlert className="h-3 w-3" />
          Warning
        </span>
      );
    }
    if (res.status === "unavailable" || res.status === "error") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-400/10 border border-red-400/30 px-2.5 py-0.5 text-xs text-red-200">
          Unavailable
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 border border-emerald-400/30 px-2.5 py-0.5 text-xs text-emerald-200">
        <CheckCircle2 className="h-3 w-3" />
        Complete
      </span>
    );
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-[#d9a441]">Multi-Agent Architecture</div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Agent Execution Pipeline</h1>
          <p className="mt-1 text-xs text-white/50">
            Parallel signal gathering feeds into the deterministic Decision Core with transparent factor weights.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={runAllSignals}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#d9a441] px-4 text-xs font-semibold text-black transition hover:bg-[#f2c86d]"
          >
            <Zap className="h-3.5 w-3.5" />
            Run Parallel Signals
          </button>
          <div className="text-xs text-white/46">
            {completedCount}/6 active · {warningCount} warnings
          </div>
        </div>
      </section>

      {/* PIPELINE ARCHITECTURE FLOW DIAGRAM (Parallel -> Converge -> Execute) */}
      <section
        className="rounded-[24px] border border-white/10 bg-black/40 p-5 backdrop-blur-md"
        aria-label="Agent flow and dependency diagram"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#d9a441]">
            Execution Architecture &amp; Dependencies
          </span>
          <span className="text-[11px] text-white/45">Deterministic Non-LLM Synthesis</span>
        </div>

        {/* Responsive Flow: Grid on Desktop, Vertical Timeline Stack on Mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_auto_1fr_auto_1fr] items-center gap-4">
          {/* STAGE 1: PARALLEL SIGNAL AGENTS */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-white/60 mb-1">
              <span>Phase 1: Parallel Signal Inputs</span>
              <span className="font-mono text-[10px] text-emerald-400">4 Concurrent</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {signalModules.map((m) => {
                const Icon = m.icon;
                const res = results[m.key];
                return (
                  <div
                    key={m.key}
                    className="flex flex-col justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs hover:border-[#d9a441]/40 transition"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex items-center gap-1.5 font-medium text-white/90">
                        <Icon className="h-3.5 w-3.5 text-[#d9a441]" />
                        <span>{m.role}</span>
                      </div>
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-white/60">
                        {m.weight}% wt
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span className="text-white/40">{m.name}</span>
                      {getAgentStatusBadge(m.key)}
                    </div>
                    {res ? (
                      <div className="mt-1.5 text-[10px] font-mono text-white/60">
                        Score: {res.score} · {res.riskLevel}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* DESKTOP CONNECTOR 1 */}
          <div className="hidden lg:flex flex-col items-center justify-center text-white/30 px-1">
            <span className="text-[10px] uppercase font-mono text-white/30 rotate-90 mb-2">Weight</span>
            <ArrowRight className="h-6 w-6 text-[#d9a441]/60" />
            <span className="text-[10px] font-mono text-white/40 mt-1">Sum = 100%</span>
          </div>
          {/* MOBILE CONNECTOR 1 */}
          <div className="flex lg:hidden items-center justify-center py-1 text-white/30">
            <ArrowDown className="h-5 w-5 text-[#d9a441]/60" />
          </div>

          {/* STAGE 2: DECISION CORE */}
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-white/60 mb-2">
              <span>Phase 2: Decision Synthesis</span>
              <span className="font-mono text-[10px] text-[#d9a441]">Core</span>
            </div>
            <div className="rounded-xl border border-[#d9a441]/30 bg-[#d9a441]/10 p-4 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <CheckCircle2 className="h-4 w-4 text-[#d9a441]" />
                  <span>{decisionModule.role}</span>
                </div>
                {getAgentStatusBadge("decision")}
              </div>
              <p className="mt-2 text-[11px] leading-5 text-white/70">
                Calculates weighted Buy Risk = (0.4×Onchain) + (0.25×Social) + (0.15×News) + (0.20×Portfolio).
              </p>
              {results.decision ? (
                <div className="mt-2 rounded-lg bg-black/40 p-2 font-mono text-[11px] text-white/90">
                  Buy Risk: {results.decision.score}/100 ({results.decision.riskLevel})
                </div>
              ) : null}
            </div>
          </div>

          {/* DESKTOP CONNECTOR 2 */}
          <div className="hidden lg:flex flex-col items-center justify-center text-white/30 px-1">
            <ArrowRight className="h-6 w-6 text-white/40" />
            <span className="text-[10px] font-mono text-white/40 mt-1">Calldata</span>
          </div>
          {/* MOBILE CONNECTOR 2 */}
          <div className="flex lg:hidden items-center justify-center py-1 text-white/30">
            <ArrowDown className="h-5 w-5 text-white/40" />
          </div>

          {/* STAGE 3: EXECUTION PILOT */}
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-white/60 mb-2">
              <span>Phase 3: Action Plan</span>
              <span className="font-mono text-[10px] text-purple-300">Approval-Only</span>
            </div>
            <div className="rounded-xl border border-purple-400/30 bg-purple-950/20 p-4 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Bot className="h-4 w-4 text-purple-300" />
                  <span>{executionModule.role}</span>
                </div>
                {getAgentStatusBadge("execution")}
              </div>
              <p className="mt-2 text-[11px] leading-5 text-white/70">
                Prepares non-custodial transaction preview. Server cannot sign (<code className="text-[10px]">serverCanSign: false</code>).
              </p>
              {results.execution ? (
                <div className="mt-2 rounded-lg bg-black/40 p-2 font-mono text-[11px] text-purple-200">
                  Plan: {results.execution.recommendedAction}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* INDIVIDUAL AGENT CONTROLS & RESULTS */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((module) => {
          const Icon = module.icon;
          const result = results[module.key];
          const isLoading = Boolean(loading[module.key]);

          return (
            <article
              key={module.key}
              className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.035] p-5 transition hover:border-white/20"
            >
              <div>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d9a441]/10 text-[#d9a441]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md border border-white/10 bg-black/30 px-2 py-0.5 text-[11px] font-mono text-white/50">
                      {module.weight}% wt
                    </span>
                    {getAgentStatusBadge(module.key)}
                  </div>
                </div>

                <div className="mt-3">
                  <h2 className="text-base font-semibold text-white">{module.name}</h2>
                  <div className="text-xs text-[#d9a441]/80 font-mono">{module.role}</div>
                  <p className="mt-2 text-xs leading-5 text-white/55">{module.description}</p>
                </div>

                <div className="mt-4">
                  <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider" htmlFor={`${module.key}-input`}>
                    {module.inputLabel}
                  </label>
                  <input
                    id={`${module.key}-input`}
                    value={inputs[module.key]}
                    onChange={(event) => setInputs((current) => ({ ...current, [module.key]: event.target.value }))}
                    placeholder={module.placeholder}
                    className="mt-1.5 h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3.5 text-xs text-white outline-none transition placeholder:text-white/26 focus:border-[#d9a441]/50"
                  />
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  onClick={() => void runAgent(module.key)}
                  disabled={isLoading}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#d9a441] px-4 text-xs font-semibold text-black transition hover:bg-[#f2c86d] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  Execute {module.name}
                </button>

                {result ? (
                  <button
                    type="button"
                    onClick={() => setSelectedResult(result)}
                    className="w-full rounded-xl border border-white/10 bg-black/30 p-3.5 text-left transition hover:border-[#d9a441]/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white truncate">{result.verdict}</span>
                      <span className="text-xs font-mono font-semibold text-[#f2c86d] shrink-0">{result.score}/100</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-white/45">
                      <span>{result.riskLevel} risk</span>
                      <span>·</span>
                      <span>{Math.round(result.confidence * 100)}% conf</span>
                    </div>
                    <p className="mt-2 line-clamp-1 text-xs text-white/50">{result.summary}</p>
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>

      {/* RESULT DETAIL MODAL */}
      {selectedResult ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-5 backdrop-blur-sm" role="dialog" aria-modal="true">
          <section className="w-full max-w-3xl rounded-[28px] border border-white/15 bg-[#121212] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-[#d9a441] font-mono">
                  {selectedResult.agent} Agent Details
                </div>
                <h2 className="mt-1 text-2xl font-semibold text-white">{selectedResult.verdict}</h2>
                <p className="mt-2 text-xs leading-5 text-white/60">{selectedResult.summary}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedResult(null)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-white/60 transition hover:text-white"
                aria-label="Close result detail"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
                <div className="text-xs text-white/40">Risk Score</div>
                <div className="mt-1 text-2xl font-semibold text-white font-mono">{selectedResult.score}/100</div>
                <div className="mt-1 text-xs capitalize text-white/50">{selectedResult.riskLevel} Risk</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
                <div className="text-xs text-white/40">Confidence</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-300 font-mono">
                  {Math.round(selectedResult.confidence * 100)}%
                </div>
                <div className="mt-1 text-xs text-white/50">{selectedResult.dataQuality?.mode ?? "Live"} mode</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
                <div className="text-xs text-white/40">Recommended Action</div>
                <div className="mt-2 text-sm font-semibold text-white">
                  {selectedResult.recommendedAction.replaceAll("_", " ")}
                </div>
              </div>
            </div>

            {selectedResult.blockingReasons.length > 0 ? (
              <div className="mt-4 rounded-xl border border-red-400/30 bg-red-950/20 p-4">
                <div className="text-xs font-semibold text-red-200">Critical Blockers</div>
                <ul className="mt-2 space-y-1 text-xs text-red-200/80">
                  {selectedResult.blockingReasons.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs uppercase tracking-wider text-white/40 mb-2">Findings ({selectedResult.findings.length})</div>
                <div className="space-y-2 text-xs">
                  {selectedResult.findings.map((f, i) => (
                    <div key={i} className="rounded-lg bg-white/5 p-2.5">
                      <div className="flex justify-between font-medium text-white/80">
                        <span>{f.label}</span>
                        <span className="font-mono text-amber-300">{f.severity}</span>
                      </div>
                      <div className="mt-1 text-white/50">{f.detail}</div>
                    </div>
                  ))}
                  {selectedResult.findings.length === 0 ? (
                    <div className="text-white/40">No adverse findings.</div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="text-xs uppercase tracking-wider text-white/40 mb-2">Missing Signals ({selectedResult.missingData.length})</div>
                <div className="space-y-2 text-xs">
                  {selectedResult.missingData.map((m, i) => (
                    <div key={i} className="rounded-lg bg-white/5 p-2.5">
                      <div className="flex justify-between font-medium text-white/80">
                        <span>{m.field}</span>
                        <span className="font-mono text-amber-300">{m.impact}</span>
                      </div>
                      <div className="mt-1 text-white/50">{m.reason}</div>
                    </div>
                  ))}
                  {selectedResult.missingData.length === 0 ? (
                    <div className="text-white/40">Zero missing signals reported.</div>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
