import type {
  AgentRunRecord,
  Alert,
  AlertDelivery,
  AlertObservation,
  AlertRule,
  DiscoveryAlert,
  NotificationPreferences,
  RecommendationRecord,
  TransactionLifecycleEvent,
  TransactionRecord,
  TransactionObservation,
  UserApprovalRecord,
  UserRule,
  X402PaymentReceipt,
  StorageHealth,
  WatchlistEntry,
  WatchlistScanRun,
  StorageCounts,
} from "@/server/types";
import { storageSchemaContract } from "@/server/storage/contract";
import type {
  IStorageAdapter,
  AgentRunInsert,
  AlertBundle,
  DiscoveryAlertInsert,
  HealthProbeResult,
  StoredErasureReceipt,
  ErasureAdapterResult,
  ResidueAdapterResult,
  WalletDeleteResult,
  WalletExportData,
  WatchlistScanRunInsert,
} from "./types";
import type { RiskSnapshotRecord } from "@/server/snapshots/schema";
import { alertDeliveryToRow, rowToAlertDelivery } from "./types";
import { wrapStorageAdapter } from "@/server/observability/tracing/spans";

type CryptaraMemoryGlobal = typeof globalThis & {
  __cryptaraAgentRuns?: AgentRunRecord[];
  __cryptaraRecommendations?: RecommendationRecord[];
  __cryptaraTransactions?: TransactionRecord[];
  __cryptaraTransactionEvents?: TransactionLifecycleEvent[];
  __cryptaraTransactionObservations?: TransactionObservation[];
  __cryptaraApprovals?: UserApprovalRecord[];
  __cryptaraUserRules?: UserRule[];
  __cryptaraX402PaymentReceipts?: X402PaymentReceipt[];
  __cryptaraWatchlistEntries?: WatchlistEntry[];
  __cryptaraWatchlistScanRuns?: WatchlistScanRun[];
  __cryptaraDiscoveryAlerts?: DiscoveryAlert[];
  __cryptaraAlertRules?: AlertRule[];
  __cryptaraAlertObservations?: AlertObservation[];
  __cryptaraAlerts?: Alert[];
  __cryptaraAlertDeliveries?: AlertDelivery[];
  __cryptaraNotificationPreferences?: NotificationPreferences[];
  __cryptaraRiskSnapshots?: RiskSnapshotRecord[];
  __cryptaraErasureReceipts?: StoredErasureReceipt[];
};

const memoryStore = globalThis as CryptaraMemoryGlobal;

function store<K extends keyof CryptaraMemoryGlobal>(key: K): NonNullable<CryptaraMemoryGlobal[K]> {
  const current = memoryStore[key];
  if (Array.isArray(current)) return current as NonNullable<CryptaraMemoryGlobal[K]>;
  const created: unknown[] = [];
  (memoryStore as Record<string, unknown>)[key as string] = created;
  return created as NonNullable<CryptaraMemoryGlobal[K]>;
}

function normalizedWallet(walletAddress?: string | null): string {
  return (walletAddress ?? "").trim().toLowerCase();
}

function sortDesc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function sortDescBy<T>(items: T[], at: (item: T) => string): T[] {
  return [...items].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)));
}

function sameWallet(left: string | undefined | null, right: string | undefined | null): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export class MemoryStorageAdapter implements IStorageAdapter {
  readonly provider = "memory" as const;
  readonly persistent = false;

  async listAgentRunRecords(walletAddress?: string): Promise<AgentRunRecord[]> {
    const wallet = normalizedWallet(walletAddress);
    return sortDesc(store("__cryptaraAgentRuns").filter((record) => !wallet || sameWallet(record.walletAddress, wallet)));
  }

  async getAgentRunRecord(id: string): Promise<AgentRunRecord | null> {
    return store("__cryptaraAgentRuns").find((record) => record.id === id) ?? null;
  }

  async createAgentRunRecord(record: AgentRunInsert): Promise<AgentRunRecord> {
    const full: AgentRunRecord = {
      ...record,
      mode: record.mode ?? undefined,
      targetToken: record.targetToken ?? undefined,
      sourceStatuses: record.sourceStatuses ?? [],
      userAction: record.userAction ?? "pending",
    };
    store("__cryptaraAgentRuns").unshift(full);
    return full;
  }

  async listRecommendationRecords(walletAddress?: string): Promise<RecommendationRecord[]> {
    const wallet = normalizedWallet(walletAddress);
    return sortDesc(store("__cryptaraRecommendations").filter((record) => !wallet || sameWallet(record.walletAddress, wallet)));
  }

  async createRecommendationRecord(record: RecommendationRecord): Promise<RecommendationRecord> {
    store("__cryptaraRecommendations").unshift(record);
    return record;
  }

  async listTransactionRecords(walletAddress?: string): Promise<TransactionRecord[]> {
    const wallet = normalizedWallet(walletAddress);
    return sortDesc(store("__cryptaraTransactions").filter((record) => !wallet || sameWallet(record.walletAddress, wallet)));
  }

  async getTransactionRecord(hash: string): Promise<TransactionRecord | null> {
    return store("__cryptaraTransactions").find((record) => sameWallet(record.hash, hash)) ?? null;
  }

  async getTransactionRecordForFamily(hash: string, family: "evm" | "stellar"): Promise<TransactionRecord | null> {
    const normalized = family === "stellar" ? hash.trim().toUpperCase() : hash.trim().toLowerCase();
    return (
      store("__cryptaraTransactions").find((record) => {
        const candidate = record.chainFamily === "stellar" ? record.hash.trim().toUpperCase() : record.hash.trim().toLowerCase();
        return candidate === normalized;
      }) ?? null
    );
  }

  async getTransactionRecordByIdempotencyKey(walletAddress: string, idempotencyKey: string): Promise<TransactionRecord | null> {
    if (!idempotencyKey) return null;
    return (
      store("__cryptaraTransactions").find(
        (record) => record.idempotencyKey === idempotencyKey && sameWallet(record.walletAddress, walletAddress),
      ) ?? null
    );
  }

  async createTransactionRecord(record: TransactionRecord): Promise<TransactionRecord> {
    const existing = await this.getTransactionRecord(record.hash);
    if (existing) return existing;
    store("__cryptaraTransactions").unshift(record);
    return record;
  }

  async updateTransactionRecord(hash: string, patch: Partial<TransactionRecord>): Promise<TransactionRecord | null> {
    const index = store("__cryptaraTransactions").findIndex((record) => sameWallet(record.hash, hash));
    if (index < 0) return null;
    const records = store("__cryptaraTransactions");
    records[index] = { ...records[index], ...patch, hash: records[index].hash, createdAt: records[index].createdAt };
    return records[index];
  }

  async removeTransactionRecordByHash(hash: string): Promise<boolean> {
    const records = store("__cryptaraTransactions");
    const index = records.findIndex((record) => sameWallet(record.hash, hash));
    if (index < 0) return false;
    records.splice(index, 1);
    return true;
  }

  async listTransactionLifecycleEvents(hash: string): Promise<TransactionLifecycleEvent[]> {
    return sortDescBy(
      store("__cryptaraTransactionEvents").filter((event) => sameWallet(event.hash, hash)),
      (event) => event.occurredAt,
    );
  }

  async createTransactionLifecycleEvent(event: TransactionLifecycleEvent): Promise<TransactionLifecycleEvent> {
    store("__cryptaraTransactionEvents").unshift(event);
    return event;
  }

  async listTransactionObservations(hash: string): Promise<TransactionObservation[]> {
    return sortDescBy(
      store("__cryptaraTransactionObservations").filter((observation) => sameWallet(observation.hash, hash)),
      (observation) => observation.observedAt,
    );
  }

  async createTransactionObservation(observation: TransactionObservation): Promise<TransactionObservation> {
    const existing = store("__cryptaraTransactionObservations").find(
      (item) => sameWallet(item.hash, observation.hash) && item.evidenceKey === observation.evidenceKey,
    );
    if (existing) return existing;
    store("__cryptaraTransactionObservations").unshift(observation);
    return observation;
  }

  async listApprovalRecords(walletAddress?: string): Promise<UserApprovalRecord[]> {
    const wallet = normalizedWallet(walletAddress);
    return sortDesc(store("__cryptaraApprovals").filter((record) => !wallet || sameWallet(record.walletAddress, wallet)));
  }

  async createApprovalRecord(record: UserApprovalRecord): Promise<UserApprovalRecord> {
    store("__cryptaraApprovals").unshift(record);
    return record;
  }

  async getUserRuleRecord(walletAddress: string): Promise<UserRule | null> {
    return store("__cryptaraUserRules").find((rule) => sameWallet(rule.walletAddress, walletAddress)) ?? null;
  }

  async upsertUserRuleRecord(rule: UserRule): Promise<UserRule> {
    const rules = store("__cryptaraUserRules");
    const index = rules.findIndex((item) => sameWallet(item.walletAddress, rule.walletAddress));
    if (index >= 0) rules[index] = rule;
    else rules.unshift(rule);
    return rule;
  }

  async listX402PaymentReceipts(): Promise<X402PaymentReceipt[]> {
    return sortDesc(store("__cryptaraX402PaymentReceipts"));
  }

  async getX402PaymentReceiptByHeaderHash(paymentHeaderHash: string): Promise<X402PaymentReceipt | null> {
    return store("__cryptaraX402PaymentReceipts").find((record) => record.paymentHeaderHash === paymentHeaderHash) ?? null;
  }

  async getX402PaymentReceiptByTxHash(transactionHash: string): Promise<X402PaymentReceipt | null> {
    return store("__cryptaraX402PaymentReceipts").find((record) => record.transactionHash === transactionHash) ?? null;
  }

  async createX402PaymentReceipt(record: X402PaymentReceipt): Promise<X402PaymentReceipt> {
    const existing = await this.getX402PaymentReceiptByHeaderHash(record.paymentHeaderHash);
    if (existing) return { ...existing, verificationStatus: "duplicate", updatedAt: new Date().toISOString() };
    store("__cryptaraX402PaymentReceipts").unshift(record);
    return record;
  }

  async listRiskSnapshots(identityKey?: string): Promise<RiskSnapshotRecord[]> {
    return store("__cryptaraRiskSnapshots")
      .filter((record) => !identityKey || record.identityKey === identityKey)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((record) => structuredClone(record));
  }

  async getRiskSnapshot(id: string): Promise<RiskSnapshotRecord | null> {
    const record = store("__cryptaraRiskSnapshots").find((item) => item.id === id);
    return record ? structuredClone(record) : null;
  }

  async createRiskSnapshot(record: RiskSnapshotRecord): Promise<RiskSnapshotRecord> {
    if (store("__cryptaraRiskSnapshots").some((item) => item.id === record.id)) {
      throw new Error("Risk snapshot id already exists.");
    }
    const stored = structuredClone(record);
    store("__cryptaraRiskSnapshots").push(stored);
    return structuredClone(stored);
  }

  async revokeRiskSnapshot(id: string, revokedAt: string): Promise<RiskSnapshotRecord | null> {
    const record = store("__cryptaraRiskSnapshots").find((item) => item.id === id);
    if (!record) return null;
    record.revokedAt ??= revokedAt;
    return structuredClone(record);
  }

  async listAlertRules(walletAddress?: string): Promise<AlertRule[]> {
    const wallet = normalizedWallet(walletAddress);
    return sortDesc(store("__cryptaraAlertRules").filter((rule) => !wallet || sameWallet(rule.walletAddress, wallet)));
  }

  async getAlertRule(id: string): Promise<AlertRule | null> {
    return store("__cryptaraAlertRules").find((rule) => rule.id === id) ?? null;
  }

  async upsertAlertRule(rule: AlertRule): Promise<AlertRule> {
    const rules = store("__cryptaraAlertRules");
    const index = rules.findIndex((item) => item.id === rule.id && sameWallet(item.walletAddress, rule.walletAddress));
    if (index >= 0) rules[index] = rule;
    else rules.unshift(rule);
    return rule;
  }

  async deleteAlertRule(id: string, walletAddress?: string): Promise<boolean> {
    const rules = store("__cryptaraAlertRules");
    const wallet = normalizedWallet(walletAddress);
    const index = rules.findIndex((rule) => rule.id === id && (!wallet || sameWallet(rule.walletAddress, wallet)));
    if (index < 0) return false;
    rules.splice(index, 1);
    return true;
  }

  async ensureAlertRulesForWallet(walletAddress?: string): Promise<AlertRule[]> {
    const wallet = normalizedWallet(walletAddress);
    if (!wallet) return [];
    return this.listAlertRules(wallet);
  }

  async listAlertObservations(walletAddress?: string, limit = 200): Promise<AlertObservation[]> {
    const wallet = normalizedWallet(walletAddress);
    return sortDesc(store("__cryptaraAlertObservations").filter((item) => !wallet || sameWallet(item.walletAddress, wallet))).slice(0, limit);
  }

  async createAlertObservation(observation: AlertObservation): Promise<AlertObservation> {
    store("__cryptaraAlertObservations").unshift(observation);
    return observation;
  }

  async listAlerts(walletAddress?: string, status?: Alert["status"], limit = 200): Promise<Alert[]> {
    const wallet = normalizedWallet(walletAddress);
    return sortDescBy(
      store("__cryptaraAlerts").filter(
        (alert) => (!wallet || sameWallet(alert.walletAddress, wallet)) && (!status || alert.status === status),
      ),
      (alert) => alert.triggeredAt,
    ).slice(0, limit);
  }

  async getAlert(id: string, walletAddress?: string): Promise<Alert | null> {
    const alert = store("__cryptaraAlerts").find((item) => item.id === id) ?? null;
    if (!alert) return null;
    if (walletAddress && !sameWallet(alert.walletAddress, walletAddress)) return null;
    return alert;
  }

  async createAlert(alert: Alert): Promise<Alert> {
    store("__cryptaraAlerts").unshift(alert);
    return alert;
  }

  async updateAlert(id: string, walletAddress: string, patch: Partial<Alert>): Promise<Alert | null> {
    const alerts = store("__cryptaraAlerts");
    const index = alerts.findIndex((alert) => alert.id === id && sameWallet(alert.walletAddress, walletAddress));
    if (index < 0) return null;
    alerts[index] = { ...alerts[index], ...patch };
    return alerts[index];
  }

  async createAlertBundle(bundle: AlertBundle): Promise<AlertBundle> {
    await this.upsertAlertRule(bundle.rule);
    await this.createAlertObservation(bundle.observation);
    await this.createAlert(bundle.alert);
    for (const delivery of bundle.deliveries) await this.createAlertDelivery(delivery);
    return bundle;
  }

  async listAlertDeliveries(alertId?: string, walletAddress?: string): Promise<AlertDelivery[]> {
    const wallet = normalizedWallet(walletAddress);
    return sortDesc(
      store("__cryptaraAlertDeliveries").filter(
        (delivery) => (!alertId || delivery.alertId === alertId) && (!wallet || sameWallet(delivery.walletAddress, wallet)),
      ),
    );
  }

  async getAlertDeliveryByIdempotencyKey(walletAddress: string, idempotencyKey: string): Promise<AlertDelivery | null> {
    return (
      store("__cryptaraAlertDeliveries").find(
        (delivery) => sameWallet(delivery.walletAddress, walletAddress) && delivery.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }

  async createAlertDelivery(record: AlertDelivery): Promise<AlertDelivery> {
    const normalized = rowToAlertDelivery(alertDeliveryToRow(record));
    if (normalized.idempotencyKey) {
      const existing = await this.getAlertDeliveryByIdempotencyKey(normalized.walletAddress, normalized.idempotencyKey);
      if (existing) return existing;
    }
    store("__cryptaraAlertDeliveries").unshift(normalized);
    return normalized;
  }

  async updateAlertDelivery(id: string, walletAddress: string, patch: Partial<AlertDelivery>): Promise<AlertDelivery | null> {
    const deliveries = store("__cryptaraAlertDeliveries");
    const index = deliveries.findIndex((delivery) => delivery.id === id && sameWallet(delivery.walletAddress, walletAddress));
    if (index < 0) return null;
    deliveries[index] = rowToAlertDelivery(alertDeliveryToRow({ ...deliveries[index], ...patch }));
    return deliveries[index];
  }

  async getNotificationPreferences(scope: {
    walletAddress: string;
    chainFamily: "evm" | "stellar";
    network: string;
  }): Promise<NotificationPreferences | null> {
    const network = scope.network || "legacy-evm";
    return (
      store("__cryptaraNotificationPreferences").find(
        (pref) =>
          sameWallet(pref.walletAddress, scope.walletAddress) &&
          pref.chainFamily === scope.chainFamily &&
          pref.network === network,
      ) ?? null
    );
  }

  async listNotificationPreferences(walletAddress?: string): Promise<NotificationPreferences[]> {
    const wallet = normalizedWallet(walletAddress);
    return sortDescBy(
      store("__cryptaraNotificationPreferences").filter((pref) => !wallet || sameWallet(pref.walletAddress, wallet)),
      (pref) => pref.updatedAt,
    );
  }

  async upsertNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences> {
    const preferences = store("__cryptaraNotificationPreferences");
    const network = prefs.network || "legacy-evm";
    const index = preferences.findIndex(
      (pref) =>
        sameWallet(pref.walletAddress, prefs.walletAddress) &&
        pref.chainFamily === prefs.chainFamily &&
        pref.network === network,
    );
    const record: NotificationPreferences = {
      ...prefs,
      id: index >= 0 ? preferences[index].id : `nfpref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      walletAddress: normalizedWallet(prefs.walletAddress),
      network,
      updatedAt: new Date().toISOString(),
    };
    if (index >= 0) preferences[index] = record;
    else preferences.unshift(record);
    return record;
  }

  async deleteNotificationPreferences(id: string): Promise<boolean> {
    const preferences = store("__cryptaraNotificationPreferences");
    const index = preferences.findIndex((pref) => pref.id === id);
    if (index < 0) return false;
    preferences.splice(index, 1);
    return true;
  }

  async listWatchlistEntries(walletAddress?: string): Promise<WatchlistEntry[]> {
    const wallet = normalizedWallet(walletAddress);
    return sortDesc(store("__cryptaraWatchlistEntries").filter((entry) => !wallet || sameWallet(entry.walletAddress, wallet)));
  }

  async getWatchlistEntry(id: string): Promise<WatchlistEntry | null> {
    return store("__cryptaraWatchlistEntries").find((entry) => entry.id === id) ?? null;
  }

  async addWatchlistEntry(entry: WatchlistEntry): Promise<{ entry: WatchlistEntry; alreadyExisted: boolean }> {
    const existing = store("__cryptaraWatchlistEntries").find(
      (item) => sameWallet(item.walletAddress, entry.walletAddress) && item.identityKey === entry.identityKey,
    );
    if (existing) return { entry: existing, alreadyExisted: true };
    store("__cryptaraWatchlistEntries").unshift(entry);
    return { entry, alreadyExisted: false };
  }

  async addWatchlistEntriesBulk(entries: WatchlistEntry[]): Promise<{ added: WatchlistEntry[] }> {
    const added: WatchlistEntry[] = [];
    for (const entry of entries) {
      const result = await this.addWatchlistEntry(entry);
      if (!result.alreadyExisted) added.push(entry);
    }
    return { added };
  }

  async removeWatchlistEntry(id: string): Promise<boolean> {
    const entries = store("__cryptaraWatchlistEntries");
    const remaining = entries.filter((entry) => entry.id !== id);
    if (remaining.length === entries.length) return false;
    memoryStore.__cryptaraWatchlistEntries = remaining;
    memoryStore.__cryptaraWatchlistScanRuns = store("__cryptaraWatchlistScanRuns").filter((run) => run.entryId !== id);
    memoryStore.__cryptaraDiscoveryAlerts = store("__cryptaraDiscoveryAlerts").filter((alert) => alert.entryId !== id);
    return true;
  }

  async updateWatchlistEntryDetails(id: string, details: Partial<WatchlistEntry>): Promise<WatchlistEntry | null> {
    const entry = await this.getWatchlistEntry(id);
    if (!entry) return null;
    for (const [key, value] of Object.entries(details)) {
      if (value) Object.assign(entry, { [key]: value });
    }
    return entry;
  }

  async listWatchlistScanRuns(entryId?: string): Promise<WatchlistScanRun[]> {
    return sortDescBy(
      store("__cryptaraWatchlistScanRuns").filter((run) => !entryId || run.entryId === entryId),
      (run) => run.scannedAt,
    );
  }

  async addWatchlistScanRun(run: WatchlistScanRunInsert): Promise<WatchlistScanRun> {
    const previous = (await this.listWatchlistScanRuns(run.entryId))[0];
    const stored: WatchlistScanRun = {
      ...run,
      classification: run.classification as WatchlistScanRun["classification"],
      sourceLineage: run.sourceLineage as WatchlistScanRun["sourceLineage"],
      missingData: run.missingData as WatchlistScanRun["missingData"],
      riskReport: run.riskReport as WatchlistScanRun["riskReport"],
      status: run.status as WatchlistScanRun["status"],
      previousRunId: run.previousRunId ?? previous?.id,
    };
    store("__cryptaraWatchlistScanRuns").unshift(stored);
    return stored;
  }

  async updateWatchlistEntryLatestScan(
    id: string,
    update: {
      scanRunId: string;
      classification: WatchlistScanRun["classification"];
      score: number;
      scannedAt: string;
      status: WatchlistScanRun["status"];
    },
  ): Promise<WatchlistEntry | null> {
    const entry = await this.getWatchlistEntry(id);
    if (!entry) return null;
    entry.lastScannedAt = update.scannedAt;
    entry.latestScanRunId = update.scanRunId;
    entry.latestStatus = update.status === "failed" ? "stale" : update.status;
    if (update.status !== "failed") {
      entry.latestClassification = update.classification;
      entry.latestScore = update.score;
      entry.successfulScanRunIds = [update.scanRunId, ...(entry.successfulScanRunIds ?? [])].slice(0, 50);
    }
    return entry;
  }

  async createDiscoveryAlert(alert: DiscoveryAlertInsert): Promise<DiscoveryAlert> {
    const stored: DiscoveryAlert = {
      ...alert,
      kind: alert.kind as DiscoveryAlert["kind"],
      severity: alert.severity as DiscoveryAlert["severity"],
    };
    store("__cryptaraDiscoveryAlerts").unshift(stored);
    return stored;
  }

  async listDiscoveryAlerts(walletAddress?: string): Promise<DiscoveryAlert[]> {
    const wallet = normalizedWallet(walletAddress);
    return sortDesc(store("__cryptaraDiscoveryAlerts").filter((alert) => !wallet || sameWallet(alert.walletAddress, wallet)));
  }

  async acknowledgeDiscoveryAlert(id: string): Promise<DiscoveryAlert | null> {
    const alert = store("__cryptaraDiscoveryAlerts").find((item) => item.id === id);
    if (!alert) return null;
    alert.acknowledged = true;
    return alert;
  }

  async exportWalletData(walletAddress: string, network?: string): Promise<WalletExportData> {
    const wallet = normalizedWallet(walletAddress);
    const matching = <T extends { walletAddress?: string; network?: string }>(items: T[]) =>
      items.filter((item) => sameWallet(item.walletAddress, wallet) && (!network || item.network === network));
    return {
      agentRuns: matching(store("__cryptaraAgentRuns")),
      recommendations: matching(store("__cryptaraRecommendations")),
      approvals: matching(store("__cryptaraApprovals")),
      transactions: matching(store("__cryptaraTransactions")),
      x402PaymentReceipts: matching(store("__cryptaraX402PaymentReceipts")),
      userRules: matching(store("__cryptaraUserRules")),
      alertRules: matching(store("__cryptaraAlertRules")),
      alertObservations: matching(store("__cryptaraAlertObservations")),
      alerts: matching(store("__cryptaraAlerts")),
      alertDeliveries: matching(store("__cryptaraAlertDeliveries")),
      watchlistEntries: matching(store("__cryptaraWatchlistEntries")),
      watchlistScanRuns: matching(store("__cryptaraWatchlistScanRuns")),
      discoveryAlerts: matching(store("__cryptaraDiscoveryAlerts")),
    };
  }

  async deleteWalletData(walletAddress: string, network?: string): Promise<WalletDeleteResult> {
    const wallet = normalizedWallet(walletAddress);
    let deletedCount = 0;
    for (const key of [
      "__cryptaraAgentRuns",
      "__cryptaraRecommendations",
      "__cryptaraApprovals",
      "__cryptaraUserRules",
      "__cryptaraAlertRules",
      "__cryptaraAlertObservations",
      "__cryptaraAlerts",
      "__cryptaraAlertDeliveries",
      "__cryptaraWatchlistEntries",
      "__cryptaraWatchlistScanRuns",
      "__cryptaraDiscoveryAlerts",
    ] as const) {
      const items = store(key) as Array<{ walletAddress?: string; network?: string }>;
      const remaining = items.filter((item) => !sameWallet(item.walletAddress, wallet) || (network && item.network && item.network !== network));
      deletedCount += items.length - remaining.length;
      (memoryStore as Record<string, unknown>)[key] = remaining;
    }
    let unlinkedAuditCount = 0;
    for (const tx of store("__cryptaraTransactions")) {
      if (sameWallet(tx.walletAddress, wallet) && (!network || tx.network === network)) {
        tx.walletAddress = "";
        unlinkedAuditCount += 1;
      }
    }
    for (const receipt of store("__cryptaraX402PaymentReceipts")) {
      if (sameWallet(receipt.walletAddress, wallet) && (!network || receipt.network === network)) {
        receipt.walletAddress = undefined;
        receipt.payer = undefined;
        unlinkedAuditCount += 1;
      }
    }
    return { deletedCount, unlinkedAuditCount };
  }

  async pruneExpiredRecords(_now: string): Promise<number> {
    void _now;
    return 0;
  }

  async getStorageHealth(): Promise<StorageHealth> {
    const probe = await this.performHealthProbe();
    return {
      provider: "memory",
      persistent: false,
      detail: `In-memory adapter (non-durable). ${probe.detail}`,
      latencyMs: (probe.write?.latencyMs ?? 0) + (probe.read?.latencyMs ?? 0),
      pool: {
        configured: false,
        connected: probe.ok,
        total: 0,
        idle: 0,
        waiting: 0,
        checkedAt: new Date().toISOString(),
      },
      schema: storageSchemaContract,
    };
  }

  async getStorageCounts(): Promise<StorageCounts> {
    return {
      agentRuns: store("__cryptaraAgentRuns").length,
      recommendations: store("__cryptaraRecommendations").length,
      transactions: store("__cryptaraTransactions").length,
      approvals: store("__cryptaraApprovals").length,
      userRules: store("__cryptaraUserRules").length,
      x402PaymentReceipts: store("__cryptaraX402PaymentReceipts").length,
      alertRules: store("__cryptaraAlertRules").length,
      alertObservations: store("__cryptaraAlertObservations").length,
      alerts: store("__cryptaraAlerts").length,
      alertDeliveries: store("__cryptaraAlertDeliveries").length,
      notificationPreferences: store("__cryptaraNotificationPreferences").length,
    };
  }

  async performHealthProbe(): Promise<HealthProbeResult> {
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
    const probeIndex = store("__cryptaraAgentRuns").findIndex((record) => record.id === probeId);
    if (probeIndex >= 0) store("__cryptaraAgentRuns").splice(probeIndex, 1);

    if (readBack?.id === probeId) {
      return {
        ok: true,
        write: { ok: true, latencyMs: writeLatency },
        read: { ok: true, latencyMs: readLatency },
        clean: { ok: true },
        detail: `Memory probe: wrote and read probe record in ${writeLatency + readLatency}ms.`,
      };
    }
    return { ok: false, detail: "Memory probe failed: probe record was not readable after write." };
  }

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
    const receipts = store("__cryptaraErasureReceipts");
    const existing = receipts.find((item) => item.receiptId === receipt.receiptId);
    if (existing) return existing;
    receipts.unshift(receipt);
    return receipt;
  }

  async getErasureReceipt(receiptId: string): Promise<StoredErasureReceipt | null> {
    return store("__cryptaraErasureReceipts").find((item) => item.receiptId === receiptId) ?? null;
  }
}

export function createTracedMemoryStorageAdapter() {
  return wrapStorageAdapter(new MemoryStorageAdapter());
}
