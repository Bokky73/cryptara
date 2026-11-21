"use client";

import Link from "next/link";
import type { AgentStep } from "@/server/types";
import { Check, CircleDashed, Clock, ShieldCheck, Zap } from "lucide-react";

export function AgentTimeline({ steps }: { steps: AgentStep[] }) {
  return (
    <section className="glass-panel rounded-[28px] p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#d9a441]">Execution Trace</div>
          <h2 className="mt-1 text-xl font-semibold text-white">Parallel Agent Timeline</h2>
        </div>
        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-mono text-emerald-200">
          Parallel Dispatch
        </span>
      </div>

      {/* Visual Timeline Items */}
      <div className="space-y-4">
        {steps.map((step, idx) => {
          const isComplete = step.status === "complete";
          const isCurrent = step.status === "in_progress" || step.status === "running";

          return (
            <div key={step.key} className="flex items-start gap-3.5 group">
              {/* Step indicator circle */}
              <div className="relative flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition ${
                    isComplete
                      ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                      : isCurrent
                        ? "border-[#d9a441]/50 bg-[#d9a441]/20 text-[#d9a441] animate-pulse"
                        : "border-white/15 bg-white/5 text-white/40"
                  }`}
                  aria-hidden="true"
                >
                  {isComplete ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <CircleDashed className={`h-4 w-4 ${isCurrent ? "animate-spin" : ""}`} />
                  )}
                </div>
                {idx < steps.length - 1 ? (
                  <div className="mt-1 h-8 w-0.5 bg-white/10" aria-hidden="true" />
                ) : null}
              </div>

              {/* Step content */}
              <div className="flex-1 rounded-xl border border-white/5 bg-white/[0.03] p-3 transition group-hover:border-white/15">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium text-sm text-white/90">{step.label}</div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-mono capitalize ${
                      isComplete
                        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                        : isCurrent
                          ? "border-[#d9a441]/30 bg-[#d9a441]/10 text-[#f2c86d]"
                          : "border-white/10 bg-white/5 text-white/40"
                    }`}
                  >
                    {step.status}
                  </span>
                </div>
                <div className="mt-1 text-xs leading-5 text-white/55">{step.detail}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-white/5 flex flex-wrap items-center justify-between gap-3 text-xs text-white/50">
        <span>Deterministic non-LLM synthesis pipeline</span>
        <Link href="/insights/run-comparison" className="text-[#f2c86d] underline underline-offset-2 hover:text-white">
          Compare two saved runs side by side →
        </Link>
      </div>
    </section>
  );
}
