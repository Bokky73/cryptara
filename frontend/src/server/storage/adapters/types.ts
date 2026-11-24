import type {
  AgentResult,
  AgentRunRecord,
  AlertDelivery,
  NotificationPreferences,
  RecommendationRecord,
  StorageCounts,
  StorageHealth,
  StorageProvider,
  TransactionRecord,
  TransactionObservation,
  UserApprovalRecord,
  UserRule,
  X402PaymentReceipt,
  WatchlistEntry,
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

/**
 * Unified storage adapter interface.
 * Every method returns a Promise so the same API works for both
 * in-memory (synchronous → wrapped) and Supabase (real async I/O).
 */
export interface IStorageAdapter {
  readonly provider: StorageProvider;
  readonly persistent: boolean;

  // ─── Agent runs ──────────────────────────────────────────────────
  listAgentRunRecords(walletAddress?: string): Promise<AgentRunRecord[]>;
  getAgentRunRecord(id: string): Promise<AgentRunRecord | null>;
  createAgentRunRecord(record: AgentRunInsert): Promise<AgentRunRecord>;

  // ─── Recommendations ─────────────────────────────────────────────
  listRecommendationRecords(walletAddress?: string): Promise<RecommendationRecord[]>;
  createRecommendationRecord(record: RecommendationRecord): Promise<RecommendationRecord>;

  // ─── Transactions ────────────────────────────────────────────────
  listTransactionRecords(walletAddress?: string): Promise<TransactionRecord[]>;
  getTransactionRecord(hash: string): Promise<TransactionRecord | null>;
  createTransactionRecord(record: TransactionRecord): Promise<TransactionRecord>;
  listTransactionObservations(hash: string): Promise<TransactionObservation[]>;
  createTransactionObservation(observation: TransactionObservation): Promise<TransactionObservation>;

  // ─── Approvals ───────────────────────────────────────────────────
  listApprovalRecords(walletAddress?: string): Promise<UserApprovalRecord[]>;
  createApprovalRecord(record: UserApprovalRecord): Promise<UserApprovalRecord>;

  // ─── User rules ──────────────────────────────────────────────────
  getUserRuleRecord(walletAddress: string): Promise<UserRule | null>;
  upsertUserRuleRecord(rule: UserRule): Promise<UserRule>;

  // ─── x402 receipts ───────────────────────────────────────────────
  listX402PaymentReceipts(): Promise<X402PaymentReceipt[]>;
  getX402PaymentReceiptByHeaderHash(paymentHeaderHash: string): Promise<X402PaymentReceipt | null>;
  createX402PaymentReceipt(record: X402PaymentReceipt): Promise<X402PaymentReceipt>;

  // ─── Public risk snapshots ──────────────────────────────────────
  /** List risk snapshots, optionally narrowed to one canonical asset identity. */
  listRiskSnapshots(identityKey?: string): Promise<RiskSnapshotRecord[]>;
  getRiskSnapshot(id: string): Promise<RiskSnapshotRecord | null>;
  createRiskSnapshot(record: RiskSnapshotRecord): Promise<RiskSnapshotRecord>;
  revokeRiskSnapshot(id: string, revokedAt: string): Promise<RiskSnapshotRecord | null>;
  // ─── Alert deliveries ────────────────────────────────────────────
  listAlertDeliveries(alertId?: string, walletAddress?: string): Promise<AlertDelivery[]>;
  getAlertDeliveryByIdempotencyKey(
    walletAddress: string,
    idempotencyKey: string,
  ): Promise<AlertDelivery | null>;
  createAlertDelivery(record: AlertDelivery): Promise<AlertDelivery>;
  updateAlertDelivery(
    id: string,
    walletAddress: string,
    patch: Partial<AlertDelivery>,
  ): Promise<AlertDelivery | null>;

  // ─── Notification preferences ───────────────────────────────
  getNotificationPreferences(scope: {
    walletAddress: string;
    chainFamily: "evm" | "stellar";
    network: string;
  }): Promise<NotificationPreferences | null>;
  upsertNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences>;

  // ─── Health & counts ─────────────────────────────────────────────
  getStorageHealth(): Promise<StorageHealth>;
  getStorageCounts(): Promise<StorageCounts>;
  performHealthProbe(): Promise<HealthProbeResult>;
  // ─── Watchlist ───────────────────────────────────────────────────
  addWatchlistEntriesBulk?(entries: WatchlistEntry[]): Promise<{ added: WatchlistEntry[] }>;

  // ─── Retention / Erasure ─────────────────────────────────────────
  /**
   * Perform a full, structured wallet erasure for this adapter.
   * Returns a per-table report of rows deleted or anonymized.
   * The caller (eraseWalletData orchestrator) assembles the receipt.
   */
  eraseWalletData?(
    walletAddress: string,
    chainFamily: "evm" | "stellar",
    network?: string,
  ): Promise<ErasureAdapterResult>;

  /**
   * Scan this adapter's stores for residual wallet identity after erasure.
   * Returns any leaks found (empty array = clean).
   */
  residueCheck?(
    walletAddress: string,
    chainFamily: "evm" | "stellar",
    network?: string,
  ): Promise<ResidueAdapterResult>;

  /**
   * Store an erasure receipt for compliance audit purposes.
   * The receipt contains only a one-way wallet hash — never the raw address.
   */
  storeErasureReceipt?(receipt: StoredErasureReceipt): Promise<StoredErasureReceipt>;

  /** Retrieve an erasure receipt by its receiptId. */
  getErasureReceipt?(receiptId: string): Promise<StoredErasureReceipt | null>;
}
