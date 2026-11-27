/**
 * Postgres storage adapter.
 *
 * All reads and writes go through a pooled `pg` connection using
 * parameterized statements. Multi-table writes (alert rule → observation →
 * alert → delivery) run inside one explicit transaction. There is no
 * in-memory primary store and no detached best-effort mirror queue.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  Alert,
  AlertDelivery,
  AlertObservation,
  AlertRule,
  DiscoveryAlert,
  NotificationPreferences,
  RecommendationRecord,
  StorageCounts,
  StorageHealth,
  TransactionLifecycleEvent,
  TransactionObservation,
  TransactionRecord,
  UserApprovalRecord,
  UserRule,
  WatchlistEntry,
  WatchlistScanRun,
  X402PaymentReceipt,
  AgentRunRecord,
} from "@/server/types";
import { storageSchemaContract } from "@/server/storage/contract";
import type {
  AgentRunInsert,
  AlertBundle,
  DiscoveryAlertInsert,
  ErasureAdapterResult,
  HealthProbeResult,
  IStorageAdapter,
  ResidueAdapterResult,
  StoredErasureReceipt,
  WalletDeleteResult,
  WalletExportData,
  WatchlistScanRunInsert,
} from "@/server/storage/adapters/types";
import { alertDeliveryToRow, rowToAlertDelivery } from "@/server/storage/adapters/types";
import type { RiskSnapshotRecord } from "@/server/snapshots/schema";
import { wrapStorageAdapter } from "@/server/observability/tracing/spans";

type QueryResult<T = Record<string, unknown>> = { rows: T[]; rowCount: number };
type QueryClient = {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
};
type QueryPool = QueryClient & {
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
  end(): Promise<void>;
};
type PgModule = {
  Pool: new (config: {
    connectionString: string;
    ssl?: { rejectUnauthorized: boolean } | false;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
  }) => QueryPool;
};

let loadedPgModule: PgModule | null | undefined;
let lastPgLoadError: string | null = null;

async function tryLoadPg(): Promise<PgModule | null> {
  if (loadedPgModule !== undefined) return loadedPgModule;
  try {
    const localRequire = createRequire(pathToFileURL(`${process.cwd()}/_pg_loader.cjs`).href);
    loadedPgModule = localRequire("pg") as PgModule;
    return loadedPgModule;
  } catch (error) {
    loadedPgModule = null;
    lastPgLoadError = error instanceof Error ? error.message : String(error);
    return null;
  }
}

export function resolveConnectionString(): string | undefined {
  return (
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    process.env.NEXT_PUBLIC_DATABASE_URL ??
    ""
  ) || undefined;
}

export const CANONICAL_MIGRATIONS: ReadonlyArray<{ name: string; checksum: string }> = [
  { name: "0001_init", checksum: "" },
];
export const EXPECTED_SCHEMA_VERSION = CANONICAL_MIGRATIONS.at(-1)?.name ?? "";

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function asJsonText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value ?? {});
}

function asNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function asArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asRecord<T extends object>(value: unknown): T {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as T;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
    } catch {
      return {} as T;
    }
  }
  return {} as T;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function optionalIso(value: unknown): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : asString(value);
}

function wallet(value: unknown): string {
  return asString(value);
}

function rowToAgentRun(row: Record<string, unknown>): AgentRunRecord {
  const snapshot = (row.input_snapshot ?? {}) as Record<string, unknown>;
  return {
    id: asString(row.id),
    walletAddress: wallet(row.wallet_address),
    mode: (row.mode as AgentRunRecord["mode"]) ?? undefined,
    targetToken: (row.target_token_data as AgentRunRecord["targetToken"]) ?? undefined,
    status: row.status as AgentRunRecord["status"],
    recommendation: row.recommendation as AgentRunRecord["recommendation"],
    decisionScore: asNumber(row.decision_score),
    confidence: asNumber(row.confidence),
    summary: asString(row.summary),
    results: (snapshot.resultSnapshots as AgentRunRecord["results"]) ?? [],
    sourceStatuses: (row.source_statuses as AgentRunRecord["sourceStatuses"]) ?? [],
    inputSnapshot: snapshot,
    userAction: (row.user_action as AgentRunRecord["userAction"]) ?? "pending",
    createdAt: asString(row.created_at),
  };
}

function agentRunToRow(record: AgentRunInsert): unknown[] {
  return [
    record.id,
    record.walletAddress,
    record.mode ?? null,
    record.targetToken?.symbol ?? null,
    record.targetToken?.name ?? null,
    record.targetToken?.tokenAddress ?? null,
    record.targetToken?.chain ?? null,
    record.targetToken ? json(record.targetToken) : null,
    json({ ...record.inputSnapshot, resultSnapshots: record.results }),
    record.status,
    record.recommendation,
    record.decisionScore,
    record.confidence,
    record.summary,
    json(record.sourceStatuses ?? []),
    record.userAction ?? "pending",
    record.createdAt,
  ];
}

const AGENT_RUN_COLUMNS =
  "id, wallet_address, mode, target_symbol, target_name, target_address, target_chain, target_token_data, input_snapshot, status, recommendation, decision_score, confidence, summary, source_statuses, user_action, created_at";
const AGENT_RUN_VALUES = "$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17";

function rowToRecommendation(row: Record<string, unknown>): RecommendationRecord {
  return {
    id: asString(row.id),
    runId: optionalIso(row.run_id),
    walletAddress: wallet(row.wallet_address),
    action: row.action as RecommendationRecord["action"],
    decisionScore: asNumber(row.decision_score),
    confidence: asNumber(row.confidence),
    summary: asString(row.summary),
    createdAt: asString(row.created_at),
  };
}

function rowToTransaction(row: Record<string, unknown>): TransactionRecord {
  return {
    hash: asString(row.tx_hash),
    type: row.type as TransactionRecord["type"],
    decisionAction: row.decision_action as TransactionRecord["decisionAction"] ?? undefined,
    asset: asString(row.asset),
    valueUsd: asNumber(row.value_usd),
    status: row.status as TransactionRecord["status"],
    lifecycleStatus: (row.lifecycle_status ?? row.status) as TransactionRecord["lifecycleStatus"],
    chainFamily: (row.chain_family ?? "evm") as TransactionRecord["chainFamily"],
    sourceAccount: optionalIso(row.source_account),
    expectedEffects: asArray(row.expected_effects) as TransactionRecord["expectedEffects"],
    idempotencyKey: optionalIso(row.idempotency_key),
    explorerUrl: optionalIso(row.explorer_url),
    failureReason: optionalIso(row.failure_reason),
    submittedAt: optionalIso(row.submitted_at),
    terminalAt: optionalIso(row.terminal_at),
    lastPolledAt: optionalIso(row.last_polled_at),
    pollAttempts: asNumber(row.poll_attempts),
    confirmationCount: asNumber(row.confirmation_count),
    requiredConfirmations: asNumber(row.required_confirmations, 1),
    finalityReached: asBool(row.finality_reached),
    replacementHash: optionalIso(row.replacement_hash),
    lastObservedBlockHash: optionalIso(row.last_observed_block_hash),
    missingObservationCount: asNumber(row.missing_observation_count),
    manualReviewReason: optionalIso(row.manual_review_reason),
    observationCount: asNumber(row.observation_count),
    network: asString(row.network),
    walletAddress: wallet(row.wallet_address),
    userApproved: asBool(row.user_approved),
    decisionId: optionalIso(row.decision_id),
    simulationStatus: row.simulation_status as TransactionRecord["simulationStatus"] ?? undefined,
    policyStatus: (row.policy_status ?? {}) as TransactionRecord["policyStatus"],
    createdAt: asString(row.created_at),
  };
}

function transactionToRow(record: TransactionRecord): unknown[] {
  return [
    record.hash,
    record.walletAddress ?? null,
    record.decisionId ?? null,
    record.decisionAction ?? null,
    record.type,
    record.asset,
    record.valueUsd,
    record.status,
    record.lifecycleStatus ?? record.status,
    record.chainFamily ?? "evm",
    record.sourceAccount ?? null,
    json(record.expectedEffects ?? []),
    record.idempotencyKey ?? null,
    record.explorerUrl ?? null,
    record.failureReason ?? null,
    record.submittedAt ?? null,
    record.terminalAt ?? null,
    record.lastPolledAt ?? null,
    record.pollAttempts ?? 0,
    record.confirmationCount ?? 0,
    record.requiredConfirmations ?? 1,
    record.finalityReached ?? false,
    record.replacementHash ?? null,
    record.lastObservedBlockHash ?? null,
    record.missingObservationCount ?? 0,
    record.manualReviewReason ?? null,
    record.observationCount ?? 0,
    record.network,
    record.userApproved ?? false,
    record.simulationStatus ?? null,
    json(record.policyStatus ?? {}),
    record.createdAt,
  ];
}

const TRANSACTION_COLUMNS =
  "tx_hash, wallet_address, decision_id, decision_action, type, asset, value_usd, status, lifecycle_status, chain_family, source_account, expected_effects, idempotency_key, explorer_url, failure_reason, submitted_at, terminal_at, last_polled_at, poll_attempts, confirmation_count, required_confirmations, finality_reached, replacement_hash, last_observed_block_hash, missing_observation_count, manual_review_reason, observation_count, network, user_approved, simulation_status, policy_status, created_at";
const TRANSACTION_VALUES =
  "$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32";

function rowToTransactionObservation(row: Record<string, unknown>): TransactionObservation {
  return {
    id: asString(row.id),
    hash: asString(row.transaction_hash),
    evidenceKey: asString(row.evidence_key),
    chainFamily: row.chain_family as TransactionObservation["chainFamily"],
    network: asString(row.network),
    provider: asString(row.provider),
    providerUrl: optionalIso(row.provider_url),
    status: row.status as TransactionObservation["status"],
    blockNumber: row.block_number == null ? undefined : asNumber(row.block_number),
    blockHash: optionalIso(row.block_hash),
    ledgerSequence: row.ledger_sequence == null ? undefined : asNumber(row.ledger_sequence),
    confirmations: asNumber(row.confirmations),
    requiredConfirmations: asNumber(row.required_confirmations, 1),
    replacementHash: optionalIso(row.replacement_hash),
    nonce: row.nonce == null ? undefined : asNumber(row.nonce),
    detail: optionalIso(row.detail),
    observedAt: asString(row.observed_at),
  };
}

function rowToApproval(row: Record<string, unknown>): UserApprovalRecord {
  return {
    id: asString(row.id),
    walletAddress: wallet(row.wallet_address),
    decisionId: optionalIso(row.decision_id),
    txHash: asString(row.tx_hash),
    network: optionalIso(row.network),
    action: row.action as UserApprovalRecord["action"] ?? undefined,
    asset: optionalIso(row.asset),
    valueUsd: row.value_usd == null ? undefined : asNumber(row.value_usd),
    status: (row.status as UserApprovalRecord["status"]) ?? "confirmed",
    autoExecuted: false,
    createdAt: asString(row.created_at),
  };
}

function rowToUserRule(row: Record<string, unknown>): UserRule {
  return {
    walletAddress: wallet(row.wallet_address),
    maxRiskScore: asNumber(row.max_risk_score),
    maxTradePercent: asNumber(row.max_trade_percent),
    maxMemeExposurePercent: asNumber(row.max_meme_exposure_percent),
    maxDailyTransactionValueUsd: row.max_daily_transaction_value_usd == null ? undefined : asNumber(row.max_daily_transaction_value_usd),
    maxSlippageBps: row.max_slippage_bps == null ? undefined : asNumber(row.max_slippage_bps),
    allowedChains: asArray(row.allowed_chains),
    blockedTokens: asArray(row.blocked_tokens),
    allowedActions: asArray(row.allowed_actions) as UserRule["allowedActions"],
    autoExecute: false,
    createdAt: asString(row.created_at),
  };
}

function rowToX402(row: Record<string, unknown>): X402PaymentReceipt {
  const network = asString(row.network);
  return {
    id: asString(row.id),
    requestId: asString(row.request_id),
    paymentHeaderHash: asString(row.payment_header_hash),
    walletAddress: optionalIso(row.wallet_address),
    payer: optionalIso(row.payer),
    transactionHash: optionalIso(row.transaction_hash),
    chainFamily: (row.chain_family as X402PaymentReceipt["chainFamily"]) ?? (network.startsWith("stellar:") ? "stellar" : "evm"),
    payerIdentity: (row.payer_identity as X402PaymentReceipt["payerIdentity"]) ?? undefined,
    network,
    asset: asString(row.asset),
    amount: asString(row.amount),
    priceUsd: asString(row.price_usd),
    payTo: asString(row.pay_to),
    facilitatorUrl: asString(row.facilitator_url),
    protectedResource: asString(row.protected_resource),
    requestBodyHash: asString(row.request_body_hash),
    paymentExpiry: optionalIso(row.payment_expiry),
    verificationStatus: row.verification_status as X402PaymentReceipt["verificationStatus"],
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function rowToRiskSnapshot(row: Record<string, unknown>): RiskSnapshotRecord {
  return {
    id: asString(row.id),
    schemaVersion: asString(row.schema_version),
    snapshot: row.snapshot as RiskSnapshotRecord["snapshot"],
    canonicalHash: asString(row.canonical_hash),
    identityKey: asString(row.identity_key),
    revocationTokenHash: asString(row.revocation_token_hash),
    createdAt: asString(row.created_at),
    expiresAt: asString(row.expires_at),
    revokedAt: optionalIso(row.revoked_at),
  };
}

function rowToAlertRule(row: Record<string, unknown>): AlertRule {
  return {
    id: asString(row.id),
    walletAddress: wallet(row.wallet_address),
    triggerType: row.trigger_type as AlertRule["triggerType"],
    observationKey: optionalIso(row.observation_key),
    threshold: asNumber(row.threshold),
    hysteresis: asNumber(row.hysteresis),
    cooldownMinutes: asNumber(row.cooldown_minutes, 60),
    direction: (row.direction as AlertRule["direction"]) ?? "high_is_bad",
    severity: row.severity as AlertRule["severity"],
    enabled: asBool(row.enabled, true),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
}

function alertRuleToRow(rule: AlertRule): unknown[] {
  return [
    rule.id,
    rule.walletAddress,
    rule.triggerType,
    rule.observationKey ?? null,
    rule.threshold,
    rule.hysteresis ?? 0,
    rule.cooldownMinutes ?? 60,
    rule.direction ?? "high_is_bad",
    rule.severity,
    rule.enabled,
    rule.createdAt,
    rule.updatedAt,
  ];
}

function rowToAlertObservation(row: Record<string, unknown>): AlertObservation {
  return {
    id: asString(row.id),
    walletAddress: wallet(row.wallet_address),
    triggerType: row.trigger_type as AlertObservation["triggerType"],
    observationKey: asString(row.observation_key),
    value: asNumber(row.value),
    direction: row.direction as AlertObservation["direction"],
    evidence: asRecord<AlertObservation["evidence"]>(row.evidence),
    incompleteData: asBool(row.incomplete_data),
    createdAt: asString(row.created_at),
  };
}

function alertObservationToRow(observation: AlertObservation): unknown[] {
  return [
    observation.id,
    observation.walletAddress,
    observation.triggerType,
    observation.observationKey,
    observation.value,
    observation.direction,
    json(observation.evidence ?? {}),
    observation.incompleteData ?? false,
    observation.createdAt,
  ];
}

function rowToAlert(row: Record<string, unknown>): Alert {
  return {
    id: asString(row.id),
    walletAddress: wallet(row.wallet_address),
    ruleId: asString(row.rule_id),
    triggerType: row.trigger_type as Alert["triggerType"],
    observationKey: asString(row.observation_key),
    status: row.status as Alert["status"],
    severity: row.severity as Alert["severity"],
    message: asString(row.message),
    beforeValue: asNumber(row.before_value),
    afterValue: asNumber(row.after_value),
    evidenceBefore: (row.evidence_before as Alert["evidenceBefore"]) ?? {},
    evidenceAfter: (row.evidence_after as Alert["evidenceAfter"]) ?? {},
    evidenceData: (row.evidence_data as Alert["evidenceData"]) ?? {},
    deliverySummary: (row.delivery_summary as Alert["deliverySummary"]) ?? undefined,
    triggeredAt: asString(row.triggered_at),
    recoveredAt: optionalIso(row.recovered_at),
    acknowledgedAt: optionalIso(row.acknowledged_at),
  };
}

function alertToRow(alert: Alert): unknown[] {
  return [
    alert.id,
    alert.walletAddress,
    alert.ruleId,
    alert.triggerType,
    alert.observationKey,
    alert.status,
    alert.severity,
    alert.message,
    alert.beforeValue,
    alert.afterValue,
    json(alert.evidenceBefore ?? {}),
    json(alert.evidenceAfter ?? {}),
    json(alert.evidenceData ?? {}),
    json(alert.deliverySummary ?? {}),
    alert.triggeredAt,
    alert.recoveredAt ?? null,
    alert.acknowledgedAt ?? null,
  ];
}

function notificationPrefsToPayload(prefs: NotificationPreferences) {
  return {
    channels: prefs.channels,
    quietHours: prefs.quietHours,
    digestCadence: prefs.digestCadence,
    dedupeWindowMinutes: prefs.dedupeWindowMinutes,
  };
}

function rowToNotificationPreferences(row: Record<string, unknown>): NotificationPreferences {
  const prefs = (row.prefs ?? {}) as Record<string, unknown>;
  return {
    id: asString(row.id),
    walletAddress: wallet(row.wallet_address),
    chainFamily: (row.chain_family as NotificationPreferences["chainFamily"]) ?? "evm",
    network: asString(row.network) || "legacy-evm",
    channels: (prefs.channels as NotificationPreferences["channels"]) ?? {},
    quietHours: (prefs.quietHours as NotificationPreferences["quietHours"]) ?? { enabled: false, start: "22:00", end: "07:00", timeZone: "UTC" },
    digestCadence: (prefs.digestCadence as NotificationPreferences["digestCadence"]) ?? "off",
    dedupeWindowMinutes: asNumber(prefs.dedupeWindowMinutes, 30),
    updatedAt: asString(row.updated_at),
  };
}

function rowToWatchlistEntry(row: Record<string, unknown>): WatchlistEntry {
  return {
    id: asString(row.id),
    walletAddress: wallet(row.wallet_address),
    identityKey: asString(row.identity_key),
    chain: row.chain as WatchlistEntry["chain"],
    network: asString(row.network),
    contractAddress: optionalIso(row.contract_address),
    pairAddress: optionalIso(row.pair_address),
    symbol: optionalIso(row.symbol),
    tokenName: optionalIso(row.token_name),
    assetKey: optionalIso(row.asset_key),
    issuer: optionalIso(row.issuer),
    assetType: row.asset_type as WatchlistEntry["assetType"] ?? undefined,
    source: row.source as WatchlistEntry["source"],
    note: optionalIso(row.note),
    createdAt: asString(row.created_at),
    lastScannedAt: optionalIso(row.last_scanned_at),
    latestScanRunId: optionalIso(row.latest_scan_run_id),
    latestClassification: row.latest_classification as WatchlistEntry["latestClassification"] ?? undefined,
    latestScore: row.latest_score == null ? undefined : asNumber(row.latest_score),
    latestStatus: row.latest_status as WatchlistEntry["latestStatus"] ?? undefined,
    successfulScanRunIds: asArray<string>(row.successful_scan_run_ids),
  };
}

function watchlistEntryToRow(entry: WatchlistEntry): unknown[] {
  return [
    entry.id,
    entry.walletAddress,
    entry.identityKey,
    entry.chain,
    entry.network ?? null,
    entry.contractAddress ?? null,
    entry.pairAddress ?? null,
    entry.symbol ?? null,
    entry.tokenName ?? null,
    entry.assetKey ?? null,
    entry.issuer ?? null,
    entry.assetType ?? null,
    entry.source,
    entry.note ?? null,
    entry.createdAt,
    entry.lastScannedAt ?? null,
    entry.latestScanRunId ?? null,
    entry.latestClassification ?? null,
    entry.latestScore ?? null,
    entry.latestStatus ?? null,
    json(entry.successfulScanRunIds ?? []),
  ];
}

const WATCHLIST_COLUMNS =
  "id, wallet_address, identity_key, chain, network, contract_address, pair_address, symbol, token_name, asset_key, issuer, asset_type, source, note, created_at, last_scanned_at, latest_scan_run_id, latest_classification, latest_score, latest_status, successful_scan_run_ids";
const WATCHLIST_VALUES = "$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21";

function rowToWatchlistScanRun(row: Record<string, unknown>): WatchlistScanRun {
  return {
    id: asString(row.id),
    entryId: asString(row.entry_id),
    walletAddress: wallet(row.wallet_address),
    identityKey: asString(row.identity_key),
    agentRunId: optionalIso(row.agent_run_id),
    classification: row.classification as WatchlistScanRun["classification"],
    classificationReasons: asArray(row.classification_reasons) as WatchlistScanRun["classificationReasons"],
    confidence: asNumber(row.confidence),
    score: asNumber(row.score),
    sourceLineage: asArray(row.source_lineage) as WatchlistScanRun["sourceLineage"],
    missingData: asArray(row.missing_data) as WatchlistScanRun["missingData"],
    riskReport: (row.risk_report as WatchlistScanRun["riskReport"]) ?? undefined,
    status: row.status as WatchlistScanRun["status"],
    previousRunId: optionalIso(row.previous_run_id),
    scannedAt: asString(row.scanned_at),
  };
}

function rowToDiscoveryAlert(row: Record<string, unknown>): DiscoveryAlert {
  return {
    id: asString(row.id),
    walletAddress: wallet(row.wallet_address),
    entryId: optionalIso(row.entry_id),
    runId: optionalIso(row.run_id),
    kind: row.kind as DiscoveryAlert["kind"],
    title: asString(row.title),
    detail: asString(row.detail),
    severity: row.severity as DiscoveryAlert["severity"],
    sourceLabel: optionalIso(row.source_label),
    acknowledged: asBool(row.acknowledged),
    createdAt: asString(row.created_at),
  };
}

export class PostgresStorageAdapter implements IStorageAdapter {
  readonly provider = "supabase_postgres" as const;
  readonly persistent = true;

  private pool: QueryPool | null = null;
  private connectPromise: Promise<{ ok: boolean; detail: string }> | null = null;
  private connected = false;
  private connectedAt: string | null = null;
  private lastError: string | null = null;
  private schemaVerified = false;
  private successCount = 0;
  private failureCount = 0;

  isConfigured(): boolean {
    return Boolean(resolveConnectionString());
  }

  isConnected(): boolean {
    return this.connected;
  }

  getHealthSnapshot() {
    return {
      connectionStringPresent: this.isConfigured(),
      pgInstalled: loadedPgModule === undefined ? null : loadedPgModule === null ? false : true,
      pgLoadError: lastPgLoadError,
      connected: this.connected,
      connectedAt: this.connectedAt,
      lastError: this.lastError,
      successCount: this.successCount,
      failureCount: this.failureCount,
      expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
    };
  }

  async connect(): Promise<{ ok: boolean; detail: string }> {
    this.connectPromise ??= this.doConnect();
    return this.connectPromise;
  }

  private async doConnect(): Promise<{ ok: boolean; detail: string }> {
    const connectionString = resolveConnectionString();
    if (!connectionString) return { ok: false, detail: "No Postgres connection string configured." };
    const pg = await tryLoadPg();
    if (!pg) return { ok: false, detail: lastPgLoadError ?? "pg is not installed." };

    try {
      this.pool = new pg.Pool({
        connectionString,
        ssl: process.env.SUPABASE_DB_URL ? { rejectUnauthorized: false } : false,
        max: Number.parseInt(process.env.PG_POOL_MAX ?? "10", 10) || 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      });
      const start = Date.now();
      await this.pool.query("SELECT 1");
      this.connected = true;
      this.connectedAt = new Date().toISOString();
      this.lastError = null;
      this.successCount += 1;
      const poolLatency = Date.now() - start;
      return { ok: true, detail: `Postgres pool connected in ${poolLatency}ms.` };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.failureCount += 1;
      this.connected = false;
      this.pool = null;
      this.connectPromise = null;
      return { ok: false, detail: this.lastError };
    }
  }

  private async client(): Promise<QueryClient> {
    const status = await this.connect();
    if (!status.ok || !this.pool) throw new Error(`Postgres storage unavailable: ${status.detail}`);
    return this.pool;
  }

  private async transaction<T>(work: (client: QueryClient) => Promise<T>): Promise<T> {
    const pool = await this.client();
    const tx = "connect" in pool ? await (pool as unknown as { connect(): Promise<QueryClient> }).connect() : null;
    const run = tx ?? pool;
    try {
      if (tx) await run.query("BEGIN");
      const result = await work(run);
      if (tx) await run.query("COMMIT");
      this.successCount += 1;
      return result;
    } catch (error) {
      if (tx) await run.query("ROLLBACK").catch(() => undefined);
      this.failureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      tx?.release();
    }
  }

  private async all<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
    const client = await this.client();
    try {
      const result = await client.query<T>(text, values);
      this.successCount += 1;
      return result.rows;
    } catch (error) {
      this.failureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async one<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T | null> {
    return (await this.all<T>(text, values))[0] ?? null;
  }

  private async run(text: string, values: unknown[] = []): Promise<number> {
    const client = await this.client();
    try {
      const result = await client.query(text, values);
      this.successCount += 1;
      return result.rowCount;
    } catch (error) {
      this.failureCount += 1;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async ping(): Promise<{ ok: boolean; latencyMs: number; detail: string }> {
    const start = Date.now();
    try {
      const client = await this.client();
      await client.query("SELECT 1");
      this.connected = true;
      this.lastError = null;
      return { ok: true, latencyMs: Date.now() - start, detail: "ok" };
    } catch (error) {
      this.connected = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      return { ok: false, latencyMs: Date.now() - start, detail: this.lastError };
    }
  }

  private async poolStatus(latencyMs?: number) {
    const status = await this.connect();
    return {
      configured: this.isConfigured(),
      connected: status.ok && this.connected,
      total: this.pool?.totalCount ?? 0,
      idle: this.pool?.idleCount ?? 0,
      waiting: this.pool?.waitingCount ?? 0,
      ...(latencyMs === undefined ? {} : { latencyMs }),
      checkedAt: new Date().toISOString(),
    };
  }

  async listAgentRunRecords(walletAddress?: string): Promise<AgentRunRecord[]> {
    const rows = walletAddress
      ? await this.all("SELECT * FROM agent_runs WHERE wallet_address = $1 ORDER BY created_at DESC", [walletAddress.trim().toLowerCase()])
      : await this.all("SELECT * FROM agent_runs ORDER BY created_at DESC");
    return rows.map(rowToAgentRun);
  }

  async getAgentRunRecord(id: string): Promise<AgentRunRecord | null> {
    const row = await this.one("SELECT * FROM agent_runs WHERE id = $1", [id]);
    return row ? rowToAgentRun(row) : null;
  }

  async createAgentRunRecord(record: AgentRunInsert): Promise<AgentRunRecord> {
    await this.run(
      `INSERT INTO agent_runs (${AGENT_RUN_COLUMNS}) VALUES (${AGENT_RUN_VALUES})
       ON CONFLICT (id) DO UPDATE SET input_snapshot = EXCLUDED.input_snapshot, status = EXCLUDED.status,
       recommendation = EXCLUDED.recommendation, decision_score = EXCLUDED.decision_score,
       confidence = EXCLUDED.confidence, summary = EXCLUDED.summary, user_action = EXCLUDED.user_action`,
      agentRunToRow(record),
    );
    return {
      ...record,
      mode: record.mode ?? undefined,
      targetToken: record.targetToken ?? undefined,
      userAction: record.userAction ?? "pending",
      sourceStatuses: record.sourceStatuses ?? [],
    };
  }

  async listRecommendationRecords(walletAddress?: string): Promise<RecommendationRecord[]> {
    const rows = walletAddress
      ? await this.all("SELECT * FROM recommendations WHERE wallet_address = $1 ORDER BY created_at DESC", [walletAddress.trim().toLowerCase()])
      : await this.all("SELECT * FROM recommendations ORDER BY created_at DESC");
    return rows.map(rowToRecommendation);
  }

  async createRecommendationRecord(record: RecommendationRecord): Promise<RecommendationRecord> {
    await this.run(
      `INSERT INTO recommendations (id, run_id, wallet_address, action, decision_score, confidence, summary, decision_explanation, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET action = EXCLUDED.action, decision_score = EXCLUDED.decision_score,
       confidence = EXCLUDED.confidence, summary = EXCLUDED.summary`,
      [record.id, record.runId ?? null, record.walletAddress, record.action, record.decisionScore, record.confidence, record.summary, json({}), record.createdAt],
    );
    return record;
  }

  async listTransactionRecords(walletAddress?: string): Promise<TransactionRecord[]> {
    const rows = walletAddress
      ? await this.all("SELECT * FROM transactions WHERE wallet_address = $1 ORDER BY created_at DESC", [walletAddress.trim().toLowerCase()])
      : await this.all("SELECT * FROM transactions ORDER BY created_at DESC");
    return rows.map(rowToTransaction);
  }

  async getTransactionRecord(hash: string): Promise<TransactionRecord | null> {
    const row = await this.one("SELECT * FROM transactions WHERE lower(tx_hash) = lower($1) LIMIT 1", [hash]);
    return row ? rowToTransaction(row) : null;
  }

  async getTransactionRecordForFamily(hash: string, family: "evm" | "stellar"): Promise<TransactionRecord | null> {
    const normalized = family === "stellar" ? hash.trim().toUpperCase() : hash.trim().toLowerCase();
    const rows = await this.all("SELECT * FROM transactions WHERE chain_family = $1 ORDER BY created_at DESC", [family]);
    const match = rows.find((candidate) => {
      const value = asString(candidate.tx_hash);
      return (family === "stellar" ? value.toUpperCase() : value.toLowerCase()) === normalized;
    });
    return match ? rowToTransaction(match) : null;
  }

  async getTransactionRecordByIdempotencyKey(walletAddress: string, idempotencyKey: string): Promise<TransactionRecord | null> {
    if (!idempotencyKey) return null;
    const row = await this.one(
      "SELECT * FROM transactions WHERE wallet_address = $1 AND idempotency_key = $2 LIMIT 1",
      [walletAddress.trim().toLowerCase(), idempotencyKey],
    );
    return row ? rowToTransaction(row) : null;
  }

  async createTransactionRecord(record: TransactionRecord): Promise<TransactionRecord> {
    await this.run(
      `INSERT INTO transactions (${TRANSACTION_COLUMNS}) VALUES (${TRANSACTION_VALUES})
       ON CONFLICT (tx_hash) DO UPDATE SET lifecycle_status = EXCLUDED.lifecycle_status, status = EXCLUDED.status,
       observation_count = EXCLUDED.observation_count, confirmation_count = EXCLUDED.confirmation_count`,
      transactionToRow(record),
    );
    return record;
  }

  async updateTransactionRecord(hash: string, patch: Partial<TransactionRecord>): Promise<TransactionRecord | null> {
    const existing = await this.getTransactionRecord(hash);
    if (!existing) return null;
    const merged = { ...existing, ...patch, hash: existing.hash, createdAt: existing.createdAt };
    await this.run(
      `UPDATE transactions SET wallet_address = $2, lifecycle_status = $3, status = $4, poll_attempts = $5,
       confirmation_count = $6, required_confirmations = $7, finality_reached = $8, observation_count = $9,
       failure_reason = $10, manual_review_reason = $11, replacement_hash = $12, last_observed_block_hash = $13,
       missing_observation_count = $14, submitted_at = $15, terminal_at = $16, last_polled_at = $17
       WHERE lower(tx_hash) = lower($1)`,
      [
        hash,
        merged.walletAddress ?? null,
        merged.lifecycleStatus ?? merged.status,
        merged.status,
        merged.pollAttempts ?? 0,
        merged.confirmationCount ?? 0,
        merged.requiredConfirmations ?? 1,
        merged.finalityReached ?? false,
        merged.observationCount ?? 0,
        merged.failureReason ?? null,
        merged.manualReviewReason ?? null,
        merged.replacementHash ?? null,
        merged.lastObservedBlockHash ?? null,
        merged.missingObservationCount ?? 0,
        merged.submittedAt ?? null,
        merged.terminalAt ?? null,
        merged.lastPolledAt ?? null,
      ],
    );
    return merged;
  }

  async removeTransactionRecordByHash(hash: string): Promise<boolean> {
    return (await this.run("DELETE FROM transactions WHERE lower(tx_hash) = lower($1)", [hash])) > 0;
  }

  async listTransactionLifecycleEvents(hash: string): Promise<TransactionLifecycleEvent[]> {
    const rows = await this.all("SELECT * FROM transaction_lifecycle_events WHERE transaction_hash = $1 ORDER BY occurred_at DESC", [hash]);
    return rows.map((row): TransactionLifecycleEvent => ({
      id: asString(row.id),
      hash: asString(row.transaction_hash),
      event: row.event as TransactionLifecycleEvent["event"],
      detail: (row.detail as TransactionLifecycleEvent["detail"]) ?? undefined,
      provider: optionalIso(row.provider),
      providerUrl: optionalIso(row.provider_url),
      occurredAt: asString(row.occurred_at),
    }));
  }

  async createTransactionLifecycleEvent(event: TransactionLifecycleEvent): Promise<TransactionLifecycleEvent> {
    await this.run(
      `INSERT INTO transaction_lifecycle_events (id, transaction_hash, event, detail, provider, provider_url, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [event.id, event.hash, event.event, json(event.detail ?? {}), event.provider ?? null, event.providerUrl ?? null, event.occurredAt],
    );
    return event;
  }

  async listTransactionObservations(hash: string): Promise<TransactionObservation[]> {
    const rows = await this.all("SELECT * FROM transaction_observations WHERE transaction_hash = $1 ORDER BY observed_at DESC", [hash]);
    return rows.map(rowToTransactionObservation);
  }

  async createTransactionObservation(observation: TransactionObservation): Promise<TransactionObservation> {
    await this.run(
      `INSERT INTO transaction_observations (id, transaction_hash, evidence_key, chain_family, network, provider, provider_url, status, block_number, block_hash, ledger_sequence, confirmations, required_confirmations, replacement_hash, nonce, detail, observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (transaction_hash, evidence_key) DO NOTHING`,
      [
        observation.id,
        observation.hash,
        observation.evidenceKey,
        observation.chainFamily,
        observation.network,
        observation.provider,
        observation.providerUrl ?? null,
        observation.status,
        observation.blockNumber ?? null,
        observation.blockHash ?? null,
        observation.ledgerSequence ?? null,
        observation.confirmations,
        observation.requiredConfirmations,
        observation.replacementHash ?? null,
        observation.nonce ?? null,
        observation.detail ?? null,
        observation.observedAt,
      ],
    );
    return observation;
  }

  async listApprovalRecords(walletAddress?: string): Promise<UserApprovalRecord[]> {
    const rows = walletAddress
      ? await this.all("SELECT * FROM approvals WHERE wallet_address = $1 ORDER BY created_at DESC", [walletAddress.trim().toLowerCase()])
      : await this.all("SELECT * FROM approvals ORDER BY created_at DESC");
    return rows.map(rowToApproval);
  }

  async createApprovalRecord(record: UserApprovalRecord): Promise<UserApprovalRecord> {
    await this.run(
      `INSERT INTO approvals (id, wallet_address, decision_id, tx_hash, network, action, asset, value_usd, status, auto_executed, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
      [record.id, record.walletAddress, record.decisionId ?? null, record.txHash, record.network ?? null, record.action ?? null, record.asset ?? null, record.valueUsd ?? null, record.status, record.autoExecuted, record.createdAt],
    );
    return record;
  }

  async getUserRuleRecord(walletAddress: string): Promise<UserRule | null> {
    const row = await this.one("SELECT * FROM user_rules WHERE wallet_address = $1", [walletAddress]);
    return row ? rowToUserRule(row) : null;
  }

  async upsertUserRuleRecord(rule: UserRule): Promise<UserRule> {
    await this.run(
      `INSERT INTO user_rules (wallet_address, max_risk_score, max_trade_percent, max_meme_exposure_percent,
       max_daily_transaction_value_usd, max_slippage_bps, allowed_chains, blocked_tokens, allowed_actions, auto_execute, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (wallet_address) DO UPDATE SET max_risk_score = EXCLUDED.max_risk_score,
       max_trade_percent = EXCLUDED.max_trade_percent, max_meme_exposure_percent = EXCLUDED.max_meme_exposure_percent,
       max_daily_transaction_value_usd = EXCLUDED.max_daily_transaction_value_usd, max_slippage_bps = EXCLUDED.max_slippage_bps,
       allowed_chains = EXCLUDED.allowed_chains, blocked_tokens = EXCLUDED.blocked_tokens,
       allowed_actions = EXCLUDED.allowed_actions`,
      [
        rule.walletAddress,
        rule.maxRiskScore,
        rule.maxTradePercent,
        rule.maxMemeExposurePercent,
        rule.maxDailyTransactionValueUsd ?? 1000,
        rule.maxSlippageBps ?? 100,
        json(rule.allowedChains ?? []),
        json(rule.blockedTokens ?? []),
        json(rule.allowedActions ?? []),
        false,
        rule.createdAt,
      ],
    );
    return rule;
  }

  async listX402PaymentReceipts(): Promise<X402PaymentReceipt[]> {
    return (await this.all("SELECT * FROM x402_payment_receipts ORDER BY created_at DESC")).map(rowToX402);
  }

  async getX402PaymentReceiptByHeaderHash(paymentHeaderHash: string): Promise<X402PaymentReceipt | null> {
    const row = await this.one("SELECT * FROM x402_payment_receipts WHERE payment_header_hash = $1", [paymentHeaderHash]);
    return row ? rowToX402(row) : null;
  }

  async getX402PaymentReceiptByTxHash(transactionHash: string): Promise<X402PaymentReceipt | null> {
    const row = await this.one("SELECT * FROM x402_payment_receipts WHERE transaction_hash = $1 LIMIT 1", [transactionHash]);
    return row ? rowToX402(row) : null;
  }

  async createX402PaymentReceipt(record: X402PaymentReceipt): Promise<X402PaymentReceipt> {
    const existing = await this.getX402PaymentReceiptByHeaderHash(record.paymentHeaderHash);
    if (existing) return { ...existing, verificationStatus: "duplicate", updatedAt: new Date().toISOString() };
    await this.run(
      `INSERT INTO x402_payment_receipts (id, request_id, payment_header_hash, wallet_address, payer, transaction_hash,
       chain_family, payer_identity, network, asset, amount, price_usd, pay_to, facilitator_url, protected_resource,
       request_body_hash, payment_expiry, verification_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (payment_header_hash) DO NOTHING`,
      [
        record.id,
        record.requestId,
        record.paymentHeaderHash,
        record.walletAddress ?? null,
        record.payer ?? null,
        record.transactionHash ?? null,
        record.chainFamily ?? "evm",
        json(record.payerIdentity ?? {}),
        record.network,
        record.asset,
        record.amount,
        record.priceUsd,
        record.payTo,
        record.facilitatorUrl,
        record.protectedResource,
        record.requestBodyHash,
        record.paymentExpiry ?? null,
        record.verificationStatus,
        record.createdAt,
        record.updatedAt,
      ],
    );
    return record;
  }

  async listRiskSnapshots(identityKey?: string): Promise<RiskSnapshotRecord[]> {
    const rows = identityKey
      ? await this.all("SELECT * FROM risk_snapshots WHERE identity_key = $1 ORDER BY created_at DESC", [identityKey])
      : await this.all("SELECT * FROM risk_snapshots ORDER BY created_at DESC");
    return rows.map(rowToRiskSnapshot);
  }

  async getRiskSnapshot(id: string): Promise<RiskSnapshotRecord | null> {
    const row = await this.one("SELECT * FROM risk_snapshots WHERE id = $1", [id]);
    return row ? rowToRiskSnapshot(row) : null;
  }

  async createRiskSnapshot(record: RiskSnapshotRecord): Promise<RiskSnapshotRecord> {
    await this.run(
      `INSERT INTO risk_snapshots (id, schema_version, snapshot, canonical_hash, identity_key, revocation_token_hash, created_at, expires_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [record.id, record.schemaVersion, json(record.snapshot), record.canonicalHash, record.identityKey, record.revocationTokenHash, record.createdAt, record.expiresAt, record.revokedAt ?? null],
    );
    return record;
  }

  async revokeRiskSnapshot(id: string, revokedAt: string): Promise<RiskSnapshotRecord | null> {
    await this.run("UPDATE risk_snapshots SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL", [id, revokedAt]);
    return this.getRiskSnapshot(id);
  }

  async listAlertRules(walletAddress?: string): Promise<AlertRule[]> {
    const rows = walletAddress
      ? await this.all("SELECT * FROM alert_rules WHERE wallet_address = $1 ORDER BY created_at DESC", [walletAddress.trim().toLowerCase()])
      : await this.all("SELECT * FROM alert_rules ORDER BY created_at DESC");
    return rows.map(rowToAlertRule);
  }

  async getAlertRule(id: string): Promise<AlertRule | null> {
    const row = await this.one("SELECT * FROM alert_rules WHERE id = $1", [id]);
    return row ? rowToAlertRule(row) : null;
  }

  async upsertAlertRule(rule: AlertRule): Promise<AlertRule> {
    await this.run(
      `INSERT INTO alert_rules (id, wallet_address, trigger_type, observation_key, threshold, hysteresis,
       cooldown_minutes, direction, severity, enabled, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET threshold = EXCLUDED.threshold, hysteresis = EXCLUDED.hysteresis,
       cooldown_minutes = EXCLUDED.cooldown_minutes, direction = EXCLUDED.direction, severity = EXCLUDED.severity,
       enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`,
      alertRuleToRow(rule),
    );
    return rule;
  }

  async deleteAlertRule(id: string, walletAddress?: string): Promise<boolean> {
    const values = walletAddress ? [id, walletAddress.trim().toLowerCase()] : [id];
    const sql = walletAddress
      ? "DELETE FROM alert_rules WHERE id = $1 AND wallet_address = $2"
      : "DELETE FROM alert_rules WHERE id = $1";
    return (await this.run(sql, values)) > 0;
  }

  async ensureAlertRulesForWallet(walletAddress?: string): Promise<AlertRule[]> {
    return this.listAlertRules(walletAddress);
  }

  async listAlertObservations(walletAddress?: string, limit = 200): Promise<AlertObservation[]> {
    const rows = walletAddress
      ? await this.all("SELECT * FROM alert_observations WHERE wallet_address = $1 ORDER BY created_at DESC LIMIT $2", [walletAddress.trim().toLowerCase(), limit])
      : await this.all("SELECT * FROM alert_observations ORDER BY created_at DESC LIMIT $1", [limit]);
    return rows.map(rowToAlertObservation);
  }

  async createAlertObservation(observation: AlertObservation): Promise<AlertObservation> {
    await this.run(
      `INSERT INTO alert_observations (id, wallet_address, trigger_type, observation_key, value, direction, evidence, incomplete_data, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) ON CONFLICT (id) DO NOTHING`,
      alertObservationToRow(observation),
    );
    return observation;
  }

  async listAlerts(walletAddress?: string, status?: Alert["status"], limit = 200): Promise<Alert[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (walletAddress) {
      values.push(walletAddress.trim().toLowerCase());
      clauses.push(`wallet_address = $${values.length}`);
    }
    if (status) {
      values.push(status);
      clauses.push(`status = $${values.length}`);
    }
    values.push(limit);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.all(`SELECT * FROM alerts ${where} ORDER BY triggered_at DESC LIMIT $${values.length}`, values);
    return rows.map(rowToAlert);
  }

  async getAlert(id: string, walletAddress?: string): Promise<Alert | null> {
    const row = walletAddress
      ? await this.one("SELECT * FROM alerts WHERE id = $1 AND wallet_address = $2", [id, walletAddress.trim().toLowerCase()])
      : await this.one("SELECT * FROM alerts WHERE id = $1", [id]);
    return row ? rowToAlert(row) : null;
  }

  async createAlert(alert: Alert): Promise<Alert> {
    await this.run(
      `INSERT INTO alerts (id, wallet_address, rule_id, trigger_type, observation_key, status, severity, message,
       before_value, after_value, evidence_before, evidence_after, evidence_data, delivery_summary, triggered_at, recovered_at, acknowledged_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, recovered_at = EXCLUDED.recovered_at, acknowledged_at = EXCLUDED.acknowledged_at`,
      alertToRow(alert),
    );
    return alert;
  }

  async updateAlert(id: string, walletAddress: string, patch: Partial<Alert>): Promise<Alert | null> {
    const existing = await this.getAlert(id, walletAddress);
    if (!existing) return null;
    const merged = { ...existing, ...patch };
    await this.run(
      `UPDATE alerts SET status = $3, severity = $4, message = $5, recovered_at = $6, acknowledged_at = $7, delivery_summary = $8::jsonb
       WHERE id = $1 AND wallet_address = $2`,
      [id, walletAddress.trim().toLowerCase(), merged.status, merged.severity, merged.message, merged.recoveredAt ?? null, merged.acknowledgedAt ?? null, json(merged.deliverySummary ?? {})],
    );
    return merged;
  }

  async createAlertBundle(bundle: AlertBundle): Promise<AlertBundle> {
    return this.transaction(async (client) => {
      await client.query(
        `INSERT INTO alert_rules (id, wallet_address, trigger_type, observation_key, threshold, hysteresis,
         cooldown_minutes, direction, severity, enabled, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET threshold = EXCLUDED.threshold, updated_at = EXCLUDED.updated_at`,
        alertRuleToRow(bundle.rule),
      );
      await client.query(
        `INSERT INTO alert_observations (id, wallet_address, trigger_type, observation_key, value, direction, evidence, incomplete_data, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) ON CONFLICT (id) DO NOTHING`,
        alertObservationToRow(bundle.observation),
      );
      await client.query(
        `INSERT INTO alerts (id, wallet_address, rule_id, trigger_type, observation_key, status, severity, message,
         before_value, after_value, evidence_before, evidence_after, evidence_data, delivery_summary, triggered_at, recovered_at, acknowledged_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16,$17)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
        alertToRow(bundle.alert),
      );
      for (const delivery of bundle.deliveries) {
        const row = alertDeliveryToRow(delivery);
        await client.query(
          `INSERT INTO alert_deliveries (id, alert_id, wallet_address, channel, status, error_detail,
           sanitized_payload, attempt_count, created_at, sent_at, idempotency_key, provider_message_id, next_retry_at, last_attempt_at, terminal)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, attempt_count = EXCLUDED.attempt_count`,
          [row.id, row.alert_id, row.wallet_address, row.channel, row.status, row.error_detail, json(row.sanitized_payload), row.attempt_count, row.created_at, row.sent_at, row.idempotency_key, row.provider_message_id, row.next_retry_at, row.last_attempt_at, row.terminal ?? false],
        );
      }
      return bundle;
    });
  }

  async listAlertDeliveries(alertId?: string, walletAddress?: string): Promise<AlertDelivery[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (alertId) {
      values.push(alertId);
      clauses.push(`alert_id = $${values.length}`);
    }
    if (walletAddress) {
      values.push(walletAddress.trim().toLowerCase());
      clauses.push(`wallet_address = $${values.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.all(`SELECT * FROM alert_deliveries ${where} ORDER BY created_at DESC`, values);
    return rows.map((row) => rowToAlertDelivery(row));
  }

  async getAlertDeliveryByIdempotencyKey(walletAddress: string, idempotencyKey: string): Promise<AlertDelivery | null> {
    const row = await this.one("SELECT * FROM alert_deliveries WHERE wallet_address = $1 AND idempotency_key = $2", [walletAddress.trim().toLowerCase(), idempotencyKey]);
    return row ? rowToAlertDelivery(row) : null;
  }

  async createAlertDelivery(record: AlertDelivery): Promise<AlertDelivery> {
    const row = alertDeliveryToRow(record);
    await this.run(
      `INSERT INTO alert_deliveries (id, alert_id, wallet_address, channel, status, error_detail, sanitized_payload,
       attempt_count, created_at, sent_at, idempotency_key, provider_message_id, next_retry_at, last_attempt_at, terminal)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, attempt_count = EXCLUDED.attempt_count`,
      [row.id, row.alert_id, row.wallet_address, row.channel, row.status, row.error_detail, json(row.sanitized_payload), row.attempt_count, row.created_at, row.sent_at, row.idempotency_key, row.provider_message_id, row.next_retry_at, row.last_attempt_at, row.terminal ?? false],
    );
    return rowToAlertDelivery(row);
  }

  async updateAlertDelivery(id: string, walletAddress: string, patch: Partial<AlertDelivery>): Promise<AlertDelivery | null> {
    const existing = await this.getAlertDeliveryByIdempotencyKey(walletAddress, patch.idempotencyKey ?? "");
    const current = existing ?? (await this.one("SELECT * FROM alert_deliveries WHERE id = $1 AND wallet_address = $2", [id, walletAddress.trim().toLowerCase()]));
    if (!current) return null;
    const merged = rowToAlertDelivery({ ...current, ...alertDeliveryToRow({ ...rowToAlertDelivery(current), ...patch }) });
    const row = alertDeliveryToRow(merged);
    await this.run(
      `UPDATE alert_deliveries SET status = $3, error_detail = $4, attempt_count = $5, sent_at = $6, terminal = $7
       WHERE id = $1 AND wallet_address = $2`,
      [id, walletAddress.trim().toLowerCase(), row.status, row.error_detail, row.attempt_count, row.sent_at, row.terminal ?? false],
    );
    return merged;
  }

  async getNotificationPreferences(scope: {
    walletAddress: string;
    chainFamily: "evm" | "stellar";
    network: string;
  }): Promise<NotificationPreferences | null> {
    const row = await this.one(
      "SELECT * FROM notification_preferences WHERE wallet_address = $1 AND chain_family = $2 AND network = $3",
      [scope.walletAddress, scope.chainFamily, scope.network || "legacy-evm"],
    );
    return row ? rowToNotificationPreferences(row) : null;
  }

  async listNotificationPreferences(walletAddress?: string): Promise<NotificationPreferences[]> {
    const rows = walletAddress
      ? await this.all("SELECT * FROM notification_preferences WHERE wallet_address = $1 ORDER BY updated_at DESC", [walletAddress.trim().toLowerCase()])
      : await this.all("SELECT * FROM notification_preferences ORDER BY updated_at DESC");
    return rows.map(rowToNotificationPreferences);
  }

  async upsertNotificationPreferences(prefs: NotificationPreferences): Promise<NotificationPreferences> {
    const network = prefs.network || "legacy-evm";
    await this.run(
      `INSERT INTO notification_preferences (id, wallet_address, chain_family, network, prefs, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)
       ON CONFLICT (id) DO UPDATE SET wallet_address = EXCLUDED.wallet_address, prefs = EXCLUDED.prefs, updated_at = EXCLUDED.updated_at`,
      [prefs.id, prefs.walletAddress, prefs.chainFamily, network, json(notificationPrefsToPayload(prefs)), new Date().toISOString()],
    );
    return { ...prefs, network, updatedAt: new Date().toISOString() };
  }

  async deleteNotificationPreferences(id: string): Promise<boolean> {
    return (await this.run("DELETE FROM notification_preferences WHERE id = $1", [id])) > 0;
  }

  async listWatchlistEntries(walletAddress?: string): Promise<WatchlistEntry[]> {
    const rows = walletAddress
      ? await this.all("SELECT * FROM watchlist_entries WHERE wallet_address = $1 ORDER BY created_at DESC", [walletAddress.trim().toLowerCase()])
      : await this.all("SELECT * FROM watchlist_entries ORDER BY created_at DESC");
    return rows.map(rowToWatchlistEntry);
  }

  async getWatchlistEntry(id: string): Promise<WatchlistEntry | null> {
    const row = await this.one("SELECT * FROM watchlist_entries WHERE id = $1", [id]);
    return row ? rowToWatchlistEntry(row) : null;
  }

  async addWatchlistEntry(entry: WatchlistEntry): Promise<{ entry: WatchlistEntry; alreadyExisted: boolean }> {
    const existing = await this.one("SELECT * FROM watchlist_entries WHERE wallet_address = $1 AND identity_key = $2", [entry.walletAddress, entry.identityKey]);
    if (existing) return { entry: rowToWatchlistEntry(existing), alreadyExisted: true };
    await this.run(
      `INSERT INTO watchlist_entries (${WATCHLIST_COLUMNS}) VALUES (${WATCHLIST_VALUES}) ON CONFLICT (id) DO NOTHING`,
      watchlistEntryToRow(entry),
    );
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
    await this.transaction(async (client) => {
      await client.query("DELETE FROM watchlist_scan_runs WHERE entry_id = $1", [id]);
      await client.query("DELETE FROM discovery_alerts WHERE entry_id = $1", [id]);
      await client.query("DELETE FROM watchlist_entries WHERE id = $1", [id]);
    });
    return true;
  }

  async updateWatchlistEntryDetails(id: string, details: Partial<WatchlistEntry>): Promise<WatchlistEntry | null> {
    const current = await this.getWatchlistEntry(id);
    if (!current) return null;
    const merged = { ...current, ...details };
    await this.run(
      `UPDATE watchlist_entries SET note = $2, pair_address = $3, symbol = $4, token_name = $5 WHERE id = $1`,
      [id, merged.note ?? null, merged.pairAddress ?? null, merged.symbol ?? null, merged.tokenName ?? null],
    );
    return merged;
  }

  async listWatchlistScanRuns(entryId?: string): Promise<WatchlistScanRun[]> {
    const rows = entryId
      ? await this.all("SELECT * FROM watchlist_scan_runs WHERE entry_id = $1 ORDER BY scanned_at DESC", [entryId])
      : await this.all("SELECT * FROM watchlist_scan_runs ORDER BY scanned_at DESC");
    return rows.map(rowToWatchlistScanRun);
  }

  async addWatchlistScanRun(run: WatchlistScanRunInsert): Promise<WatchlistScanRun> {
    await this.run(
      `INSERT INTO watchlist_scan_runs (id, entry_id, wallet_address, identity_key, agent_run_id, classification,
       classification_reasons, confidence, score, source_lineage, missing_data, risk_report, status, previous_run_id, scanned_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET classification = EXCLUDED.classification, score = EXCLUDED.score, status = EXCLUDED.status`,
      [
        run.id,
        run.entryId,
        run.walletAddress,
        run.identityKey,
        run.agentRunId ?? null,
        run.classification,
        json(run.classificationReasons),
        run.confidence,
        run.score,
        json(run.sourceLineage),
        json(run.missingData),
        run.riskReport == null ? null : json(run.riskReport),
        run.status,
        run.previousRunId ?? null,
        run.scannedAt,
      ],
    );
    return { ...run, classification: run.classification as WatchlistScanRun["classification"], status: run.status as WatchlistScanRun["status"] } as WatchlistScanRun;
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
    await this.run(
      `UPDATE watchlist_entries SET last_scanned_at = $2, latest_scan_run_id = $3, latest_classification = $4,
       latest_score = $5, latest_status = $6 WHERE id = $1`,
      [id, update.scannedAt, update.scanRunId, update.classification, update.score, update.status === "failed" ? "stale" : update.status],
    );
    return this.getWatchlistEntry(id);
  }

  async createDiscoveryAlert(alert: DiscoveryAlertInsert): Promise<DiscoveryAlert> {
    await this.run(
      `INSERT INTO discovery_alerts (id, wallet_address, entry_id, run_id, kind, title, detail, severity, source_label, acknowledged, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
      [alert.id, alert.walletAddress, alert.entryId ?? null, alert.runId ?? null, alert.kind, alert.title, alert.detail, alert.severity, alert.sourceLabel ?? null, alert.acknowledged, alert.createdAt],
    );
    return { ...alert, kind: alert.kind as DiscoveryAlert["kind"], severity: alert.severity as DiscoveryAlert["severity"] };
  }

  async listDiscoveryAlerts(walletAddress?: string): Promise<DiscoveryAlert[]> {
    const rows = walletAddress
      ? await this.all("SELECT * FROM discovery_alerts WHERE wallet_address = $1 ORDER BY created_at DESC", [walletAddress.trim().toLowerCase()])
      : await this.all("SELECT * FROM discovery_alerts ORDER BY created_at DESC");
    return rows.map(rowToDiscoveryAlert);
  }

  async acknowledgeDiscoveryAlert(id: string): Promise<DiscoveryAlert | null> {
    await this.run("UPDATE discovery_alerts SET acknowledged = true WHERE id = $1", [id]);
    const row = await this.one("SELECT * FROM discovery_alerts WHERE id = $1", [id]);
    return row ? rowToDiscoveryAlert(row) : null;
  }

  async exportWalletData(walletAddress: string, network?: string): Promise<WalletExportData> {
    const tables = [
      "agent_runs",
      "recommendations",
      "approvals",
      "transactions",
      "x402_payment_receipts",
      "user_rules",
      "alert_rules",
      "alert_observations",
      "alerts",
      "alert_deliveries",
      "watchlist_entries",
      "watchlist_scan_runs",
      "discovery_alerts",
    ];
    const result: WalletExportData = {};
    for (const table of tables) {
      const networkClause = network && table !== "user_rules" ? " AND network = $2" : "";
      const values = networkClause ? [walletAddress, network] : [walletAddress];
      result[table] = await this.all(`SELECT * FROM ${table} WHERE wallet_address = $1${networkClause}`, values);
    }
    return result;
  }

  async deleteWalletData(walletAddress: string, network?: string): Promise<WalletDeleteResult> {
    return this.transaction(async (client) => {
      const hardDeleteTables = ["agent_runs", "recommendations", "approvals", "user_rules", "alert_rules", "alert_observations", "alerts", "alert_deliveries", "watchlist_entries", "watchlist_scan_runs", "discovery_alerts"];
      let deletedCount = 0;
      for (const table of hardDeleteTables) {
        const result = await client.query(`DELETE FROM ${table} WHERE wallet_address = $1`, [walletAddress]);
        deletedCount += result.rowCount;
      }
      const unlink = await client.query(
        `UPDATE transactions SET wallet_address = NULL WHERE wallet_address = $1 AND ($2::text IS NULL OR network = $2)`,
        [walletAddress, network ?? null],
      );
      const receiptUnlink = await client.query(
        `UPDATE x402_payment_receipts SET wallet_address = NULL, payer = NULL WHERE (wallet_address = $1 OR payer = $1) AND ($2::text IS NULL OR network = $2)`,
        [walletAddress, network ?? null],
      );
      return { deletedCount, unlinkedAuditCount: unlink.rowCount + receiptUnlink.rowCount };
    });
  }

  async pruneExpiredRecords(now: string): Promise<number> {
    return this.run("DELETE FROM risk_snapshots WHERE expires_at IS NOT NULL AND expires_at < $1", [now]);
  }

  async getStorageHealth(): Promise<StorageHealth> {
    const probe = await this.ping();
    const pool = await this.poolStatus(probe.latencyMs);
    const livePool = { ...pool, connected: probe.ok && pool.connected };
    return {
      provider: "supabase_postgres",
      persistent: probe.ok,
      latencyMs: probe.latencyMs,
      pool: livePool,
      detail: probe.ok
        ? `Postgres pool reachable in ${probe.latencyMs}ms (${livePool.total} connections, ${livePool.idle} idle, ${livePool.waiting} waiting).`
        : `Postgres storage unavailable: ${probe.detail}`,
      schema: storageSchemaContract,
    };
  }

  async getStorageCounts(): Promise<StorageCounts> {
    const names: Array<[keyof StorageCounts, string]> = [
      ["agentRuns", "agent_runs"],
      ["recommendations", "recommendations"],
      ["transactions", "transactions"],
      ["approvals", "approvals"],
      ["userRules", "user_rules"],
      ["x402PaymentReceipts", "x402_payment_receipts"],
      ["alertRules", "alert_rules"],
      ["alertObservations", "alert_observations"],
      ["alerts", "alerts"],
      ["alertDeliveries", "alert_deliveries"],
      ["notificationPreferences", "notification_preferences"],
    ];
    const counts = {} as StorageCounts;
    for (const [key, table] of names) {
      const row = await this.one<{ count: string | number }>(`SELECT count(*)::int AS count FROM ${table}`);
      counts[key] = asNumber(row?.count, 0);
    }
    return counts;
  }

  async performHealthProbe(): Promise<HealthProbeResult> {
    const probeId = `probe_${Date.now()}`;
    const now = new Date().toISOString();
    try {
      const writeStart = Date.now();
      await this.run(
        `INSERT INTO agent_runs (${AGENT_RUN_COLUMNS}) VALUES (${AGENT_RUN_VALUES})`,
        agentRunToRow({
          id: probeId,
          walletAddress: "probe_health_check",
          mode: null,
          targetToken: null,
          status: "completed",
          recommendation: "no_action",
          decisionScore: 0,
          confidence: 0,
          summary: "Health probe record — safe to delete",
          results: [],
          sourceStatuses: [],
          inputSnapshot: {},
          userAction: "pending",
          createdAt: now,
        }),
      );
      const writeLatency = Date.now() - writeStart;
      const readStart = Date.now();
      const readBack = await this.one("SELECT id FROM agent_runs WHERE id = $1", [probeId]);
      const readLatency = Date.now() - readStart;
      await this.run("DELETE FROM agent_runs WHERE id = $1", [probeId]);
      return {
        ok: Boolean(readBack),
        write: { ok: true, latencyMs: writeLatency },
        read: { ok: Boolean(readBack), latencyMs: readLatency },
        clean: { ok: true },
        detail: `Postgres probe write ${writeLatency}ms, read ${readLatency}ms.`,
      };
    } catch (error) {
      return {
        ok: false,
        detail: `Postgres probe failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async eraseWalletData(walletAddress: string): Promise<ErasureAdapterResult> {
    const result = await this.deleteWalletData(walletAddress);
    return {
      tables: [
        { table: "wallet_data", action: "deleted", rowsAffected: result.deletedCount, strategy: "delete" },
        { table: "audit_records", action: "anonymized", rowsAffected: result.unlinkedAuditCount, strategy: "anonymize" },
      ],
    };
  }

  async residueCheck(walletAddress: string): Promise<ResidueAdapterResult> {
    const rows = await this.all<{ table_name: string }>(
      `SELECT 'agent_runs' AS table_name FROM agent_runs WHERE wallet_address = $1
       UNION ALL SELECT 'transactions' FROM transactions WHERE wallet_address = $1
       UNION ALL SELECT 'x402_payment_receipts' FROM x402_payment_receipts WHERE wallet_address = $1
       UNION ALL SELECT 'watchlist_entries' FROM watchlist_entries WHERE wallet_address = $1`,
      [walletAddress],
    );
    return { leaks: rows.map((row) => ({ store: row.table_name, field: "wallet_address", hint: walletAddress.slice(0, 8) })) };
  }

  async storeErasureReceipt(receipt: StoredErasureReceipt): Promise<StoredErasureReceipt> {
    await this.run(
      `INSERT INTO erasure_receipts (receipt_id, wallet_hash, chain_family, network, erased_at, sha256, receipt_body, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (receipt_id) DO NOTHING`,
      [receipt.receiptId, receipt.walletHash, receipt.chainFamily, receipt.network ?? null, receipt.erasedAt, receipt.sha256, receipt.receiptBody, receipt.createdAt],
    );
    return receipt;
  }

  async getErasureReceipt(receiptId: string): Promise<StoredErasureReceipt | null> {
    const row = await this.one("SELECT * FROM erasure_receipts WHERE receipt_id = $1", [receiptId]);
    if (!row) return null;
    return {
      receiptId: asString(row.receipt_id),
      walletHash: asString(row.wallet_hash),
      chainFamily: row.chain_family as StoredErasureReceipt["chainFamily"],
      network: optionalIso(row.network),
      erasedAt: asString(row.erased_at),
      sha256: asString(row.sha256),
      receiptBody: asJsonText(row.receipt_body),
      createdAt: asString(row.created_at),
    };
  }
}

let adapterSingleton: PostgresStorageAdapter | null = null;

export function getPostgresStorageAdapter(): PostgresStorageAdapter {
  adapterSingleton ??= new PostgresStorageAdapter();
  return adapterSingleton;
}

export function createTracedPostgresStorageAdapter() {
  return wrapStorageAdapter(getPostgresStorageAdapter());
}

export async function exportWalletDataFromPg(walletAddress: string, network?: string, chainFamily?: "evm" | "stellar") {
  void chainFamily;
  return getPostgresStorageAdapter().exportWalletData(walletAddress, network);
}

export async function deleteWalletDataFromPg(walletAddress: string, network?: string, chainFamily?: "evm" | "stellar") {
  void chainFamily;
  return getPostgresStorageAdapter().deleteWalletData(walletAddress, network);
}

export async function pruneExpiredRecordsFromPg(now = new Date().toISOString()) {
  return getPostgresStorageAdapter().pruneExpiredRecords(now);
}

export const __rowMappers = {
  rule: rowToAlertRule,
  observation: rowToAlertObservation,
};
