import { MemoryCacheStore } from "./memoryStore";
import { cacheMetrics } from "./metrics";
import type {
  CacheBackendStatus,
  CacheNegativeWriteOptions,
  CacheRead,
  CacheStore,
  CacheWriteOptions,
  DistributedCacheBackend,
} from "./store";

export type TieredCacheOptions = {
  l1MaxEntries: number;
  invalidationPollMs: number;
  now?: () => number;
};

/**
 * L1/L2 cache facade. Reads use the in-process store first, then the shared
 * backend. Writes and tag invalidations are mirrored to the backend and every
 * instance applies broadcast invalidations to its own L1 cache.
 */
export class TieredCacheStore implements CacheStore {
  readonly l1: MemoryCacheStore;
  readonly backend?: DistributedCacheBackend;

  private readonly invalidationPollMs: number;
  private cursor = 0;
  private nextRefreshAt = 0;
  private refreshInFlight?: Promise<number>;

  constructor(backend: DistributedCacheBackend | undefined, options: TieredCacheOptions) {
    this.backend = backend;
    this.options = options;
    this.invalidationPollMs = Math.max(100, options.invalidationPollMs);
    this.l1 = new MemoryCacheStore({ maxEntries: options.l1MaxEntries, now: options.now });
  }

  get<T>(key: string, now?: number): CacheRead<T> {
    return this.l1.get<T>(key, now);
  }

  set<T>(key: string, value: T, options: CacheWriteOptions): void {
    this.l1.set(key, value, options);
    this.background(() => this.backend?.set(key, value, options));
  }

  setNegative(key: string, error: unknown, options: CacheNegativeWriteOptions = {}): void {
    this.l1.setNegative(key, error, options);
    this.background(() => this.backend?.setNegative(key, error, options));
  }

  delete(key: string): void {
    this.l1.delete(key);
    this.background(() => this.backend?.delete(key));
  }

  invalidateTags(tags: readonly string[]): number {
    const removed = this.l1.invalidateTags(tags);
    this.background(() => this.backend?.invalidateTags(tags).then(() => this.refreshInvalidations(true)));
    return removed;
  }

  clear(): void {
    this.l1.clear();
    this.background(() => this.backend?.clear().then(() => this.refreshInvalidations(true)));
  }

  size(): number {
    return this.l1.size();
  }

  async loadFromBackend<T>(key: string, now?: number): Promise<CacheRead<T> | undefined> {
    if (!this.backend) return undefined;
    await this.refreshInvalidations();
    const cached = await this.backend.get<T>(key, now);
    if (cached.state !== "miss" && cached.record) this.l1.put(key, cached.record);
    return cached;
  }

  async persistSet<T>(key: string, value: T, options: CacheWriteOptions): Promise<void> {
    this.l1.set(key, value, options);
    if (!this.backend) return;
    try {
      await this.backend.set(key, value, options);
    } catch {
      cacheMetrics.increment("backendError");
    }
  }

  async persistNegative(key: string, error: unknown, options: CacheNegativeWriteOptions = {}): Promise<void> {
    this.l1.setNegative(key, error, options);
    if (!this.backend) return;
    try {
      await this.backend.setNegative(key, error, options);
    } catch {
      cacheMetrics.increment("backendError");
    }
  }

  async deleteAsync(key: string): Promise<void> {
    this.l1.delete(key);
    if (!this.backend) return;
    try {
      await this.backend.delete(key);
    } catch {
      cacheMetrics.increment("backendError");
    }
  }

  async invalidateTagsAsync(tags: readonly string[]): Promise<number> {
    const removed = this.l1.invalidateTags(tags);
    if (this.backend) {
      try {
        await this.backend.invalidateTags(tags);
      } catch {
        cacheMetrics.increment("backendError");
      }
      await this.refreshInvalidations(true);
    }
    return removed;
  }

  /** Apply invalidation broadcasts from the shared backend to this instance's L1. */
  async refreshInvalidations(force = false): Promise<number> {
    if (!this.backend) return 0;
    const now = Date.now();
    if (!force && now < this.nextRefreshAt) return 0;
    if (this.refreshInFlight) {
      if (!force) return this.refreshInFlight;
      await this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      try {
        const { cursor, events } = await this.backend!.readInvalidations(this.cursor);
        for (const event of events) {
          if (event.tags.includes("*")) this.l1.clear();
          else this.l1.invalidateTags(event.tags);
        }
        this.cursor = Math.max(this.cursor, cursor);
        return events.length;
      } catch {
        cacheMetrics.increment("backendError");
        return 0;
      } finally {
        this.nextRefreshAt = Date.now() + this.invalidationPollMs;
        this.refreshInFlight = undefined;
      }
    })();

    return this.refreshInFlight;
  }

  backendStatus(): CacheBackendStatus {
    return {
      ...(this.backend?.status ?? {
        kind: "memory" as const,
        distributed: false,
        ready: true,
        detail: "In-memory cache is active; entries are process-local.",
      }),
      l1MaxEntries: this.l1SizeLimit(),
    };
  }

  private l1SizeLimit(): number {
    // MemoryCacheStore clamps to at least one entry; report the configured cap.
    return this.options.l1MaxEntries;
  }

  private background(task: () => Promise<unknown> | undefined): void {
    if (!this.backend) return;
    void Promise.resolve()
      .then(task)
      .catch(() => cacheMetrics.increment("backendError"));
  }

  private readonly options: TieredCacheOptions;
}
