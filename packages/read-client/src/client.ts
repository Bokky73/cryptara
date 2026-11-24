import { createTransport } from "./transport.js";
import type { ClientOptions } from "./types.js";
import { healthClient } from "./health.js";
import { portfolioClient } from "./portfolio.js";
import { historyClient } from "./history.js";
import { watchlistClient } from "./watchlist.js";
import { alertsClient } from "./alerts.js";
import { registryClient } from "./registry.js";
import { snapshotsClient } from "./snapshots.js";
/**
 * Instantiates the typed read-only API client with explicit base URL configuration.
 *
 * @param options Configuration options including baseUrl, fetcher, headers, and bounded retry policy.
 * @returns An initialized client instance with typed resource methods.
 */
export function createReadClient(options: ClientOptions) {
  const get = createTransport(options);
  return { health: healthClient(get), portfolio: portfolioClient(get), history: historyClient(get),
    watchlist: watchlistClient(get), alerts: alertsClient(get), registry: registryClient(get), snapshots: snapshotsClient(get) };
}
export type ReadClient = ReturnType<typeof createReadClient>;
export type { ClientOptions, ReadOptions, StellarNetwork } from "./types.js";
export { ReadClientError, CompatibilityError, httpError, parseErrorEnvelope } from "./errors.js";
export type { RecoveryAction, ErrorEnvelope } from "./errors.js";
export type { Health } from "./health.js";
export type { Portfolio } from "./portfolio.js";
export type { TransactionPage } from "./history.js";
export type { SourceSnapshot, AgentRunDetail } from "./history.js";
export type { Watchlist, WatchlistEntry, WatchlistScanRun } from "./watchlist.js";
export type { Alerts, AlertHistory, AlertRecord, AlertSeverity, AlertStatus, AlertTriggerType, AlertDeliveryChannel, AlertDeliveryStatus, DeliveryAuditRow } from "./alerts.js";
export type { RegistryHistory, RegistryRecord, RegistryStatus } from "./registry.js";
export type { Snapshot } from "./snapshots.js";
