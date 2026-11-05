// Server-side phase timing and API latency tracking.
//
// The ring buffer intentionally stores only latency numbers, a route label,
// and a timestamp — never wallet addresses, request bodies, or response
// payloads — so it is always safe to read across users/requests. See
// docs/PERFORMANCE_BUDGETS.md for the budgets this feeds.

export type PhaseRecord = {
  name: string;
  durationMs: number;
};

export type PhaseTimerResult = {
  phases: PhaseRecord[];
  totalMs: number;
};

export type PhaseTimer = {
  /** Times an async or sync operation and records it as a named phase. */
  track<T>(name: string, operation: () => Promise<T> | T): Promise<T>;
  /** Records a phase boundary without wrapping an operation (elapsed since the previous mark/track). */
  mark(name: string): void;
  /** Finalizes the timer and returns all recorded phases plus the total elapsed time. */
  finish(): PhaseTimerResult;
};

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function createPhaseTimer(): PhaseTimer {
  const startedAt = now();
  let cursor = startedAt;
  const phases: PhaseRecord[] = [];

  return {
    async track<T>(name: string, operation: () => Promise<T> | T): Promise<T> {
      const start = now();
      try {
        return await operation();
      } finally {
        const end = now();
        phases.push({ name, durationMs: round(end - start) });
        cursor = end;
      }
    },
    mark(name: string) {
      const end = now();
      phases.push({ name, durationMs: round(end - cursor) });
      cursor = end;
    },
    finish(): PhaseTimerResult {
      return { phases: [...phases], totalMs: round(now() - startedAt) };
    },
  };
}

function sanitizeServerTimingName(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return cleaned.length > 0 ? cleaned : "phase";
}

export function buildServerTimingHeader(result: PhaseTimerResult) {
  const entries = result.phases.map((phase) => `${sanitizeServerTimingName(phase.name)};dur=${phase.durationMs}`);
  entries.push(`total;dur=${result.totalMs}`);
  return entries.join(", ");
}

export type PercentileSummary = {
  p50: number;
  p95: number;
  sampleSize: number;
};

export function summarizePercentiles(samplesMs: number[]): PercentileSummary {
  if (samplesMs.length === 0) {
    return { p50: 0, p95: 0, sampleSize: 0 };
  }

  const sorted = [...samplesMs].sort((left, right) => left - right);
  const pick = (percentile: number) => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1));
    return sorted[index];
  };

  return { p50: round(pick(0.5)), p95: round(pick(0.95)), sampleSize: sorted.length };
}

type ApiTimingSample = {
  route: string;
  durationMs: number;
  recordedAt: string;
};

const RING_BUFFER_SIZE = 200;

const ringBufferHolder = globalThis as typeof globalThis & {
  __cryptaraApiTimingRingBuffer?: ApiTimingSample[];
};

function getRingBuffer() {
  ringBufferHolder.__cryptaraApiTimingRingBuffer ??= [];
  return ringBufferHolder.__cryptaraApiTimingRingBuffer;
}

/** Records a single API request's total latency. Latency numbers only — no wallet or payload data. */
export function recordApiTiming(route: string, durationMs: number) {
  const buffer = getRingBuffer();
  buffer.push({ route, durationMs: Math.round(durationMs), recordedAt: new Date().toISOString() });

  while (buffer.length > RING_BUFFER_SIZE) {
    buffer.shift();
  }
}

export function getRecentApiLatency(route?: string): PercentileSummary {
  const buffer = getRingBuffer();
  const samples = (route ? buffer.filter((sample) => sample.route === route) : buffer).map((sample) => sample.durationMs);
  return summarizePercentiles(samples);
}

export function getRecentApiLatencyByRoute(): Record<string, PercentileSummary> {
  const buffer = getRingBuffer();
  const routes = [...new Set(buffer.map((sample) => sample.route))];
  return Object.fromEntries(routes.map((route) => [route, getRecentApiLatency(route)]));
}

export function getApiTimingSampleCount() {
  return getRingBuffer().length;
}
