import type {
  CacheBackendStatus,
  CacheInvalidationEvent,
  CacheNegativeWriteOptions,
  CacheRead,
  CacheRecord,
  CacheWriteOptions,
  DistributedCacheBackend,
} from "./store";

const ENTRY_PREFIX = "cryptara:cache:entry:";
const TAG_PREFIX = "cryptara:cache:tag:";
const EVENT_ID_KEY = "cryptara:cache:invalidation:id";
const EVENT_LIST_KEY = "cryptara:cache:invalidation:events";
const MAX_INVALIDATION_EVENTS = 500;

type BackendStatus = Omit<CacheBackendStatus, "l1MaxEntries">;

type RedisCommands = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(keys: string[]): Promise<number>;
  sadd(key: string, members: string[]): Promise<void>;
  srem(key: string, members: string[]): Promise<void>;
  smembers(key: string): Promise<string[]>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  incr(key: string): Promise<number>;
  lpush(key: string, value: string): Promise<void>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
};

function readRecord<T>(raw: CacheRecord<T> | null | undefined, now = Date.now()): CacheRead<T> {
  if (!raw || typeof raw !== "object" || !Number.isFinite(raw.expiresAt) || !Number.isFinite(raw.staleUntil)) {
    return { state: "miss" };
  }
  if (now < raw.expiresAt) {
    if (raw.negative) return { state: "negative", error: raw.error, record: raw };
    return { state: "fresh", value: raw.value, record: raw };
  }
  if (now < raw.staleUntil && !raw.negative) {
    return { state: "stale", value: raw.value, record: raw };
  }
  return { state: "miss" };
}

function parseRecord<T>(raw: string | null): CacheRecord<T> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CacheRecord<T>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function uniqueTags(tags: readonly string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))];
}

function entryKey(key: string): string {
  return `${ENTRY_PREFIX}${key}`;
}

function tagIndexKey(tag: string): string {
  return `${TAG_PREFIX}${tag}`;
}

function ttlSecondsFor(record: CacheRecord, now = Date.now()): number {
  return Math.max(1, Math.ceil((record.staleUntil - now) / 1_000));
}

function buildRecord<T>(value: T, options: CacheWriteOptions): CacheRecord<T> {
  const now = Date.now();
  return {
    value,
    createdAt: now,
    expiresAt: now + Math.max(0, options.ttlMs),
    staleUntil: now + Math.max(0, options.ttlMs) + Math.max(0, options.staleMs ?? 0),
    tags: uniqueTags(options.tags),
    negative: false,
  };
}

function buildNegativeRecord(error: unknown, options: CacheNegativeWriteOptions): CacheRecord {
  const now = Date.now();
  const ttlMs = Math.max(1, options.ttlMs ?? 5_000);
  return {
    error: error instanceof Error ? error.message : String(error),
    createdAt: now,
    expiresAt: now + ttlMs,
    staleUntil: now + ttlMs,
    tags: uniqueTags(options.tags),
    negative: true,
  };
}

function parseEvents(raw: string[]): CacheInvalidationEvent[] {
  const events: CacheInvalidationEvent[] = [];
  for (const value of raw) {
    try {
      const event = JSON.parse(value) as CacheInvalidationEvent;
      if (Number.isFinite(event.id) && Array.isArray(event.tags)) {
        events.push({ id: event.id, tags: event.tags.map(String), createdAt: Number(event.createdAt) || Date.now() });
      }
    } catch {
      // Malformed events are skipped; the cache is best-effort by design.
    }
  }
  return events.sort((a, b) => a.id - b.id);
}

function eventCursor(afterId: number, events: CacheInvalidationEvent[]): number {
  return events.reduce((cursor, event) => Math.max(cursor, event.id), afterId);
}

async function publishEvent(commands: RedisCommands, tags: readonly string[]): Promise<void> {
  const id = await commands.incr(EVENT_ID_KEY);
  const event: CacheInvalidationEvent = { id, tags: uniqueTags(tags), createdAt: Date.now() };
  await commands.lpush(EVENT_LIST_KEY, JSON.stringify(event));
  await commands.ltrim(EVENT_LIST_KEY, 0, MAX_INVALIDATION_EVENTS - 1);
}

async function writeRecord(commands: RedisCommands, key: string, record: CacheRecord): Promise<void> {
  const existing = parseRecord(await commands.get(entryKey(key)));
  const removedTags = uniqueTags(existing?.tags).filter((tag) => !record.tags.includes(tag));
  for (const tag of removedTags) await commands.srem(tagIndexKey(tag), [key]);

  const ttl = ttlSecondsFor(record);
  await commands.set(entryKey(key), JSON.stringify(record), ttl);
  // Tag indexes are intentionally not expired: an index that disappears before
  // a long-lived entry would silently miss a later invalidation broadcast.
  for (const tag of record.tags) await commands.sadd(tagIndexKey(tag), [key]);
}

async function deleteKeysByTags(commands: RedisCommands, tags: readonly string[]): Promise<number> {
  const wanted = uniqueTags(tags);
  if (!wanted.length) return 0;
  const keys = new Set<string>();
  for (const tag of wanted) {
    const indexKey = tagIndexKey(tag);
    for (const key of await commands.smembers(indexKey)) keys.add(key);
    await commands.del([indexKey]);
  }
  const names = [...keys].map(entryKey);
  for (let index = 0; index < names.length; index += 100) {
    await commands.del(names.slice(index, index + 100));
  }
  await publishEvent(commands, wanted);
  return keys.size;
}

function createCommandCacheBackend(status: BackendStatus, commands: RedisCommands): DistributedCacheBackend {
  return {
    status,
    async get<T>(key: string, now?: number): Promise<CacheRead<T>> {
      return readRecord<T>(parseRecord<T>(await commands.get(entryKey(key))), now);
    },
    async set<T>(key: string, value: T, options: CacheWriteOptions): Promise<void> {
      await writeRecord(commands, key, buildRecord(value, options));
    },
    async setNegative(key: string, error: unknown, options: CacheNegativeWriteOptions = {}): Promise<void> {
      await writeRecord(commands, key, buildNegativeRecord(error, options));
    },
    async delete(key: string): Promise<void> {
      const existing = parseRecord(await commands.get(entryKey(key)));
      await commands.del([entryKey(key)]);
      for (const tag of uniqueTags(existing?.tags)) await commands.srem(tagIndexKey(tag), [key]);
    },
    async invalidateTags(tags: readonly string[]): Promise<number> {
      return deleteKeysByTags(commands, tags);
    },
    async clear(): Promise<void> {
      await commands.del([EVENT_LIST_KEY]);
      await publishEvent(commands, ["*"]);
    },
    async readInvalidations(afterId: number): Promise<{ cursor: number; events: CacheInvalidationEvent[] }> {
      const events = parseEvents(await commands.lrange(EVENT_LIST_KEY, 0, MAX_INVALIDATION_EVENTS - 1))
        .filter((event) => event.id > afterId);
      return { cursor: eventCursor(afterId, events), events };
    },
  };
}

function restCommands(url: string, token: string): RedisCommands {
  const endpoint = url.trim().replace(/\/+$/, "");

  async function command<T>(args: (string | number)[]): Promise<T> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error(`Upstash cache command failed (${response.status})`);
    const payload = (await response.json()) as { result?: T; error?: string };
    if (payload.error) throw new Error(payload.error);
    return payload.result as T;
  }

  return {
    get: (key) => command<string | null>(["GET", key]),
    set: async (key, value, ttlSeconds) => { await command(["SET", key, value, "EX", ttlSeconds]); },
    del: (keys) => keys.length ? command<number>(["DEL", ...keys]) : Promise.resolve(0),
    sadd: async (key, members) => { if (members.length) await command(["SADD", key, ...members]); },
    srem: async (key, members) => { if (members.length) await command(["SREM", key, ...members]); },
    smembers: (key) => command<string[]>(["SMEMBERS", key]),
    expire: async (key, ttlSeconds) => { await command(["EXPIRE", key, ttlSeconds]); },
    incr: (key) => command<number>(["INCR", key]),
    lpush: async (key, value) => { await command(["LPUSH", key, value]); },
    ltrim: async (key, start, stop) => { await command(["LTRIM", key, start, stop]); },
    lrange: (key, start, stop) => command<string[]>(["LRANGE", key, start, stop]),
  };
}

export function createUpstashCacheBackend(options: { url: string; token: string; detail?: string }): DistributedCacheBackend {
  return createCommandCacheBackend(
    {
      kind: "upstash",
      distributed: true,
      ready: true,
      detail: options.detail ?? "Upstash REST cache is configured.",
    },
    restCommands(options.url, options.token),
  );
}

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  del(keys: string[]): Promise<number>;
  sAdd(key: string, members: string[]): Promise<number>;
  sRem(key: string, members: string[]): Promise<number>;
  sMembers(key: string): Promise<string[]>;
  expire(key: string, seconds: number): Promise<boolean>;
  incr(key: string): Promise<number>;
  lPush(key: string, value: string): Promise<number>;
  lTrim(key: string, start: number, stop: number): Promise<unknown>;
  lRange(key: string, start: number, stop: number): Promise<string[]>;
  connect(): Promise<void>;
};

export function createNativeRedisCacheBackend(url: string): DistributedCacheBackend {
  // Lazy require keeps the native client optional for local deployments.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require("redis") as { createClient: (opts: { url: string }) => RedisLike };
  const client = createClient({ url });
  void client.connect().catch(() => undefined);

  const commands: RedisCommands = {
    get: (key) => client.get(key),
    set: async (key, value, ttlSeconds) => { await client.set(key, value, { EX: ttlSeconds }); },
    del: (keys) => client.del(keys),
    sadd: async (key, members) => { if (members.length) await client.sAdd(key, members); },
    srem: async (key, members) => { if (members.length) await client.sRem(key, members); },
    smembers: (key) => client.sMembers(key),
    expire: async (key, ttlSeconds) => { await client.expire(key, ttlSeconds); },
    incr: (key) => client.incr(key),
    lpush: async (key, value) => { await client.lPush(key, value); },
    ltrim: async (key, start, stop) => { await client.lTrim(key, start, stop); },
    lrange: (key, start, stop) => client.lRange(key, start, stop),
  };

  return createCommandCacheBackend({
    kind: "redis",
    distributed: true,
    ready: true,
    detail: `Redis cache is configured at ${redactUrl(url)}.`,
  }, commands);
}

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "configured Redis URL";
  }
}

type PgQuery = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

const ENTRY_TABLE = "cryptara_cache_entries";
const EVENT_TABLE = "cryptara_cache_invalidation_events";

export function createPostgresCacheBackend(options: {
  connectionString: string;
  detail?: string;
  query?: PgQuery;
}): DistributedCacheBackend {
  const query: PgQuery = options.query ?? createPgQuery(options.connectionString);
  let schemaReady: Promise<void> | undefined;

  async function ready(): Promise<void> {
    schemaReady ??= ensureSchema(query).catch((error) => {
      schemaReady = undefined;
      throw error;
    });
    await schemaReady;
  }

  return {
    status: {
      kind: "postgres",
      distributed: true,
      ready: true,
      detail: options.detail ?? "Postgres unlogged cache tables are configured.",
    },
    async get<T>(key: string, now?: number): Promise<CacheRead<T>> {
      await ready();
      const { rows } = await query(
        `SELECT record::text AS record FROM ${ENTRY_TABLE} WHERE key = $1 AND stale_until > now()`,
        [key],
      );
      const raw = rows[0]?.record;
      if (typeof raw !== "string") return { state: "miss" };
      try {
        return readRecord<T>(JSON.parse(raw) as CacheRecord<T>, now);
      } catch {
        return { state: "miss" };
      }
    },
    async set<T>(key: string, value: T, options: CacheWriteOptions): Promise<void> {
      await ready();
      await upsertEntry(query, key, buildRecord(value, options));
    },
    async setNegative(key: string, error: unknown, options: CacheNegativeWriteOptions = {}): Promise<void> {
      await ready();
      await upsertEntry(query, key, buildNegativeRecord(error, options));
    },
    async delete(key: string): Promise<void> {
      await ready();
      await query(`DELETE FROM ${ENTRY_TABLE} WHERE key = $1`, [key]);
    },
    async invalidateTags(tags: readonly string[]): Promise<number> {
      await ready();
      const wanted = uniqueTags(tags);
      if (!wanted.length) return 0;
      const deleted = await query(`DELETE FROM ${ENTRY_TABLE} WHERE tags && $1::text[] RETURNING key`, [wanted]);
      await query(`INSERT INTO ${EVENT_TABLE} (tags) VALUES ($1::text[])`, [wanted]);
      return deleted.rows.length;
    },
    async clear(): Promise<void> {
      await ready();
      await query(`DELETE FROM ${ENTRY_TABLE}`);
      await query(`INSERT INTO ${EVENT_TABLE} (tags) VALUES ($1::text[])`, [["*"]]);
    },
    async readInvalidations(afterId: number): Promise<{ cursor: number; events: CacheInvalidationEvent[] }> {
      await ready();
      const { rows } = await query(
        `SELECT id, tags, created_at FROM ${EVENT_TABLE} WHERE id > $1 ORDER BY id ASC LIMIT $2`,
        [afterId, MAX_INVALIDATION_EVENTS],
      );
      const events = rows.map((row) => ({
        id: Number(row.id),
        tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
        createdAt: row.created_at instanceof Date ? row.created_at.getTime() : Date.now(),
      }));
      return { cursor: eventCursor(afterId, events), events };
    },
  };
}

async function upsertEntry(query: PgQuery, key: string, record: CacheRecord): Promise<void> {
  await query(
    `INSERT INTO ${ENTRY_TABLE} (key, record, tags, stale_until)
     VALUES ($1, $2::jsonb, $3::text[], to_timestamp($4 / 1000.0))
     ON CONFLICT (key) DO UPDATE SET
       record = EXCLUDED.record,
       tags = EXCLUDED.tags,
       stale_until = EXCLUDED.stale_until`,
    [key, JSON.stringify(record), record.tags, record.staleUntil],
  );
}

async function ensureSchema(query: PgQuery): Promise<void> {
  await query(`CREATE UNLOGGED TABLE IF NOT EXISTS ${ENTRY_TABLE} (
    key text PRIMARY KEY,
    record jsonb NOT NULL,
    tags text[] NOT NULL DEFAULT '{}',
    stale_until timestamptz NOT NULL
  )`);
  await query(`CREATE INDEX IF NOT EXISTS ${ENTRY_TABLE}_stale_until_idx ON ${ENTRY_TABLE} (stale_until)`);
  await query(`CREATE INDEX IF NOT EXISTS ${ENTRY_TABLE}_tags_idx ON ${ENTRY_TABLE} USING gin (tags)`);
  await query(`CREATE UNLOGGED TABLE IF NOT EXISTS ${EVENT_TABLE} (
    id bigserial PRIMARY KEY,
    tags text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
}

function createPgQuery(connectionString: string): PgQuery {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg") as {
    Pool: new (opts: { connectionString: string }) => {
      query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
    };
  };
  const pool = new Pool({ connectionString });
  return (sql, params) => pool.query(sql, params);
}
