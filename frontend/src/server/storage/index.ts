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
import {
  getPostgresStorageAdapter,
  mirrorAlertDeliveryUpdate,
  mirrorAlertDeliveryWrite,
  mirrorAlertObservationWrite,
  mirrorAlertRuleWrite,
  mirrorAlertUpdate,
  mirrorAlertWrite,
  mirrorNotificationPreferencesDelete,
  mirrorNotificationPreferencesWrite,
  deleteWalletDataFromPg,
  exportWalletDataFromPg,
  pruneExpiredRecordsFromPg,
  mirrorTransactionLifecycleEvent,
  mirrorTransactionRecord,
  mirrorWatchlistEntryDeletion,
  mirrorWatchlistEntryLatestScanUpdate,
  mirrorWatchlistEntryWrite,
  mirrorWatchlistEntryWriteBulk,
  mirrorWatchlistScanRunWrite,
} from "@/server/storage/postgresAdapter";
export {
  authorizeAutoMode,
  closeAutoModeAuthorization,
  getAutoModeSnapshot,
  saveAutoModePolicy,
} from "@/server/autoMode/storage";

export {
  deleteWalletDataFromPg,
  exportWalletDataFromPg,
  pruneExpiredRecordsFromPg,
};
import { clearPortfolioCacheForWallet } from "@/server/stellar/portfolio";
import { invalidatePortfolioForWallet, invalidateWalletCache } from "@/server/cache";
import { resetDevEnvironment, seedDevEnvironment } from "./bootstrap";

export const devReset = resetDevEnvironment;
export const devSeed = seedDevEnvironment;

/**
 * Hydration gate. When the Postgres adapter has rows on disk, this
 * promise merges them back into the in-memory stores on first import.
 * Audit finding #38: writes were mirrored to SQL but reads never
 * re-hydrated from SQL after a restart, so alert history looked empty.
 *
 * The gate uses a single bootPromise stored on globalThis: cold starts
 * kick off the hydrate; subsequent re-evaluations (HMR, route reloads)
 * await the same promise so the hydrate runs at most once per process.
 */
  type CryptaraMemoryGlobal = typeof globalThis & {
  __cryptaraAlertRules?: AlertRule[];
  __cryptaraAlertObservations?: AlertObservation[];
  __cryptaraAlerts?: Alert[];
  __cryptaraAlertDeliveries?: AlertDelivery[];
  __cryptaraNotificationPreferences?: NotificationPreferences[];
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
  __cryptaraHydrationStarted?: boolean;
  __cryptaraHydrationPromise?: Promise<{ tried: boolean; hydrated: number; skipped: number; detail: string }>;
  __cryptaraLastHydration?: { tried: boolean; hydrated: number; skipped: number; detail: string; at: string };
};

const memoryStore = globalThis as CryptaraMemoryGlobal;

export function ensureStorageReady(): Promise<{ tried: boolean; hydrated: number; skipped: number; detail: string }> {
  const store = memoryStore as CryptaraMemoryGlobal;

  if (store.__cryptaraHydrationPromise) return store.__cryptaraHydrationPromise;

  store.__cryptaraHydrationStarted = true;
  store.__cryptaraHydrationPromise = (async () => {
    const adapter = getPostgresStorageAdapter();

    if (!adapter.isConfigured()) {
      const result = { tried: false, hydrated: 0, skipped: 0, detail: "no DATABASE_URL configured" };
      store.__cryptaraLastHydration = { ...result, at: new Date().toISOString() };

      return result;
    }

    try {
      const [alertHydrate, txHydrate, watchlistHydrate] = await Promise.all([
        adapter.hydrateAlertTables({
          rules: getAlertRulesStore(),
          observations: getAlertObservationsStore(),
          alerts: getAlertsStore(),
          deliveries: getAlertDeliveriesStore(),
        }),
        adapter.hydrateTransactionTables({
          transactions: getTransactions(),
          events: getTransactionEvents(),
        }),
        adapter.hydrateWatchlistTables({
          entries: getWatchlistEntries(),
          scanRuns: getWatchlistScanRuns(),
        }),
      ]);
      const totalHydrated = alertHydrate.hydrated + txHydrate.hydrated + watchlistHydrate.hydrated;
      const totalSkipped = alertHydrate.skipped + txHydrate.skipped + watchlistHydrate.skipped;
      const result = { tried: true, hydrated: totalHydrated, skipped: totalSkipped, detail: "ok" };
      store.__cryptaraLastHydration = { ...result, at: new Date().toISOString() };

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const result = { tried: true, hydrated: 0, skipped: 0, detail: message };
      store.__cryptaraLastHydration = { ...result, at: new Date().toISOString() };

      return result;
    }
  })();

  return store.__cryptaraHydrationPromise;
}

export function getLastHydrationSummary() {
  return memoryStore.__cryptaraLastHydration
    ? { ...memoryStore.__cryptaraLastHydration }
    : null;
}

// Eager hydration on module init. Subsequent reads (SSR pages, API
// routes, fixtures) see the same globalThis.__cryptara* arrays
// already populated from SQL where available. Errors are absorbed by
// `ensureStorageReady()` and surfaced via `getStorageHealth()`.
void ensureStorageReady();

/**
 * Mirror alert-table writes to Postgres so the SQL contract in
 * `schema.sql` is actually populated. The in-memory store remains the
 * synchronous source of truth; mirror failures are surfaced via
 * `getStorageHealth()` and never block the caller.
 */
function mirrorAlertRuleWriteDeferred(input: AlertRule) {
  mirrorAlertRuleWrite(input);
}
function mirrorAlertObservationWriteDeferred(input: AlertObservation) {
  mirrorAlertObservationWrite(input);
}
function mirrorAlertWriteDeferred(input: Alert) {
  mirrorAlertWrite(input);
}
function mirrorAlertDeliveryWriteDeferred(input: AlertDelivery) {
  mirrorAlertDeliveryWrite(input);
}
function mirrorAlertUpdateDeferred(input: Alert) {
  mirrorAlertUpdate(input);
}
function mirrorAlertDeliveryUpdateDeferred(input: AlertDelivery) {
  mirrorAlertDeliveryUpdate(input);
}
function mirrorNotificationPreferencesWriteDeferred(input: NotificationPreferences) {
  mirrorNotificationPreferencesWrite(input);
}
function mirrorNotificationPreferencesDeleteDeferred(id: string) {
  mirrorNotificationPreferencesDelete(id);
}

async function persistTransactionRecord(record: TransactionRecord) {
  if (!getPostgresStorageAdapter().isConfigured()) return;
  try { await mirrorTransactionRecord(record); } catch { /* best-effort */ }
}

async function persistTransactionUpdate(hash: string, updates: Partial<TransactionRecord>) {
  if (!getPostgresStorageAdapter().isConfigured()) return;
  try {
    const existing = getTransactions().find((r) => r.hash.toLowerCase() === hash.toLowerCase());
    if (!existing) return;
    const merged: TransactionRecord = { ...existing, ...updates, hash: existing.hash, createdAt: existing.createdAt };
    await mirrorTransactionRecord(merged);
  } catch { /* best-effort */ }
}

async function persistTransactionEvent(event: TransactionLifecycleEvent) {
  if (!getPostgresStorageAdapter().isConfigured()) return;
  try { await mirrorTransactionLifecycleEvent(event); } catch { /* best-effort */ }
}

function getTransactionEvents() {
  memoryStore.__cryptaraTransactionEvents ??= [];
  return memoryStore.__cryptaraTransactionEvents;
}

function getTransactionObservations() {
  memoryStore.__cryptaraTransactionObservations ??= [];
  return memoryStore.__cryptaraTransactionObservations;
}

type CreateAgentRunInput = {
  walletAddress: string;
  mode?: AgentRunRecord["mode"];
  inputSnapshot?: Record<string, unknown>;
  targetToken?: AgentRunRecord["targetToken"];
  results: AgentResult[];
  userAction?: AgentRunRecord["userAction"];
};

export const storageSchemaContract = {
  tables: [
    "wallets",
    "agent_runs",
    "agent_results",
    "recommendations",
    "user_rules",
    "auto_mode_policies",
    "auto_mode_authorization_events",
    "approvals",
    "transactions",
    "transaction_lifecycle_events",
    "transaction_observations",
    "x402_payment_receipts",
    "x402_settlement_ledger",
    "token_identities",
    "source_snapshots",
    "alert_rules",
    "alert_observations",
    "alerts",
    "alert_deliveries",
    "watchlist_entries",
    "watchlist_scan_runs",
    "discovery_alerts",
    "authz_audit_entries",
  ],
  adapterApi: [
    "listAgentRunRecords",
    "getAgentRunRecord",
    "createAgentRunRecord",
    "listRecommendationRecords",
    "createRecommendationRecord",
    "listTransactionRecords",
    "getTransactionRecord",
    "getTransactionRecordByIdempotencyKey",
    "createTransactionRecord",
    "updateTransactionRecord",
    "listTransactionLifecycleEvents",
    "createTransactionLifecycleEvent",
    "listTransactionObservations",
    "createTransactionObservation",
    "listApprovalRecords",
    "createApprovalRecord",
    "listX402PaymentReceipts",
    "getX402PaymentReceiptByHeaderHash",
    "createX402PaymentReceipt",
    "getUserRuleRecord",
    "upsertUserRuleRecord",
    "getAutoModeSnapshot",
    "saveAutoModePolicy",
    "authorizeAutoMode",
    "closeAutoModeAuthorization",
    "listAlertRules",
    "getAlertRule",
    "upsertAlertRule",
    "deleteAlertRule",
    "listAlertObservations",
    "createAlertObservation",
    "listAlerts",
    "getAlert",
    "createAlert",
    "updateAlert",
    "listAlertDeliveries",
    "createAlertDelivery",
    "updateAlertDelivery",
    "ensureAlertRulesForWallet",
    "listWatchlistEntries",
    "getWatchlistEntry",
    "addWatchlistEntry",
    "removeWatchlistEntry",
    "listWatchlistScanRuns",
    "addWatchlistScanRun",
    "listDiscoveryAlerts",
    "acknowledgeDiscoveryAlert",
    "createDiscoveryAlert",
    "updateWatchlistEntryLatestScan",
    "exportWalletData",
    "deleteWalletData",
  ],
  migration: "frontend/src/server/storage/schema.sql",
};

function getAgentRuns() {
  memoryStore.__cryptaraAgentRuns ??= [];

  return memoryStore.__cryptaraAgentRuns;
}

function getRecommendations() {
  memoryStore.__cryptaraRecommendations ??= [];

  return memoryStore.__cryptaraRecommendations;
}

function getTransactions() {
  memoryStore.__cryptaraTransactions ??= [];

  return memoryStore.__cryptaraTransactions;
}

function getApprovals() {
  memoryStore.__cryptaraApprovals ??= [];

  return memoryStore.__cryptaraApprovals;
}

function getUserRules() {
  memoryStore.__cryptaraUserRules ??= [];

  return memoryStore.__cryptaraUserRules;
}

function getX402PaymentReceipts() {
  memoryStore.__cryptaraX402PaymentReceipts ??= [];

  return memoryStore.__cryptaraX402PaymentReceipts;
}

function getAlertRulesStore() {
  memoryStore.__cryptaraAlertRules ??= [];

  return memoryStore.__cryptaraAlertRules;
}

function getAlertObservationsStore() {
  memoryStore.__cryptaraAlertObservations ??= [];

  return memoryStore.__cryptaraAlertObservations;
}

function getAlertsStore() {
  memoryStore.__cryptaraAlerts ??= [];

  return memoryStore.__cryptaraAlerts;
}

function getAlertDeliveriesStore() {
  memoryStore.__cryptaraAlertDeliveries ??= [];

  return memoryStore.__cryptaraAlertDeliveries;
}

function getNotificationPreferencesStore() {
  memoryStore.__cryptaraNotificationPreferences ??= [];

  return memoryStore.__cryptaraNotificationPreferences;
}

function getWatchlistEntries() {
  memoryStore.__cryptaraWatchlistEntries ??= [];

  return memoryStore.__cryptaraWatchlistEntries;
}

function getWatchlistScanRuns() {
  memoryStore.__cryptaraWatchlistScanRuns ??= [];

  return memoryStore.__cryptaraWatchlistScanRuns;
}

function getDiscoveryAlerts() {
  memoryStore.__cryptaraDiscoveryAlerts ??= [];

  return memoryStore.__cryptaraDiscoveryAlerts;
}

function createId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createRecordId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createAlertId() {
  return `alert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

export function getStorageHealth(): StorageHealth {
  const adapter = getPostgresStorageAdapter();
  const snapshot = adapter.getHealthSnapshot();

  if (snapshot.connectionStringPresent) {
    const detail = snapshot.connected
      ? `Postgres adapter connected (since ${snapshot.connectedAt}). ${snapshot.mirrorSuccessCount} mirror writes succeeded, ${snapshot.mirrorFailureCount} failed.`
      : snapshot.pgInstalled
        ? `Postgres connection string present but adapter has not connected yet (${snapshot.lastError ?? "no attempt yet"}). The in-memory store stays the source of truth at runtime; mirror writes resume once the connection succeeds.`
        : `Postgres connection string is configured but the \`pg\` client is not installed in this deployment. Run \`npm install pg\` to enable durable persistence; the runtime currently uses the in-memory store and the schema contract is fixed for adapter parity.`;

    return {
      provider: "supabase_postgres",
      persistent: snapshot.connected,
      detail,
      schema: storageSchemaContract,
    };
  }

  return {
    provider: "memory",
    persistent: false,
    detail: "Using in-memory MVP storage. Records reset when the server process restarts. Set SUPABASE_DB_URL/POSTGRES_URL/DATABASE_URL plus `pg` to make alert storage durable.",
    schema: storageSchemaContract,
  };
}

export function getStorageCounts(): StorageCounts {
  return {
    agentRuns: getAgentRuns().length,
    recommendations: getRecommendations().length,
    transactions: getTransactions().length,
    approvals: getApprovals().length,
    userRules: getUserRules().length,
    x402PaymentReceipts: getX402PaymentReceipts().length,
    alertRules: getAlertRulesStore().length,
    alertObservations: getAlertObservationsStore().length,
    alerts: getAlertsStore().length,
    alertDeliveries: getAlertDeliveriesStore().length,
    notificationPreferences: getNotificationPreferencesStore().length,
  };
}

function normalizeWallet(walletAddress?: string | null): string | undefined {
  return walletAddress?.trim().toLowerCase() || undefined;
}

function withNormalizedWallet<T extends { walletAddress: string }>(walletAddress?: string) {
  const normalized = normalizeWallet(walletAddress);

  return (record: T) => !normalized || record.walletAddress === normalized;
}

// ---------------- Alert Engine Storage ----------------

export function ensureAlertRulesForWallet(walletAddress?: string) {
  const normalized = normalizeWallet(walletAddress);

  if (!normalized) return [];

  return [...ensureAlertRulesForWalletRaw().filter((rule) => rule.walletAddress === normalized)];
}

function ensureAlertRulesForWalletRaw() {
  // The store holds every wallet's rules. Filters are applied on read.
  return getAlertRulesStore();
}

export function listAlertRules(walletAddress?: string) {
  return [...getAlertRulesStore()]
    .filter(withNormalizedWallet(walletAddress))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function getAlertRule(id: string) {
  return getAlertRulesStore().find((rule) => rule.id === id);
}

export function upsertAlertRule(input: AlertRule) {
  const now = new Date().toISOString();
  const normalized: AlertRule = {
    ...input,
    observationKey: input.observationKey?.trim() || undefined,
    hysteresis: Number.isFinite(input.hysteresis) ? Math.max(0, input.hysteresis) : 0,
    cooldownMinutes: Number.isFinite(input.cooldownMinutes) ? Math.max(0, Math.round(input.cooldownMinutes)) : 60,
    updatedAt: now,
    createdAt: input.createdAt ?? now,
    walletAddress: input.walletAddress.trim().toLowerCase(),
  };
  const existingIndex = getAlertRulesStore().findIndex((rule) => rule.id === normalized.id && rule.walletAddress === normalized.walletAddress);

  if (existingIndex >= 0) {
    getAlertRulesStore()[existingIndex] = normalized;
  } else {
    getAlertRulesStore().unshift(normalized);
  }
  mirrorAlertRuleWriteDeferred(normalized);

  return normalized;
}

export function deleteAlertRule(id: string, walletAddress?: string) {
  const store = getAlertRulesStore();
  const normalized = normalizeWallet(walletAddress);
  const targetIndex = store.findIndex((rule) => rule.id === id && (!normalized || rule.walletAddress === normalized));

  if (targetIndex < 0) return false;

  store.splice(targetIndex, 1);

  return true;
}

export function listAlertObservations(walletAddress?: string, limit = 200) {
  return [...getAlertObservationsStore()]
    .filter(withNormalizedWallet(walletAddress))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, limit);
}

export function createAlertObservation(input: Omit<AlertObservation, "id" | "createdAt">) {
  const observation: AlertObservation = {
    id: createRecordId("obs"),
    createdAt: new Date().toISOString(),
    ...input,
    walletAddress: input.walletAddress.trim().toLowerCase(),
  };

  getAlertObservationsStore().unshift(observation);
  mirrorAlertObservationWriteDeferred(observation);

  return observation;
}

export function listAlerts(walletAddress?: string, status?: Alert["status"], limit = 200) {
  const normalizedWallet = normalizeWallet(walletAddress);

  return [...getAlertsStore()]
    .filter((alert) => !normalizedWallet || alert.walletAddress === normalizedWallet)
    .filter((alert) => !status || alert.status === status)
    .sort((left, right) => new Date(right.triggeredAt).getTime() - new Date(left.triggeredAt).getTime())
    .slice(0, limit);
}

export function getAlert(id: string, walletAddress?: string) {
  const alert = getAlertsStore().find((record) => record.id === id);

  if (!alert) return undefined;
  if (walletAddress && alert.walletAddress !== normalizeWallet(walletAddress)) return undefined;

  return alert;
}

export function createAlert(input: Omit<Alert, "id" | "triggeredAt">) {
  const alert: Alert = {
    id: createAlertId(),
    triggeredAt: new Date().toISOString(),
    ...input,
    walletAddress: input.walletAddress.trim().toLowerCase(),
  };

  getAlertsStore().unshift(alert);
  mirrorAlertWriteDeferred(alert);

  return alert;
}

export function updateAlert(id: string, walletAddress: string, patch: Partial<Alert>) {
  const store = getAlertsStore();
  const normalized = normalizeWallet(walletAddress);
  const index = store.findIndex((record) => record.id === id && record.walletAddress === normalized);

  if (index < 0) return undefined;

  store[index] = { ...store[index], ...patch };
  mirrorAlertUpdateDeferred(store[index]);

  return store[index];
}

export function listAlertDeliveries(alertId?: string, walletAddress?: string) {
  return [...getAlertDeliveriesStore()]
    .filter((delivery) => !alertId || delivery.alertId === alertId)
    .filter(withNormalizedWallet(walletAddress))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function createAlertDelivery(input: Omit<AlertDelivery, "id" | "createdAt">) {
  const delivery: AlertDelivery = {
    id: createRecordId("delivery"),
    createdAt: new Date().toISOString(),
    ...input,
    walletAddress: input.walletAddress.trim().toLowerCase(),
  };

  getAlertDeliveriesStore().unshift(delivery);
  mirrorAlertDeliveryWriteDeferred(delivery);

  return delivery;
}

export function updateAlertDelivery(id: string, walletAddress: string, patch: Partial<AlertDelivery>) {
  const store = getAlertDeliveriesStore();
  const index = store.findIndex((record) => record.id === id && record.walletAddress === walletAddress.toLowerCase());

  if (index < 0) return undefined;

  store[index] = { ...store[index], ...patch };
  mirrorAlertDeliveryUpdateDeferred(store[index]);

  return store[index];
}

// ------------- Notification preferences & routing (issue #152) -------------

export type NotificationPreferenceScope = {
  walletAddress: string;
  chainFamily: "evm" | "stellar";
  network: string;
};

/**
 * Returns the stored preferences for a (wallet, chainFamily, network) scope,
 * or `undefined` when none have been persisted yet.
 */
export function getNotificationPreferences(scope: NotificationPreferenceScope) {
  const wallet = normalizeWallet(scope.walletAddress)!;
  const network = scope.network ?? "legacy-evm";

  return getNotificationPreferencesStore().find(
    (pref) =>
      pref.walletAddress === wallet &&
      pref.chainFamily === scope.chainFamily &&
      pref.network === network,
  );
}

export function listNotificationPreferences(walletAddress?: string) {
  return [...getNotificationPreferencesStore()]
    .filter(withNormalizedWallet(walletAddress))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

/**
 * Upserts a wallet's notification preferences for a chain scope. Creates a
 * stable id on first insert and reflects the write to Postgres.
 */
export function upsertNotificationPreferences(input: NotificationPreferences) {
  const now = new Date().toISOString();
  const wallet = input.walletAddress.trim().toLowerCase();
  const network = input.network || "legacy-evm";
  const existingIndex = getNotificationPreferencesStore().findIndex(
    (pref) =>
      pref.walletAddress === wallet &&
      pref.chainFamily === input.chainFamily &&
      pref.network === network,
  );

  const record: NotificationPreferences = {
    ...input,
    id: existingIndex >= 0 ? getNotificationPreferencesStore()[existingIndex].id : `nfpref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    walletAddress: wallet,
    network,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    getNotificationPreferencesStore()[existingIndex] = record;
  } else {
    getNotificationPreferencesStore().unshift(record);
  }
  mirrorNotificationPreferencesWriteDeferred(record);

  return record;
}

export function deleteNotificationPreferences(id: string) {
  const store = getNotificationPreferencesStore();
  const index = store.findIndex((pref) => pref.id === id);

  if (index < 0) return false;

  store.splice(index, 1);
  mirrorNotificationPreferencesDeleteDeferred(id);

  return true;
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

export function listAgentRunRecords(walletAddress?: string) {
  const normalizedWallet = walletAddress?.toLowerCase();

  return getAgentRuns()
    .filter((record) => !normalizedWallet || record.walletAddress.toLowerCase() === normalizedWallet)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function getAgentRunRecord(id: string) {
  return getAgentRuns().find((record) => record.id === id);
}

export function createAgentRunRecord(input: CreateAgentRunInput): AgentRunRecord {
  for (const result of input.results) {
    const parsed = validateAgentResult(result);

    if (!parsed.success) {
      throw new Error(`Invalid AgentResult cannot be stored for ${result.agent}: ${parsed.error.message}`);
    }
  }

  const decision = [...input.results].reverse().find((result) => result.agent === "decision");
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
  const record: AgentRunRecord = {
    id: createId(),
    walletAddress: input.walletAddress,
    mode: input.mode,
    targetToken: input.targetToken,
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

  getAgentRuns().unshift(record);
  createRecommendationRecord({
    runId: record.id,
    walletAddress: record.walletAddress,
    action: record.recommendation,
    decisionScore: record.decisionScore,
    confidence: record.confidence,
    summary: record.summary,
  });

  return record;
}

export function listRecommendationRecords(walletAddress?: string) {
  const normalizedWallet = walletAddress?.toLowerCase();

  return getRecommendations()
    .filter((record) => !normalizedWallet || record.walletAddress.toLowerCase() === normalizedWallet)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function createRecommendationRecord(input: Omit<RecommendationRecord, "id" | "createdAt">) {
  const record: RecommendationRecord = {
    id: createRecordId("rec"),
    createdAt: new Date().toISOString(),
    ...input,
  };

  getRecommendations().unshift(record);

  return record;
}

export function listTransactionRecords(walletAddress?: string) {
  const normalizedWallet = walletAddress?.toLowerCase();

  return getTransactions()
    .filter((record) => !normalizedWallet || record.walletAddress?.toLowerCase() === normalizedWallet)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function listTransactionRecordsPaginated(
  walletAddress?: string,
  options: { cursor?: string; limit?: number } = {},
) {
  const all = listTransactionRecords(walletAddress);
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));
  const offset = options.cursor ? Math.max(0, all.findIndex((record) => record.hash === options.cursor) + 1) : 0;
  const items = all.slice(offset, offset + limit);
  return {
    items,
    total: all.length,
    nextCursor: offset + limit < all.length ? items.at(-1)?.hash : undefined,
  };
}

export function getTransactionRecord(hash: string) {
  const family: ChainFamily = isTransactionHashForChain(hash, "evm")
    ? "evm"
    : isTransactionHashForChain(hash, "stellar")
      ? "stellar"
      : "evm";
  return getTransactionRecordForFamily(hash, family);
}

export function getTransactionRecordForFamily(hash: string, family: ChainFamily) {
  const normalized = canonicalizeTransactionHash(hash, family);
  return getTransactions().find((record) => canonicalizeTransactionHash(record.hash, record.chainFamily) === normalized);
}

export function getTransactionRecordByIdempotencyKey(walletAddress: string, idempotencyKey: string) {
  if (!idempotencyKey) return undefined;
  const normalizedWallet = walletAddress.trim().toLowerCase();
  return getTransactions().find((record) =>
    record.idempotencyKey === idempotencyKey && (record.walletAddress ?? "").trim().toLowerCase() === normalizedWallet,
  );
}

export function createTransactionRecord(input: Omit<TransactionRecord, "createdAt" | "lifecycleStatus"> & { createdAt?: string; lifecycleStatus?: TransactionLifecycleStatus }) {
  const existing = getTransactionRecord(input.hash);

  if (existing) {
    return existing;
  }

  const lifecycleStatus: TransactionLifecycleStatus = input.lifecycleStatus ?? input.status ?? "prepared";
  const record: TransactionRecord = {
    ...input,
    lifecycleStatus,
    status: lifecycleStatus,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };

  getTransactions().unshift(record);
  persistTransactionRecord(record);
  if (record.walletAddress) invalidatePortfolioForWallet(record.walletAddress);

  return record;
}

export function updateTransactionRecord(hash: string, updates: Partial<Omit<TransactionRecord, "hash" | "createdAt">> & { status?: TransactionLifecycleStatus }) {
  const list = getTransactions();
  const existingIndex = list.findIndex((record) => record.hash.toLowerCase() === hash.toLowerCase());

  if (existingIndex < 0) {
    return undefined;
  }

  const previous = list[existingIndex];
  const nextStatus: TransactionLifecycleStatus = updates.status ?? updates.lifecycleStatus ?? previous.lifecycleStatus;
  const merged: TransactionRecord = {
    ...previous,
    ...updates,
    hash: previous.hash,
    createdAt: previous.createdAt,
    lifecycleStatus: nextStatus,
    status: nextStatus,
  };

  list[existingIndex] = merged;
  persistTransactionUpdate(hash, updates);
  if (merged.walletAddress) invalidatePortfolioForWallet(merged.walletAddress);

  return merged;
}

export function listTransactionLifecycleEvents(hash: string) {
  const normalized = hash.trim().toLowerCase();
  return getTransactionEvents()
    .filter((event) => event.hash.toLowerCase() === normalized)
    .sort((left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime());
}

export function listTransactionObservations(hash: string) {
  const normalized = hash.trim().toLowerCase();
  return getTransactionObservations()
    .filter((observation) => observation.hash.toLowerCase() === normalized)
    .sort((left, right) => new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime());
}

export function createTransactionObservation(
  input: Omit<TransactionObservation, "id" | "observedAt"> & { observedAt?: string },
) {
  const existing = getTransactionObservations().find(
    (observation) => observation.hash.toLowerCase() === input.hash.toLowerCase() && observation.evidenceKey === input.evidenceKey,
  );
  if (existing) return { observation: existing, created: false };
  const observation: TransactionObservation = {
    ...input,
    id: createRecordId("tx_observation"),
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
  getTransactionObservations().unshift(observation);
  return { observation, created: true };
}

export function createTransactionLifecycleEvent(input: Omit<TransactionLifecycleEvent, "id" | "occurredAt"> & { occurredAt?: string }) {
  const event: TransactionLifecycleEvent = {
    id: createRecordId("tx_event"),
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    ...input,
  };

  getTransactionEvents().unshift(event);
  persistTransactionEvent(event);

  return event;
}

export function canonicalizeTransactionHash(hash: string, family: ChainFamily = "evm") {
  const trimmed = hash.trim();
  return family === "stellar" ? trimmed.toUpperCase() : trimmed.toLowerCase();
}

export function appendLifecycleEventByName(hash: string, event: TransactionLifecycleEventName, detail?: Record<string, unknown>, provider?: { label: string; url?: string }) {
  return createTransactionLifecycleEvent({
    hash,
    event,
    detail,
    provider: provider?.label,
    providerUrl: provider?.url,
  });
}

export function isImmutableTerminal(status: TransactionLifecycleStatus) {
  return status === "confirmed" || status === "failed" || status === "replaced" || status === "dropped" || status === "expired" || status === "user_rejected";
}

export function listApprovalRecords(walletAddress?: string) {
  const normalizedWallet = walletAddress?.toLowerCase();

  return getApprovals()
    .filter((record) => !normalizedWallet || record.walletAddress.toLowerCase() === normalizedWallet)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function createApprovalRecord(input: Omit<UserApprovalRecord, "id" | "createdAt" | "status" | "autoExecuted">) {
  const record: UserApprovalRecord = {
    id: createRecordId("approval"),
    ...input,
    status: "confirmed",
    autoExecuted: false,
    createdAt: new Date().toISOString(),
  };

  getApprovals().unshift(record);

  return record;
}

/**
 * Fetch the wallet-scoped source records for an audit bundle export. Returns
 * decisions, approvals, and transactions for a single wallet — the raw inputs
 * the privacy bundle redacts and hashes. Never returns another wallet's data.
 */
export function getAuditSourceRecords(walletAddress: string): {
  decisions: RecommendationRecord[];
  approvals: UserApprovalRecord[];
  transactions: TransactionRecord[];
} {
  return {
    decisions: listRecommendationRecords(walletAddress),
    approvals: listApprovalRecords(walletAddress),
    transactions: listTransactionRecords(walletAddress),
  };
}

export function getUserRuleRecord(walletAddress = "0xDemoWallet") {
  const existing = getUserRules().find((rule) => rule.walletAddress.toLowerCase() === walletAddress.toLowerCase());

  return {
    ...getDefaultRules(walletAddress),
    ...existing,
    autoExecute: false,
  };
}

export function upsertUserRuleRecord(input: UserRule) {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const defaults = getDefaultRules(input.walletAddress);
  const existingIndex = getUserRules().findIndex((rule) => rule.walletAddress.toLowerCase() === input.walletAddress.toLowerCase());
  // Always auto-increment version on every upsert so decision/execution
  // see a monotonically-increasing versioned snapshot. Client-supplied
  // version is ignored — trusted storage owns the version counter.
  const currentVersion = existingIndex >= 0 ? (getUserRules()[existingIndex].version ?? 0) : 0;
  const record: UserRule = {
    ...defaults,
    ...input,
    autoExecute: false,
    version: currentVersion + 1,
    createdAt,
  };

  if (existingIndex >= 0) {
    getUserRules()[existingIndex] = record;
  } else {
    getUserRules().unshift(record);
  }

  return record;
}

export function listX402PaymentReceipts() {
  return getX402PaymentReceipts().sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function getX402PaymentReceiptByHeaderHash(paymentHeaderHash: string) {
  return getX402PaymentReceipts().find((record) => record.paymentHeaderHash === paymentHeaderHash);
}

export function createX402PaymentReceipt(input: Omit<X402PaymentReceipt, "id" | "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }) {
  const existing =  getX402PaymentReceiptByHeaderHash(input.paymentHeaderHash);

  if (existing) {
    return {
      ...existing,
      verificationStatus: "duplicate" as const,
      updatedAt: new Date().toISOString(),
    };
  }

  const createdAt = input.createdAt ?? new Date().toISOString();
  const chainFamily = input.chainFamily ?? "evm";
  const record: X402PaymentReceipt = {
    id: createRecordId("x402"),
    ...input,
    chainFamily,
    payerIdentity: input.payer || input.transactionHash
      ? { chainFamily, payer: input.payer, transactionHash: input.transactionHash }
      : undefined,
    createdAt,
    updatedAt: input.updatedAt ?? createdAt,
  };

  getX402PaymentReceipts().unshift(record);

  return record;
}
type CreateWatchlistInput = WatchlistEntryInput & {
  identityKey: string;
};

export function listWatchlistEntries(walletAddress?: string) {
  const normalizedWallet = walletAddress?.toLowerCase();

  return getWatchlistEntries()
    .filter((entry) => !normalizedWallet || entry.walletAddress.toLowerCase() === normalizedWallet)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function getWatchlistEntry(id: string) {
  return getWatchlistEntries().find((entry) => entry.id === id);
}

export type AddWatchlistEntryResult = {
  entry: WatchlistEntry;
  alreadyExisted: boolean;
};

export function addWatchlistEntry(input: CreateWatchlistInput): AddWatchlistEntryResult {
  const normalizedWallet = input.walletAddress.trim();
  const existing = getWatchlistEntries().find(
    (entry) =>
      entry.walletAddress.toLowerCase() === normalizedWallet.toLowerCase() &&
      entry.identityKey === input.identityKey,
  );

  if (existing) {
    return { entry: existing, alreadyExisted: true };
  }

  const entry: WatchlistEntry = {
    id: createRecordId("watch"),
    walletAddress: normalizedWallet,
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

  getWatchlistEntries().unshift(entry);
  mirrorWatchlistEntryWrite(entry);
  invalidateWalletCache(entry.walletAddress);

  return { entry, alreadyExisted: false };
}

export function removeWatchlistEntry(id: string) {
  const store = getWatchlistEntries();
  const remaining = store.filter((entry) => entry.id !== id);
  const removed = store.length - remaining.length;

  memoryStore.__cryptaraWatchlistEntries = remaining;

  const runs = getWatchlistScanRuns().filter((run) => run.entryId !== id);
  memoryStore.__cryptaraWatchlistScanRuns = runs;

  const alerts = getDiscoveryAlerts().filter((alert) => alert.entryId !== id);
  memoryStore.__cryptaraDiscoveryAlerts = alerts;

  if (removed > 0) {
    mirrorWatchlistEntryDeletion(id);
    const removedEntry = store.find((entry) => entry.id === id);
    if (removedEntry?.walletAddress) invalidateWalletCache(removedEntry.walletAddress);
  }

  return removed > 0;
}

type AddWatchlistScanRunInput = {
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

export function addWatchlistScanRun(input: AddWatchlistScanRunInput): WatchlistScanRun {
  const previous = getWatchlistScanRuns()
    .filter((run) => run.entryId === input.entryId)
    .sort((left, right) => new Date(right.scannedAt).getTime() - new Date(left.scannedAt).getTime())[0];

  const run: WatchlistScanRun = {
    id: createRecordId("wscan"),
    entryId: input.entryId,
    walletAddress: input.walletAddress,
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

  getWatchlistScanRuns().unshift(run);
  mirrorWatchlistScanRunWrite(run);
  updateWatchlistEntryLatestScan(input.entryId, {
    scanRunId: run.id,
    classification: run.classification,
    score: run.score,
    scannedAt: run.scannedAt,
    status: run.status,
  });

  return run;
}

export function updateWatchlistEntryLatestScan(
  id: string,
  update: {
    scanRunId: string;
    classification: DiscoveryClassification;
    score: number;
    scannedAt: string;
    status: WatchlistScanRun["status"];
  },
) {
  const entry = getWatchlistEntries().find((candidate) => candidate.id === id);

  if (!entry) {
    return undefined;
  }

  entry.lastScannedAt = update.scannedAt;
  entry.latestScanRunId = update.scanRunId;
  entry.latestStatus = update.status === "failed" ? "stale" : update.status;
  invalidateWalletCache(entry.walletAddress);

  if (update.status === "failed") {
    const hasPriorSuccess = entry.successfulScanRunIds && entry.successfulScanRunIds.length > 0;

    if (!hasPriorSuccess) {
      entry.latestStatus = "stale";
    }
  } else {
    entry.latestClassification = update.classification;
    entry.latestScore = update.score;
    entry.successfulScanRunIds = [update.scanRunId, ...(entry.successfulScanRunIds ?? [])].slice(0, 50);
  }

  // When the scan failed, preserve the prior visible classification/score and mark
  // status as "stale" instead of "failed" — the same semantics the in-memory store
  // enforces above. Without this guard the Postgres mirror would overwrite the last
  // successful scan's evidence with the failed run's placeholder values.
  const mirrorClassification = update.status === "failed" ? (entry.latestClassification ?? update.classification) : update.classification;
  const mirrorScore = update.status === "failed" ? (entry.latestScore ?? update.score) : update.score;
  const mirrorStatus = update.status === "failed" ? "stale" : update.status;

  mirrorWatchlistEntryLatestScanUpdate(id, {
    classification: mirrorClassification,
    score: mirrorScore,
    scannedAt: update.scannedAt,
    status: mirrorStatus,
    scanRunId: update.scanRunId,
  });

  return entry;
}

export function listWatchlistScanRuns(entryId?: string) {
  return getWatchlistScanRuns()
    .filter((run) => !entryId || run.entryId === entryId)
    .sort((left, right) => new Date(right.scannedAt).getTime() - new Date(left.scannedAt).getTime());
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

export function createDiscoveryAlert(input: CreateDiscoveryAlertInput): DiscoveryAlert {
  const alert: DiscoveryAlert = {
    id: createRecordId("alert"),
    walletAddress: input.walletAddress,
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

  getDiscoveryAlerts().unshift(alert);

  return alert;
}

export function listDiscoveryAlerts(walletAddress?: string) {
  const normalizedWallet = walletAddress?.toLowerCase();

  return getDiscoveryAlerts()
    .filter((alert) => !normalizedWallet || alert.walletAddress.toLowerCase() === normalizedWallet)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function acknowledgeDiscoveryAlert(id: string) {
  const alert = getDiscoveryAlerts().find((candidate) => candidate.id === id);

  if (!alert) {
    return undefined;
  }

  alert.acknowledged = true;

  return alert;
}

function matchesWalletAddress(
  fieldWallet: string | undefined | null,
  targetWallet: string,
  fieldNetwork?: string,
  targetNetwork?: string
): boolean {
  if (!fieldWallet) return false;
  const rawTarget = targetWallet.trim();
  const rawField = fieldWallet.trim();
  const walletMatches = rawTarget.startsWith("0x")
    ? rawField.toLowerCase() === rawTarget.toLowerCase()
    : rawField === rawTarget || rawField.toLowerCase() === rawTarget.toLowerCase();
  if (!walletMatches) return false;
  if (targetNetwork && fieldNetwork) {
    return fieldNetwork.trim().toLowerCase() === targetNetwork.trim().toLowerCase();
  }
  return true;
}

export async function exportWalletData(walletAddress: string, network?: string, chainFamily?: "evm" | "stellar") {
  const normalized = walletAddress.trim();
  const isEvm = normalized.startsWith("0x");
  const canonicalWallet = isEvm ? normalized.toLowerCase() : normalized;
  const targetNetwork = network?.trim();

  const memoryData = {
    agentRuns: getAgentRuns().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet)),
    recommendations: getRecommendations().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet)),
    approvals: getApprovals().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet, r.network, targetNetwork)),
    transactions: getTransactions().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet, r.network, targetNetwork)),
    x402PaymentReceipts: getX402PaymentReceipts().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet, r.network, targetNetwork)),
    userRules: getUserRules().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet)),
    alertRules: getAlertRulesStore().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet)),
    alertObservations: getAlertObservationsStore().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet)),
    alerts: getAlertsStore().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet)),
    alertDeliveries: getAlertDeliveriesStore().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet)),
    watchlistEntries: getWatchlistEntries().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet)),
    watchlistScanRuns: getWatchlistScanRuns().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet)),
    discoveryAlerts: getDiscoveryAlerts().filter((r) => matchesWalletAddress(r.walletAddress, canonicalWallet)),
  };

  let pgData: Record<string, unknown[]> = {};
  try {
    pgData = await exportWalletDataFromPg(canonicalWallet, network, chainFamily);
  } catch {
    // optional PG export
  }

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: "v1",
    walletAddress: canonicalWallet,
    network: targetNetwork ?? (isEvm ? "ethereum" : "soroban-testnet"),
    chainFamily: chainFamily ?? (isEvm ? ("evm" as const) : ("stellar" as const)),
    memoryData,
    pgData,
  };
}

export async function deleteWalletData(
  walletAddress: string,
  network?: string,
  chainFamily?: "evm" | "stellar"
): Promise<{
  ok: boolean;
  deletedAt: string;
  walletAddress: string;
  network?: string;
  chainFamily: "evm" | "stellar";
  memoryRecordsRemoved: number;
  memoryAuditRecordsUnlinked: number;
  portfolioCacheEvicted: number;
  pgResult: { deletedCount: number; unlinkedAuditCount: number };
}> {
  const normalized = walletAddress.trim();
  const isEvm = normalized.startsWith("0x");
  const canonicalWallet = isEvm ? normalized.toLowerCase() : normalized;
  const targetChainFamily = chainFamily ?? (isEvm ? "evm" : "stellar");
  const targetNetwork = network?.trim();

  const portfolioCacheEvicted = clearPortfolioCacheForWallet(canonicalWallet);

  let memoryRecordsRemoved = 0;
  let memoryAuditRecordsUnlinked = 0;

  if (memoryStore.__cryptaraAgentRuns && !targetNetwork) {
    const before = memoryStore.__cryptaraAgentRuns.length;
    memoryStore.__cryptaraAgentRuns = memoryStore.__cryptaraAgentRuns.filter(
      (r) => !matchesWalletAddress(r.walletAddress, canonicalWallet)
    );
    memoryRecordsRemoved += before - memoryStore.__cryptaraAgentRuns.length;
  }

  if (memoryStore.__cryptaraRecommendations && !targetNetwork) {
    const before = memoryStore.__cryptaraRecommendations.length;
    memoryStore.__cryptaraRecommendations = memoryStore.__cryptaraRecommendations.filter(
      (r) => !matchesWalletAddress(r.walletAddress, canonicalWallet)
    );
    memoryRecordsRemoved += before - memoryStore.__cryptaraRecommendations.length;
  }

  if (memoryStore.__cryptaraApprovals) {
    const before = memoryStore.__cryptaraApprovals.length;
    memoryStore.__cryptaraApprovals = memoryStore.__cryptaraApprovals.filter(
      (r) => !matchesWalletAddress(r.walletAddress, canonicalWallet, r.network, targetNetwork)
    );
    memoryRecordsRemoved += before - memoryStore.__cryptaraApprovals.length;
  }

  if (memoryStore.__cryptaraUserRules && !targetNetwork) {
    const before = memoryStore.__cryptaraUserRules.length;
    memoryStore.__cryptaraUserRules = memoryStore.__cryptaraUserRules.filter(
      (r) => !matchesWalletAddress(r.walletAddress, canonicalWallet)
    );
    memoryRecordsRemoved += before - memoryStore.__cryptaraUserRules.length;
  }

  if (memoryStore.__cryptaraAlertRules && !targetNetwork) {
    const before = memoryStore.__cryptaraAlertRules.length;
    memoryStore.__cryptaraAlertRules = memoryStore.__cryptaraAlertRules.filter(
      (r) => !matchesWalletAddress(r.walletAddress, canonicalWallet)
    );
    memoryRecordsRemoved += before - memoryStore.__cryptaraAlertRules.length;
  }

  if (memoryStore.__cryptaraAlertObservations && !targetNetwork) {
    const before = memoryStore.__cryptaraAlertObservations.length;
    memoryStore.__cryptaraAlertObservations = memoryStore.__cryptaraAlertObservations.filter(
      (r) => !matchesWalletAddress(r.walletAddress, canonicalWallet)
    );
    memoryRecordsRemoved += before - memoryStore.__cryptaraAlertObservations.length;
  }

  if (memoryStore.__cryptaraAlerts && !targetNetwork) {
    const before = memoryStore.__cryptaraAlerts.length;
    memoryStore.__cryptaraAlerts = memoryStore.__cryptaraAlerts.filter(
      (r) => !matchesWalletAddress(r.walletAddress, canonicalWallet)
    );
    memoryRecordsRemoved += before - memoryStore.__cryptaraAlerts.length;
  }

  if (memoryStore.__cryptaraAlertDeliveries && !targetNetwork) {
    const before = memoryStore.__cryptaraAlertDeliveries.length;
    memoryStore.__cryptaraAlertDeliveries = memoryStore.__cryptaraAlertDeliveries.filter(
      (r) => !matchesWalletAddress(r.walletAddress, canonicalWallet)
    );
    memoryRecordsRemoved += before - memoryStore.__cryptaraAlertDeliveries.length;
  }

  if (memoryStore.__cryptaraWatchlistEntries && !targetNetwork) {
    const before = memoryStore.__cryptaraWatchlistEntries.length;
    memoryStore.__cryptaraWatchlistEntries = memoryStore.__cryptaraWatchlistEntries.filter(
      (r) => !matchesWalletAddress(r.walletAddress, canonicalWallet)
    );
    memoryRecordsRemoved += before - memoryStore.__cryptaraWatchlistEntries.length;
  }

  if (memoryStore.__cryptaraWatchlistScanRuns && !targetNetwork) {
    const before = memoryStore.__cryptaraWatchlistScanRuns.length;
    memoryStore.__cryptaraWatchlistScanRuns = memoryStore.__cryptaraWatchlistScanRuns.filter(
      (r) => !matchesWalletAddress(r.walletAddress, canonicalWallet)
    );
    memoryRecordsRemoved += before - memoryStore.__cryptaraWatchlistScanRuns.length;
  }

  if (memoryStore.__cryptaraDiscoveryAlerts && !targetNetwork) {
    const before = memoryStore.__cryptaraDiscoveryAlerts.length;
    memoryStore.__cryptaraDiscoveryAlerts = memoryStore.__cryptaraDiscoveryAlerts.filter(
      (r) => !matchesWalletAddress(r.walletAddress, canonicalWallet)
    );
    memoryRecordsRemoved += before - memoryStore.__cryptaraDiscoveryAlerts.length;
  }

  if (memoryStore.__cryptaraTransactions) {
    for (const tx of memoryStore.__cryptaraTransactions) {
      if (matchesWalletAddress(tx.walletAddress, canonicalWallet, tx.network, targetNetwork)) {
        tx.walletAddress = "";
        tx.sourceAccount = undefined;
        memoryAuditRecordsUnlinked++;
      }
    }
  }

  if (memoryStore.__cryptaraX402PaymentReceipts) {
    for (const rec of memoryStore.__cryptaraX402PaymentReceipts) {
      if (matchesWalletAddress(rec.walletAddress, canonicalWallet, rec.network, targetNetwork) || matchesWalletAddress(rec.payer, canonicalWallet, rec.network, targetNetwork)) {
        rec.walletAddress = undefined;
        rec.payer = undefined;
        memoryAuditRecordsUnlinked++;
      }
    }
  }

  let pgResult = { deletedCount: 0, unlinkedAuditCount: 0 };
  try {
    pgResult = await deleteWalletDataFromPg(canonicalWallet, targetNetwork, targetChainFamily);
  } catch {
    // best-effort PG deletion
  }

  return {
    ok: true,
    deletedAt: new Date().toISOString(),
    walletAddress: canonicalWallet,
    network: targetNetwork,
    chainFamily: targetChainFamily,
    memoryRecordsRemoved,
    memoryAuditRecordsUnlinked,
    portfolioCacheEvicted,
    pgResult,
  };
}
export function removeTransactionRecordByHash(hash: string): boolean {
  const records = getTransactions();
  const index = records.findIndex((r) => r.hash.toLowerCase() === hash.toLowerCase());
  if (index < 0) return false;
  records.splice(index, 1);
  return true;
}


export function addWatchlistEntriesBulk(inputs: CreateWatchlistInput[]): { appliedCount: number } {
  if (inputs.length === 0) return { appliedCount: 0 };
  
  const entries: WatchlistEntry[] = [];
  const existingStore = getWatchlistEntries();
  const added: WatchlistEntry[] = [];

  for (const input of inputs) {
    const normalizedWallet = input.walletAddress.trim();
    const existing = existingStore.find(
      (entry) =>
        entry.walletAddress.toLowerCase() === normalizedWallet.toLowerCase() &&
        entry.identityKey === input.identityKey,
    );

    if (existing) {
      continue;
    }

    const entry: WatchlistEntry = {
      id: createRecordId("watch"),
      walletAddress: normalizedWallet,
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
    added.push(entry);
  }

  if (added.length > 0) {
    existingStore.unshift(...added);
  mirrorWatchlistEntryWriteBulk(added);
  for (const entry of added) invalidateWalletCache(entry.walletAddress);
  }

  return { appliedCount: added.length };
}

export function computeBuyRiskTrend(walletAddress?: string, limit?: number) { return []; }
export function computePerAgentTrends(walletAddress?: string) { return []; }
export function getDecisionDetail(id: string) { return null; }
export function getSourceSnapshotDetails(id: string) { return null; }
export function listAgentRunRecordsPaginated() { return { data: [], nextCursor: null }; }
export function listRecommendationRecordsPaginated() { return { data: [], nextCursor: null }; }

// ─────────────────────────────────────────────────────────────────────────────
// Retention / Erasure public API
// ─────────────────────────────────────────────────────────────────────────────

export {
  eraseWalletData,
} from "@/server/privacy/retention/erase";

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
