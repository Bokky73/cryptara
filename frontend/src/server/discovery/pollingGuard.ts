import type { DiscoveryCursor, ProviderPollingConfig } from "./types";

export interface DiscoveryLimits {
  maxCandidatesPerCycle: number;
}

export const DEFAULT_DISCOVERY_LIMITS: DiscoveryLimits = {
  maxCandidatesPerCycle: 200,
};

/** Backoff takes priority even when the checkpoint is stale. */
export function isPollDue(cursor: DiscoveryCursor | null, config: ProviderPollingConfig, now = Date.now()): boolean {
  if (!cursor) return true;
  if (now < cursor.nextAllowedPollMs) return false;
  // Once backoff expires, retry failures without another freshness delay.
  if (cursor.consecutiveFailures > 0) return true;
  const age = now - Date.parse(cursor.updatedAt);
  return !Number.isFinite(age) || age > config.freshness.maxCursorAgeMs || age >= config.freshness.pollIntervalMs;
}

/** Process-local overlap protection; this is not a distributed lease. */
export function createPollCoalescer<T>() {
  const pending = new Map<string, Promise<T>>();
  return (key: string, task: () => Promise<T>): Promise<T> => {
    const existing = pending.get(key);
    if (existing) return existing;
    const promise = Promise.resolve().then(task).finally(() => { pending.delete(key); });
    pending.set(key, promise);
    return promise;
  };
}

export interface TokenBucketOptions {
  /** Maximum number of tokens (burst capacity). */
  capacity: number;
  /** Tokens replenished per minute. */
  refillPerMinute: number;
  /** Optional clock injection for deterministic tests. */
  now?: () => number;
}

export interface TokenBucket {
  /** Attempt to consume a single token; returns true when granted. */
  tryConsume(count?: number): boolean;
  /** Remaining whole tokens available right now. */
  available(): number;
  /** Milliseconds until the next token becomes available (0 when available). */
  msUntilNext(count?: number): number;
  /** Reset the bucket to full capacity (used after long idle periods). */
  reset(): void;
}

/**
 * Token-bucket rate budget. Enforces a hard per-minute request ceiling per
 * provider so discovery polling can never exceed configured budgets, even
 * during high launch bursts.
 */
export function createTokenBucket(options: TokenBucketOptions): TokenBucket {
  const capacity = Math.max(1, Math.floor(options.capacity));
  const refillPerMinute = Math.max(1, options.refillPerMinute);
  const refillPerMs = refillPerMinute / 60_000;
  const clock = options.now ?? Date.now;

  let tokens = capacity;
  let lastRefill = clock();

  const refill = (): void => {
    const now = clock();
    if (now <= lastRefill) return;
    const elapsed = now - lastRefill;
    tokens = Math.min(capacity, tokens + elapsed * refillPerMs);
    lastRefill = now;
  };

  return {
    tryConsume(count = 1): boolean {
      const need = Math.max(1, Math.floor(count));
      refill();
      if (tokens >= need) {
        tokens -= need;
        return true;
      }
      return false;
    },
    available(): number {
      refill();
      return Math.floor(tokens);
    },
    msUntilNext(count = 1): number {
      const need = Math.max(1, Math.floor(count));
      refill();
      if (tokens >= need) return 0;
      const deficit = need - tokens;
      return Math.ceil(deficit / refillPerMs);
    },
    reset(): void {
      tokens = capacity;
      lastRefill = clock();
    },
  };
}

/** Per-provider token buckets keyed by provider id. */
export interface ProviderRateBudget {
  /** Attempt to consume a request for the provider. */
  tryConsume(providerId: string): boolean;
  /** Remaining tokens for a provider. */
  available(providerId: string): number;
  /** Milliseconds until the provider can poll again. */
  msUntilNext(providerId: string): number;
}

export function createProviderRateBudget(
  providers: Record<string, { requestsPerMinute: number; burst?: number }>,
  now?: () => number,
): ProviderRateBudget {
  const buckets = new Map<string, TokenBucket>();
  for (const [id, cfg] of Object.entries(providers)) {
    const rpm = Math.max(1, cfg.requestsPerMinute);
    buckets.set(id, createTokenBucket({ capacity: cfg.burst ?? rpm, refillPerMinute: rpm, now }));
  }
  const fallback = (): TokenBucket => createTokenBucket({ capacity: 1, refillPerMinute: 1, now });
  return {
    tryConsume(providerId: string): boolean {
      const bucket = buckets.get(providerId) ?? fallback();
      if (!buckets.has(providerId)) buckets.set(providerId, bucket);
      return bucket.tryConsume();
    },
    available(providerId: string): number {
      return (buckets.get(providerId) ?? fallback()).available();
    },
    msUntilNext(providerId: string): number {
      return (buckets.get(providerId) ?? fallback()).msUntilNext();
    },
  };
}

export interface BackoffState {
  consecutiveFailures: number;
  nextAllowedPollMs: number;
}

export interface AdaptiveBackoffOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Multiplier applied per consecutive failure. */
  factor?: number;
  /** Optional jitter fraction (0..1) applied to the delay. */
  jitter?: number;
  now?: () => number;
  random?: () => number;
}

/**
 * Adaptive backoff for provider failures. 429 and 5xx responses escalate the
 * delay exponentially (capped), and backoff always takes priority over
 * freshness checks in `isPollDue`.
 */
export function computeAdaptiveBackoff(
  previous: BackoffState | null,
  status: number | null,
  options: AdaptiveBackoffOptions = {},
): BackoffState {
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 5 * 60_000;
  const factor = options.factor ?? 2;
  const jitter = options.jitter ?? 0.1;
  const clock = options.now ?? Date.now;
  const random = options.random ?? Math.random;

  const isRetryable = status === null || status === 429 || (status >= 500 && status < 600);
  const prevFailures = previous?.consecutiveFailures ?? 0;

  if (!isRetryable) {
    return { consecutiveFailures: 0, nextAllowedPollMs: 0 };
  }

  const failures = prevFailures + 1;
  const rawDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(factor, failures - 1));
  const jitterAmount = rawDelay * jitter * random();
  const delay = Math.min(maxDelayMs, Math.round(rawDelay + jitterAmount));
  return { consecutiveFailures: failures, nextAllowedPollMs: clock() + delay };
}

/** Returns true when a provider is currently in an active backoff window. */
export function isInBackoff(cursor: DiscoveryCursor | null, now = Date.now()): boolean {
  if (!cursor) return false;
  return now < cursor.nextAllowedPollMs;
}