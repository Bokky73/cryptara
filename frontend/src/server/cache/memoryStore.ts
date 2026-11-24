import type { CacheRead, CacheRecord, CacheStore, CacheWriteOptions, CacheNegativeWriteOptions } from "./store";
import { cacheMetrics } from "./metrics";

export type MemoryCacheOptions = { maxEntries?: number; now?: () => number };

export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, CacheRecord>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 1_000));
    this.now = options.now ?? Date.now;
  }

  get<T>(key: string, now = this.now()): CacheRead<T> {
    const entry = this.entries.get(key) as CacheRecord<T> | undefined;
    if (!entry) return { state: "miss" };
    if (now < entry.expiresAt) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      if (entry.negative) return { state: "negative", error: entry.error, record: entry };
      return { state: "fresh", value: entry.value, record: entry };
    }
    if (now < entry.staleUntil && !entry.negative) {
      return { state: "stale", value: entry.value, record: entry };
    }
    this.entries.delete(key);
    return { state: "miss" };
  }

  set<T>(key: string, value: T, options: CacheWriteOptions): void {
    const now = this.now();
    this.write(key, {
      value,
      createdAt: now,
      expiresAt: now + Math.max(0, options.ttlMs),
      staleUntil: now + Math.max(0, options.ttlMs) + Math.max(0, options.staleMs ?? 0),
      tags: [...(options.tags ?? [])],
      negative: false,
    });
  }

  setNegative(key: string, error: unknown, options: CacheNegativeWriteOptions = {}): void {
    const message = error instanceof Error ? error.message : String(error);
    const ttlMs = Math.max(1, options.ttlMs ?? 5_000);
    const now = this.now();
    this.write(key, {
      error: message,
      createdAt: now,
      expiresAt: now + ttlMs,
      staleUntil: now + ttlMs,
      tags: [...(options.tags ?? [])],
      negative: true,
    });
  }

  /** Insert a record received from a shared backend without changing its timestamps. */
  put(key: string, record: CacheRecord): void {
    this.write(key, { ...record, tags: [...(record.tags ?? [])] });
  }

  delete(key: string) {
    this.entries.delete(key);
  }

  invalidateTags(tags: readonly string[]): number {
    const wanted = new Set(tags);
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.tags.some((tag) => wanted.has(tag))) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear() {
    this.entries.clear();
  }

  size() {
    return this.entries.size;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  private write(key: string, entry: CacheRecord) {
    if (this.entries.has(key)) this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
      cacheMetrics.increment("eviction");
    }
  }
}
