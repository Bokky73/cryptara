export const DEFAULT_NEGATIVE_TTL_MS = 5_000;

export function negativeCacheOptions(ttlMs = DEFAULT_NEGATIVE_TTL_MS) {
  return { ttlMs: Math.max(1, ttlMs) };
}

interface NegativeEntry {
  expiresAt: number;
}

export interface NegativeCacheEntry {
  reason: string;
  ttlMs: number;
}

export interface NegativeCache {
  get(key: string): NegativeCacheEntry | undefined;
  set(key: string, value: NegativeCacheEntry): void;
  delete(key: string): void;
}

const negativeStore = new Map<string, NegativeEntry>();
const providerNegativeStore = new Map<string, NegativeCacheEntry & { expiresAt: number }>();

export function getNegativeCache(): NegativeCache {
  return {
    get(key) {
      const entry = providerNegativeStore.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        providerNegativeStore.delete(key);
        return undefined;
      }
      return { reason: entry.reason, ttlMs: entry.ttlMs };
    },
    set(key, value) {
      providerNegativeStore.set(key, { ...value, expiresAt: Date.now() + normalizeTtl(value.ttlMs) });
    },
    delete(key) {
      providerNegativeStore.delete(key);
    },
  };
}

function normalizeTtl(ttlMs: number | undefined): number {
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs)) {
    return DEFAULT_NEGATIVE_TTL_MS;
  }
  return Math.max(1, Math.floor(ttlMs));
}

function evictExpired(now: number): void {
  for (const [key, entry] of negativeStore) {
    if (entry.expiresAt <= now) {
      negativeStore.delete(key);
    }
  }
}

export function recordNegative(key: string, ttlMs?: number): void {
  if (!key) {
    return;
  }
  const now = Date.now();
  evictExpired(now);
  negativeStore.set(key, { expiresAt: now + normalizeTtl(ttlMs) });
}

export function isNegative(key: string): boolean {
  if (!key) {
    return false;
  }
  const entry = negativeStore.get(key);
  if (!entry) {
    return false;
  }
  if (entry.expiresAt <= Date.now()) {
    negativeStore.delete(key);
    return false;
  }
  return true;
}

export function clearNegative(key: string): void {
  if (!key) {
    return;
  }
  negativeStore.delete(key);
}

export function clearAllNegative(): void {
  negativeStore.clear();
}