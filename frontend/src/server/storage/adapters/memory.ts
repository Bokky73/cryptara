import type {
  AgentRunRecord,
  AlertDelivery,
  NotificationPreferences,
  RecommendationRecord,
  TransactionRecord,
  TransactionObservation,
  UserApprovalRecord,
  UserRule,
  X402PaymentReceipt,
  StorageHealth,
  WatchlistEntry,
  StorageCounts,
} from "@/server/types";
import { storageSchemaContract } from "@/server/storage/contract";
import type { IStorageAdapter, AgentRunInsert, HealthProbeResult, StoredErasureReceipt, ErasureAdapterResult, ResidueAdapterResult } from "./types";
import type { RiskSnapshotRecord } from "@/server/snapshots/schema";
import { alertDeliveryToRow, rowToAlertDelivery } from "./types";
import { wrapStorageAdapter } from "@/server/observability/tracing/spans";

const memoryStore = globalThis as typeof globalThis & {
  __cryptaraAgentRuns?: AgentRunRecord[];
  __cryptaraRecommendations?: RecommendationRecord[];
  __cryptaraTransactions?: TransactionRecord[];
  __cryptaraTransactionObservations?: TransactionObservation[];
  __cryptaraApprovals?: UserApprovalRecord[];
  __cryptaraUserRules?: UserRule[];
  __cryptaraX402PaymentReceipts?: X402PaymentReceipt[];
  __cryptaraWatchlistEntries?: WatchlistEntry[];
  __cryptaraRiskSnapshots?: RiskSnapshotRecord[];
  __cryptaraAdapterAlertDeliveries?: AlertDelivery[];
  __cryptaraAdapterNotificationPreferences?: NotificationPreferences[];
  __cryptaraErasureReceipts?: StoredErasureReceipt[];
};

function getAgentRuns(): AgentRunRecord[] {
  memoryStore.__cryptaraAgentRuns ??= [];
  return memoryStore.__cryptaraAgentRuns;
}
function getRecommendations(): RecommendationRecord[] {
  memoryStore.__cryptaraRecommendations ??= [];
  return memoryStore.__cryptaraRecommendations;
}
function getTransactions(): TransactionRecord[] {
  memoryStore.__cryptaraTransactions ??= [];
  return memoryStore.__cryptaraTransactions;
}
function getTransactionObservations(): TransactionObservation[] {
  memoryStore.__cryptaraTransactionObservations ??= [];
  return memoryStore.__cryptaraTransactionObservations;
}
function getApprovals(): UserApprovalRecord[] {
  memoryStore.__cryptaraApprovals ??= [];
  return memoryStore.__cryptaraApprovals;
}
function getUserRules(): UserRule[] {
  memoryStore.__cryptaraUserRules ??= [];
  return memoryStore.__cryptaraUserRules;
}
function getX402PaymentReceipts(): X402PaymentReceipt[] {
  memoryStore.__cryptaraX402PaymentReceipts ??= [];
  return memoryStore.__cryptaraX402PaymentReceipts;
}
function getRiskSnapshots(): RiskSnapshotRecord[] {
  memoryStore.__cryptaraRiskSnapshots ??= [];
  return memoryStore.__cryptaraRiskSnapshots;
}

function getAlertDeliveries(): AlertDelivery[] {
  memoryStore.__cryptaraAdapterAlertDeliveries ??= [];
  return memoryStore.__cryptaraAdapterAlertDeliveries;
}

function getNotificationPreferences(): NotificationPreferences[] {
  memoryStore.__cryptaraAdapterNotificationPreferences ??= [];
  return memoryStore.__cryptaraAdapterNotificationPreferences;
}

function normalizedWallet(walletAddress?: string): string | undefined {
  return walletAddress?.toLowerCase();
}

function sortDescCreated<T extends { createdAt: string }>(items: T[]): T[] {
  return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export class MemoryStorageAdapter implements IStorageAdapter {
  readonly provider = "memory" as const;
  readonly persistent = false;

  // ─── Agent runs ──────────────────────────────────────────────────

  async listAgentRunRecords(walletAddress?: string): Promise<AgentRunRecord[]> {
    const nw = normalizedWallet(walletAddress);
    return sortDescCreated(
      getAgentRuns().filter((r) => !nw || r.walletAddress.toLowerCase() === nw),
    );
  }

  async getAgentRunRecord(id: string): Promise<AgentRunRecord | null> {
    return getAgentRuns().find((r) => r.id === id) ?? null;
  }

  async createAgentRunRecord(record: AgentRunInsert): Promise<AgentRunRecord> {
    const full: AgentRunRecord = {
      ...record,
      mode: record.mode ?? undefined,
      targetToken: record.targetToken ?? undefined,
      sourceStatuses: record.sourceStatuses ?? [],
      userAction: record.userAction ?? "pending",
    };
    getAgentRuns().unshift(full);
    return full;
  }

  // ─── Recommendations ─────────────────────────────────────────────

  async listRecommendationRecords(walletAddress?: string): Promise<RecommendationRecord[]> {
    const nw = normalizedWallet(walletAddress);
    return sortDescCreated(
      getRecommendations().filter((r) => !nw || r.walletAddress.toLowerCase() === nw),
    );
  }

  async createRecommendationRecord(record: RecommendationRecord): Promise<RecommendationRecord> {
    getRecommendations().unshift(record);
    return record;
  }

  // ─── Transactions ────────────────────────────────────────────────

  async listTransactionRecords(walletAddress?: string): Promise<TransactionRecord[]> {
    const nw = normalizedWallet(walletAddress);
    return sortDescCreated(
      getTransactions().filter((r) => !nw || (r.walletAddress ?? "").toLowerCase() === nw),
    );
  }

  async getTransactionRecord(hash: string): Promise<TransactionRecord | null> {
    return getTransactions().find((r) => r.hash.toLowerCase() === hash.toLowerCase()) ?? null;
  }

  async createTransactionRecord(record: TransactionRecord): Promise<TransactionRecord> {
    const existingIdx = getTransactions().findIndex(
      (r) => r.hash.toLowerCase() === record.hash.toLowerCase(),
    );
    if (existingIdx >= 0) {
      getTransactions()[existingIdx] = record;
    } else {
      getTransactions().unshift(record);
    }
    return record;
  }

  async listTransactionObservations(hash: string): Promise<TransactionObservation[]> {
    return getTransactionObservations()
      .filter((item) => item.hash.toLowerCase() === hash.toLowerCase())
      .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime());
  }

  async createTransactionObservation(observation: TransactionObservation): Promise<TransactionObservation> {
    const existing = getTransactionObservations().find((item) => item.evidenceKey === observation.evidenceKey);
    if (existing) return existing;
    getTransactionObservations().unshift(observation);
    return observation;
  }

  // ─── Approvals ───────────────────────────────────────────────────

  async listApprovalRecords(walletAddress?: string): Promise<UserApprovalRecord[]> {
    const nw = normalizedWallet(walletAddress);
    return sortDescCreated(
      getApprovals().filter((r) => !nw || r.walletAddress.toLowerCase() === nw),
    );
  }

  async createApprovalRecord(record: UserApprovalRecord): Promise<UserApprovalRecord> {
    getApprovals().unshift(record);
    return record;
  }

  // ─── User rules ──────────────────────────────────────────────────

  async getUserRuleRecord(walletAddress: string): Promise<UserRule | null> {
    const r = getUserRules().find(
      (rule) => rule.walletAddress.toLowerCase() === walletAddress.toLowerCase(),
    );
    return r ?? null;
  }

  async upsertUserRuleRecord(rule: UserRule): Promise<UserRule> {
    const existingIdx = getUserRules().findIndex(
      (r) => r.walletAddress.toLowerCase() === rule.walletAddress.toLowerCase(),
    );
    if (existingIdx >= 0) {
      getUserRules()[existingIdx] = rule;
    } else {
      getUserRules().unshift(rule);
    }
    return rule;
  }

  // ─── x402 receipts ───────────────────────────────────────────────

  async listX402PaymentReceipts(): Promise<X402PaymentReceipt[]> {
    return sortDescCreated(getX402PaymentReceipts());
  }

  async getX402PaymentReceiptByHeaderHash(paymentHeaderHash: string): Promise<X402PaymentReceipt | null> {
    return getX402PaymentReceipts().find((r) => r.paymentHeaderHash === paymentHeaderHash) ?? null;
  }

  async createX402PaymentReceipt(record: X402PaymentReceipt): Promise<X402PaymentReceipt> {
    getX402PaymentReceipts().unshift(record);
    return record;
  }

  // ─── Public risk snapshots ──────────────────────────────────────

  async getRiskSnapshot(id: string): Promise<RiskSnapshotRecord | null> {
    const record = getRiskSnapshots().find((item) => item.id === id);
    return record ? structuredClone(record) : null;
  }

  async createRiskSnapshot(record: RiskSnapshotRecord): Promise<RiskSnapshotRecord> {
    if (getRiskSnapshots().some((item) => item.id === record.id)) {
      throw new Error("Risk snapshot id already exists.");
    }
    const stored = structuredClone(record);
    getRiskSnapshots().push(stored);
    return structuredClone(stored);
  }

  async revokeRiskSnapshot(id: string, revokedAt: string): Promise<RiskSnapshotRecord | null> {
    const record = getRiskSnapshots().find((item) => item.id === id);
    if (!record) return null;
    record.revokedAt ??= revokedAt;
    return structuredClone(record);
  }

  // ─── Alert deliveries ────────────────────────────────────────────

  async listAlertDeliveries(alertId?: string, walletAddress?: string): Promise<AlertDelivery[]> {
    const nw = normalizedWallet(walletAddress);
    return sortDescCreated(
      getAlertDeliveries().filter(
        (delivery) =>
          (!alertId || delivery.alertId === alertId) &&
          (!nw || delivery.walletAddress.toLowerCase() === nw),
      ),
    );
  }

  async getAlertDeliveryByIdempotencyKey(
    walletAddress: string,
    idempotencyKey: string,
  ): Promise<AlertDelivery | null> {
    const nw = walletAddress.toLowerCase();
    return (
      getAlertDeliveries().find(
        (delivery) =>
          delivery.walletAddress.toLowerCase() === nw && delivery.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async createAlertDelivery(record: AlertDelivery): Promise<AlertDelivery> {
    // Round-trip through the SQL row mapper so adapter consumers share the
    // same column contract as schema.sql / Supabase.
    const normalized = rowToAlertDelivery(alertDeliveryToRow(record));
    if (normalized.idempotencyKey) {
      const existing = await this.getAlertDeliveryByIdempotencyKey(
        normalized.walletAddress,
        normalized.idempotencyKey,
      );
      if (existing) return existing;
    }
    getAlertDeliveries().unshift(normalized);
    return normalized;
  }

  async updateAlertDelivery(
    id: string,
    walletAddress: string,
    patch: Partial<AlertDelivery>,
  ): Promise<AlertDelivery | null> {
    const nw = walletAddress.toLowerCase();
    const store = getAlertDeliveries();
    const index = store.findIndex(
      (delivery) => delivery.id === id && delivery.walletAddress.toLowerCase() === nw,
    );
    if (index < 0) return null;
    store[index] = rowToAlertDelivery(alertDeliveryToRow({ ...store[index], ...patch }));
    return store[index];
  }

  // ─── Notification preferences ──────────────────────────────────

  async getNotificationPreferences(scope: {
    walletAddress: string;
    chainFamily: "evm" | "stellar";
    network: string;
  }): Promise<NotificationPreferences | null> {
    const nw = scope.walletAddress.toLowerCase();
    const network = scope.network || "legacy-evm";
    return (
      getNotificationPreferences().find(
        (pref) =>
          pref.walletAddress.toLowerCase() === nw &&
          pref.chainFamily === scope.chainFamily &&
          pref.network === network,
      ) ?? null
    );
  }

  async upsertNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences> {
    const nw = prefs.walletAddress.toLowerCase();
    const network = prefs.network || "legacy-evm";
    const store = getNotificationPreferences();
    const existingIndex = store.findIndex(
      (existing) =>
        existing.walletAddress.toLowerCase() === nw &&
        existing.chainFamily === prefs.chainFamily &&
        existing.network === network,
    );

    const record: NotificationPreferences = {
      ...prefs,
      id:
        existingIndex >= 0
          ? store[existingIndex].id
          : `nfpref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      walletAddress: nw,
      network,
      updatedAt: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      store[existingIndex] = record;
    } else {
      store.unshift(record);
    }

    return record;
  }

  // ─── Health & counts ─────────────────────────────────────────────

  async getStorageHealth(): Promise<StorageHealth> {
    return {
      provider: "memory",
      persistent: false,
      detail: "Using in-memory MVP storage. Records reset when the server process restarts.",
      schema: storageSchemaContract,
    };
  }

  async getStorageCounts(): Promise<StorageCounts> {
    return {
      agentRuns: getAgentRuns().length,
      recommendations: getRecommendations().length,
      transactions: getTransactions().length,
      approvals: getApprovals().length,
      userRules: getUserRules().length,
      x402PaymentReceipts: getX402PaymentReceipts().length,
      alertRules: 0,
      alertObservations: 0,
      alerts: 0,
      alertDeliveries: 0,
      notificationPreferences: 0,
    };
  }

  
  async addWatchlistEntriesBulk(entries: WatchlistEntry[]): Promise<{ added: WatchlistEntry[] }> {
    memoryStore.__cryptaraWatchlistEntries ??= [];
    const store = memoryStore.__cryptaraWatchlistEntries;
    const added: WatchlistEntry[] = [];
    for (const entry of entries) {
      const existing = store.find(e => e.walletAddress === entry.walletAddress && e.identityKey === entry.identityKey);
      if (!existing) {
        store.unshift(entry);
        added.push(entry);
      }
    }
    return { added };
  }

  async performHealthProbe(): Promise<HealthProbeResult> {
    // Memory adapter: write a probe record, read it back, clean it up
    const probeId = `probe_${Date.now()}`;
    const probe: AgentRunInsert = {
      id: probeId,
      walletAddress: "probe",
      mode: null,
      targetToken: null,
      status: "completed",
      recommendation: "no_action",
      decisionScore: 0,
      confidence: 0,
      summary: "health probe",
      results: [],
      sourceStatuses: [],
      inputSnapshot: {},
      userAction: "pending",
      createdAt: new Date().toISOString(),
    };

    const writeStart = Date.now();
    await this.createAgentRunRecord(probe);
    const writeLatency = Date.now() - writeStart;

    const readStart = Date.now();
    const readBack = await this.getAgentRunRecord(probeId);
    const readLatency = Date.now() - readStart;

    // Clean up
    const idx = getAgentRuns().findIndex((r) => r.id === probeId);
    if (idx >= 0) getAgentRuns().splice(idx, 1);

    if (readBack && readBack.id === probeId) {
      return {
        ok: true,
        write: { ok: true, latencyMs: writeLatency },
        read: { ok: true, latencyMs: readLatency },
        clean: { ok: true },
        detail: `Memory probe: wrote and read probe record in ${writeLatency + readLatency}ms.`,
      };
    }
    return {
      ok: false,
      detail: "Memory probe failed: probe record was not readable after write.",
    };
  }

  // ─── Retention / Erasure ──────────────────────────────────────────────

  async eraseWalletData(
    walletAddress: string,
    chainFamily: "evm" | "stellar",
    network?: string,
  ): Promise<ErasureAdapterResult> {
    const { eraseWalletDataFromMemory } = await import("@/server/privacy/retention/erase");
    const result = eraseWalletDataFromMemory({ walletAddress, chainFamily, network });
    return { tables: result.tables };
  }

  async residueCheck(
    walletAddress: string,
    chainFamily: "evm" | "stellar",
    network?: string,
  ): Promise<ResidueAdapterResult> {
    const { checkErasureResidue } = await import("@/server/privacy/retention/residue");
    const result = checkErasureResidue(walletAddress, chainFamily, network);
    return { leaks: result.leaks };
  }

  async storeErasureReceipt(receipt: StoredErasureReceipt): Promise<StoredErasureReceipt> {
    memoryStore.__cryptaraErasureReceipts ??= [];
    const existing = memoryStore.__cryptaraErasureReceipts.find(
      (r) => r.receiptId === receipt.receiptId,
    );
    if (existing) return existing;
    memoryStore.__cryptaraErasureReceipts.unshift(receipt);
    return receipt;
  }

  async getErasureReceipt(receiptId: string): Promise<StoredErasureReceipt | null> {
    memoryStore.__cryptaraErasureReceipts ??= [];
    return memoryStore.__cryptaraErasureReceipts.find((r) => r.receiptId === receiptId) ?? null;
  }
}

export function createTracedMemoryStorageAdapter() {
  return wrapStorageAdapter(new MemoryStorageAdapter());
}
