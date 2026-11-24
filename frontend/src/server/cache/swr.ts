import { cacheMetrics } from "./metrics";
import { cacheSingleFlight, type SingleFlight } from "./coalesce";
import { negativeCacheOptions } from "./negative";
import type { CacheRead, CacheStore } from "./store";

export type CachedRead<T> = { value: T; state: "fresh" | "stale"; error?: undefined } | { value?: undefined; state: "negative"; error: Error };

type CacheLoadInput<T> = {
  store: CacheStore;
  key: string;
  loader: () => Promise<T>;
  ttlMs: number;
  staleMs?: number;
  tags?: string[];
  negativeTtlMs?: number;
  flight?: SingleFlight;
  now?: number;
};

export async function getOrLoad<T>(input: CacheLoadInput<T>): Promise<CachedRead<T>> {
  const flight = input.flight ?? cacheSingleFlight;
  let cached: CacheRead<T>;
  try {
    await input.store.refreshInvalidations?.();
    cached = await readCache(input.store, input.key, input.now);
  } catch {
    cacheMetrics.increment("backendError");
    return loadThrough(input, flight);
  }

  if (cached.state === "fresh") {
    cacheMetrics.increment("hit");
    return { state: "fresh", value: cached.value as T };
  }
  if (cached.state === "negative") {
    cacheMetrics.increment("negativeHit");
    return { state: "negative", error: new Error(cached.error ?? "cached_upstream_failure") };
  }
  if (cached.state === "stale") {
    cacheMetrics.increment("stale");
    void loadThrough(input, flight);
    return { state: "stale", value: cached.value as T };
  }

  cacheMetrics.increment("miss");
  return loadThrough(input, flight);
}

async function readCache<T>(store: CacheStore, key: string, now?: number): Promise<CacheRead<T>> {
  const local = store.get<T>(key, now);
  if (local.state !== "miss" || !store.loadFromBackend) return local;

  try {
    const remote = await store.loadFromBackend<T>(key, now);
    if (remote && remote.state !== "miss") return remote;
  } catch {
    cacheMetrics.increment("backendError");
  }
  return { state: "miss" };
}

async function loadThrough<T>(input: CacheLoadInput<T>, flight: SingleFlight): Promise<CachedRead<T>> {
  try {
    const value = await flight.run(input.key, input.loader);
    try {
      if (input.store.persistSet) {
        await input.store.persistSet(input.key, value, { ttlMs: input.ttlMs, staleMs: input.staleMs, tags: input.tags });
      } else {
        input.store.set(input.key, value, { ttlMs: input.ttlMs, staleMs: input.staleMs, tags: input.tags });
      }
    } catch {
      cacheMetrics.increment("backendError");
    }
    return { state: "fresh", value };
  } catch (error) {
    try {
      const options = { ...negativeCacheOptions(input.negativeTtlMs), tags: input.tags };
      if (input.store.persistNegative) {
        await input.store.persistNegative(input.key, error, options);
      } else {
        input.store.setNegative(input.key, error, options);
      }
    } catch {
      cacheMetrics.increment("backendError");
    }
    return { state: "negative", error: error instanceof Error ? error : new Error(String(error)) };
  }
}
