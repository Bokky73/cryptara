import { z } from "zod";
import type {
  DiscoveryChainId,
  DiscoveryCursor,
  DiscoveryProviderKind,
} from "@/server/discovery/types";
import type { BackoffConfig } from "@/server/discovery/types";

// ─── Durable persistence adapter ─────────────────────────────────────────────
// Cursors must survive process restarts. The scheduler wires a durable sink
// (e.g. Postgres / file-backed store) via `setCursorPersistence`; when no sink
// is configured the store falls back to in-memory only (tests / fixture replay).

export interface CursorPersistence {
  /** Persist the full cursor snapshot. Must be idempotent. */
  save(snapshot: Record<string, unknown>[]): void | Promise<void>;
  /** Load a previously persisted snapshot, or null when none exists. */
  load(): Record<string, unknown>[] | null | Promise<Record<string, unknown>[] | null>;
}

let cursorPersistence: CursorPersistence | null = null;

export function setCursorPersistence(persistence: CursorPersistence | null): void {
  cursorPersistence = persistence;
}

export function getCursorPersistence(): CursorPersistence | null {
  return cursorPersistence;
}

/**
 * Flush the current cursor snapshot to the configured durable sink.
 * No-op when no persistence adapter is configured.
 */
export async function persistCursors(): Promise<void> {
  if (!cursorPersistence) return;
  await cursorPersistence.save(dumpCursors());
}

/**
 * Load cursors from the configured durable sink (if any) into memory.
 * Returns the number of cursors restored.
 */
export async function restoreCursors(): Promise<number> {
  if (!cursorPersistence) return 0;
  const dumped = await cursorPersistence.load();
  if (!dumped) return 0;
  loadCursors(dumped);
  return cursorStore.size;
}

// ─── Zod schema for runtime validation ───────────────────────────────────────

export const discoveryCursorSchema = z.object({
  providerKind: z.enum(["dexscreener_new_pairs", "stellar_market"]),
  chainId: z.string().min(1),
  cursor: z.string(),
  updatedAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  consecutiveFailures: z.number().int().min(0),
  nextAllowedPollMs: z.number().int().min(0),
  _key: z.string().optional(),
});

// ─── In-memory cursor store ──────────────────────────────────────────────────
// Persisted cursors survive restarts via JSON serialisation.
// In a production build this would write to Postgres; for the MVP the
// scheduler calls `dumpCursors()` / `loadCursors()` at start/stop.

const cursorStore = new Map<string, DiscoveryCursor>();

function storeKey(kind: DiscoveryProviderKind, chainId: DiscoveryChainId): string {
  return `${kind}::${chainId}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getCursor(kind: DiscoveryProviderKind, chainId: DiscoveryChainId): DiscoveryCursor | null {
  return cursorStore.get(storeKey(kind, chainId)) ?? null;
}

export function upsertCursor(cursor: DiscoveryCursor): void {
  cursorStore.set(storeKey(cursor.providerKind, cursor.chainId), { ...cursor });
  // Fire-and-forget durable write; failures must not break the poll loop.
  if (cursorPersistence) {
    void Promise.resolve(persistCursors()).catch(() => {
      /* durable write failures are surfaced via metrics, not thrown */
    });
  }
}

export function listCursors(): DiscoveryCursor[] {
  return Array.from(cursorStore.values());
}

export function listCursorsForProvider(kind: DiscoveryProviderKind): DiscoveryCursor[] {
  return Array.from(cursorStore.values()).filter((c) => c.providerKind === kind);
}

export function updateCursorFailure(
  kind: DiscoveryProviderKind,
  chainId: DiscoveryChainId,
  backoffConfig: BackoffConfig,
): DiscoveryCursor {
  const existing = getCursor(kind, chainId);
  const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
  const delayMs = Math.min(
    backoffConfig.initialMs * Math.pow(backoffConfig.multiplier, consecutiveFailures - 1),
    backoffConfig.maxMs,
  );
  const cursor: DiscoveryCursor = {
    providerKind: kind,
    chainId,
    cursor: existing?.cursor ?? "",
    updatedAt: new Date().toISOString(),
    consecutiveFailures,
    nextAllowedPollMs: Date.now() + delayMs,
  };
  upsertCursor(cursor);
  return cursor;
}

export function updateCursorSuccess(
  kind: DiscoveryProviderKind,
  chainId: DiscoveryChainId,
  newCursor: string,
): DiscoveryCursor {
  const cursor: DiscoveryCursor = {
    providerKind: kind,
    chainId,
    cursor: newCursor,
    updatedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    nextAllowedPollMs: 0,
  };
  upsertCursor(cursor);
  return cursor;
}

export function isCursorReady(cursor: DiscoveryCursor | null): boolean {
  if (!cursor) return true;
  return Date.now() >= cursor.nextAllowedPollMs;
}

export function isCursorStale(cursor: DiscoveryCursor, maxCursorAgeMs: number): boolean {
  const age = Date.now() - new Date(cursor.updatedAt).getTime();
  return age > maxCursorAgeMs;
}

/**
 * Serialise all cursors to a JSON-serialisable structure for persistence.
 */
export function dumpCursors(): Record<string, unknown>[] {
  return Array.from(cursorStore.entries()).map(([key, cursor]) => ({
    ...cursor,
    _key: key,
  }));
}

/**
 * Restore cursors from a previously dumped array.
 * Uses Zod runtime validation to ensure the data matches the expected shape.
 * Silently skips entries that fail validation.
 */
export function loadCursors(dumped: Record<string, unknown>[]): void {
  for (const entry of dumped) {
    const parsed = discoveryCursorSchema.safeParse(entry);
    if (!parsed.success) {
      continue;
    }
    const { _key, ...cursor } = parsed.data;
    cursorStore.set(_key ?? storeKey(cursor.providerKind as DiscoveryProviderKind, cursor.chainId as DiscoveryChainId), cursor as DiscoveryCursor);
  }
}

/**
 * Reset all cursors (used in tests / fixture replay).
 */
export function resetCursors(): void {
  cursorStore.clear();
  if (cursorPersistence) {
    void Promise.resolve(persistCursors()).catch(() => {
      /* ignore */
    });
  }
}
