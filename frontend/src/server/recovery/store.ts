import type {
  RecoveryList,
  RecoveryRequest,
  RecoveryStatus,
  RecoveryType,
} from "@/server/types";
import { applyStaleIfExpired, getIncidentMode, getPolicyVersion } from "@/server/recovery/policy";

/**
 * In-memory recovery adapter. The store is intentionally minimal to mirror
 * the structure of src/server/storage/index.ts so a future Supabase adapter
 * can map the same API.
 */

declare global {
  var __cryptaraRecoveryRequests: RecoveryRequest[] | undefined;
}

type CreateRecoveryRequestInput = Omit<RecoveryRequest, "id" | "requestedAt" | "updatedAt" | "policyVersion"> & {
  policyVersion?: string;
  updatedAt?: string;
  requestedAt?: string;
  confirmedAt?: string;
  staleAt?: string;
  txHash?: string;
};

type PatchRecoveryRequest = Partial<Omit<RecoveryRequest, "id" | "requestedAt" | "policyVersion" | "appliedDuringIncident">> & {
  status?: RecoveryStatus;
  appliedDuringIncident?: boolean;
};

function getAllRecoveryRequestsInternal(): RecoveryRequest[] {
  globalThis.__cryptaraRecoveryRequests ??= [];

  return globalThis.__cryptaraRecoveryRequests;
}

function createRecordId() {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePolicyVersion(provided?: string) {
  return provided ?? getPolicyVersion();
}

export function listRecoveryRequests(walletAddress?: string): RecoveryRequest[] {
  const normalized = walletAddress?.toLowerCase();

  return getAllRecoveryRequestsInternal()
    .map((record) => applyStaleIfExpired(record))
    .filter((record) => !normalized || record.walletAddress.toLowerCase() === normalized)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export function getRecoveryRequest(id: string) {
  const record = getAllRecoveryRequestsInternal().find((candidate) => candidate.id === id);

  return record ? applyStaleIfExpired(record) : undefined;
}

export function findActiveRecovery(walletAddress: string, recoveryType: RecoveryType, asset?: string, consumer?: string) {
  const normalizedWallet = walletAddress.toLowerCase();

  return getAllRecoveryRequestsInternal()
    .map((record) => applyStaleIfExpired(record))
    .find((record) => {
      if (record.walletAddress.toLowerCase() !== normalizedWallet) return false;
      if (record.recoveryType !== recoveryType) return false;
      if ((record.status === "confirmed" || record.status === "failed" || record.status === "stale")) return false;
      if (asset && record.asset !== asset) return false;
      if (consumer && record.consumer !== consumer) return false;

      return true;
    });
}

export function createRecoveryRequest(input: CreateRecoveryRequestInput): RecoveryRequest {
  // Block duplicates: per (wallet, recoveryType, asset) only one active record.
  const existing = findActiveRecovery(input.walletAddress, input.recoveryType, input.asset, input.consumer);

  if (existing && ["requested", "prepared", "submitted"].includes(existing.status)) {
    return existing;
  }

  const now = new Date().toISOString();
  const createdAt = input.updatedAt ?? now;
  const record: RecoveryRequest = {
    ...input,
    id: createRecordId(),
    policyVersion: ensurePolicyVersion(input.policyVersion),
    requestedAt: input.requestedAt ?? createdAt,
    updatedAt: createdAt,
  };

  getAllRecoveryRequestsInternal().unshift(record);

  return record;
}

export function patchRecoveryRequest(id: string, patch: PatchRecoveryRequest): RecoveryRequest | undefined {
  const records = getAllRecoveryRequestsInternal();
  const existingIndex = records.findIndex((record) => record.id === id);

  if (existingIndex < 0) {
    return undefined;
  }

  const updatedAt = new Date().toISOString();
  const next: RecoveryRequest = {
    ...records[existingIndex],
    ...patch,
    updatedAt,
  };

  records[existingIndex] = next;

  return next;
}

export function markRecoverySubmitted(id: string, txHash?: string) {
  return patchRecoveryRequest(id, {
    status: "submitted",
    submittedAt: new Date().toISOString(),
    txHash,
  });
}

export function markRecoveryConfirmed(id: string, txHash: string) {
  return patchRecoveryRequest(id, {
    status: "confirmed",
    confirmedAt: new Date().toISOString(),
    txHash,
  });
}

export function markRecoveryFailed(id: string, error: string) {
  return patchRecoveryRequest(id, {
    status: "failed",
    error,
  });
}

export function listRecoveryByStatus(status: RecoveryStatus, walletAddress?: string) {
  return listRecoveryRequests(walletAddress).filter((record) => record.status === status);
}

export function getRecoveryList(walletAddress?: string): RecoveryList {
  const records = listRecoveryRequests(walletAddress);
  const stale = records.filter((record) => record.status === "stale");
  const ledger = records.find((record) => typeof record.lastVerifiedLedger === "number")?.lastVerifiedLedger;
  const block = records.find((record) => typeof record.lastVerifiedBlockNumber === "number")?.lastVerifiedBlockNumber;

  return {
    requests: records,
    incidentMode: getIncidentMode(),
    policyVersion: getPolicyVersion(),
    lastVerifiedLedger: ledger,
    lastVerifiedBlockNumber: block,
    staleCount: stale.length,
  };
}

export function getRecoveryCounts() {
  const records = getAllRecoveryRequestsInternal().map((record) => applyStaleIfExpired(record));

  return {
    total: records.length,
    requested: records.filter((record) => record.status === "requested").length,
    prepared: records.filter((record) => record.status === "prepared").length,
    submitted: records.filter((record) => record.status === "submitted").length,
    confirmed: records.filter((record) => record.status === "confirmed").length,
    failed: records.filter((record) => record.status === "failed").length,
    stale: records.filter((record) => record.status === "stale").length,
  };
}

export function resetRecoveryStoreForTests() {
  globalThis.__cryptaraRecoveryRequests = [];
}
