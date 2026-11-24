import { array, boolean, nullable, number, oneOf, optional, record, shape, text } from "./validation.js";
import type { Transport } from "./transport.js";
import type { ReadOptions, WalletQuery } from "./types.js";
import { ReadClientError } from "./errors.js";

/* Discovery alerts (public read surface). */
export const alertsSchema = shape({ alerts: array(shape({ id: text, walletAddress: text, kind: text, title: text, detail: text,
  severity: text, acknowledged: boolean, createdAt: text, entryId: optional(text), runId: optional(text) })) });
export type Alerts = ReturnType<typeof alertsSchema>;

const triggerTypes = [
  "critical_risk", "liquidity_drop", "holder_concentration_change", "tax_control_change",
  "phishing_detected", "exploit_news", "portfolio_concentration", "stable_reserve_change",
  "stellar_issuer_auth", "stellar_clawback", "stellar_trustline", "stellar_contract_ttl", "rpc_degradation",
] as const;
const severities = ["low", "medium", "high", "critical"] as const;
const statuses = ["triggered", "recovered", "acknowledged"] as const;
const channels = ["in_app", "email", "telegram", "discord"] as const;
const deliveryStatuses = ["pending", "delivered", "failed", "skipped"] as const;

/** Immutable evidence captured when an alert fires. Missing fields make the payload unusable. */
export const alertEvidenceSchema = shape({
  runId: text, agent: text, label: text, detail: text, sourceLabels: array(text),
  sourceSnapshotHash: optional(text), beforeValue: optional(number), afterValue: optional(number), meta: optional(record),
});

export const alertSchema = shape({
  id: text, walletAddress: text, ruleId: text, triggerType: oneOf(triggerTypes), observationKey: text,
  status: oneOf(statuses), severity: oneOf(severities), message: text,
  beforeValue: number, afterValue: number, triggeredAt: text,
  evidenceBefore: alertEvidenceSchema, evidenceAfter: alertEvidenceSchema,
  evidenceData: shape({
    runId: text, observationId: text, sourceSnapshotHashAfter: text,
    sourceSnapshotHashBefore: optional(text), evidenceBeforeObservationId: optional(text),
    evidenceAfterObservationId: text, evidenceBeforeHash: optional(text), evidenceAfterHash: text,
    deteriorationObservationIds: array(text),
  }),
  recoveredAt: optional(text), acknowledgedAt: optional(text),
  deliveryCount: number, observableHistoryCount: optional(number),
  deliverySummary: optional(shape({
    delivered: array(text),
    failed: array(shape({ channel: text, error: text })),
    skipped: array(shape({ channel: text, reason: text })),
    pending: optional(array(text)),
  })),
  matchingRule: optional(nullable(shape({ triggerType: oneOf(triggerTypes), severity: oneOf(severities) }))),
});

/** Wallet-scoped alert history with the counts rendered in the UI header. */
export const alertHistorySchema = shape({
  alerts: array(alertSchema),
  counts: shape({ triggered: number, recovered: number, acknowledged: number }),
  walletAddress: optional(text),
});
export type AlertRecord = ReturnType<typeof alertSchema>;
export type AlertHistory = ReturnType<typeof alertHistorySchema>;
export type AlertSeverity = (typeof severities)[number];
export type AlertStatus = (typeof statuses)[number];
export type AlertTriggerType = (typeof triggerTypes)[number];
export type AlertDeliveryChannel = (typeof channels)[number];
export type AlertDeliveryStatus = (typeof deliveryStatuses)[number];

export const deliveryAuditSchema = array(shape({
  id: text, alertId: text, channel: oneOf(channels), status: oneOf(deliveryStatuses),
  attemptCount: number, terminal: optional(boolean), errorDetail: optional(text),
  nextRetryAt: optional(text), providerMessageId: optional(text), lastAttemptAt: optional(text),
  sentAt: optional(text), createdAt: optional(text), sanitizedPayload: optional(record),
}));
export type DeliveryAuditRow = ReturnType<typeof deliveryAuditSchema>[number];

/**
 * Creates the alerts resource client.
 *
 * @param get Transport function.
 * @returns Object exposing discovery alerts, wallet alert history and delivery audit queries.
 */
export const alertsClient = (get: Transport) => ({
  list: (query: WalletQuery, options?: ReadOptions) => get("/api/alerts", query, alertsSchema, options),
  history: (query: Partial<WalletQuery> & { status?: AlertStatus; limit?: number } = {}, options?: ReadOptions) => {
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 500)) {
      throw new ReadClientError("configuration", "Alert history limit must be an integer from 1 to 500.");
    }
    return get("/api/alerts/alerts", query, alertHistorySchema, options);
  },
  deliveries: (query: { alertId?: string } = {}, options?: ReadOptions) =>
    get("/api/alerts/deliveries", query, deliveryAuditSchema, options),
});
