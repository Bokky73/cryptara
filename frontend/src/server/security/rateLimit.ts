import { NextRequest, NextResponse } from "next/server";

type RateLimitOptions = {
  limit: number;
  windowMs: number;
  namespace: string;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

export const rateLimitProfiles = {
  tokenScan: { namespace: "scan:token", limit: 25, windowMs: 60_000 },
  portfolioReview: { namespace: "agent:portfolio", limit: 30, windowMs: 60_000 },
  executionPrepare: { namespace: "execute:prepare", limit: 20, windowMs: 60_000 },
  historyRead: { namespace: "history", limit: 80, windowMs: 60_000 },
  expensiveProviderCall: { namespace: "provider:expensive", limit: 10, windowMs: 60_000 },
  alertRead: { namespace: "alert:read", limit: 80, windowMs: 60_000 },
  alertRuleWrite: { namespace: "alert:write", limit: 30, windowMs: 60_000 },
  alertAcknowledge: { namespace: "alert:ack", limit: 30, windowMs: 60_000 },
} satisfies Record<string, RateLimitOptions>;

type Bucket = { count: number; resetAt: number };

function readIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Bounded in-memory LRU/TTL store. Used for local dev and as a safe fallback
 * when no distributed store is configured. Memory is strictly bounded by
 * `maxKeys`; expired buckets are swept periodically and LRU entries are
 * evicted when the cap is reached.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxKeys: number;
  private readonly sweepIntervalMs: number;
  private lastSweep = 0;

  constructor(options: { maxKeys?: number; sweepIntervalMs?: number } = {}) {
    this.maxKeys = Math.max(1, options.maxKeys ?? readIntEnv("RATE_LIMIT_MAX_KEYS", 10_000));
    this.sweepIntervalMs = Math.max(1_000, options.sweepIntervalMs ?? 30_000);
  }

  private sweep(now: number) {
    if (now - this.lastSweep < this.sweepIntervalMs) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    this.sweep(now);

    let bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
    } else {
      // Refresh LRU ordering.
      this.buckets.delete(key);
    }

    bucket.count += 1;
    this.buckets.set(key, bucket);

    // Enforce the max-key cap by evicting least-recently-used entries.
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (oldest.done) break;
      this.buckets.delete(oldest.value);
    }

    const allowed = bucket.count <= limit;
    const remaining = Math.max(0, limit - bucket.count);
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    return { allowed, limit, remaining, resetAt: bucket.resetAt, retryAfterSeconds };
  }
}

type RedisLike = {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  pttl(key: string): Promise<number>;
};

/**
 * Redis-backed store. Uses INCR + PEXPIRE for atomic increments with TTL.
 * The first increment in a window sets the expiry; subsequent increments
 * leave the existing TTL intact.
 */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly client: RedisLike) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const count = await this.client.incr(key);
    if (count === 1) {
      await this.client.pexpire(key, windowMs);
    }
    let ttl = await this.client.pttl(key);
    if (ttl < 0) {
      await this.client.pexpire(key, windowMs);
      ttl = windowMs;
    }
    const now = Date.now();
    const resetAt = now + ttl;
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil(ttl / 1000));

    return { allowed, limit, remaining, resetAt, retryAfterSeconds };
  }
}

/**
 * Upstash REST store. Uses the INCR command followed by PEXPIRE on first hit.
 */
export class UpstashRateLimitStore implements RateLimitStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async command<T>(...args: (string | number)[]): Promise<T> {
    const res = await fetch(`${this.url}/${args.map((a) => encodeURIComponent(String(a))).join("/")}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Upstash command failed: ${res.status}`);
    const body = (await res.json()) as { result: T };
    return body.result;
  }

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const count = await this.command<number>("INCR", key);
    if (count === 1) {
      await this.command("PEXPIRE", key, windowMs);
    }
    let ttl = await this.command<number>("PTTL", key);
    if (ttl < 0) {
      await this.command("PEXPIRE", key, windowMs);
      ttl = windowMs;
    }
    const now = Date.now();
    const resetAt = now + ttl;
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil(ttl / 1000));

    return { allowed, limit, remaining, resetAt, retryAfterSeconds };
  }
}

type QueryFn = (sql: string, params: unknown[]) => Promise<{ rows: Array<{ count: number; reset_at: string | Date }> }>;

/**
 * Postgres-backed store using a bucket table with atomic upsert and window reset.
 * Expects a table:
 *   rate_limit_buckets(key text primary key, count integer not null, reset_at timestamptz not null)
 */
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly query: QueryFn) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const resetAt = new Date(now + windowMs);
    const { rows } = await this.query(
      `INSERT INTO rate_limit_buckets (key, count, reset_at)
       VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limit_buckets.reset_at <= now() THEN 1 ELSE rate_limit_buckets.count + 1 END,
         reset_at = CASE WHEN rate_limit_buckets.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limit_buckets.reset_at END
       RETURNING count, reset_at`,
      [key, resetAt],
    );
    const row = rows[0];
    const count = row?.count ?? 1;
    const rowResetAt = row ? new Date(row.reset_at).getTime() : resetAt.getTime();
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((rowResetAt - now) / 1000));

    return { allowed, limit, remaining, resetAt: rowResetAt, retryAfterSeconds };
  }
}

const storeGlobal = globalThis as typeof globalThis & {
  __cryptaraRateLimitStore?: RateLimitStore;
};

function createStore(): RateLimitStore {
  const kind = (process.env.RATE_LIMIT_STORE ?? "memory").toLowerCase();

  if (kind === "redis") {
    const url = process.env.REDIS_URL;
    if (url) {
      try {
        // Lazy require to avoid a hard dependency when not configured.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { createClient } = require("redis") as { createClient: (opts: { url: string }) => RedisLike & { connect(): Promise<void> } };
        const client = createClient({ url });
        void client.connect();
        return new RedisRateLimitStore(client);
      } catch {
        // Fall through to memory store.
      }
    }
  }

  if (kind === "upstash") {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token) {
      return new UpstashRateLimitStore(url, token);
    }
  }

  if (kind === "postgres") {
    const connectionString = process.env.DATABASE_URL;
    if (connectionString) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Pool } = require("pg") as { Pool: new (opts: { connectionString: string }) => { query(sql: string, params: unknown[]): Promise<{ rows: Array<{ count: number; reset_at: string | Date }> }> } };
        const pool = new Pool({ connectionString });
        return new PostgresRateLimitStore((sql, params) => pool.query(sql, params));
      } catch {
        // Fall through to memory store.
      }
    }
  }

  return new MemoryRateLimitStore();
}

export function getRateLimitStore(): RateLimitStore {
  storeGlobal.__cryptaraRateLimitStore ??= createStore();
  return storeGlobal.__cryptaraRateLimitStore;
}

export function getClientKey(request: Request | NextRequest, namespace: string) {
  const headers = request.headers;

  // Prefer platform-verified headers that cannot be spoofed by clients.
  const vercelForwarded = headers.get("x-vercel-forwarded-for");
  if (vercelForwarded) {
    const ip = vercelForwarded.split(",").pop()?.trim();
    if (ip) return `${namespace}:${ip}`;
  }

  const cfConnectingIp = headers.get("cf-connecting-ip");
  if (cfConnectingIp) {
    return `${namespace}:${cfConnectingIp.trim()}`;
  }

  // Only trust x-forwarded-for when a trusted proxy hop count is configured.
  const trustedHops = readIntEnv("TRUSTED_PROXY_HOPS", 0);
  if (trustedHops > 0) {
    const forwardedFor = headers.get("x-forwarded-for");
    if (forwardedFor) {
      const parts = forwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
      // The rightmost entries are appended by trusted proxies; pick the entry
      // that the outermost trusted proxy observed.
      const index = parts.length - trustedHops;
      const ip = parts[index] ?? parts[parts.length - 1];
      if (ip) return `${namespace}:${ip}`;
    }
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    return `${namespace}:${realIp.trim()}`;
  }

  return `${namespace}:local`;
}

function applyRateLimitHeaders(response: NextResponse, result: RateLimitResult) {
  response.headers.set("RateLimit-Limit", result.limit.toString());
  response.headers.set("RateLimit-Remaining", result.remaining.toString());
  response.headers.set("RateLimit-Reset", Math.max(0, Math.ceil((result.resetAt - Date.now()) / 1000)).toString());
  if (!result.allowed) {
    response.headers.set("Retry-After", result.retryAfterSeconds.toString());
  }
  return response;
}

export async function checkRateLimit(
  request: Request | NextRequest,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const key = getClientKey(request, options.namespace);
  const store = getRateLimitStore();
  return store.consume(key, options.limit, options.windowMs);
}

export async function checkRateLimitProfile(
  request: Request | NextRequest,
  profile: keyof typeof rateLimitProfiles,
): Promise<RateLimitResult> {
  return checkRateLimit(request, rateLimitProfiles[profile]);
}

/**
 * Builds a 429 response for a denied rate-limit result, including standard
 * RateLimit-* and Retry-After headers.
 */
export function rateLimitResponse(result: RateLimitResult, namespace: string): NextResponse {
  const response = NextResponse.json(
    {
      error: "rate_limited",
      detail: `Too many ${namespace} requests. Try again after ${new Date(result.resetAt).toISOString()}.`,
    },
    { status: 429 },
  );
  return applyRateLimitHeaders(response, result);
}

/**
 * Attaches RateLimit-* headers to a successful response.
 */
export function withRateLimitHeaders(response: NextResponse, result: RateLimitResult): NextResponse {
  return applyRateLimitHeaders(response, result);
}
