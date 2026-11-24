import { createNativeRedisCacheBackend, createPostgresCacheBackend, createUpstashCacheBackend } from "./distributed";
import { TieredCacheStore } from "./tiered";
import type { CacheBackendKind, DistributedCacheBackend } from "./store";

const CACHE_STORE_KINDS: readonly CacheBackendKind[] = ["memory", "upstash", "redis", "postgres"];

export type CacheConfig = {
  store: CacheBackendKind;
  storeValid: boolean;
  distributed: boolean;
  l1MaxEntries: number;
  invalidationPollMs: number;
  detail: string;
};

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export function getCacheConfig(): CacheConfig {
  const rawStore = (process.env.CACHE_STORE ?? "").trim().toLowerCase();
  const requestedStore = (CACHE_STORE_KINDS as readonly string[]).includes(rawStore)
    ? (rawStore as CacheBackendKind)
    : "memory";
  const storeValid = rawStore === "" || requestedStore === rawStore;

  const upstashUrl = process.env.CACHE_UPSTASH_REST_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.CACHE_UPSTASH_REST_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  const redisUrl = process.env.CACHE_REDIS_URL ?? process.env.REDIS_URL;
  const postgresUrl = process.env.CACHE_POSTGRES_URL ?? process.env.DATABASE_URL;

  const upstashReady = Boolean(upstashUrl && upstashToken);
  const redisReady = Boolean(redisUrl);
  const postgresReady = Boolean(postgresUrl);
  const storeReady =
    requestedStore === "memory"
      ? true
      : requestedStore === "upstash"
        ? upstashReady
        : requestedStore === "redis"
          ? redisReady
          : postgresReady;

  const distributed = requestedStore !== "memory" && storeReady;
  const detail = !storeValid
    ? `CACHE_STORE="${rawStore}" is not one of ${CACHE_STORE_KINDS.join(", ")}; falling back to the in-memory cache.`
    : requestedStore === "memory"
      ? "In-memory cache is active; entries and invalidations are process-local."
      : storeReady
        ? `Distributed ${requestedStore} cache is configured with an in-process L1 cache.`
        : `CACHE_STORE=${requestedStore} is selected but its connection settings are missing; falling back to the in-memory cache.`;

  return {
    store: distributed ? requestedStore : "memory",
    storeValid,
    distributed,
    l1MaxEntries: boundedInteger("CACHE_L1_MAX_ENTRIES", 1_000, 1, 100_000),
    invalidationPollMs: boundedInteger("CACHE_INVALIDATION_POLL_MS", 1_000, 100, 60_000),
    detail,
  };
}

function createBackend(config: CacheConfig): DistributedCacheBackend | undefined {
  if (!config.distributed) return undefined;

  try {
    if (config.store === "upstash") {
      const url = process.env.CACHE_UPSTASH_REST_URL ?? process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.CACHE_UPSTASH_REST_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
      if (url && token) return createUpstashCacheBackend({ url, token });
    }
    if (config.store === "redis") {
      const url = process.env.CACHE_REDIS_URL ?? process.env.REDIS_URL;
      if (url) return createNativeRedisCacheBackend(url);
    }
    if (config.store === "postgres") {
      const connectionString = process.env.CACHE_POSTGRES_URL ?? process.env.DATABASE_URL;
      if (connectionString) return createPostgresCacheBackend({ connectionString });
    }
  } catch {
    // Cache is an optimization; a broken adapter must never break the app.
  }

  return undefined;
}

export function createCacheStore(): TieredCacheStore {
  const config = getCacheConfig();
  return new TieredCacheStore(createBackend(config), {
    l1MaxEntries: config.l1MaxEntries,
    invalidationPollMs: config.invalidationPollMs,
  });
}

const storeGlobal = globalThis as typeof globalThis & {
  __cryptaraCacheStore?: TieredCacheStore;
};

/** Process-wide store. In memory mode this is equivalent to the old serverCache. */
export function getCacheStore(): TieredCacheStore {
  storeGlobal.__cryptaraCacheStore ??= createCacheStore();
  return storeGlobal.__cryptaraCacheStore;
}

export const serverCache = getCacheStore();
