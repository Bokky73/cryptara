import { metrics, type Counter } from "@opentelemetry/api";

export type CacheMetricName = "hit" | "miss" | "coalesced" | "stale" | "eviction" | "negativeHit" | "backendError";
export type CacheMetricsSnapshot = Record<CacheMetricName, number>;
export type CacheRatioName = "hit" | "miss" | "stale" | "coalesced" | "negativeHit";
export type CacheRatios = Record<CacheRatioName, number>;
export type CacheMetricsReport = {
  counts: CacheMetricsSnapshot;
  total: number;
  ratios: CacheRatios;
};

const zero = (): CacheMetricsSnapshot => ({ hit: 0, miss: 0, coalesced: 0, stale: 0, eviction: 0, negativeHit: 0, backendError: 0 });
const ratioNames: readonly CacheRatioName[] = ["hit", "miss", "stale", "coalesced", "negativeHit"];

function calculateRatios(counts: CacheMetricsSnapshot): { total: number; ratios: CacheRatios } {
  const total = ratioNames.reduce((sum, name) => sum + counts[name], 0);
  const ratios = Object.fromEntries(
    ratioNames.map((name) => [name, total === 0 ? 0 : Number((counts[name] / total).toFixed(4))]),
  ) as CacheRatios;
  return { total, ratios };
}

const meter = metrics.getMeter("cryptara-cache", "0.1.0");
const counters = new Map<CacheMetricName, Counter>();
let otelRegistered = false;

function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function registerOtelMetrics(): void {
  if (otelRegistered) return;
  otelRegistered = true;

  for (const name of Object.keys(zero()) as CacheMetricName[]) {
    counters.set(name, meter.createCounter(`cache.${snakeCase(name)}_total`, {
      description: `Number of cache ${snakeCase(name)} events.`,
    }));
  }

  for (const name of ratioNames) {
    meter.createObservableGauge(`cache.${snakeCase(name)}_ratio`, {
      description: `Ratio of cache ${snakeCase(name)} events to all cache lookups.`,
    }).addCallback((result) => {
      result.observe(calculateRatios(cacheMetrics.snapshot()).ratios[name]);
    });
  }
}

export class CacheMetrics {
  private counts = zero();

  increment(name: CacheMetricName) {
    this.counts[name] += 1;
    registerOtelMetrics();
    counters.get(name)?.add(1);
  }

  snapshot(): CacheMetricsSnapshot {
    return { ...this.counts };
  }

  report(): CacheMetricsReport {
    registerOtelMetrics();
    const counts = this.snapshot();
    return { counts, ...calculateRatios(counts) };
  }

  reset() {
    this.counts = zero();
  }
}

export const cacheMetrics = new CacheMetrics();
export const getCacheMetrics = () => cacheMetrics.snapshot();
export const getCacheMetricsReport = () => cacheMetrics.report();
