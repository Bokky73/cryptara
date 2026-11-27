import type {
  AgentResult,
  AgentRunRecord,
  Alert,
  AlertDelivery,
  AlertDeliveryChannel,
  AlertObservation,
  AlertRule,
  ChainFamily,
  DiscoveryAlert,
  RecommendationRecord,
  StorageCounts,
  StorageHealth,
  TransactionLifecycleEvent,
  TransactionLifecycleEventName,
  TransactionLifecycleStatus,
  TransactionObservation,
  TransactionRecord,
  UserApprovalRecord,
  UserRule,
  WatchlistEntry,
  WatchlistEntryInput,
  WatchlistScanRun,
  X402PaymentReceipt,
  AgentSource,
  AgentMissingData,
  DiscoveryClassification,
  RiskLevel,
  NotificationPreferences,
} from "@/server/types";
import { getDefaultRules } from "@/server/rules/defaultRules";
import { isTransactionHashForChain } from "@/lib/chainIdentity";
import { validateAgentResult } from "@/server/agents/schema";
import { assertStorageReady, getStorageAdapter, getStorageMode, isPersistentStorage } from "@/server/storage/adapters";
import type {
  AgentRunInsert,
  AlertBundle,
  DiscoveryAlertInsert,
  WatchlistScanRunInsert,
} from "@/server/storage/adapters/types";
import { storageSchemaContract, storageAdapterContract } from "@/server/storage/contract";
import { clearPortfolioCacheForWallet } from "@/server/stellar/portfolio";
import { invalidatePortfolioForWallet, invalidateRulesCache, invalidateWalletCache } from "@/server/cache";
import { resetDevEnvironment, seedDevEnvironment } from "@/server/storage/bootstrap";

export { storageSchemaContract, storageAdapterContract };
export {
  deleteWalletDataFromPg,
  exportWalletDataFromPg,
  pruneExpiredRecordsFromPg,
} from "@/server/storage/postgresAdapter";
export {
  authorizeAutoMode,
  closeAutoModeAuthorization,
  getAutoModeSnapshot,
  saveAutoModePolicy,
} from "@/server/autoMode/storage";
export { eraseWalletData } from "@/server/privacy/retention/erase";
export {
  checkErasureResidue,
  checkFullErasureResidue,
} from "@/server/privacy/retention/residue";
export {
  verifyErasureReceipt,
  buildErasureReceipt,
  createErasureReceipt,
} from "@/server/privacy/retention/receipt";
export {
  RETENTION_POLICIES,
  getTablePolicy,
} from "@/server/privacy/retention/policy";
export {
  runRetentionPurge,
  purgeExpiredMemoryData,
} from "@/server/privacy/retention/purge";

export const devReset = resetDevEnvironment;
export const devSeed = seedDevEnvironment;

type ReadyResult = { tried: boolean; hydrated: number; skipped: number; detail: string };
type ReadySummary = ReadyResult & { at: string };
type ReadyGlobal = typeof globalThis & {
  __cryptaraHydrationPromise?: Promise<ReadyResult>;
  __cryptaraLastHydration?: ReadySummary;
};

const readyStore = globalThis as ReadyGlobal;

export function ensureStorageReady(): Promise<ReadyResult> {
  if (readyStore.__cryptaraHydrationPromise) return readyStore.__cryptaraHydrationPromise;

  readyStore.__cryptaraHydrationPromise = (async () => {
    if (!isPersistentStorage()) {
      const result = { tried: false, hydrated: 0, skipped: 0, detail: "no persistent storage configured" };
      readyStore.__cryptaraLastHydration = { ...result, at: new Date().toISOString() };
      return result;
    }

    await assertStorageReady();
    const health = await getStorageAdapter().getStorageHealth();
    const result = {
      tried: true,
      hydrated: 0,
      skipped: 0,
      detail: health.persistent ? "ok" : health.detail,
    };
    readyStore.__cryptaraLastHydration = { ...result, at: new Date().toISOString() };
    return result;
  })();

  return readyStore.__cryptaraHydrationPromise;
}

export function getLastHydrationSummary() {
  const summary = readyStore.__cryptaraLastHydration;
  return summary ? { ...summary } : null;
}

export function getStorageProvider() {
  return getStorageMode();
}

export async function getStorageHealth(): Promise<StorageHealth> {
  const health = await getStorageAdapter().getStorageHealth();
  return { ...health, schema: storageSchemaContract };
}

export async function getStorageCounts(): Promise<StorageCounts> {
  return getStorageAdapter().getStorageCounts();
}

export async function performHealthProbe() {
  return getStorageAdapter().performHealthProbe();
}

function createId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createRecordId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeWallet(walletAddress?: string | null): string {
  return (walletAddress ?? "").trim().toLowerCase();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function hashSourceSnapshot(value: unknown) {
  const serialized = stableStringify(value);
  let hash = 5381;

  for (let index = 0; index < serialized.length; index += 1) {
    hash = (hash * 33) ^ serialized.charCodeAt(index);
  }

  return `snap_${(hash >>> 0).toString(16)}`;
}

export function canonicalizeTransactionHash(hash: string, family: ChainFamily = "evm") {
  const trimmed = hash.trim();
  return family === "stellar" ? trimmed.toUpperCase() : trimmed.toLowerCase();
}

export function isImmutableTerminal(status: TransactionLifecycleStatus) {
  return status === "confirmed" || status === "failed" || status === "replaced" || status === "dropped" || status === "expired" || status === "user_rejected";
}

export async function ensureAlertRulesForWallet(walletAddress?: string) {
  return getStorageAdapter().ensureAlertRulesForWallet(walletAddress);
}

export async function listAlertRules(walletAddress?: string) {
  return getStorageAdapter().listAlertRules(walletAddress);
}

export async function getAlertRule(id: string) {
  return (await getStorageAdapter().getAlertRule(id)) ?? undefined;
}

export async function upsertAlertRule(input: AlertRule) {
  const now = new Date().toISOString();
  const normalized: AlertRule = {
    ...input,
    observationKey: input.observationKey?.trim() || undefined,
    hysteresis: Number.isFinite(input.hysteresis) ? Math.max(0, input.hysteresis) : 0,
    cooldownMinutes: Number.isFinite(input.cooldownMinutes) ? Math.max(0, Math.round(input.cooldownMinutes)) : 60,
    updatedAt: now,
    createdAt: input.createdAt ?? now,
    walletAddress: normalizeWallet(input.walletAddress),
  };
  return getStorageAdapter().upsertAlertRule(normalized);
}

export async function deleteAlertRule(id: string, walletAddress?: string) {
  return getStorageAdapter().deleteAlertRule(id, walletAddress);
}

export async function listAlertObservations(walletAddress?: string, limit = 200) {
  return getStorageAdapter().listAlertObservations(walletAddress, limit);
}

export async function createAlertObservation(input: Omit<AlertObservation, "id" | "createdAt">) {
  const observation: AlertObservation = {
    id: createRecordId("obs"),
    createdAt: new Date().toISOString(),
    ...input,
    walletAddress: normalizeWallet(input.walletAddress),
  };
  return getStorageAdapter().createAlertObservation(observation);
}

export async function listAlerts(walletAddress?: string, status?: Alert["status"], limit = 200) {
  return getStorageAdapter().listAlerts(walletAddress, status, limit);
}

export async function getAlert(id: string, walletAddress?: string) {
  return (await getStorageAdapter().getAlert(id, walletAddress)) ?? undefined;
}

export async function createAlert(input: Omit<Alert, "id" | "triggeredAt">) {
  const alert: Alert = {
    id: `alert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    triggeredAt: new Date().toISOString(),
    ...input,
    walletAddress: normalizeWallet(input.walletAddress),
  };
  return getStorageAdapter().createAlert(alert);
}

export async function updateAlert(id: string, walletAddress: string, patch: Partial<Alert>) {
  return (await getStorageAdapter().updateAlert(id, walletAddress, patch)) ?? undefined;
}

export async function createAlertBundle(bundle: AlertBundle) {
  return getStorageAdapter().createAlertBundle(bundle);
}

export async function listAlertDeliveries(alertId?: string, walletAddress?: string) {
  return getStorageAdapter().listAlertDeliveries(alertId, walletAddress);
}

export async function createAlertDelivery(input: Omit<AlertDelivery, "id" | "createdAt">) {
  const delivery: AlertDelivery = {
    id: createRecordId("delivery"),
    createdAt: new Date().toISOString(),
    ...input,
    walletAddress: normalizeWallet(input.walletAddress),
  };
  return getStorageAdapter().createAlertDelivery(delivery);
}

export async function updateAlertDelivery(id: string, walletAddress: string, patch: Partial<AlertDelivery>) {
  return (await getStorageAdapter().updateAlertDelivery(id, walletAddress, patch)) ?? undefined;
}

export type NotificationPreferenceScope = {
  walletAddress: string;
  chainFamily: "evm" | "stellar";
  network: string;
};

export async function getNotificationPreferences(scope: NotificationPreferenceScope) {
  return (await getStorageAdapter().getNotificationPreferences(scope)) ?? undefined;
}

export async function listNotificationPreferences(walletAddress?: string) {
  return getStorageAdapter().listNotificationPreferences(walletAddress);
}

export async function upsertNotificationPreferences(input: NotificationPreferences) {
  const record: NotificationPreferences = {
    ...input,
    walletAddress: normalizeWallet(input.walletAddress),
    network: input.network || "legacy-evm",
    updatedAt: new Date().toISOString(),
  };
  return getStorageAdapter().upsertNotificationPreferences(record);
}

export async function deleteNotificationPreferences(id: string) {
  return getStorageAdapter().deleteNotificationPreferences(id);
}

export function summarizeDeliveries(deliveries: AlertDelivery[]) {
  const deliverableByChannel: Record<AlertDeliveryChannel, string> = {
    in_app: "delivered",
    email: "no_env",
    telegram: "no_env",
    discord: "no_env",
  };

  return {
    delivered: deliveries.filter((delivery) => delivery.status === "delivered").map((delivery) => delivery.channel),
    failed: deliveries
      .filter((delivery) => delivery.status === "failed")
      .map((delivery) => ({ channel: delivery.channel, error: delivery.errorDetail ?? "delivery failed" })),
    skipped: [
      ...deliveries
        .filter((delivery) => delivery.status === "skipped")
        .map((delivery) => ({ channel: delivery.channel, reason: delivery.errorDetail ?? "skipped" })),
      ...(["in_app", "email", "telegram", "discord"] as AlertDeliveryChannel[])
        .filter((channel) => !deliveries.some((delivery) => delivery.channel === channel))
        .map((channel) => ({ channel, reason: deliverableByChannel[channel] === "delivered" ? "in-app inbox is always available" : "delivery channel is not configured" })),
    ],
  };
}

export type CreateAgentRunInput = {
  walletAddress: string;
  mode?: AgentRunRecord["mode"];
  inputSnapshot?: Record<string, unknown>;
  targetToken?: AgentRunRecord["targetToken"];
  results: AgentResult[];
  userAction?: AgentRunRecord["userAction"];
  runId?: string;
  identity?: unknown;
  decision?: AgentResult;
  partialStatus?: unknown;
  evaluatedAt?: string;
};

export async function listAgentRunRecords(walletAddress?: string) {
  return getStorageAdapter().listAgentRunRecords(walletAddress);
}

export async function getAgentRunRecord(id: string) {
  return (await getStorageAdapter().getAgentRunRecord(id)) ?? undefined;
}

export async function createAgentRunRecord(input: CreateAgentRunInput): Promise<AgentRunRecord> {
  for (const result of input.results) {
    const parsed = validateAgentResult(result);
    if (!parsed.success) {
      throw new Error(`Invalid AgentResult cannot be stored for ${result.agent}: ${parsed.error.message}`);
    }
  }

  const decision = input.decision ?? [...input.results].reverse().find((result) => result.agent === "decision");
  const failed = input.results.some((result) => result.status === "error" || result.status === "unavailable");
  const completed = input.results.some((result) => result.agent === "decision");
  const sourceStatuses = input.results.map((result) => ({
    agent: result.agent,
    connected: result.sources.filter((source) => source.status === "connected").length,
    unavailable: result.sources.filter((source) => source.status === "unavailable").length,
    mock: result.sources.filter((source) => source.status === "mock").length,
  }));
  const resultSnapshots = input.results.map((result) => ({
    agent: result.agent,
    rawSignals: result.rawSignals ?? {},
    sources: result.sources,
    sourceSnapshotHash: hashSourceSnapshot({
      agent: result.agent,
      sources: result.sources,
      rawSignals: result.rawSignals ?? {},
    }),
    immutable: true,
    decisionExplanation: result.agent === "decision" ? result.rawSignals?.explanation : undefined,
  }));
  const record: AgentRunInsert = {
    id: createId(),
    walletAddress: normalizeWallet(input.walletAddress),
    mode: input.mode ?? null,
    targetToken: input.targetToken ?? null,
    status: completed ? (failed ? "partial" : "completed") : "failed",
    recommendation: decision?.recommendedAction ?? "manual_review",
    decisionScore: decision?.score ?? Math.max(...input.results.map((result) => result.score), 50),
    confidence: decision?.confidence ?? 0.28,
    summary: decision?.summary ?? "Agent run ended before a final decision was produced.",
    results: input.results,
    sourceStatuses,
    inputSnapshot: {
      ...(input.inputSnapshot ?? {}),
      resultSnapshots,
    },
    userAction: input.userAction ?? "pending",
    createdAt: new Date().toISOString(),
  };
  const stored = await getStorageAdapter().createAgentRunRecord(record);
  await createRecommendationRecord({
    runId: stored.id,
    walletAddress: stored.walletAddress,
    action: stored.recommendation,
    decisionScore: stored.decisionScore,
    confidence: stored.confidence,
    summary: stored.summary,
  });
  return stored;
}

export async function listAgentRunRecordsPaginated(
  walletAddress?: string,
  options: { cursor?: string; limit?: number } = {},
) {
  const all = await listAgentRunRecords(walletAddress);
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = options.cursor ? Math.max(0, all.findIndex((record) => record.id === options.cursor) + 1) : 0;
  const data = all.slice(offset, offset + limit);
  return { data, nextCursor: offset + limit < all.length ? data.at(-1)?.id ?? null : null };
}

export async function listRecommendationRecords(walletAddress?: string) {
  return getStorageAdapter().listRecommendationRecords(walletAddress);
}

export async function createRecommendationRecord(
  input: Omit<RecommendationRecord, "id" | "createdAt"> & { createdAt?: string },
) {
  const { createdAt = new Date().toISOString(), ...rest } = input;
  const record: RecommendationRecord = {
    id: createRecordId("rec"),
    createdAt,
    ...rest,
    walletAddress: normalizeWallet(input.walletAddress),
  };
  return getStorageAdapter().createRecommendationRecord(record);
}

export async function listRecommendationRecordsPaginated(
  walletAddress?: string,
  options: { cursor?: string; limit?: number } = {},
) {
  const all = await listRecommendationRecords(walletAddress);
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = options.cursor ? Math.max(0, all.findIndex((record) => record.id === options.cursor) + 1) : 0;
  const data = all.slice(offset, offset + limit);
  return { data, nextCursor: offset + limit < all.length ? data.at(-1)?.id ?? null : null };
}

export async function listTransactionRecords(walletAddress?: string) {
  return getStorageAdapter().listTransactionRecords(walletAddress);
}

export async function listTransactionRecordsPaginated(
  walletAddress?: string,
  options: { cursor?: string; limit?: number } = {},
) {
  const all = await listTransactionRecords(walletAddress);
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = options.cursor ? Math.max(0, all.findIndex((record) => record.hash === options.cursor) + 1) : 0;
  const items = all.slice(offset, offset + limit);
  return {
    items,
    total: all.length,
    nextCursor: offset + limit < all.length ? items.at(-1)?.hash : undefined,
  };
}

export async function getTransactionRecord(hash: string) {
  const family: ChainFamily = isTransactionHashForChain(hash, "evm")
    ? "evm"
    : isTransactionHashForChain(hash, "stellar")
      ? "stellar"
      : "evm";
  return getTransactionRecordForFamily(hash, family);
}

export async function getTransactionRecordForFamily(hash: string, family: ChainFamily) {
  return (await getStorageAdapter().getTransactionRecordForFamily(hash, family)) ?? undefined;
}

export async function getTransactionRecordByIdempotencyKey(walletAddress: string, idempotencyKey: string) {
  return (await getStorageAdapter().getTransactionRecordByIdempotencyKey(walletAddress, idempotencyKey)) ?? undefined;
}

export async function createTransactionRecord(
  input: Omit<TransactionRecord, "createdAt" | "lifecycleStatus"> & { createdAt?: string; lifecycleStatus?: TransactionLifecycleStatus },
) {
  const existing = await getTransactionRecord(input.hash);
  if (existing) return existing;

  const lifecycleStatus: TransactionLifecycleStatus = input.lifecycleStatus ?? input.status ?? "prepared";
  const record: TransactionRecord = {
    ...input,
    walletAddress: input.walletAddress ? normalizeWallet(input.walletAddress) : undefined,
    lifecycleStatus,
    status: lifecycleStatus,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const stored = await getStorageAdapter().createTransactionRecord(record);
  if (stored.walletAddress) invalidatePortfolioForWallet(stored.walletAddress);
  return stored;
}

export async function updateTransactionRecord(
  hash: string,
  updates: Partial<Omit<TransactionRecord, "hash" | "createdAt">> & { status?: TransactionLifecycleStatus },
) {
  const updated = await getStorageAdapter().updateTransactionRecord(hash, updates);
  if (updated?.walletAddress) invalidatePortfolioForWallet(updated.walletAddress);
  return updated ?? undefined;
}

export async function removeTransactionRecordByHash(hash: string) {
  return getStorageAdapter().removeTransactionRecordByHash(hash);
}

export async function listTransactionLifecycleEvents(hash: string) {
  return getStorageAdapter().listTransactionLifecycleEvents(hash);
}

export async function listTransactionObservations(hash: string) {
  return getStorageAdapter().listTransactionObservations(hash);
}

export async function createTransactionObservation(
  input: Omit<TransactionObservation, "id" | "observedAt"> & { observedAt?: string },
) {
  const existing = (await listTransactionObservations(input.hash)).find(
    (observation) => observation.evidenceKey === input.evidenceKey,
  );
  if (existing) return { observation: existing, created: false };

  const observation: TransactionObservation = {
    ...input,
    id: createRecordId("tx_observation"),
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
  return { observation: await getStorageAdapter().createTransactionObservation(observation), created: true };
}

export async function createTransactionLifecycleEvent(
  input: Omit<TransactionLifecycleEvent, "id" | "occurredAt"> & { occurredAt?: string },
) {
  const event: TransactionLifecycleEvent = {
    id: createRecordId("tx_event"),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    ...input,
  };
  return getStorageAdapter().createTransactionLifecycleEvent(event);
}

export async function appendLifecycleEventByName(
  hash: string,
  event: TransactionLifecycleEventName,
  detail?: Record<string, unknown>,
  provider?: { label: string; url?: string },
) {
  return createTransactionLifecycleEvent({
    hash,
    event,
    detail,
    provider: provider?.label,
    providerUrl: provider?.url,
  });
}

export async function listApprovalRecords(walletAddress?: string) {
  return getStorageAdapter().listApprovalRecords(walletAddress);
}

export async function createApprovalRecord(
  input: Omit<UserApprovalRecord, "id" | "createdAt" | "status" | "autoExecuted"> & {
    createdAt?: string;
  },
) {
  const { createdAt = new Date().toISOString(), ...rest } = input;
  const record: UserApprovalRecord = {
    id: createRecordId("approval"),
    createdAt,
    ...rest,
    walletAddress: normalizeWallet(input.walletAddress),
    status: "confirmed",
    autoExecuted: false,
  };
  return getStorageAdapter().createApprovalRecord(record);
}

export async function getAuditSourceRecords(walletAddress: string): Promise<{
  decisions: RecommendationRecord[];
  approvals: UserApprovalRecord[];
  transactions: TransactionRecord[];
}> {
  const [decisions, approvals, transactions] = await Promise.all([
    listRecommendationRecords(walletAddress),
    listApprovalRecords(walletAddress),
    listTransactionRecords(walletAddress),
  ]);
  return { decisions, approvals, transactions };
}

export async function getUserRuleRecord(walletAddress = "0xDemoWallet") {
  const existing = await getStorageAdapter().getUserRuleRecord(walletAddress);
  return {
    ...getDefaultRules(walletAddress),
    ...(existing ?? {}),
    autoExecute: false,
  };
}

export async function upsertUserRuleRecord(input: UserRule) {
  const defaults = getDefaultRules(input.walletAddress);
  const existing = await getStorageAdapter().getUserRuleRecord(input.walletAddress);
  const record: UserRule = {
    ...defaults,
    ...input,
    walletAddress: normalizeWallet(input.walletAddress),
    autoExecute: false,
    version: (existing?.version ?? 0) + 1,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const stored = await getStorageAdapter().upsertUserRuleRecord(record);
  invalidateRulesCache(input.walletAddress);
  return stored;
}

export async function listX402PaymentReceipts() {
  return getStorageAdapter().listX402PaymentReceipts();
}

export async function getX402PaymentReceiptByHeaderHash(paymentHeaderHash: string) {
  return (await getStorageAdapter().getX402PaymentReceiptByHeaderHash(paymentHeaderHash)) ?? undefined;
}

export async function getX402PaymentReceiptByTxHash(transactionHash: string) {
  return (await getStorageAdapter().getX402PaymentReceiptByTxHash(transactionHash)) ?? undefined;
}

export const findX402PaymentReceiptByTxHash = getX402PaymentReceiptByTxHash;

export async function createX402PaymentReceipt(
  input: Omit<X402PaymentReceipt, "id" | "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string },
) {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const chainFamily = input.chainFamily ?? "evm";
  const record: X402PaymentReceipt = {
    id: createRecordId("x402"),
    ...input,
    walletAddress: input.walletAddress ? normalizeWallet(input.walletAddress) : undefined,
    chainFamily,
    payerIdentity: input.payer || input.transactionHash
      ? { chainFamily, payer: input.payer, transactionHash: input.transactionHash }
      : undefined,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };
  return getStorageAdapter().createX402PaymentReceipt(record);
}

export type CreateWatchlistInput = WatchlistEntryInput & {
  identityKey: string;
};

export type AddWatchlistEntryResult = {
  entry: WatchlistEntry;
  alreadyExisted: boolean;
};

export async function listWatchlistEntries(walletAddress?: string) {
  return getStorageAdapter().listWatchlistEntries(walletAddress);
}

export async function getWatchlistEntry(id: string) {
  return (await getStorageAdapter().getWatchlistEntry(id)) ?? undefined;
}

export async function addWatchlistEntry(input: CreateWatchlistInput): Promise<AddWatchlistEntryResult> {
  const entry: WatchlistEntry = {
    id: createRecordId("watch"),
    walletAddress: normalizeWallet(input.walletAddress),
    identityKey: input.identityKey,
    chain: input.chain,
    network: input.network,
    contractAddress: input.contractAddress,
    pairAddress: input.pairAddress,
    symbol: input.symbol,
    tokenName: input.tokenName,
    assetKey: input.assetKey,
    issuer: input.issuer,
    assetType: input.assetType,
    source: input.source,
    note: input.note,
    createdAt: new Date().toISOString(),
  };
  const result = await getStorageAdapter().addWatchlistEntry(entry);
  if (!result.alreadyExisted) invalidateWalletCache(entry.walletAddress);
  return result;
}

export async function addWatchlistEntriesBulk(inputs: CreateWatchlistInput[]) {
  if (inputs.length === 0) return { appliedCount: 0 };
  const entries: WatchlistEntry[] = inputs.map((input) => ({
    id: createRecordId("watch"),
    walletAddress: normalizeWallet(input.walletAddress),
    identityKey: input.identityKey,
    chain: input.chain,
    network: input.network,
    contractAddress: input.contractAddress,
    pairAddress: input.pairAddress,
    symbol: input.symbol,
    tokenName: input.tokenName,
    assetKey: input.assetKey,
    issuer: input.issuer,
    assetType: input.assetType,
    source: input.source,
    note: input.note,
    createdAt: new Date().toISOString(),
  }));
  const { added } = await getStorageAdapter().addWatchlistEntriesBulk(entries);
  for (const entry of added) invalidateWalletCache(entry.walletAddress);
  return { appliedCount: added.length };
}

export async function removeWatchlistEntry(id: string) {
  const entry = await getWatchlistEntry(id);
  const removed = await getStorageAdapter().removeWatchlistEntry(id);
  if (removed && entry?.walletAddress) invalidateWalletCache(entry.walletAddress);
  return removed;
}

export async function updateWatchlistEntryDetails(
  id: string,
  details: Pick<Partial<WatchlistEntry>, "note" | "pairAddress" | "symbol" | "tokenName">,
) {
  const entry = await getStorageAdapter().updateWatchlistEntryDetails(id, details);
  if (entry?.walletAddress) invalidateWalletCache(entry.walletAddress);
  return entry ?? undefined;
}

export type AddWatchlistScanRunInput = {
  entryId: string;
  walletAddress: string;
  identityKey: string;
  classification: DiscoveryClassification;
  classificationReasons: string[];
  confidence: number;
  score: number;
  sourceLineage: AgentSource[];
  missingData: AgentMissingData[];
  riskReport?: WatchlistScanRun["riskReport"];
  agentRunId?: string;
  status?: WatchlistScanRun["status"];
};

export async function addWatchlistScanRun(input: AddWatchlistScanRunInput): Promise<WatchlistScanRun> {
  const previous = (await listWatchlistScanRuns(input.entryId))[0];
  const run: WatchlistScanRunInsert = {
    id: createRecordId("wscan"),
    entryId: input.entryId,
    walletAddress: normalizeWallet(input.walletAddress),
    identityKey: input.identityKey,
    agentRunId: input.agentRunId,
    classification: input.classification,
    classificationReasons: input.classificationReasons,
    confidence: input.confidence,
    score: input.score,
    sourceLineage: input.sourceLineage,
    missingData: input.missingData,
    riskReport: input.riskReport,
    status: input.status ?? "completed",
    previousRunId: previous?.id,
    scannedAt: new Date().toISOString(),
  };
  const stored = await getStorageAdapter().addWatchlistScanRun(run);
  await getStorageAdapter().updateWatchlistEntryLatestScan(input.entryId, {
    scanRunId: stored.id,
    classification: stored.classification,
    score: stored.score,
    scannedAt: stored.scannedAt,
    status: stored.status,
  });
  if (stored.walletAddress) invalidateWalletCache(stored.walletAddress);
  return stored;
}

export async function updateWatchlistEntryLatestScan(
  id: string,
  update: {
    scanRunId: string;
    classification: DiscoveryClassification;
    score: number;
    scannedAt: string;
    status: WatchlistScanRun["status"];
  },
) {
  const entry = await getStorageAdapter().updateWatchlistEntryLatestScan(id, update);
  if (entry?.walletAddress) invalidateWalletCache(entry.walletAddress);
  return entry ?? undefined;
}

export async function listWatchlistScanRuns(entryId?: string) {
  return getStorageAdapter().listWatchlistScanRuns(entryId);
}

type CreateDiscoveryAlertInput = {
  walletAddress: string;
  entryId?: string;
  runId?: string;
  kind: DiscoveryAlert["kind"];
  title: string;
  detail: string;
  severity: RiskLevel;
  sourceLabel?: string;
};

export async function createDiscoveryAlert(input: CreateDiscoveryAlertInput): Promise<DiscoveryAlert> {
  const alert: DiscoveryAlertInsert = {
    id: createRecordId("alert"),
    walletAddress: normalizeWallet(input.walletAddress),
    entryId: input.entryId,
    runId: input.runId,
    kind: input.kind,
    title: input.title,
    detail: input.detail,
    severity: input.severity,
    sourceLabel: input.sourceLabel,
    acknowledged: false,
    createdAt: new Date().toISOString(),
  };
  return getStorageAdapter().createDiscoveryAlert(alert);
}

export async function listDiscoveryAlerts(walletAddress?: string) {
  return getStorageAdapter().listDiscoveryAlerts(walletAddress);
}

export async function acknowledgeDiscoveryAlert(id: string) {
  return (await getStorageAdapter().acknowledgeDiscoveryAlert(id)) ?? undefined;
}

export async function exportWalletData(
  walletAddress: string,
  network?: string,
  chainFamily?: "evm" | "stellar",
) {
  const normalized = walletAddress.trim();
  const isEvm = normalized.startsWith("0x");
  const canonicalWallet = isEvm ? normalized.toLowerCase() : normalized;
  const targetNetwork = network?.trim();
  const memoryData = await getStorageAdapter().exportWalletData(canonicalWallet, targetNetwork, chainFamily);

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: "v1",
    walletAddress: canonicalWallet,
    network: targetNetwork ?? (isEvm ? "ethereum" : "soroban-testnet"),
    chainFamily: chainFamily ?? (isEvm ? ("evm" as const) : ("stellar" as const)),
    memoryData,
    pgData: {},
  };
}

export async function deleteWalletData(
  walletAddress: string,
  network?: string,
  chainFamily?: "evm" | "stellar",
) {
  const normalized = walletAddress.trim();
  const isEvm = normalized.startsWith("0x");
  const canonicalWallet = isEvm ? normalized.toLowerCase() : normalized;
  const targetChainFamily = chainFamily ?? (isEvm ? "evm" : "stellar");
  const targetNetwork = network?.trim();
  const result = await getStorageAdapter().deleteWalletData(canonicalWallet, targetNetwork, targetChainFamily);

  return {
    ok: true,
    deletedAt: new Date().toISOString(),
    walletAddress: canonicalWallet,
    network: targetNetwork,
    chainFamily: targetChainFamily,
    memoryRecordsRemoved: result.deletedCount,
    memoryAuditRecordsUnlinked: result.unlinkedAuditCount,
    portfolioCacheEvicted: clearPortfolioCacheForWallet(canonicalWallet),
    pgResult: result,
  };
}

export async function pruneExpiredRecords(now = new Date().toISOString()) {
  return getStorageAdapter().pruneExpiredRecords(now);
}

export async function computeBuyRiskTrend(_walletAddress?: string, _limit?: number) {
  void _walletAddress;
  void _limit;
  return [];
}

export async function computePerAgentTrends(_walletAddress?: string) {
  void _walletAddress;
  return [];
}

export async function getDecisionDetail(_id: string) {
  void _id;
  return null;
}

export async function getSourceSnapshotDetails(_id: string) {
  void _id;
  return null;
}
