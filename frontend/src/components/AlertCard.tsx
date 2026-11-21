"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, ExternalLink, ShieldAlert } from "lucide-react";
import type { RiskLevel } from "@/server/types";

const severityTone: Record<RiskLevel, { wrapper: string; icon: string; badge: string }> = {
  low: { wrapper: "border-emerald-300/25 bg-emerald-300/8", icon: "text-emerald-200", badge: "bg-emerald-500/15 text-emerald-200" },
  medium: { wrapper: "border-[#d9a441]/30 bg-[#d9a441]/8", icon: "text-[#f2c86d]", badge: "bg-amber-500/15 text-amber-200" },
  high: { wrapper: "border-orange-300/25 bg-orange-300/8", icon: "text-orange-200", badge: "bg-orange-500/15 text-orange-200" },
  critical: { wrapper: "border-red-300/30 bg-red-400/8", icon: "text-red-200", badge: "bg-red-500/20 text-red-200 font-bold" },
};

export type AlertCardProps = {
  title: string;
  detail: string;
  severity: RiskLevel;
  sourceLabel: string;
  beforeValue?: number;
  afterValue?: number;
  ruleName?: string;
  timestamp?: string;
  tokenAddress?: string;
  tokenChain?: string;
};

export function AlertCard({
  title,
  detail,
  severity,
  sourceLabel,
  beforeValue,
  afterValue,
  ruleName,
  timestamp,
  tokenAddress,
  tokenChain = "base",
}: AlertCardProps) {
  const tone = severityTone[severity] ?? severityTone.medium;
  const delta = beforeValue !== undefined && afterValue !== undefined ? afterValue - beforeValue : null;

  return (
    <section className={`rounded-2xl border p-5 ${tone.wrapper}`} role="article" aria-label={`Alert: ${title}`}>
      <div className="flex items-start gap-4">
        <div className={`rounded-full bg-white/8 p-3 ${tone.icon} shrink-0`}>
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">{title}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone.badge}`}>
                {severity}
              </span>
            </div>
            <span className="text-xs text-white/60">{sourceLabel}</span>
          </div>

          <p className="mt-2 text-sm leading-6 text-white/78">{detail}</p>

          {/* Delta and rule metadata */}
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/8 pt-3 text-xs">
            {delta !== null ? (
              <div className="flex items-center gap-1.5 rounded-md bg-black/30 px-2.5 py-1 text-white">
                <span className="text-white/50">Shift:</span>
                <span className="font-mono">{beforeValue}</span>
                <ArrowRight className="h-3 w-3 text-white/40" />
                <span className="font-mono font-semibold">{afterValue}</span>
                <span className={delta > 0 ? "text-red-300 font-bold" : delta < 0 ? "text-emerald-300 font-bold" : "text-white/60"}>
                  ({delta > 0 ? `+${delta}` : delta})
                </span>
              </div>
            ) : null}

            {ruleName ? (
              <span className="text-white/60">
                Rule: <strong className="text-white/90">{ruleName}</strong>
              </span>
            ) : null}

            {timestamp ? (
              <span className="text-white/40">
                {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : null}

            {tokenAddress ? (
              <Link
                href={`/scan?address=${encodeURIComponent(tokenAddress)}&chain=${encodeURIComponent(tokenChain)}`}
                className="ml-auto inline-flex items-center gap-1 text-[#f2c86d] underline-offset-2 hover:underline"
              >
                Inspect Token <ExternalLink className="h-3 w-3" />
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
