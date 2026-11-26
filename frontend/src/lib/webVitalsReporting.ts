import budgets from "../../../docs/performance/budgets.json";
import type { WebVitalMetric } from "./webVitals";

export type PerformanceProfile = "desktop" | "constrainedMobile";

export type ProfileHints = {
  effectiveType?: string;
  saveData?: boolean;
  hardwareConcurrency?: number;
  deviceMemory?: number;
};

export type WebVitalPayload = {
  name: WebVitalMetric["name"];
  value: number;
  budget: number;
  profile: PerformanceProfile;
  path: string;
};

const BUDGET_KEYS = {
  LCP: "lcpMs",
  INP: "inpMs",
  FID: "inpMs",
  CLS: "cls",
  TTFB: "ttfbMs",
} as const;

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const STELLAR_ADDRESS = /^[GC][A-Z2-9]{55}$/;
const OPAQUE_ID = /^(?:[0-9a-f]{32,64}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[a-z0-9_-]{32,}|\d+)$/i;

function isDynamicSegment(segment: string) {
  return EVM_ADDRESS.test(segment) || STELLAR_ADDRESS.test(segment) || OPAQUE_ID.test(segment);
}

export function sanitizeRoute(route: string): string {
  if (typeof route !== "string" || route.length === 0) return "/";

  const withoutQueryOrHash = route.split(/[?#]/, 1)[0].replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, "").replace(/^\/\/[^/]+/, "");
  const segments = withoutQueryOrHash.split("/").filter(Boolean).map((segment) => {
    let decoded: string;

    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return "[id]";
    }

    if (decoded.includes("/") || decoded.includes("\\") || isDynamicSegment(decoded)) return "[id]";
    return decoded;
  });

  return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

export function resolvePerformanceProfile(hints: ProfileHints): PerformanceProfile {
  const effectiveType = hints.effectiveType?.toLowerCase();

  if (hints.saveData || effectiveType === "slow-2g" || effectiveType === "2g" || effectiveType === "3g") {
    return "constrainedMobile";
  }

  if (hints.deviceMemory !== undefined && hints.deviceMemory <= 4) return "constrainedMobile";

  return "desktop";
}

export function getPerformanceProfile(): PerformanceProfile {
  if (typeof navigator === "undefined") return "desktop";

  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; saveData?: boolean };
  }).connection;

  return resolvePerformanceProfile({
    effectiveType: connection?.effectiveType,
    saveData: connection?.saveData,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  });
}

export function getMetricBudget(name: WebVitalMetric["name"], profile: PerformanceProfile): number {
  const values = budgets.webVitals[BUDGET_KEYS[name]] as Record<PerformanceProfile, number>;
  return values[profile];
}

export function isBudgetBreach(metric: Pick<WebVitalMetric, "name" | "value">, profile: PerformanceProfile): boolean {
  return Number.isFinite(metric.value) && metric.value > getMetricBudget(metric.name, profile);
}

export function parseSampleRate(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 1;
  const rate = Number(raw);
  if (!Number.isFinite(rate)) return 1;
  return Math.min(1, Math.max(0, rate));
}

export function shouldReportBreach(metric: WebVitalMetric, profile: PerformanceProfile, sampleRate = 1): boolean {
  if (!isBudgetBreach(metric, profile)) return false;
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;

  const source = `${metric.name}:${metric.id}:${metric.value}`;
  let hash = 2166136261;

  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 0xffffffff < sampleRate;
}

export function createWebVitalPayload(
  metric: WebVitalMetric,
  options: { route: string; profile: PerformanceProfile; sampleRate?: number },
): WebVitalPayload | null {
  if (!shouldReportBreach(metric, options.profile, options.sampleRate ?? 1)) return null;

  return {
    name: metric.name,
    value: metric.value,
    budget: getMetricBudget(metric.name, options.profile),
    profile: options.profile,
    path: sanitizeRoute(options.route),
  };
}
