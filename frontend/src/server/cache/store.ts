export type CacheState = "fresh" | "stale" | "negative" | "miss";

export type CacheRecord<T = unknown> = {
  value?: T;
  error?: string;
  createdAt: number;
  expiresAt: number;
  staleUntil: number;
  tags: string[];
  negative: boolean;
};

export type CacheRead<T = unknown> = {
  state: CacheState;
  value?: T;
  error?: string;
  record?: CacheRecord<T>;
};

export type CacheWriteOptions = { ttlMs: number; staleMs?: number; tags?: string[] };
export type CacheNegativeWriteOptions = { ttlMs?: number; tags?: string[] };

export type CacheBackendKind = "memory" | "upstash" | "redis" | "postgres";

export type CacheBackendStatus = {
  kind: CacheBackendKind;
  distributed: boolean;
  ready: boolean;
  detail: string;
  l1MaxEntries: number;
};

/** A broadcast event applied by every instance's L1 cache. */
export type CacheInvalidationEvent = {
  id: number;
  tags: string[];
  createdAt: number;
};

/**
 * Async shared cache backend. Implementations are responsible for both value
 * storage and broadcasting tag invalidations to other instances.
 */
export type DistributedCacheBackend = {
  readonly status: Omit<CacheBackendStatus, "l1MaxEntries">;
  get<T>(key: string, now?: number): Promise<CacheRead<T>>;
  set<T>(key: string, value: T, options: CacheWriteOptions): Promise<void>;
  setNegative(key: string, error: unknown, options?: CacheNegativeWriteOptions): Promise<void>;
  delete(key: string): Promise<void>;
  invalidateTags(tags: readonly string[]): Promise<number>;
  clear(): Promise<void>;
  readInvalidations(afterId: number): Promise<{ cursor: number; events: CacheInvalidationEvent[] }>;
};

/**
 * The synchronous facade used by route handlers. Distributed backends are
 * exposed through optional async hooks so existing memory-only callers and
 * tests keep working unchanged.
 */
export type CacheStore = {
  get<T>(key: string, now?: number): CacheRead<T>;
  set<T>(key: string, value: T, options: CacheWriteOptions): void;
  setNegative(key: string, error: unknown, options?: CacheNegativeWriteOptions): void;
  delete(key: string): void;
  invalidateTags(tags: readonly string[]): number;
  clear(): void;
  size(): number;

  /** Hydrate L1 from the shared backend. Callers should await this on a miss. */
  loadFromBackend?<T>(key: string, now?: number): Promise<CacheRead<T> | undefined>;
  /** Persist a value after a successful loader. */
  persistSet?<T>(key: string, value: T, options: CacheWriteOptions): Promise<void>;
  /** Persist a negative result after a failed loader. */
  persistNegative?(key: string, error: unknown, options?: CacheNegativeWriteOptions): Promise<void>;
  /** Remove a single key from every instance. */
  deleteAsync?(key: string): Promise<void>;
  /** Broadcast a tag invalidation and clear matching entries locally and remotely. */
  invalidateTagsAsync?(tags: readonly string[]): Promise<number>;
  /** Apply any pending invalidation broadcasts to L1. Safe to call frequently. */
  refreshInvalidations?(force?: boolean): Promise<number>;
  /** Non-secret backend selection details for health checks. */
  backendStatus?(): CacheBackendStatus;
};
