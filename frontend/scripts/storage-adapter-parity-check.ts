import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryStorageAdapter } from "../src/server/storage/adapters/memory";
import { PostgresStorageAdapter } from "../src/server/storage/postgresAdapter";
import { storageSchemaContract } from "../src/server/storage/contract";
import type {
  AlertBundle,
  DiscoveryAlertInsert,
  IStorageAdapter,
  StoredErasureReceipt,
  AgentRunInsert,
  WatchlistScanRunInsert,
} from "../src/server/storage/adapters/types";
import type {
  Alert,
  AlertDelivery,
  AlertObservation,
  AlertRule,
  NotificationPreferences,
  RecommendationRecord,
  TransactionLifecycleEvent,
  TransactionObservation,
  TransactionRecord,
  UserApprovalRecord,
  UserRule,
  WatchlistEntry,
  X402PaymentReceipt,
} from "../src/server/types";
import type { RiskSnapshotRecord } from "../src/server/snapshots/schema";

type PgClient = {
  connect(): Promise<void>;
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  end(): Promise<void>;
};

type TraceEntry = { step: string; method: string; result: unknown };

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromProject = createRequire(path.join(projectRoot, "noop.cjs"));
const WALLET = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NETWORK = "base";
const TX_HASH = `0x${"a".repeat(64)}`;
const REMOVED_TX_HASH = `0x${"b".repeat(64)}`;
const TX_HASH_2 = `0x${"c".repeat(64)}`;
const time = (day: number) => new Date(Date.UTC(2025, 0, day, 12, 0, 0)).toISOString();
const sha = (character: string) => `sha256:${character.repeat(64)}`;

function fixture<T>(value: unknown): T {
  return value as T;
}

function makeFixtures() {
  const evidence = (runId: string, label: string) => ({
    runId,
    agent: "onchain" as const,
    label,
    detail: `${label} evidence`,
    sourceLabels: ["source-a"],
    sourceSnapshotHash: `hash-${label}`,
    beforeValue: 10,
    afterValue: 80,
  });
  const evidenceData = (observationId: string) => ({
    runId: "run-1",
    observationId,
    sourceSnapshotHashAfter: "hash-after",
    sourceSnapshotHashBefore: "hash-before",
    evidenceBeforeObservationId: "observation-1",
    evidenceAfterObservationId: observationId,
    evidenceBeforeHash: "hash-before",
    evidenceAfterHash: "hash-after",
    deteriorationObservationIds: [],
  });
  const deliveryPayload = {
    triggerType: "critical_risk" as const,
    severity: "critical" as const,
    summary: "critical risk detected",
    beforeValue: 10,
    afterValue: 80,
    observationKey: "riskScore",
    evidenceLinks: ["evidence-1"],
    walletHint: WALLET.slice(0, 8),
    sourceLabels: ["source-a"],
  };
  const deliverySummary = {
    delivered: ["in_app" as const],
    failed: [],
    skipped: [],
  };

  const agentRun = fixture<AgentRunInsert>({
    id: "run-1",
    walletAddress: WALLET,
    mode: "token_scan",
    targetToken: {
      symbol: "TEST",
      name: "Test Token",
      tokenAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
      chain: "evm",
    },
    status: "completed",
    recommendation: "buy_small",
    decisionScore: 70,
    confidence: 0.8,
    summary: "completed scan",
    results: [],
    sourceStatuses: [],
    inputSnapshot: { marker: "agent-run" },
    userAction: "pending",
    createdAt: time(1),
  });
  const recommendation = fixture<RecommendationRecord>({
    id: "recommendation-1",
    runId: agentRun.id,
    walletAddress: WALLET,
    action: "buy_small",
    decisionScore: 70,
    confidence: 0.8,
    summary: "buy a small amount",
    createdAt: time(2),
  });
  const transaction = fixture<TransactionRecord>({
    hash: TX_HASH,
    type: "transfer",
    decisionAction: "buy_small",
    asset: "USDC",
    valueUsd: 100,
    status: "confirmed",
    lifecycleStatus: "confirmed",
    chainFamily: "evm",
    createdAt: time(3),
    submittedAt: time(4),
    terminalAt: time(5),
    lastPolledAt: time(6),
    pollAttempts: 1,
    network: NETWORK,
    walletAddress: WALLET,
    sourceAccount: WALLET,
    userApproved: true,
    decisionId: "decision-1",
    policyStatus: {},
    expectedEffects: [],
    idempotencyKey: "idem-tx-1",
    explorerUrl: "https://example.invalid/tx",
    confirmationCount: 1,
    requiredConfirmations: 1,
    finalityReached: true,
    missingObservationCount: 0,
    observationCount: 1,
  });
  const removedTransaction = fixture<TransactionRecord>({
    ...transaction,
    hash: REMOVED_TX_HASH,
    idempotencyKey: "idem-tx-remove",
    createdAt: time(7),
  });
  const lifecycleEvent = fixture<TransactionLifecycleEvent>({
    id: "event-1",
    hash: TX_HASH,
    event: "submitted",
    detail: { source: "parity-test" },
    occurredAt: time(8),
    providerUrl: "https://example.invalid/provider",
  });
  const observation = fixture<TransactionObservation>({
    id: "observation-tx-1",
    hash: TX_HASH,
    evidenceKey: "evidence-tx-1",
    chainFamily: "evm",
    network: NETWORK,
    provider: "rpc-a",
    providerUrl: "https://example.invalid/rpc",
    status: "confirmed",
    confirmations: 2,
    requiredConfirmations: 2,
    detail: "confirmed",
    observedAt: time(9),
  });
  const approval = fixture<UserApprovalRecord>({
    id: "approval-1",
    walletAddress: WALLET,
    decisionId: "decision-1",
    txHash: TX_HASH,
    network: NETWORK,
    action: "buy_small",
    asset: "USDC",
    valueUsd: 100,
    status: "confirmed",
    autoExecuted: false,
    createdAt: time(10),
  });
  const userRule = fixture<UserRule>({
    walletAddress: WALLET,
    maxRiskScore: 80,
    maxTradePercent: 10,
    maxMemeExposurePercent: 5,
    maxDailyTransactionValueUsd: 1000,
    maxSlippageBps: 100,
    allowedChains: ["evm"],
    blockedTokens: ["0xdead"],
    allowedActions: ["buy_small"],
    autoExecute: false,
    createdAt: time(11),
  });
  const x402Receipt = fixture<X402PaymentReceipt>({
    id: "x402-1",
    requestId: "request-1",
    paymentHeaderHash: "header-hash-1",
    walletAddress: WALLET,
    payer: WALLET,
    transactionHash: TX_HASH_2,
    chainFamily: "evm",
    payerIdentity: { chainFamily: "evm", payer: WALLET, transactionHash: TX_HASH_2 },
    network: NETWORK,
    asset: "USDC",
    amount: "1000",
    priceUsd: "1",
    payTo: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    facilitatorUrl: "https://example.invalid/facilitator",
    protectedResource: "https://example.invalid/resource",
    requestBodyHash: "request-body-hash",
    paymentExpiry: time(30),
    verificationStatus: "verified",
    createdAt: time(12),
    updatedAt: time(13),
  });
  const activeSnapshot = fixture<RiskSnapshotRecord>({
    id: "snapshot-active",
    schemaVersion: "1",
    snapshot: { version: 1, walletHint: WALLET.slice(0, 8) },
    canonicalHash: sha("a"),
    identityKey: "identity-1",
    revocationTokenHash: sha("b"),
    createdAt: time(14),
    expiresAt: time(30),
  });
  const expiredSnapshot = fixture<RiskSnapshotRecord>({
    ...activeSnapshot,
    id: "snapshot-expired",
    canonicalHash: sha("c"),
    createdAt: time(15),
    expiresAt: time(16),
  });
  const alertRule = fixture<AlertRule>({
    id: "rule-1",
    walletAddress: WALLET,
    triggerType: "critical_risk",
    observationKey: "riskScore",
    threshold: 80,
    hysteresis: 5,
    cooldownMinutes: 15,
    direction: "high_is_bad",
    severity: "critical",
    enabled: true,
    createdAt: time(17),
    updatedAt: time(18),
  });
  const ruleToDelete = fixture<AlertRule>({
    ...alertRule,
    id: "rule-delete",
    triggerType: "liquidity_drop",
    createdAt: time(19),
    updatedAt: time(20),
  });
  const alertObservation = fixture<AlertObservation>({
    id: "observation-1",
    walletAddress: WALLET,
    triggerType: "critical_risk",
    observationKey: "riskScore",
    value: 80,
    direction: "high_is_bad",
    evidence: evidence("run-1", "risk-score"),
    createdAt: time(21),
    incompleteData: false,
  });
  const alert = fixture<Alert>({
    id: "alert-1",
    walletAddress: WALLET,
    ruleId: alertRule.id,
    triggerType: "critical_risk",
    observationKey: "riskScore",
    status: "triggered",
    severity: "critical",
    message: "critical risk",
    beforeValue: 10,
    afterValue: 80,
    evidenceBefore: evidence("run-1", "risk-before"),
    evidenceAfter: evidence("run-1", "risk-after"),
    evidenceData: evidenceData("observation-1"),
    triggeredAt: time(22),
    deliverySummary,
  });
  const delivery = fixture<AlertDelivery>({
    id: "delivery-1",
    alertId: alert.id,
    walletAddress: WALLET,
    channel: "in_app",
    status: "pending",
    sanitizedPayload: deliveryPayload,
    attemptCount: 0,
    createdAt: time(23),
    idempotencyKey: "idem-delivery-1",
    providerMessageId: "provider-1",
    nextRetryAt: time(24),
    lastAttemptAt: time(25),
    terminal: false,
  });
  const bundleRule = fixture<AlertRule>({
    ...alertRule,
    id: "bundle-rule",
    triggerType: "phishing_detected",
    createdAt: time(26),
    updatedAt: time(27),
  });
  const bundleObservation = fixture<AlertObservation>({
    ...alertObservation,
    id: "bundle-observation",
    triggerType: "phishing_detected",
    evidence: evidence("run-1", "phishing"),
    createdAt: time(28),
  });
  const bundleAlert = fixture<Alert>({
    ...alert,
    id: "bundle-alert",
    ruleId: bundleRule.id,
    triggerType: "phishing_detected",
    observationKey: "phishing",
    triggeredAt: time(29),
  });
  const bundleDelivery = fixture<AlertDelivery>({
    id: "bundle-delivery",
    alertId: bundleAlert.id,
    walletAddress: WALLET,
    channel: "in_app",
    status: "delivered",
    sanitizedPayload: { ...deliveryPayload, triggerType: "phishing_detected" },
    attemptCount: 1,
    createdAt: time(30),
    sentAt: time(31),
    terminal: true,
  });
  const bundle = fixture<AlertBundle>({
    rule: bundleRule,
    observation: bundleObservation,
    alert: bundleAlert,
    deliveries: [bundleDelivery],
  });
  const notificationPreferences = fixture<NotificationPreferences>({
    id: "prefs-1",
    walletAddress: WALLET,
    chainFamily: "evm",
    network: NETWORK,
    channels: {
      in_app: { enabled: true, minimumSeverity: "low" },
      email: { enabled: false, minimumSeverity: "high" },
      telegram: { enabled: false, minimumSeverity: "high" },
      discord: { enabled: false, minimumSeverity: "high" },
    },
    quietHours: { enabled: false, start: "22:00", end: "07:00", timeZone: "UTC" },
    digestCadence: "off",
    dedupeWindowMinutes: 30,
    updatedAt: time(32),
  });
  const watchlistEntry = fixture<WatchlistEntry>({
    id: "entry-1",
    walletAddress: WALLET,
    identityKey: "evm:base:0xdddd",
    chain: "evm",
    network: NETWORK,
    contractAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
    pairAddress: "0xffffffffffffffffffffffffffffffffffffffff",
    symbol: "TEST",
    tokenName: "Test Token",
    assetKey: "evm:base:0xdddd",
    issuer: "issuer-1",
    assetType: "contract",
    source: "manual_watchlist",
    note: "tracked",
    createdAt: time(33),
    successfulScanRunIds: [],
  });
  const bulkEntries = [
    fixture<WatchlistEntry>({
      ...watchlistEntry,
      id: "entry-2",
      identityKey: "evm:base:0xeeee",
      symbol: "TEST2",
      createdAt: time(34),
    }),
    fixture<WatchlistEntry>({
      ...watchlistEntry,
      id: "entry-3",
      identityKey: "evm:base:0x1111",
      symbol: "TEST3",
      createdAt: time(35),
    }),
  ];
  const scanRun = fixture<WatchlistScanRunInsert>({
    id: "scan-run-1",
    entryId: watchlistEntry.id,
    walletAddress: WALLET,
    identityKey: watchlistEntry.identityKey,
    agentRunId: agentRun.id,
    classification: "watch",
    classificationReasons: ["reason-1"],
    confidence: 0.7,
    score: 60,
    sourceLineage: [],
    missingData: [],
    status: "completed",
    scannedAt: time(36),
  });
  const discoveryAlert = fixture<DiscoveryAlertInsert>({
    id: "discovery-1",
    walletAddress: WALLET,
    entryId: watchlistEntry.id,
    runId: scanRun.id,
    kind: "classification_change",
    title: "classification changed",
    detail: "moved to watch",
    severity: "medium",
    sourceLabel: "source-a",
    acknowledged: false,
    createdAt: time(37),
  });
  const erasureReceipt = fixture<StoredErasureReceipt>({
    receiptId: "receipt-1",
    walletHash: "hash-wallet",
    chainFamily: "evm",
    network: NETWORK,
    erasedAt: time(38),
    sha256: "sha256-receipt",
    receiptBody: JSON.stringify({ receiptId: "receipt-1", walletHash: "hash-wallet" }),
    createdAt: time(39),
  });

  return {
    agentRun,
    recommendation,
    transaction,
    removedTransaction,
    lifecycleEvent,
    observation,
    approval,
    userRule,
    x402Receipt,
    activeSnapshot,
    expiredSnapshot,
    alertRule,
    ruleToDelete,
    alertObservation,
    alert,
    delivery,
    bundle,
    notificationPreferences,
    watchlistEntry,
    bulkEntries,
    scanRun,
    discoveryAlert,
    erasureReceipt,
  };
}

function canonicalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" && Object.is(value, -0)) return 0;
  if (Array.isArray(value)) {
    return value
      .map(canonicalize)
      .filter((item) => item !== undefined)
      .sort((left, right) => stable(left).localeCompare(stable(right)));
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const canonical = canonicalize(source[key]);
      if (canonical !== undefined) result[key] = canonical;
    }
    return result;
  }
  return value;
}

function stable(value: unknown): string {
  return JSON.stringify(canonicalize(value)) ?? "undefined";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalize(method: string, value: unknown): unknown {
  if (method === "getStorageHealth") {
    return canonicalize({ schema: asRecord(value).schema });
  }
  if (method === "performHealthProbe") {
    const probe = asRecord(value);
    return canonicalize({
      ok: probe.ok,
      write: asRecord(probe.write).ok,
      read: asRecord(probe.read).ok,
      clean: asRecord(probe.clean).ok,
    });
  }
  return canonicalize(value);
}

async function runScenario(adapter: IStorageAdapter): Promise<{ trace: TraceEntry[]; called: Set<string> }> {
  const fixtures = makeFixtures();
  const trace: TraceEntry[] = [];
  const called = new Set<string>();

  async function call<T>(step: string, method: string, operation: () => Promise<T>): Promise<T> {
    const result = await operation();
    called.add(method);
    trace.push({ step, method, result: normalize(method, result) });
    return result;
  }

  await call("agent runs empty", "listAgentRunRecords", () => adapter.listAgentRunRecords(WALLET));
  await call("agent run missing", "getAgentRunRecord", () => adapter.getAgentRunRecord("run-missing"));
  await call("agent run create", "createAgentRunRecord", () => adapter.createAgentRunRecord(fixtures.agentRun));
  await call("agent run get", "getAgentRunRecord", () => adapter.getAgentRunRecord(fixtures.agentRun.id));
  await call("agent runs list", "listAgentRunRecords", () => adapter.listAgentRunRecords(WALLET));

  await call("recommendations empty", "listRecommendationRecords", () => adapter.listRecommendationRecords(WALLET));
  await call("recommendation create", "createRecommendationRecord", () => adapter.createRecommendationRecord(fixtures.recommendation));
  await call("recommendations list", "listRecommendationRecords", () => adapter.listRecommendationRecords(WALLET));

  await call("transactions empty", "listTransactionRecords", () => adapter.listTransactionRecords(WALLET));
  await call("transaction create", "createTransactionRecord", () => adapter.createTransactionRecord(fixtures.transaction));
  await call("transaction create removed", "createTransactionRecord", () => adapter.createTransactionRecord(fixtures.removedTransaction));
  await call("transaction get", "getTransactionRecord", () => adapter.getTransactionRecord(fixtures.transaction.hash));
  await call("transaction family", "getTransactionRecordForFamily", () => adapter.getTransactionRecordForFamily(fixtures.transaction.hash, "evm"));
  await call("transaction idempotency", "getTransactionRecordByIdempotencyKey", () => adapter.getTransactionRecordByIdempotencyKey(WALLET, fixtures.transaction.idempotencyKey!));
  await call("transactions list", "listTransactionRecords", () => adapter.listTransactionRecords(WALLET));
  await call("transaction update", "updateTransactionRecord", () => adapter.updateTransactionRecord(fixtures.transaction.hash, { confirmationCount: 2, pollAttempts: 2 }));
  await call("transaction remove", "removeTransactionRecordByHash", () => adapter.removeTransactionRecordByHash(fixtures.removedTransaction.hash));

  await call("lifecycle events empty", "listTransactionLifecycleEvents", () => adapter.listTransactionLifecycleEvents(fixtures.transaction.hash));
  await call("lifecycle event create", "createTransactionLifecycleEvent", () => adapter.createTransactionLifecycleEvent(fixtures.lifecycleEvent));
  await call("lifecycle events list", "listTransactionLifecycleEvents", () => adapter.listTransactionLifecycleEvents(fixtures.transaction.hash));

  await call("transaction observations empty", "listTransactionObservations", () => adapter.listTransactionObservations(fixtures.transaction.hash));
  await call("transaction observation create", "createTransactionObservation", () => adapter.createTransactionObservation(fixtures.observation));
  await call("transaction observations list", "listTransactionObservations", () => adapter.listTransactionObservations(fixtures.transaction.hash));

  await call("approvals empty", "listApprovalRecords", () => adapter.listApprovalRecords(WALLET));
  await call("approval create", "createApprovalRecord", () => adapter.createApprovalRecord(fixtures.approval));
  await call("approvals list", "listApprovalRecords", () => adapter.listApprovalRecords(WALLET));

  await call("user rule missing", "getUserRuleRecord", () => adapter.getUserRuleRecord(WALLET));
  await call("user rule upsert", "upsertUserRuleRecord", () => adapter.upsertUserRuleRecord(fixtures.userRule));
  await call("user rule get", "getUserRuleRecord", () => adapter.getUserRuleRecord(WALLET));

  await call("x402 receipts empty", "listX402PaymentReceipts", () => adapter.listX402PaymentReceipts());
  await call("x402 receipt header missing", "getX402PaymentReceiptByHeaderHash", () => adapter.getX402PaymentReceiptByHeaderHash("header-missing"));
  await call("x402 receipt tx missing", "getX402PaymentReceiptByTxHash", () => adapter.getX402PaymentReceiptByTxHash("tx-missing"));
  await call("x402 receipt create", "createX402PaymentReceipt", () => adapter.createX402PaymentReceipt(fixtures.x402Receipt));
  await call("x402 receipts list", "listX402PaymentReceipts", () => adapter.listX402PaymentReceipts());
  await call("x402 receipt header", "getX402PaymentReceiptByHeaderHash", () => adapter.getX402PaymentReceiptByHeaderHash(fixtures.x402Receipt.paymentHeaderHash));
  await call("x402 receipt tx", "getX402PaymentReceiptByTxHash", () => adapter.getX402PaymentReceiptByTxHash(fixtures.x402Receipt.transactionHash!));

  await call("risk snapshots empty", "listRiskSnapshots", () => adapter.listRiskSnapshots());
  await call("risk snapshot create", "createRiskSnapshot", () => adapter.createRiskSnapshot(fixtures.activeSnapshot));
  await call("risk snapshot create expired", "createRiskSnapshot", () => adapter.createRiskSnapshot(fixtures.expiredSnapshot));
  await call("risk snapshots list", "listRiskSnapshots", () => adapter.listRiskSnapshots());
  await call("risk snapshot get", "getRiskSnapshot", () => adapter.getRiskSnapshot(fixtures.activeSnapshot.id));
  await call("risk snapshot revoke", "revokeRiskSnapshot", () => adapter.revokeRiskSnapshot(fixtures.activeSnapshot.id, time(29)));
  await call("risk snapshot get revoked", "getRiskSnapshot", () => adapter.getRiskSnapshot(fixtures.activeSnapshot.id));

  await call("alert rules empty", "listAlertRules", () => adapter.listAlertRules(WALLET));
  await call("alert rule missing", "getAlertRule", () => adapter.getAlertRule("rule-missing"));
  await call("alert rule upsert", "upsertAlertRule", () => adapter.upsertAlertRule(fixtures.alertRule));
  await call("alert rule get", "getAlertRule", () => adapter.getAlertRule(fixtures.alertRule.id));
  await call("alert rules list", "listAlertRules", () => adapter.listAlertRules(WALLET));
  await call("alert rules ensure", "ensureAlertRulesForWallet", () => adapter.ensureAlertRulesForWallet(WALLET));
  await call("alert rule delete create", "upsertAlertRule", () => adapter.upsertAlertRule(fixtures.ruleToDelete));
  await call("alert rule delete", "deleteAlertRule", () => adapter.deleteAlertRule(fixtures.ruleToDelete.id, WALLET));

  await call("alert observations empty", "listAlertObservations", () => adapter.listAlertObservations(WALLET));
  await call("alert observation create", "createAlertObservation", () => adapter.createAlertObservation(fixtures.alertObservation));
  await call("alert observations list", "listAlertObservations", () => adapter.listAlertObservations(WALLET));

  await call("alerts empty", "listAlerts", () => adapter.listAlerts(WALLET));
  await call("alert missing", "getAlert", () => adapter.getAlert("alert-missing", WALLET));
  await call("alert create", "createAlert", () => adapter.createAlert(fixtures.alert));
  await call("alert get", "getAlert", () => adapter.getAlert(fixtures.alert.id, WALLET));
  await call("alerts list", "listAlerts", () => adapter.listAlerts(WALLET));
  await call("alert update", "updateAlert", () => adapter.updateAlert(fixtures.alert.id, WALLET, {
    status: "acknowledged",
    acknowledgedAt: time(40),
    deliverySummary: { delivered: [], failed: [], skipped: [{ channel: "email", reason: "disabled" }] },
  }));
  await call("alert get updated", "getAlert", () => adapter.getAlert(fixtures.alert.id, WALLET));

  await call("alert deliveries empty", "listAlertDeliveries", () => adapter.listAlertDeliveries(undefined, WALLET));
  await call("alert bundle create", "createAlertBundle", () => adapter.createAlertBundle(fixtures.bundle));
  await call("alert delivery create", "createAlertDelivery", () => adapter.createAlertDelivery(fixtures.delivery));
  await call("alert deliveries list", "listAlertDeliveries", () => adapter.listAlertDeliveries(undefined, WALLET));
  await call("alert delivery idempotency", "getAlertDeliveryByIdempotencyKey", () => adapter.getAlertDeliveryByIdempotencyKey(WALLET, fixtures.delivery.idempotencyKey!));
  await call("alert delivery update", "updateAlertDelivery", () => adapter.updateAlertDelivery(fixtures.delivery.id, WALLET, {
    idempotencyKey: fixtures.delivery.idempotencyKey,
    status: "delivered",
    errorDetail: "none",
    attemptCount: 2,
    sentAt: time(41),
    terminal: true,
  }));

  await call("notification preferences missing", "getNotificationPreferences", () => adapter.getNotificationPreferences({ walletAddress: WALLET, chainFamily: "evm", network: NETWORK }));
  await call("notification preferences upsert", "upsertNotificationPreferences", () => adapter.upsertNotificationPreferences(fixtures.notificationPreferences));
  await call("notification preferences get", "getNotificationPreferences", () => adapter.getNotificationPreferences({ walletAddress: WALLET, chainFamily: "evm", network: NETWORK }));
  await call("notification preferences list", "listNotificationPreferences", () => adapter.listNotificationPreferences(WALLET));
  await call("notification preferences delete", "deleteNotificationPreferences", () => adapter.deleteNotificationPreferences(fixtures.notificationPreferences.id!));
  await call("notification preferences get deleted", "getNotificationPreferences", () => adapter.getNotificationPreferences({ walletAddress: WALLET, chainFamily: "evm", network: NETWORK }));

  await call("watchlist entries empty", "listWatchlistEntries", () => adapter.listWatchlistEntries(WALLET));
  await call("watchlist entry missing", "getWatchlistEntry", () => adapter.getWatchlistEntry("entry-missing"));
  await call("watchlist entry add", "addWatchlistEntry", () => adapter.addWatchlistEntry(fixtures.watchlistEntry));
  await call("watchlist entries bulk", "addWatchlistEntriesBulk", () => adapter.addWatchlistEntriesBulk(fixtures.bulkEntries));
  await call("watchlist entries list", "listWatchlistEntries", () => adapter.listWatchlistEntries(WALLET));
  await call("watchlist entry get", "getWatchlistEntry", () => adapter.getWatchlistEntry(fixtures.watchlistEntry.id));
  await call("watchlist scan run create", "addWatchlistScanRun", () => adapter.addWatchlistScanRun(fixtures.scanRun));
  await call("watchlist scan runs list", "listWatchlistScanRuns", () => adapter.listWatchlistScanRuns(fixtures.watchlistEntry.id));
  await call("watchlist latest scan update", "updateWatchlistEntryLatestScan", () => adapter.updateWatchlistEntryLatestScan(fixtures.watchlistEntry.id, {
    scanRunId: fixtures.scanRun.id,
    classification: "risky",
    score: 90,
    scannedAt: time(42),
    status: "failed",
  }));
  await call("discovery alert create", "createDiscoveryAlert", () => adapter.createDiscoveryAlert(fixtures.discoveryAlert));
  await call("discovery alerts list", "listDiscoveryAlerts", () => adapter.listDiscoveryAlerts(WALLET));
  await call("discovery alert acknowledge", "acknowledgeDiscoveryAlert", () => adapter.acknowledgeDiscoveryAlert(fixtures.discoveryAlert.id));
  await call("discovery alerts list acknowledged", "listDiscoveryAlerts", () => adapter.listDiscoveryAlerts(WALLET));
  await call("watchlist entry details update", "updateWatchlistEntryDetails", () => adapter.updateWatchlistEntryDetails(fixtures.watchlistEntry.id, {
    note: "updated note",
    pairAddress: "0x9999999999999999999999999999999999999999",
    symbol: "UPDT",
    tokenName: "Updated Token",
  }));
  await call("watchlist entry get updated", "getWatchlistEntry", () => adapter.getWatchlistEntry(fixtures.watchlistEntry.id));
  await call("watchlist entry remove", "removeWatchlistEntry", () => adapter.removeWatchlistEntry(fixtures.bulkEntries[0].id));
  await call("watchlist entries list final", "listWatchlistEntries", () => adapter.listWatchlistEntries(WALLET));

  await call("wallet export", "exportWalletData", () => adapter.exportWalletData(WALLET));
  await call("wallet export network", "exportWalletData", () => adapter.exportWalletData(WALLET, NETWORK));
  await call("wallet delete", "deleteWalletData", () => adapter.deleteWalletData(WALLET, NETWORK));
  await call("wallet export after delete", "exportWalletData", () => adapter.exportWalletData(WALLET));

  await call("risk snapshot prune", "pruneExpiredRecords", () => adapter.pruneExpiredRecords(time(43)));
  await call("risk snapshots after prune", "listRiskSnapshots", () => adapter.listRiskSnapshots());

  await call("erasure receipt store", "storeErasureReceipt", () => adapter.storeErasureReceipt!(fixtures.erasureReceipt));
  await call("erasure receipt get", "getErasureReceipt", () => adapter.getErasureReceipt!(fixtures.erasureReceipt.receiptId));

  await call("storage counts", "getStorageCounts", () => adapter.getStorageCounts());
  await call("storage health", "getStorageHealth", () => adapter.getStorageHealth());
  await call("storage probe", "performHealthProbe", () => adapter.performHealthProbe());
  await call("storage counts after probe", "getStorageCounts", () => adapter.getStorageCounts());

  return { trace, called };
}

function resetMemoryAdapter(): void {
  for (const key of Object.keys(globalThis)) {
    if (key.startsWith("__cryptara")) delete (globalThis as Record<string, unknown>)[key];
  }
}

async function prepareDatabase(client: PgClient): Promise<void> {
  const schema = readFileSync(path.join(projectRoot, "src/server/storage/schema.sql"), "utf8");
  await client.query(schema);
  const names = [...storageSchemaContract.tables, "recovery_requests"];
  assert.ok(names.every((name) => /^[a-z0-9_]+$/.test(name)));
  const existing = await client.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
    [names],
  );
  if (existing.rows.length === 0) return;
  const list = existing.rows.map((row) => `"${row.table_name}"`).join(", ");
  await client.query(`truncate table ${list} restart identity cascade`);
}

async function main(): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) throw new Error("TEST_DATABASE_URL is required for the storage adapter parity check.");
  process.env.DATABASE_URL = connectionString;
  for (const key of ["SUPABASE_DB_URL", "POSTGRES_URL", "NEXT_PUBLIC_DATABASE_URL"]) delete process.env[key];

  const { Client } = requireFromProject("pg") as { Client: new (config: { connectionString: string }) => PgClient };
  const client = new Client({ connectionString });
  let postgres: PostgresStorageAdapter | null = null;
  try {
    await client.connect();
    await prepareDatabase(client);

    resetMemoryAdapter();
    const memory = await runScenario(new MemoryStorageAdapter());

    await prepareDatabase(client);
    postgres = new PostgresStorageAdapter();
    const pg = await runScenario(postgres);

    for (const method of storageSchemaContract.adapterApi) {
      assert.ok(memory.called.has(method), `Memory adapter coverage missing ${method}`);
      assert.ok(pg.called.has(method), `Postgres adapter coverage missing ${method}`);
    }
    assert.strictEqual(pg.trace.length, memory.trace.length);
    for (let index = 0; index < memory.trace.length; index += 1) {
      assert.deepStrictEqual(
        pg.trace[index],
        memory.trace[index],
        `Adapter mismatch at ${memory.trace[index].step} (${memory.trace[index].method})\nmemory: ${stable(memory.trace[index].result)}\npostgres: ${stable(pg.trace[index].result)}`,
      );
    }
    console.log(`Storage adapter parity verified for ${storageSchemaContract.adapterApi.length} methods.`);
  } finally {
    if (postgres) await postgres.close();
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
