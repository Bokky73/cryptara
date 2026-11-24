import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCacheConfig } from "./config";
import { createUpstashCacheBackend } from "./distributed";
import { createCacheKey } from "./keys";
import { MemoryCacheStore } from "./memoryStore";
import { cacheMetrics } from "./metrics";
import type { CacheBackendStatus, CacheInvalidationEvent, CacheRead, CacheRecord, CacheWriteOptions, DistributedCacheBackend } from "./store";
import { getOrLoad } from "./swr";
import { TieredCacheStore } from "./tiered";

class FakeBackend implements DistributedCacheBackend {
  readonly status: Omit<CacheBackendStatus, "l1MaxEntries"> = {
    kind: "postgres",
    distributed: true,
    ready: true,
    detail: "fake shared backend",
  };
  readonly records = new Map<string, CacheRecord>();
  readonly events: CacheInvalidationEvent[] = [];
  private nextId = 0;

  async get<T>(key: string, now = Date.now()): Promise<CacheRead<T>> {
    const record = this.records.get(key) as CacheRecord<T> | undefined;
    if (!record) return { state: "miss" };
    if (now < record.expiresAt) {
      if (record.negative) return { state: "negative", error: record.error, record };
      return { state: "fresh", value: record.value, record };
    }
    if (now < record.staleUntil && !record.negative) return { state: "stale", value: record.value, record };
    this.records.delete(key);
    return { state: "miss" };
  }

  async set<T>(key: string, value: T, options: CacheWriteOptions): Promise<void> {
    const now = Date.now();
    this.records.set(key, {
      value,
      createdAt: now,
      expiresAt: now + options.ttlMs,
      staleUntil: now + options.ttlMs + (options.staleMs ?? 0),
      tags: [...(options.tags ?? [])],
      negative: false,
    });
  }

  async setNegative(key: string, error: unknown, options: { ttlMs?: number; tags?: string[] } = {}): Promise<void> {
    const now = Date.now();
    const ttlMs = options.ttlMs ?? 5_000;
    this.records.set(key, {
      error: error instanceof Error ? error.message : String(error),
      createdAt: now,
      expiresAt: now + ttlMs,
      staleUntil: now + ttlMs,
      tags: [...(options.tags ?? [])],
      negative: true,
    });
  }

  async delete(key: string): Promise<void> {
    this.records.delete(key);
  }

  async invalidateTags(tags: readonly string[]): Promise<number> {
    const wanted = new Set(tags);
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.tags.some((tag) => wanted.has(tag))) {
        this.records.delete(key);
        removed += 1;
      }
    }
    this.events.push({ id: ++this.nextId, tags: [...tags], createdAt: Date.now() });
    return removed;
  }

  async clear(): Promise<void> {
    this.records.clear();
    this.events.push({ id: ++this.nextId, tags: ["*"], createdAt: Date.now() });
  }

  async readInvalidations(afterId: number): Promise<{ cursor: number; events: CacheInvalidationEvent[] }> {
    const events = this.events.filter((event) => event.id > afterId);
    return { cursor: events.at(-1)?.id ?? afterId, events };
  }
}

function tiered(backend: FakeBackend) {
  return new TieredCacheStore(backend, { l1MaxEntries: 100, invalidationPollMs: 1_000 });
}

describe("server cache", () => {
  beforeEach(() => cacheMetrics.reset());

  it("coalesces concurrent misses and keeps network-aware keys separate", async () => {
    const store = new MemoryCacheStore();
    let calls = 0;
    const key = createCacheKey({ chainFamily: "evm", network: "testnet", walletAddress: "0xA", resource: "portfolio" });
    const reads = await Promise.all(Array.from({ length: 50 }, () => getOrLoad({
      store,
      key,
      loader: async () => { calls += 1; await Promise.resolve(); return { calls }; },
      ttlMs: 1_000,
    })));
    expect(calls).toBe(1);
    expect(reads.every((read) => read.state === "fresh" && read.value?.calls === 1)).toBe(true);

    const otherNetwork = createCacheKey({ chainFamily: "evm", network: "mainnet", walletAddress: "0xA", resource: "portfolio" });
    expect(otherNetwork).not.toBe(key);
  });

  it("serves stale values while revalidating and supports tags", async () => {
    let now = 0;
    const store = new MemoryCacheStore({ now: () => now });
    store.set("k", "old", { ttlMs: 10, staleMs: 100, tags: ["wallet:a"] });
    now = 20;
    let refreshed = 0;
    const stale = await getOrLoad({ store, key: "k", loader: async () => { refreshed += 1; return "new"; }, ttlMs: 10, staleMs: 100, now });
    expect(stale).toMatchObject({ state: "stale", value: "old" });
    await Promise.resolve();
    expect(refreshed).toBe(1);
    expect(store.invalidateTags(["wallet:a"])).toBe(1);
  });

  it("negative caches failures without preventing a later success", async () => {
    let now = 0;
    const store = new MemoryCacheStore({ now: () => now });
    const options = { store, key: "failure", ttlMs: 100, negativeTtlMs: 5, loader: async () => { throw new Error("upstream"); } };
    expect((await getOrLoad(options)).state).toBe("negative");
    expect((await getOrLoad({ ...options, loader: async () => "ok" })).state).toBe("negative");
    now = 6;
    const success = await getOrLoad({ ...options, loader: async () => "ok" });
    expect(success).toMatchObject({ state: "fresh", value: "ok" });
  });

  it("falls through when a backend read fails", async () => {
    const broken = new MemoryCacheStore();
    broken.get = () => { throw new Error("backend down"); };
    const result = await getOrLoad({ store: broken, key: "broken", loader: async () => "live", ttlMs: 100 });
    expect(result).toMatchObject({ state: "fresh", value: "live" });
  });

  it("hydrates L1 from the shared backend on a miss", async () => {
    const backend = new FakeBackend();
    await backend.set("shared", { score: 42 }, { ttlMs: 10_000, tags: ["resource:risk-registry"] });
    const store = tiered(backend);
    let loaderCalls = 0;

    const result = await getOrLoad({
      store,
      key: "shared",
      loader: async () => { loaderCalls += 1; return { score: 0 }; },
      ttlMs: 10_000,
    });

    expect(result).toMatchObject({ state: "fresh", value: { score: 42 } });
    expect(loaderCalls).toBe(0);
    expect(store.get("shared").state).toBe("fresh");
    expect(cacheMetrics.report().ratios.hit).toBe(1);
  });

  it("broadcasts tag invalidation and clears stale entries on every instance", async () => {
    const backend = new FakeBackend();
    const writer = tiered(backend);
    const reader = tiered(backend);

    await writer.persistSet("snapshot", "v1", { ttlMs: 60_000, tags: ["resource:rules"] });
    await reader.loadFromBackend("snapshot");
    expect(reader.get("snapshot")).toMatchObject({ state: "fresh", value: "v1" });

    expect(await writer.invalidateTagsAsync(["resource:rules"])).toBe(1);
    expect(backend.records.size).toBe(0);
    // The reader keeps its L1 value until it consumes the broadcast.
    expect(reader.get("snapshot").state).toBe("fresh");
    expect(await reader.refreshInvalidations(true)).toBe(1);
    expect(reader.get("snapshot").state).toBe("miss");
    expect(await backend.get("snapshot")).toMatchObject({ state: "miss" });
  });

  it("sends Upstash REST commands as JSON arrays", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return { ok: true, json: async () => ({ result: "OK" }) } as Response;
    });

    try {
      const backend = createUpstashCacheBackend({ url: "https://example.upstash.io", token: "test-token" });
      await backend.set("key", "value", { ttlMs: 1_000 });

      const setCommand = bodies
        .map((body) => JSON.parse(body) as unknown[])
        .find((command) => command[0] === "SET");
      expect(setCommand?.[1]).toBe("cryptara:cache:entry:key");
      expect(setCommand?.[3]).toBe("EX");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to memory cache selection when env config is invalid or incomplete", () => {
    const original = process.env.CACHE_STORE;
    try {
      process.env.CACHE_STORE = "unknown-store";
      expect(getCacheConfig()).toMatchObject({ store: "memory", distributed: false, storeValid: false });

      process.env.CACHE_STORE = "postgres";
      delete process.env.CACHE_POSTGRES_URL;
      delete process.env.DATABASE_URL;
      expect(getCacheConfig()).toMatchObject({ store: "memory", distributed: false, storeValid: true });
    } finally {
      if (original === undefined) delete process.env.CACHE_STORE;
      else process.env.CACHE_STORE = original;
    }
  });

  it("reports cache ratios from recorded events", () => {
    cacheMetrics.increment("hit");
    cacheMetrics.increment("miss");
    cacheMetrics.increment("coalesced");
    cacheMetrics.increment("hit");
    cacheMetrics.increment("eviction");

    expect(cacheMetrics.report()).toMatchObject({
      total: 4,
      counts: { hit: 2, miss: 1, coalesced: 1, eviction: 1 },
      ratios: { hit: 0.5, miss: 0.25, coalesced: 0.25, stale: 0 },
    });
  });
});
