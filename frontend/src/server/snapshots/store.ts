import { randomBytes, randomUUID } from "node:crypto";
import type { IStorageAdapter } from "@/server/storage/adapters/types";
import { MemoryStorageAdapter } from "@/server/storage/adapters/memory";
import { wrapStorageAdapter } from "@/server/observability/tracing/spans";
import type { TokenScanResult } from "@/server/types";
import { canonicalAssetIdentity, hashRiskSnapshot } from "./canonical";
import {
  hashRevocationToken,
  verifyRevocationToken,
  verifyRiskSnapshotRecord,
  type RiskSnapshotIntegrityFailure,
} from "./integrity";
import { redactRiskReportSnapshot } from "./redaction";
import { RISK_SNAPSHOT_SCHEMA_VERSION, type RiskSnapshotRecord } from "./schema";
import type { PublicRiskSnapshot } from "./schema";

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

type SnapshotAdapterGlobal = typeof globalThis & {
  __cryptaraSnapshotAdapter?: Promise<IStorageAdapter>;
};

const adapterGlobal = globalThis as SnapshotAdapterGlobal;

export type SnapshotReadResult =
  | { ok: true; snapshot: PublicRiskSnapshot }
  | RiskSnapshotIntegrityFailure
  | { ok: false; code: "not_found"; detail: string };

export async function getSnapshotStorageAdapter(): Promise<IStorageAdapter> {
  adapterGlobal.__cryptaraSnapshotAdapter ??= (async () => {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { SupabaseStorageAdapter } = await import("@/server/storage/adapters/supabase");
      return wrapStorageAdapter(new SupabaseStorageAdapter());
    }
    return wrapStorageAdapter(new MemoryStorageAdapter());
  })();
  return adapterGlobal.__cryptaraSnapshotAdapter;
}

function boundedTtl(value?: number): number {
  if (value === undefined) return DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(value)) throw new TypeError("Snapshot TTL must be finite.");
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, Math.round(value)));
}

export async function createRiskSnapshot(
  source: TokenScanResult,
  options: { ttlSeconds?: number; productVersion?: string; now?: number } = {},
  adapter?: IStorageAdapter,
) {
  const now = options.now ?? Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + boundedTtl(options.ttlSeconds) * 1_000).toISOString();
  const document = redactRiskReportSnapshot(source, {
    expiresAt,
    productVersion: options.productVersion ?? process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0",
  });
  const revocationToken = randomBytes(32).toString("base64url");
  const record: RiskSnapshotRecord = {
    id: `snapshot_${randomUUID()}`,
    schemaVersion: RISK_SNAPSHOT_SCHEMA_VERSION,
    snapshot: document,
    canonicalHash: hashRiskSnapshot(document),
    identityKey: canonicalAssetIdentity(document.asset),
    revocationTokenHash: hashRevocationToken(revocationToken),
    createdAt,
    expiresAt,
  };
  const storage = adapter ?? await getSnapshotStorageAdapter();
  await storage.createRiskSnapshot(record);
  return {
    id: record.id,
    hash: record.canonicalHash,
    schemaVersion: record.schemaVersion,
    createdAt,
    expiresAt,
    revocationToken,
  };
}

export async function readRiskSnapshot(id: string, adapter?: IStorageAdapter): Promise<SnapshotReadResult> {
  const storage = adapter ?? await getSnapshotStorageAdapter();
  const record = await storage.getRiskSnapshot(id);
  if (!record) return { ok: false, code: "not_found", detail: "Risk snapshot was not found." };
  return verifyRiskSnapshotRecord(record);
}

export async function revokeRiskSnapshot(
  id: string,
  token: string,
  adapter?: IStorageAdapter,
): Promise<{ ok: true; revokedAt: string } | { ok: false; code: "not_found" | "invalid_token"; detail: string }> {
  const storage = adapter ?? await getSnapshotStorageAdapter();
  const record = await storage.getRiskSnapshot(id);
  if (!record) return { ok: false, code: "not_found", detail: "Risk snapshot was not found." };
  if (!verifyRevocationToken(record, token)) {
    return { ok: false, code: "invalid_token", detail: "Revocation credentials are invalid." };
  }
  const revokedAt = record.revokedAt ?? new Date().toISOString();
  await storage.revokeRiskSnapshot(id, revokedAt);
  return { ok: true, revokedAt };
}
