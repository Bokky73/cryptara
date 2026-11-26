"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Activity,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Radio,
  Server,
  Zap,
} from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";

interface SloItem {
  id: string;
  name: string;
  target: number;
  sli?: number | null;
  burnRateShort?: number | null;
  burnRateLong?: number | null;
  insufficientData?: boolean;
}

interface IncidentItem {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  status?: "open" | "investigating" | "recovered";
  severity?: "low" | "medium" | "high" | "critical";
  runbookUrl?: string;
}

interface ProviderHealthItem {
  name: string;
  circuitState: "Closed" | "Half-Open" | "Open";
  p95LatencyMs: number;
  uptimePercent: number;
  runbookUrl: string;
}

interface HealthResponse {
  slos?: SloItem[];
  incidentTimeline?: IncidentItem[];
  providerMatrix?: ProviderHealthItem[];
}

const DEFAULT_SLOS: SloItem[] = [
  { id: "slo-scan-completion", name: "Scan Completion", target: 99.0, sli: 99.4, burnRateShort: 0.6, burnRateLong: 0.8 },
  { id: "slo-quote-availability", name: "Quote Availability", target: 99.5, sli: 99.7, burnRateShort: 0.4, burnRateLong: 0.5 },
  { id: "slo-simulation-success", name: "Simulation Success", target: 99.0, sli: 98.9, burnRateShort: 2.1, burnRateLong: 1.2 },
  { id: "slo-transaction-observation", name: "Transaction Observation", target: 99.9, sli: 99.95, burnRateShort: 0.1, burnRateLong: 0.2 },
  { id: "slo-stellar-ledger-lag", name: "Stellar Ledger Lag", target: 99.0, sli: 99.2, burnRateShort: 0.8, burnRateLong: 0.9 },
  { id: "slo-api-latency", name: "API Latency", target: 99.0, sli: 99.6, burnRateShort: 0.3, burnRateLong: 0.4 },
];

const DEFAULT_PROVIDERS: ProviderHealthItem[] = [
  { name: "DexScreener", circuitState: "Closed", p95LatencyMs: 180, uptimePercent: 99.8, runbookUrl: "/docs/RUNBOOKS.md#rb-001-quote--simulation-provider-outage" },
  { name: "GoPlus", circuitState: "Closed", p95LatencyMs: 240, uptimePercent: 99.6, runbookUrl: "/docs/RUNBOOKS.md#rb-001-quote--simulation-provider-outage" },
  { name: "Stellar Horizon", circuitState: "Closed", p95LatencyMs: 95, uptimePercent: 99.9, runbookUrl: "/docs/RUNBOOKS.md#rb-002-stellar-rpc-lag--degradation" },
  { name: "Soroban RPC", circuitState: "Half-Open", p95LatencyMs: 420, uptimePercent: 98.7, runbookUrl: "/docs/RUNBOOKS.md#rb-002-stellar-rpc-lag--degradation" },
  { name: "Storage / Postgres", circuitState: "Closed", p95LatencyMs: 45, uptimePercent: 100.0, runbookUrl: "/docs/RUNBOOKS.md#rb-005-supabase--storage-failure" },
];

const circuitStateKeys: Record<ProviderHealthItem["circuitState"], MessageKey> = {
  Closed: "circuitClosed",
  "Half-Open": "circuitHalfOpen",
  Open: "circuitOpen",
};

const incidentStatusKeys: Record<NonNullable<IncidentItem["status"]>, MessageKey> = {
  open: "statusOpen",
  investigating: "statusInvestigating",
  recovered: "statusRecovered",
};

export function OperationsSloPanel() {
  const { t, format } = useI18n();
  const [data, setData] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((d) => setData(d))
      .catch((err) => console.error(err));
  }, []);

  const slos: SloItem[] = data?.slos?.length ? data.slos : DEFAULT_SLOS;
  const incidentTimeline: IncidentItem[] = data?.incidentTimeline ?? [];
  const providers: ProviderHealthItem[] = data?.providerMatrix ?? DEFAULT_PROVIDERS;

  return (
    <div className="mt-8 space-y-8" aria-label={t("opsAria")}>
      <section className="rounded-2xl border border-white/10 bg-white/6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Activity className="h-5 w-5 text-[#d9a441]" />
            <h2 className="text-base font-semibold text-white">{t("opsTitle")}</h2>
          </div>
          <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-xs text-white/60">
            {t("opsHorizon")}
          </span>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {slos.map((slo) => {
            const currentSli = slo.sli ?? 0;
            const target = slo.target;
            const errorBudget = 100 - target;
            const errorUsed = Math.max(0, 100 - currentSli);
            const remainingBudgetPercent = Math.max(0, Math.min(100, ((errorBudget - errorUsed) / (errorBudget || 1)) * 100));

            const isCritical = (slo.burnRateShort ?? 0) >= 10 || (slo.burnRateLong ?? 0) >= 10;
            const isWarning = (slo.burnRateShort ?? 0) >= 2 || (slo.burnRateLong ?? 0) >= 2;

            return (
              <div key={slo.id} className="rounded-xl border border-white/8 bg-black/30 p-4 transition hover:border-white/20">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-medium text-white">{slo.name}</h3>
                  {slo.insufficientData ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                      <Clock className="h-3 w-3" /> {t("samplesPending")}
                    </span>
                  ) : isCritical ? (
                    <span className="inline-flex items-center gap-1 rounded bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-300">
                      <Flame className="h-3 w-3" /> {t("criticalBurn")}
                    </span>
                  ) : isWarning ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
                      <AlertTriangle className="h-3 w-3" /> {t("elevatedBurn")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> {t("normal")}
                    </span>
                  )}
                </div>

                {slo.insufficientData ? (
                  <p className="mt-4 text-xs text-white/50">{t("collectingSamples")}</p>
                ) : (
                  <>
                    <div className="mt-3 flex items-baseline justify-between text-xs">
                      <span className="text-white/60">{t("sliTarget")}</span>
                      <span className="font-semibold text-white">
                        {format.number(currentSli)}% <span className="font-normal text-white/40">/ {format.number(target)}%</span>
                      </span>
                    </div>

                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={remainingBudgetPercent} aria-valuemin={0} aria-valuemax={100}>
                      <div
                        className={`h-full transition-all duration-500 ${
                          remainingBudgetPercent < 20
                            ? "bg-red-500"
                            : remainingBudgetPercent < 50
                            ? "bg-amber-400"
                            : "bg-emerald-400"
                        }`}
                        style={{ width: `${remainingBudgetPercent}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-white/40">
                      <span>{t("errorBudgetRemaining", { value: format.number(Math.round(remainingBudgetPercent)) })}</span>
                      <span>{t("targetLabel", { value: format.number(target) })}</span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-2 text-[11px]">
                      <div>
                        <span className="text-white/40">{t("burn1h")}</span>
                        <span className={slo.burnRateShort && slo.burnRateShort >= 2 ? "font-bold text-amber-300" : "text-white/80"}>
                          {format.number(slo.burnRateShort ?? 0)}x
                        </span>
                      </div>
                      <div>
                        <span className="text-white/40">{t("burn6h")}</span>
                        <span className={slo.burnRateLong && slo.burnRateLong >= 2 ? "font-bold text-amber-300" : "text-white/80"}>
                          {format.number(slo.burnRateLong ?? 0)}x
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/6 p-6">
        <div className="flex items-center gap-2.5">
          <Server className="h-5 w-5 text-[#d9a441]" />
          <div>
            <h2 className="text-base font-semibold text-white">{t("providerTitle")}</h2>
            <p className="mt-0.5 text-xs text-white/50">{t("providerDetail")}</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/10 text-white/40">
                <th className="pb-3 font-medium">{t("providerService")}</th>
                <th className="pb-3 font-medium">{t("circuitState")}</th>
                <th className="pb-3 font-medium">{t("p95Latency")}</th>
                <th className="pb-3 font-medium">{t("uptime30d")}</th>
                <th className="pb-3 font-medium">{t("triageRunbook")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {providers.map((p) => {
                const isTripped = p.circuitState === "Open";
                const isHalfOpen = p.circuitState === "Half-Open";

                return (
                  <tr key={p.name} className="hover:bg-white/4">
                    <td className="py-3 font-medium text-white">{p.name}</td>
                    <td className="py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium ${
                          isTripped
                            ? "bg-red-500/15 text-red-300 border border-red-500/30"
                            : isHalfOpen
                            ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                            : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                        }`}
                      >
                        {isTripped ? (
                          <Zap className="h-3 w-3 text-red-400" />
                        ) : isHalfOpen ? (
                          <Radio className="h-3 w-3 text-amber-400 animate-pulse" />
                        ) : (
                          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                        )}
                        {t(circuitStateKeys[p.circuitState])}
                      </span>
                    </td>
                    <td className="py-3 text-white/70">
                      <span className={p.p95LatencyMs > 400 ? "text-amber-300 font-semibold" : "text-white"}>
                        {format.number(p.p95LatencyMs)}ms
                      </span>
                    </td>
                    <td className="py-3 text-white/70">{format.number(p.uptimePercent)}%</td>
                    <td className="py-3">
                      <Link
                        href={p.runbookUrl}
                        className="inline-flex items-center gap-1 text-[#f2c86d] underline-offset-2 hover:underline"
                      >
                        {t("runbook")} <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/6 p-6">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-5 w-5 text-[#d9a441]" />
          <div>
            <h2 className="text-base font-semibold text-white">{t("incidentTitle")}</h2>
            <p className="mt-0.5 text-xs text-white/50">{t("incidentDetail")}</p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {incidentTimeline.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-6 text-center text-sm text-white/50">
              {t("noIncidents")}
            </div>
          ) : (
            incidentTimeline.map((ev) => (
              <div key={ev.id} className="rounded-xl border border-white/8 bg-black/30 p-4 transition hover:border-white/15">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-[#d9a441]/10 px-2 py-0.5 text-xs font-semibold uppercase text-[#f2c86d]">
                      {ev.type}
                    </span>
                    <span className="text-sm font-medium text-white">{ev.description}</span>
                  </div>
                  <span className="text-xs text-white/40">{format.dateTime(ev.timestamp)}</span>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-xs">
                  <span className="text-white/50">{t("status")}: <strong className="text-white">{t(incidentStatusKeys[ev.status ?? "open"])}</strong></span>
                  <Link
                    href={ev.runbookUrl ?? "/docs/RUNBOOKS.md"}
                    className="inline-flex items-center gap-1 text-[#f2c86d] hover:underline"
                  >
                    {t("runbookProcedure")}
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
