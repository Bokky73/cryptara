import { describe, expect, it } from "vitest";
import {
  createWebVitalPayload,
  getMetricBudget,
  isBudgetBreach,
  parseSampleRate,
  resolvePerformanceProfile,
  sanitizeRoute,
  shouldReportBreach,
} from "../../../src/lib/webVitalsReporting";
import type { WebVitalMetric } from "../../../src/lib/webVitals";

const evmAddress = `0x${"a".repeat(40)}`;
const stellarAddress = `G${"B".repeat(55)}`;

function metric(overrides: Partial<WebVitalMetric> = {}): WebVitalMetric {
  return { name: "LCP", value: 3000, id: "v_test_1", ...overrides };
}

describe("sanitizeRoute", () => {
  it("strips query strings, hashes, origins and token identifiers", () => {
    expect(sanitizeRoute(`/scan/token/${evmAddress}?q=${evmAddress}&token=secret#fragment`)).toBe("/scan/token/[id]");
    expect(sanitizeRoute(`https://example.com/token/${stellarAddress}?sponsor=${stellarAddress}`)).toBe("/token/[id]");
    expect(sanitizeRoute("/history?address=0xabc")).toBe("/history");
  });

  it("replaces dynamic path segments without leaking encoded addresses", () => {
    expect(sanitizeRoute("/wallet/123e4567-e89b-12d3-a456-426614174000/activity")).toBe("/wallet/[id]/activity");
    expect(sanitizeRoute(`/issuer/${encodeURIComponent(stellarAddress)}`)).toBe("/issuer/[id]");
    expect(sanitizeRoute("/docs/introduction")).toBe("/docs/introduction");
    expect(sanitizeRoute("")).toBe("/");
  });
});

describe("budget profiles and breaches", () => {
  it("uses distinct web vital budgets for each profile", () => {
    expect(getMetricBudget("LCP", "desktop")).toBe(2500);
    expect(getMetricBudget("LCP", "constrainedMobile")).toBe(4000);
    expect(getMetricBudget("TTFB", "desktop")).toBe(800);
    expect(getMetricBudget("TTFB", "constrainedMobile")).toBe(1800);
  });

  it("maps constrained device and network hints to the mobile profile", () => {
    expect(resolvePerformanceProfile({ effectiveType: "4g", hardwareConcurrency: 8, deviceMemory: 8 })).toBe("desktop");
    expect(resolvePerformanceProfile({ effectiveType: "3g" })).toBe("constrainedMobile");
    expect(resolvePerformanceProfile({ saveData: true, hardwareConcurrency: 8 })).toBe("constrainedMobile");
    expect(resolvePerformanceProfile({ hardwareConcurrency: 4 })).toBe("desktop");
    expect(resolvePerformanceProfile({ deviceMemory: 2 })).toBe("constrainedMobile");
  });

  it("evaluates the same metric against the active profile only", () => {
    expect(isBudgetBreach(metric({ value: 3000 }), "desktop")).toBe(true);
    expect(isBudgetBreach(metric({ value: 3000 }), "constrainedMobile")).toBe(false);
    expect(isBudgetBreach(metric({ value: Number.NaN }), "desktop")).toBe(false);
  });
});

describe("breach sampling and payload", () => {
  it("respects explicit sample rates and never returns a non-breach", () => {
    expect(shouldReportBreach(metric(), "desktop", 0)).toBe(false);
    expect(shouldReportBreach(metric(), "desktop", 1)).toBe(true);
    expect(shouldReportBreach(metric({ value: 1000 }), "desktop", 1)).toBe(false);
    expect(parseSampleRate(undefined)).toBe(1);
    expect(parseSampleRate("0.25")).toBe(0.25);
    expect(parseSampleRate("2")).toBe(1);
    expect(parseSampleRate("nonsense")).toBe(1);
  });

  it("builds a PII-free payload with the profile budget", () => {
    const result = createWebVitalPayload(metric({ name: "TTFB", value: 1200 }), {
      route: `/token/${evmAddress}?q=${stellarAddress}`,
      profile: "desktop",
    });

    expect(result).toEqual({
      name: "TTFB",
      value: 1200,
      budget: 800,
      profile: "desktop",
      path: "/token/[id]",
    });
    expect(JSON.stringify(result)).not.toContain(evmAddress);
    expect(JSON.stringify(result)).not.toContain(stellarAddress);
    expect(createWebVitalPayload(metric({ value: 1000 }), { route: "/", profile: "constrainedMobile" })).toBeNull();
  });
});
