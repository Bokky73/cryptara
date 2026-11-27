import type {
  AgentResult,
  AgentRunRecord,
  Alert,
  AlertDelivery,
  AlertObservation,
  AlertRule,
  DiscoveryAlert,
  NotificationPreferences,
  RecommendationRecord,
  StorageCounts,
  StorageHealth,
  StorageProvider,
  TransactionLifecycleEvent,
  TransactionRecord,
  TransactionObservation,
  UserApprovalRecord,
  UserRule,
  X402PaymentReceipt,
  WatchlistEntry,
  WatchlistScanRun,
} from "@/server/types";
import type { RiskSnapshotRecord } from "@/server/snapshots/schema";

export type { StorageHealth, StorageCounts, StorageProvider };

// ---------------------------------------------------------------------------
// Retention / Erasure types (used by IStorageAdapter optional methods)
// ---------------------------------------------------------------------------

export interface ErasureAdapterTableResult {
  table: string;
  action: "deleted" | "anonymized" | "skipped";
  rowsAffected: number;
  strategy: "delete" | "anonymize";
}

export interface ErasureAdapterResult {
  tables: ErasureAdapterTableResult[];
}

export interface ResidueAdapterLeak {
  store: string;
  recordId?: string;
  field: string;
  hint: string;
}

export interface ResidueAdapterResult {
  leaks: ResidueAdapterLeak[];
}

/** Erasure receipt as persisted in the erasure_receipts table / in-memory store. */
export interface StoredErasureReceipt {
  receiptId: string;
  walletHash: string;
  chainFamily: "evm" | "stellar";
  network?: string;
  erasedAt: string;
  sha256: string;
  /** Full JSON-serialized receipt body for verification. */
  receiptBody: string;
  createdAt: string;
}

/** Arguments passed to createAgentRunRecord after business logic is applied. */
export interface CreateAgentRunInput {
  walletAddress: string;
  mode?: AgentRunRecord["mode"];
  inputSnapshot?: Record<string, unknown>;
  targetToken?: AgentRunRecord["targetToken"];
  results: AgentResult[];
  userAction?: AgentRunRecord["userAction"];
}

/** Pre-built agent run record ready for insertion. */
export interface AgentRunInsert {
  id: string;
  walletAddress: string;
  mode: AgentRunRecord["mode"] | null;
  targetToken: AgentRunRecord["targetToken"] | null;
  status: AgentRunRecord["status"];
  recommendation: AgentRunRecord["recommendation"];
  decisionScore: number;
  confidence: number;
  summary: string;
  results: AgentResult[];
  sourceStatuses: AgentRunRecord["sourceStatuses"];

  inputSnapshot: Record<string, unknown>;
  userAction: AgentRunRecord["userAction"];
  createdAt: string;
}

/** Probe result for read/write health check. */
export interface HealthProbeResult {
  ok: boolean;
  write?: { ok: boolean; latencyMs: number };
  read?: { ok: boolean; latencyMs: number };
  clean?: { ok: boolean };
  detail: string;
}

/** SQL row shape for `alert_deliveries`. */
export type AlertDeliveryRow = {
  id: string;
  alert_id: string;
  wallet_address: string;
  channel: string;
  status: string;
  error_detail: string | null;
  sanitized_payload: AlertDelivery["sanitizedPayload"] | Record<string, unknown>;
  attempt_count: number;
  created_at: string;
  sent_at: string | null;
  idempotency_key: string | null;
  provider_message_id: string | null;
  next_retry_at: string | null;
  last_attempt_at: string | null;
  terminal: boolean | null;
};

function asIso(value: unknown, fallback = new Date(0).toISOString()): string {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return fallback;
}

function asOptionalIso(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return asIso(value);
}

function asNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

export function alertDeliveryToRow(delivery: AlertDelivery): AlertDeliveryRow {
  return {
    id: delivery.id,
    alert_id: delivery.alertId,
    wallet_address: delivery.walletAddress,
    channel: delivery.channel,
    status: delivery.status,
    error_detail: delivery.errorDetail ?? null,
    sanitized_payload: delivery.sanitizedPayload ?? {},
    attempt_count: delivery.attemptCount ?? 0,
    created_at: delivery.createdAt,
    sent_at: delivery.sentAt ?? null,
    idempotency_key: delivery.idempotencyKey ?? null,
    provider_message_id: delivery.providerMessageId ?? null,
    next_retry_at: delivery.nextRetryAt ?? null,
    last_attempt_at: delivery.lastAttemptAt ?? null,
    terminal: delivery.terminal ?? false,
  };
}

export function rowToAlertDelivery(row: AlertDeliveryRow | Record<string, unknown>): AlertDelivery {
  const record = row as Record<string, unknown>;
  const payload = record.sanitized_payload;
  const sanitizedPayload =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as AlertDelivery["sanitizedPayload"])
      : ({} as AlertDelivery["sanitizedPayload"]);

  return {
    id: typeof record.id === "string" ? record.id : "",
    alertId: typeof record.alert_id === "string" ? record.alert_id : "",
    walletAddress:
      typeof record.wallet_address === "string" ? record.wallet_address.toLowerCase() : "",
    channel: (record.channel as AlertDelivery["channel"]) ?? "in_app",
    status: (record.status as AlertDelivery["status"]) ?? "pending",
    ...(typeof record.error_detail === "string" ? { errorDetail: record.error_detail } : {}),
    sanitizedPayload,
    attemptCount: asNumber(record.attempt_count, 0),
    createdAt: asIso(record.created_at),
    ...(asOptionalIso(record.sent_at) ? { sentAt: asOptionalIso(record.sent_at) } : {}),
    ...(typeof record.idempotency_key === "string"
      ? { idempotencyKey: record.idempotency_key }
      : {}),
    ...(typeof record.provider_message_id === "string"
      ? { providerMessageId: record.provider_message_id }
      : {}),
    ...(asOptionalIso(record.next_retry_at)
      ? { nextRetryAt: asOptionalIso(record.next_retry_at) }
      : {}),
    ...(asOptionalIso(record.last_attempt_at)
      ? { lastAttemptAt: asOptionalIso(record.last_attempt_at) }
      : {}),
    terminal: asBoolean(record.terminal, false),
  };
}

export type AlertBundle = {
  rule: AlertRule;
  observation: AlertObservation;
  alert: Alert;
  deliveries: AlertDelivery[];
};

export type WatchlistEntryInsert = WatchlistEntry;

export type WatchlistScanRunInsert = {
  id: string;
  entryId: string;
  walletAddress: string;
  identityKey: string;
  agentRunId?: string;
  classification: string;
  classificationReasons: string[];
  confidence: number;
  score: number;
  sourceLineage: unknown[];
  missingData: unknown[];
  riskReport?: unknown;
  status: string;
  previousRunId?: string;
  scannedAt: string;
};

export type DiscoveryAlertInsert = {
  id: string;
  walletAddress: string;
  entryId?: string;
  runId?: string;
  kind: string;
  title: string;
  detail: string;
  severity: string;
  sourceLabel?: string;
  acknowledged: boolean;
  createdAt: string;
};

export type WalletExportData = Record<string, unknown[]>;

export type WalletDeleteResult = {
  deletedCount: number;
  unlinkedAuditCount: number;
};

/**
 * Unified storage adapter interface.
 * Every read and write is async. The memory adapter wraps synchronous stores,
 * while Postgres/Supabase adapters perform real I/O. Production mode never
 * falls back to an in-memory source of truth.
 */
export interface IStorageAdapter {
  readonly provider: StorageProvider;
  readonly persistent: boolean;

  listAgentRunRecords(walletAddress?: string): Promise<AgentRunRecord[]>;
  getAgentRunRecord(id: string): Promise<AgentRunRecord | null>;
  createAgentRunRecord(record: AgentRunInsert): Promise<AgentRunRecord>;

  listRecommendationRecords(walletAddress?: string): Promise<RecommendationRecord[]>;
  createRecommendationRecord(record: RecommendationRecord): Promise<RecommendationRecord>;

  listTransactionRecords(walletAddress?: string): Promise<TransactionRecord[]>;
  getTransactionRecord(hash: string): Promise<TransactionRecord | null>;
  getTransactionRecordForFamily(hash: string, family: "evm" | "stellar"): Promise<TransactionRecord | null>;
  getTransactionRecordByIdempotencyKey(walletAddress: string, idempotencyKey: string): Promise<TransactionRecord | null>;
  createTransactionRecord(record: TransactionRecord): Promise<TransactionRecord>;
  updateTransactionRecord(hash: string, patch: Partial<TransactionRecord>): Promise<TransactionRecord | null>;
  removeTransactionRecordByHash(hash: string): Promise<boolean>;
  listTransactionLifecycleEvents(hash: string): Promise<TransactionLifecycleEvent[]>;
  createTransactionLifecycleEvent(event: TransactionLifecycleEvent): Promise<TransactionLifecycleEvent>;
  listTransactionObservations(hash: string): Promise<TransactionObservation[]>;
  createTransactionObservation(observation: TransactionObservation): Promise<TransactionObservation>;

  listApprovalRecords(walletAddress?: string): Promise<UserApprovalRecord[]>;
  createApprovalRecord(record: UserApprovalRecord): Promise<UserApprovalRecord>;

  getUserRuleRecord(walletAddress: string): Promise<UserRule | null>;
  upsertUserRuleRecord(rule: UserRule): Promise<UserRule>;

  listX402PaymentReceipts(): Promise<X402PaymentReceipt[]>;
  getX402PaymentReceiptByHeaderHash(paymentHeaderHash: string): Promise<X402PaymentReceipt | null>;
  getX402PaymentReceiptByTxHash(transactionHash: string): Promise<X402PaymentReceipt | null>;
  createX402PaymentReceipt(record: X402PaymentReceipt): Promise<X402PaymentReceipt>;

  listRiskSnapshots(identityKey?: string): Promise<RiskSnapshotRecord[]>;
  getRiskSnapshot(id: string): Promise<RiskSnapshotRecord | null>;
  createRiskSnapshot(record: RiskSnapshotRecord): Promise<RiskSnapshotRecord>;
  revokeRiskSnapshot(id: string, revokedAt: string): Promise<RiskSnapshotRecord | null>;

  listAlertRules(walletAddress?: string): Promise<AlertRule[]>;
  getAlertRule(id: string): Promise<AlertRule | null>;
  upsertAlertRule(rule: AlertRule): Promise<AlertRule>;
  deleteAlertRule(id: string, walletAddress?: string): Promise<boolean>;
  ensureAlertRulesForWallet(walletAddress?: string): Promise<AlertRule[]>;
  listAlertObservations(walletAddress?: string, limit?: number): Promise<AlertObservation[]>;
  createAlertObservation(observation: AlertObservation): Promise<AlertObservation>;
  listAlerts(walletAddress?: string, status?: Alert["status"], limit?: number): Promise<Alert[]>;
  getAlert(id: string, walletAddress?: string): Promise<Alert | null>;
  createAlert(alert: Alert): Promise<Alert>;
  updateAlert(id: string, walletAddress: string, patch: Partial<Alert>): Promise<Alert | null>;
  createAlertBundle(bundle: AlertBundle): Promise<AlertBundle>;

  listAlertDeliveries(alertId?: string, walletAddress?: string): Promise<AlertDelivery[]>;
  getAlertDeliveryByIdempotencyKey(walletAddress: string, idempotencyKey: string): Promise<AlertDelivery | null>;
  createAlertDelivery(record: AlertDelivery): Promise<AlertDelivery>;
  updateAlertDelivery(id: string, walletAddress: string, patch: Partial<AlertDelivery>): Promise<AlertDelivery | null>;

  getNotificationPreferences(scope: {
    walletAddress: string;
    chainFamily: "evm" | "stellar";
    network: string;
  }): Promise<NotificationPreferences | null>;
  listNotificationPreferences(walletAddress?: string): Promise<NotificationPreferences[]>;
  upsertNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences>;
  deleteNotificationPreferences(id: string): Promise<boolean>;

  listWatchlistEntries(walletAddress?: string): Promise<WatchlistEntry[]>;
  getWatchlistEntry(id: string): Promise<WatchlistEntry | null>;
  addWatchlistEntry(entry: WatchlistEntry): Promise<{ entry: WatchlistEntry; alreadyExisted: boolean }>;
  addWatchlistEntriesBulk(entries: WatchlistEntry[]): Promise<{ added: WatchlistEntry[] }>;
  removeWatchlistEntry(id: string): Promise<boolean>;
  updateWatchlistEntryDetails(id: string, details: Partial<WatchlistEntry>): Promise<WatchlistEntry | null>;
  listWatchlistScanRuns(entryId?: string): Promise<WatchlistScanRun[]>;
  addWatchlistScanRun(run: WatchlistScanRunInsert): Promise<WatchlistScanRun>;
  updateWatchlistEntryLatestScan(
    id: string,
    update: {
      scanRunId: string;
      classification: WatchlistScanRun["classification"];
      score: number;
      scannedAt: string;
      status: WatchlistScanRun["status"];
    },
  ): Promise<WatchlistEntry | null>;
  createDiscoveryAlert(alert: DiscoveryAlertInsert): Promise<DiscoveryAlert>;
  listDiscoveryAlerts(walletAddress?: string): Promise<DiscoveryAlert[]>;
  acknowledgeDiscoveryAlert(id: string): Promise<DiscoveryAlert | null>;

  exportWalletData(walletAddress: string, network?: string, chainFamily?: "evm" | "stellar"): Promise<WalletExportData>;
  deleteWalletData(walletAddress: string, network?: string, chainFamily?: "evm" | "stellar"): Promise<WalletDeleteResult>;
  pruneExpiredRecords(now: string): Promise<number>;

  getStorageHealth(): Promise<StorageHealth>;
  getStorageCounts(): Promise<StorageCounts>;
  performHealthProbe(): Promise<HealthProbeResult>;

  eraseWalletData?(
    walletAddress: string,
    chainFamily: "evm" | "stellar",
    network?: string,
  ): Promise<ErasureAdapterResult>;
  residueCheck?(
    walletAddress: string,
    chainFamily: "evm" | "stellar",
    network?: string,
  ): Promise<ResidueAdapterResult>;
  storeErasureReceipt?(receipt: StoredErasureReceipt): Promise<StoredErasureReceipt>;
  getErasureReceipt?(receiptId: string): Promise<StoredErasureReceipt | null>;
}
