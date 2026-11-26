"use client";

import { useEffect } from "react";
import { observeWebVitals, type WebVitalMetric } from "@/lib/webVitals";
import {
  createWebVitalPayload,
  getMetricBudget,
  getPerformanceProfile,
  isBudgetBreach,
  parseSampleRate,
  type PerformanceProfile,
} from "@/lib/webVitalsReporting";

function formatValue(metric: WebVitalMetric) {
  return metric.name === "CLS" ? metric.value.toFixed(3) : `${Math.round(metric.value)}ms`;
}

function logMetric(metric: WebVitalMetric, profile: PerformanceProfile) {
  const budget = getMetricBudget(metric.name, profile);
  const overBudget = isBudgetBreach(metric, profile);
  const label = `[web-vitals] ${metric.name} = ${formatValue(metric)} (${profile})`;

  if (overBudget) {
    console.warn(`${label} (over budget of ${metric.name === "CLS" ? budget : `${budget}ms`}). See docs/PERFORMANCE_BUDGETS.md.`);
  } else {
    console.info(label);
  }
}

/**
 * Beacon stub: intentionally a no-op unless NEXT_PUBLIC_WEB_VITALS_BEACON_URL
 * is set. Only sampled breaches are sent, with a PII-free route template.
 */
function sendBeacon(metric: WebVitalMetric, profile: PerformanceProfile) {
  const endpoint = process.env.NEXT_PUBLIC_WEB_VITALS_BEACON_URL;
  if (!endpoint || typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;

  const route = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const sampleRate = parseSampleRate(process.env.NEXT_PUBLIC_WEB_VITALS_SAMPLE_RATE);
  const payload = createWebVitalPayload(metric, { route, profile, sampleRate });
  if (!payload) return;

  navigator.sendBeacon(endpoint, JSON.stringify(payload));
}

/** Mounts once from the root layout to report sampled Web Vitals budget breaches. */
export function WebVitalsReporter() {
  useEffect(() => {
    const profile = getPerformanceProfile();

    return observeWebVitals((metric) => {
      if (process.env.NODE_ENV !== "production") {
        logMetric(metric, profile);
      }

      sendBeacon(metric, profile);
    });
  }, []);

  return null;
}
