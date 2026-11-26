"use client";

import Link from "next/link";
import type { TokenScanResult } from "@/server/types";
import { ArrowRight, ShieldAlert, ShieldCheck, ShieldQuestion, ShieldX } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";

type VerdictTier = {
  labelKey: MessageKey;
  icon: typeof ShieldAlert;
  tone: string;
  border: string;
  bg: string;
};

function resolveVerdict(scan: TokenScanResult): VerdictTier {
  const risk = typeof scan.buyRisk === "number" ? scan.buyRisk : null;
  if (risk === null) {
    return {
      labelKey: "verdictInsufficientData",
      icon: ShieldQuestion,
      tone: "text-white/70",
      border: "border-white/15",
      bg: "bg-white/5",
    };
  }
  if (risk >= 70) {
    return {
      labelKey: "verdictAvoid",
      icon: ShieldX,
      tone: "text-[#ff6b6b]",
      border: "border-[#ff6b6b]/30",
      bg: "bg-[#ff6b6b]/8",
    };
  }
  if (risk >= 45) {
    return {
      labelKey: "verdictCaution",
      icon: ShieldAlert,
      tone: "text-[#d9a441]",
      border: "border-[#d9a441]/25",
      bg: "bg-[#d9a441]/8",
    };
  }
  if (risk >= 25) {
    return {
      labelKey: "verdictWatch",
      icon: ShieldQuestion,
      tone: "text-[#f2c86d]",
      border: "border-[#f2c86d]/25",
      bg: "bg-[#f2c86d]/8",
    };
  }
  return {
    labelKey: "verdictFavorable",
    icon: ShieldCheck,
    tone: "text-[#4ade80]",
    border: "border-[#4ade80]/25",
    bg: "bg-[#4ade80]/8",
  };
}

export function AgentVerdictCard({ scan }: { scan: TokenScanResult }) {
  const { t } = useI18n();
  const verdict = resolveVerdict(scan);
  const VerdictIcon = verdict.icon;
  const confidence = typeof scan.confidence === "number" ? scan.confidence : null;
  const lowConfidence = confidence !== null && confidence < 60;

  return (
    <section className={`rounded-[28px] border ${verdict.border} ${verdict.bg} p-6`}>
      <div className="flex items-start gap-4">
        <div className={`rounded-2xl ${verdict.bg} p-3 ${verdict.tone}`}>
          <VerdictIcon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm uppercase tracking-[0.18em] text-white/50">{t("latestAgentVerdict")}</span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border ${verdict.border} ${verdict.bg} px-3 py-1 text-xs font-semibold ${verdict.tone}`}
            >
              <VerdictIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {t(verdict.labelKey)}
            </span>
            {confidence !== null ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                  lowConfidence
                    ? "border-[#d9a441]/40 bg-[#d9a441]/10 text-[#f2c86d]"
                    : "border-white/15 bg-white/5 text-white/70"
                }`}
              >
                {t("confidenceLabel", { value: confidence })}
                {lowConfidence ? t("confidenceLow") : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-white/20 px-3 py-1 text-xs font-semibold text-white/50">
                {t("confidenceUnavailable")}
              </span>
            )}
          </div>
          <h2 className="mt-3 text-2xl font-semibold">{t("needsProtectionReview", { symbol: scan.symbol })}</h2>
          <p className="mt-3 text-sm leading-6 text-white/58">{scan.summary}</p>
          {lowConfidence ? (
            <p className="mt-3 text-xs leading-5 text-[#f2c86d]">
              {t("lowConfidenceNotice")}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/agents"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#d9a441] px-5 text-sm font-semibold text-black transition hover:bg-[#f2c86d]"
            >
              {t("reviewAction")}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/scan"
              className="inline-flex h-11 items-center justify-center rounded-full border border-white/10 px-5 text-sm font-medium text-white transition hover:bg-white/10"
            >
              {t("runTokenScan")}
            </Link>
          </div>
          <p className="mt-4 text-[11px] leading-4 text-white/40">{t("notFinancialAdvice")}</p>
        </div>
      </div>
    </section>
  );
}
