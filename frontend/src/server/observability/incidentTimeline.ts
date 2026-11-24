// frontend/src/server/observability/incidentTimeline.ts

export type IncidentEventType = "open" | "update" | "recover";

export interface IncidentEvent {
  id: string;
  timestamp: number;
  type: IncidentEventType;
  description: string;
}

export type OperationalAlertKind = "stellar_ledger_gap";

export interface OperationalAlert {
  kind: OperationalAlertKind;
  network: string;
  contractId: string;
  requestedStartLedger: number;
  rpcOldestLedger: number;
  /** Optional explicit event type; defaults to "open" for new alerts. */
  type?: IncidentEventType;
  /** Optional timestamp override (ms since epoch); defaults to Date.now(). */
  timestamp?: number;
  /** Optional extra human-readable context appended to the description. */
  detail?: string;
}

/**
 * Build a stable incident id for an operational alert so repeated emissions for
 * the same underlying condition dedupe/update rather than spawning new entries.
 */
export function operationalAlertId(alert: OperationalAlert): string {
  return [
    "op-alert",
    alert.kind,
    alert.network,
    alert.contractId,
    String(alert.requestedStartLedger),
    String(alert.rpcOldestLedger),
  ].join(":");
}

/**
 * Produce a redacted {@link IncidentEvent} for an operational alert (e.g. a
 * pruned-ledger gap detected by the Stellar event indexer). The description is
 * passed through the same {@link redact} logic used by the timeline so no
 * wallet/secret/payload data leaks into incident records.
 */
export function recordOperationalAlert(alert: OperationalAlert): IncidentEvent {
  const timestamp = alert.timestamp ?? Date.now();
  const type: IncidentEventType = alert.type ?? "open";

  const base =
    alert.kind === "stellar_ledger_gap"
      ? `stellar_ledger_gap network=${alert.network} contractId=${alert.contractId} ` +
        `requestedStartLedger=${alert.requestedStartLedger} rpcOldestLedger=${alert.rpcOldestLedger}`
      : `${alert.kind} network=${alert.network} contractId=${alert.contractId}`;

  const description = alert.detail ? `${base} ${alert.detail}` : base;

  return {
    id: operationalAlertId(alert),
    timestamp,
    type,
    description: redact(description),
  };
}

export function generateIncidentTimeline(rawEvents: any[]): IncidentEvent[] {
  // deduplicate and remove sensitive
  const timeline: IncidentEvent[] = [];
  const seenIds = new Set<string>();

  // sort by timestamp
  const sorted = [...rawEvents].sort((a, b) => a.timestamp - b.timestamp);

  for (const ev of sorted) {
    if (!seenIds.has(ev.id)) {
      seenIds.add(ev.id);
      timeline.push({
        id: ev.id,
        timestamp: ev.timestamp,
        type: ev.type,
        // redact sensitive info (assuming description might have wallet/payload/asset)
        description: redact(ev.description || ""),
      });
    } else {
      // update latest state if it's an update or recover
      const existing = timeline.find(e => e.id === ev.id);
      if (existing && ev.type !== "open") {
        existing.type = ev.type;
        existing.description = redact(ev.description || "");
        existing.timestamp = ev.timestamp; // update timestamp to latest
      }
    }
  }

  // Immutable events: map to a new array of frozen objects if we really wanted, but regular returning array is fine.
  return timeline;
}

function redact(text: string): string {
  // basic redaction of wallet, asset, payload
  return text
    .replace(/0x[a-fA-F0-9]{40}/gi, "[REDACTED_WALLET]")
    .replace(/\bG[A-Z2-7]{55}\b/g, "[REDACTED_WALLET]")
    .replace(/\bS[A-Z2-7]{55}\b/g, "[REDACTED_SECRET]")
    .replace(/"payload":\s*\{.*?\}/g, '"payload": [REDACTED]')
    .replace(/asset=[a-zA-Z0-9]+/gi, "asset=[REDACTED]");
}
