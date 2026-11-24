import { annotateProviderResult, withProviderSpan } from "@/server/observability/tracing/spans";
import { recordProviderHealth } from "@/server/observability/providerHealth";
import { getNegativeCache, type NegativeCache } from "@/server/cache/negative";
import type { AgentSource } from "@/server/types";

export type ProviderKind = "portfolio" | "onchain" | "news" | "social" | "decision" | "execution";
export type CircuitState = "closed" | "open" | "half_open";
export type ProviderIdentity = { family: "evm" | "stellar" | "external"; network: string; chainId?: number; passphrase?: string };

export type NormalizedProviderError = {
  code: "timeout" | "cancelled" | "rate_limited" | "network_error" | "provider_error" | "malformed_response" | "network_mismatch" | "provider_lag" | "invalid_request" | "circuit_open" | "unknown";
  message: string;
  retryable: boolean;
  rateLimited: boolean;
  retryAfterMs?: number;
};

export class ProviderRequestError extends Error {
  constructor(message: string, readonly code: NormalizedProviderError["code"], readonly options: { retryable?: boolean; status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

export type ProviderAdapterOptions = {
  kind: ProviderKind;
  provider: string;
  label: string;
  url?: string;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  maxRetryDelayMs?: number;
  retryBudgetMs?: number;
  fallbackRank?: number;
  cache?: AgentSource["cache"];
  identity?: ProviderIdentity;
  expectedIdentity?: ProviderIdentity;
  signal?: AbortSignal;
  validate?: (value: unknown) => boolean;
  circuitRegistry?: ProviderCircuitRegistry;
  negativeCache?: NegativeCache;
  deadlineAt?: number;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

export type ProviderAdapterResult<T> = {
  ok: boolean;
  value?: T;
  error?: NormalizedProviderError;
  elapsedMs: number;
  fallbackRank: number;
  confidenceCap: number;
  circuitState: CircuitState;
  attempts: number;
  source: AgentSource;
};

type CircuitEntry = {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt?: number;
  halfOpenInFlight: boolean;
  samples: Array<{ ok: boolean; latencyMs: number; at: number }>;
};

export type CircuitSnapshot = Omit<CircuitEntry, "samples"> & {
  key: string;
  sampleCount: number;
  errorRate: number;
  averageLatencyMs: number;
};

export type ProviderCircuitConfig = {
  failureThreshold?: number;
  openMs?: number;
  windowMs?: number;
  maxProviders?: number;
  sampleSize?: number;
  now?: () => number;
};

export class ProviderCircuitRegistry {
  private readonly entries = new Map<string, CircuitEntry>();

  constructor(private readonly config: ProviderCircuitConfig = {}) {}

  private now() { return (this.config.now ?? Date.now)(); }
  private get(key: string) {
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= (this.config.maxProviders ?? 128)) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      entry = { state: "closed", consecutiveFailures: 0, halfOpenInFlight: false, samples: [] };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private prune(entry: CircuitEntry) {
    const windowMs = this.config.windowMs ?? 60_000;
    const cutoff = this.now() - windowMs;
    while (entry.samples.length > 0 && entry.samples[0].at < cutoff) entry.samples.shift();
  }

  acquire(key: string): CircuitState {
    const entry = this.get(key);
    if (entry.state === "open" && this.now() - (entry.openedAt ?? 0) >= (this.config.openMs ?? 30_000)) {
      entry.state = "half_open";
      entry.halfOpenInFlight = false;
    }
    if (entry.state === "open" || (entry.state === "half_open" && entry.halfOpenInFlight)) {
      throw new ProviderRequestError(`Circuit is ${entry.state} for provider ${key}.`, "circuit_open", { retryable: true });
    }
    if (entry.state === "half_open") entry.halfOpenInFlight = true;
    return entry.state;
  }

  success(key: string, latencyMs: number) {
    const entry = this.get(key);
    entry.state = "closed";
    entry.consecutiveFailures = 0;
    entry.openedAt = undefined;
    entry.halfOpenInFlight = false;
    this.sample(entry, true, latencyMs);
  }

  failure(key: string, latencyMs: number, countsTowardCircuit = true) {
    const entry = this.get(key);
    entry.halfOpenInFlight = false;
    this.sample(entry, false, latencyMs);
    if (!countsTowardCircuit) return;
    entry.consecutiveFailures += 1;
    if (entry.state === "half_open" || entry.consecutiveFailures >= (this.config.failureThreshold ?? 3)) {
      entry.state = "open";
      entry.openedAt = this.now();
    }
  }

  private sample(entry: CircuitEntry, ok: boolean, latencyMs: number) {
    entry.samples.push({ ok, latencyMs: Math.max(0, latencyMs), at: this.now() });
    this.prune(entry);
    const excess = entry.samples.length - (this.config.sampleSize ?? 20);
    if (excess > 0) entry.samples.splice(0, excess);
  }

  state(key: string): CircuitState {
    const entry = this.entries.get(key);
    if (!entry) return "closed";
    if (entry.state === "open" && this.now() - (entry.openedAt ?? 0) >= (this.config.openMs ?? 30_000)) return "half_open";
    return entry.state;
  }

  snapshots(): CircuitSnapshot[] {
    return [...this.entries.entries()].map(([key, entry]) => {
      this.prune(entry);
      return {
        key,
        state: this.state(key),
        consecutiveFailures: entry.consecutiveFailures,
        openedAt: entry.openedAt,
        halfOpenInFlight: entry.halfOpenInFlight,
        sampleCount: entry.samples.length,
        errorRate: entry.samples.length === 0 ? 0 : entry.samples.filter((sample) => !sample.ok).length / entry.samples.length,
        averageLatencyMs: entry.samples.length === 0 ? 0 : Math.round(entry.samples.reduce((sum, sample) => sum + sample.latencyMs, 0) / entry.samples.length),
      };
    });
  }

  reset() { this.entries.clear(); }
}

function boundedEnvInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export const sharedProviderCircuits = new ProviderCircuitRegistry({
  failureThreshold: boundedEnvInteger("PROVIDER_CIRCUIT_FAILURE_THRESHOLD", 3, 1, 10),
  openMs: boundedEnvInteger("PROVIDER_CIRCUIT_OPEN_MS", 30_000, 1_000, 300_000),
  windowMs: boundedEnvInteger("PROVIDER_CIRCUIT_WINDOW_MS", 60_000, 1_000, 600_000),
});
export const providerTimeoutBudgets: Record<ProviderKind, number> = { portfolio: 8_000, onchain: 12_000, news: 8_000, social: 12_000, decision: 3_000, execution: 20_000 };
export function getProviderTimeoutBudget(kind: ProviderKind) { return providerTimeoutBudgets[kind]; }

const IDEMPOTENT_RETRY_STATUSES = new Set([429, 502, 503, 504]);
const IDEMPOTENT_RETRY_CODES = new Set<NormalizedProviderError["code"]>(["rate_limited", "network_error", "provider_error", "timeout"]);

export function isIdempotentRetryable(error: NormalizedProviderError): boolean {
  if (error.code === "cancelled" || error.code === "invalid_request" || error.code === "network_mismatch" || error.code === "circuit_open") return false;
  if (error.code === "rate_limited") return true;
  if (error.code === "network_error") return true;
  if (error.code === "timeout") return true;
  if (error.code === "provider_error") return true;
  return IDEMPOTENT_RETRY_CODES.has(error.code);
}

export function computeBackoffDelay(attempt: number, options: { backoffMs?: number; maxRetryDelayMs?: number; retryAfterMs?: number; random?: () => number } = {}): number {
  const base = options.backoffMs ?? 250;
  const exponential = base * 2 ** Math.max(0, attempt);
  const jitter = 0.5 + (options.random ?? Math.random)();
  return Math.min(options.maxRetryDelayMs ?? 5_000, options.retryAfterMs ?? Math.round(exponential * jitter));
}

export function deriveDeadlineBudget(deadlineAt: number | undefined, kind: ProviderKind, now: () => number = Date.now): number {
  const base = getProviderTimeoutBudget(kind);
  if (deadlineAt === undefined) return base;
  const remaining = deadlineAt - now();
  if (!Number.isFinite(remaining)) return base;
  return Math.max(1, Math.min(base, remaining));
}

function errorField(error: unknown, field: string) {
  return typeof error === "object" && error !== null && field in error ? (error as Record<string, unknown>)[field] : undefined;
}

export function normalizeProviderError(error: unknown): NormalizedProviderError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const explicitCode = errorField(error, "code");
  const status = Number(errorField(error, "status") ?? errorField(error, "statusCode"));
  const options = error instanceof ProviderRequestError ? error.options : undefined;
  const retryAfterMs = Number(options?.retryAfterMs ?? errorField(error, "retryAfterMs")) || undefined;
  if (explicitCode === "invalid_request" || explicitCode === "unsupported_chain" || explicitCode === "no_route") return { code: "invalid_request", message, retryable: false, rateLimited: false };
  if (explicitCode === "network_mismatch") return { code: "network_mismatch", message, retryable: false, rateLimited: false };
  if (explicitCode === "malformed_response") return { code: "malformed_response", message, retryable: true, rateLimited: false };
  if (explicitCode === "provider_lag") return { code: "provider_lag", message, retryable: true, rateLimited: false };
  if (explicitCode === "circuit_open") return { code: "circuit_open", message, retryable: true, rateLimited: false };
  if (explicitCode === "cancelled" || lower.includes("cancelled") || lower.includes("canceled")) return { code: "cancelled", message, retryable: false, rateLimited: false };
  if (explicitCode === "timeout" || lower.includes("timeout") || lower.includes("timed out")) return { code: "timeout", message, retryable: true, rateLimited: false };
  if (status === 429 || lower.includes("429") || lower.includes("rate limit")) return { code: "rate_limited", message, retryable: true, rateLimited: true, retryAfterMs };
  if (IDEMPOTENT_RETRY_STATUSES.has(status)) return { code: "provider_error", message, retryable: true, rateLimited: false };
  if (status >= 500 && status <= 599) return { code: "provider_error", message, retryable: true, rateLimited: false };
  if (lower.includes("malformed") || lower.includes("invalid response")) return { code: "malformed_response", message, retryable: true, rateLimited: false };
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("econnreset")) return { code: "network_error", message, retryable: true, rateLimited: false };
  if (error instanceof ProviderRequestError) return { code: error.code, message, retryable: error.options.retryable ?? false, rateLimited: error.code === "rate_limited", retryAfterMs };
  if (lower.includes("provider") || lower.includes("api")) return { code: "provider_error", message, retryable: true, rateLimited: false };
  return { code: "unknown", message, retryable: false, rateLimited: false };
}

function abortableSleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderRequestError("Provider retry cancelled.", "cancelled"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new ProviderRequestError("Provider retry cancelled.", "cancelled"));
    }, { once: true });
  });
}

async function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, label: string, parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProviderRequestError(`${label} timeout after ${timeoutMs}ms`, "timeout", { retryable: true }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener("abort", onAbort);
  }
}

function negativeCacheKey(options: ProviderAdapterOptions) {
  return `provider:${circuitKey(options)}`;
}

function identityMatches(expected?: ProviderIdentity, actual?: ProviderIdentity) {
  if (!expected) return true;
  return Boolean(actual && expected.family === actual.family && expected.network === actual.network && (expected.chainId === undefined || expected.chainId === actual.chainId) && (expected.passphrase === undefined || expected.passphrase === actual.passphrase));
}

function circuitKey(options: ProviderAdapterOptions) {
  const identity = options.identity;
  return [options.provider, identity?.family, identity?.network, identity?.chainId ?? identity?.passphrase].filter((item) => item !== undefined && item !== "").join(":");
}

export async function runProviderAdapter<T>(operation: (signal?: AbortSignal) => Promise<T>, options: ProviderAdapterOptions): Promise<ProviderAdapterResult<T>> {
  return withProviderSpan(`provider.${options.kind}.${options.provider}`, {"provider.kind": options.kind, "provider.name": options.provider, "provider.label": options.label, ...(options.identity?.family ? {"chain.family": options.identity.family} : {}), ...(options.identity?.network ? {"chain.network": options.identity.network} : {}), ...(options.cache?.hit !== undefined ? {"cache.hit": options.cache.hit} : {})}, async (span) => { const result = await executeProviderAdapter(operation, options); annotateProviderResult(span, result); return result; });
}

async function executeProviderAdapter<T>(operation: (signal?: AbortSignal) => Promise<T>, options: ProviderAdapterOptions): Promise<ProviderAdapterResult<T>> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const retries = Math.min(3, Math.max(0, options.retries ?? boundedEnvInteger("PROVIDER_MAX_RETRIES", 2, 0, 3)));
  const fallbackRank = options.fallbackRank ?? 0;
  const registry = options.circuitRegistry ?? sharedProviderCircuits;
  const key = circuitKey(options);
  const negativeCache = options.negativeCache ?? getNegativeCache();
  const cacheKey = negativeCacheKey(options);
  let lastError: NormalizedProviderError | undefined;
  let attempts = 0;
  if (!identityMatches(options.expectedIdentity, options.identity)) {
    lastError = normalizeProviderError(new ProviderRequestError("Provider identity does not match the requested chain/network.", "network_mismatch"));
  } else {
    const cached = negativeCache.get(cacheKey);
    if (cached) {
      lastError = { code: "circuit_open", message: `Provider ${options.provider} is in negative cache.`, retryable: true, rateLimited: false };
    } else {
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const attemptStartedAt = now();
        const timeoutMs = Math.max(1, options.timeoutMs ?? deriveDeadlineBudget(options.deadlineAt, options.kind, now));
        try {
          if (options.signal?.aborted) throw new ProviderRequestError("Provider request cancelled.", "cancelled");
          if (options.deadlineAt !== undefined && now() >= options.deadlineAt) throw new ProviderRequestError(`${options.label} deadline exceeded.`, "timeout", { retryable: false });
          registry.acquire(key);
          attempts += 1;
          const value = await withTimeout((signal) => operation(signal), timeoutMs, options.label, options.signal);
          if (options.validate && !options.validate(value)) throw new ProviderRequestError(`${options.label} returned a malformed response.`, "malformed_response", { retryable: true });
          const latencyMs = now() - attemptStartedAt;
          registry.success(key, latencyMs);
          negativeCache.delete(cacheKey);
          recordProviderHealth({ provider: options.provider, kind: options.kind, ok: true, latencyMs, circuitState: registry.state(key) });
          const elapsedMs = now() - startedAt;
          return {
            ok: true, value, elapsedMs, fallbackRank, attempts, circuitState: registry.state(key), confidenceCap: fallbackRank > 0 ? 0.68 : 0.9,
            source: { label: options.label, url: options.url, status: "connected", checkedAt: new Date(now()).toISOString(), latencyMs: elapsedMs, provider: options.provider, fallbackRank, cache: options.cache, reliability: fallbackRank > 0 ? 0.62 : 0.82, detail: fallbackRank > 0 ? `Fallback provider ${options.provider} returned data.` : `Primary provider ${options.provider} returned data.` },
          };
        } catch (error) {
          lastError = normalizeProviderError(error);
          const latencyMs = now() - attemptStartedAt;
          registry.failure(key, latencyMs, lastError.retryable && lastError.code !== "circuit_open");
          recordProviderHealth({ provider: options.provider, kind: options.kind, ok: false, latencyMs, errorCode: lastError.code, circuitState: registry.state(key) });
          const elapsedMs = now() - startedAt;
          const retryBudgetMs = options.retryBudgetMs ?? boundedEnvInteger("PROVIDER_RETRY_BUDGET_MS", Math.min(120_000, timeoutMs * (retries + 1)), 1_000, 120_000);
          const deadlineExhausted = options.deadlineAt !== undefined && now() >= options.deadlineAt;
          if (!isIdempotentRetryable(lastError) || attempt === retries || elapsedMs >= retryBudgetMs || deadlineExhausted) break;
          const delay = computeBackoffDelay(attempt, { backoffMs: options.backoffMs, maxRetryDelayMs: options.maxRetryDelayMs, retryAfterMs: lastError.retryAfterMs, random: options.random });
          if (options.deadlineAt !== undefined && now() + delay >= options.deadlineAt) break;
          try { await (options.sleep ?? abortableSleep)(delay, options.signal); } catch (sleepError) { lastError = normalizeProviderError(sleepError); break; }
        }
      }
      if (lastError && registry.state(key) === "open") {
        negativeCache.set(cacheKey, { reason: lastError.code, ttlMs: boundedEnvInteger("PROVIDER_NEGATIVE_CACHE_MS", 15_000, 1_000, 300_000) });
      }
    }
  }
  const elapsedMs = now() - startedAt;
  return {
    ok: false, error: lastError, elapsedMs, fallbackRank, attempts, circuitState: registry.state(key), confidenceCap: 0.32,
    source: { label: options.label, url: options.url, status: "unavailable", checkedAt: new Date(now()).toISOString(), latencyMs: elapsedMs, error: lastError?.message, errorCode: lastError?.code, provider: options.provider, fallbackRank, cache: options.cache, reliability: 0.1, detail: lastError ? `Provider ${options.provider} failed with ${lastError.code}.` : `Provider ${options.provider} failed.` },
  };
}

export async function runProviderFallbacks<T>(operations: Array<ProviderAdapterOptions & { run: (signal?: AbortSignal) => Promise<T> }>, expectedIdentity?: ProviderIdentity): Promise<ProviderAdapterResult<T>> {
  let lastResult: ProviderAdapterResult<T> | undefined;
  for (const operation of [...operations].sort((left, right) => (left.fallbackRank ?? 0) - (right.fallbackRank ?? 0))) {
    const result = await runProviderAdapter(operation.run, { ...operation, expectedIdentity: expectedIdentity ?? operation.expectedIdentity });
    if (result.ok) return result;
    lastResult = result;
  }
  if (!lastResult) throw new Error("Provider fallback chain is empty.");
  return lastResult;
}

export function unavailableProviderResult<T>(options: Pick<ProviderAdapterOptions, "kind" | "provider" | "label" | "url" | "fallbackRank" | "cache">, error: NormalizedProviderError, elapsedMs = 0): ProviderAdapterResult<T> {
  const fallbackRank = options.fallbackRank ?? 0;
  return {
    ok: false, error, elapsedMs, fallbackRank, attempts: 0, circuitState: "open", confidenceCap: 0.32,
    source: { label: options.label, url: options.url, status: "unavailable", checkedAt: new Date().toISOString(), latencyMs: elapsedMs, error: error.message, errorCode: error.code, provider: options.provider, fallbackRank, cache: options.cache, reliability: 0.1, detail: `Provider ${options.provider} unavailable (${error.code}); no mock data substituted.` },
  };
}

export function resolveProviderConflict(input: { kind: "sellability" | "liquidity" | "identity"; primaryRisk: number; secondaryRisk: number; primaryLabel: string; secondaryLabel: string }) {
  const conservativeRisk = Math.max(input.primaryRisk, input.secondaryRisk);
  const winner = input.kind === "sellability" && input.secondaryLabel.toLowerCase().includes("simulation") ? input.secondaryLabel : conservativeRisk === input.primaryRisk ? input.primaryLabel : input.secondaryLabel;
  return { riskScore: conservativeRisk, winner, conflict: input.primaryRisk !== input.secondaryRisk, detail: `${winner} wins by conservative ${input.kind} conflict resolution.` };
}
