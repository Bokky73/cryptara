import type { Alert, AlertDelivery, AlertObservation, AlertTriggerType } from "@/server/types";

const FORBIDDEN_KEY_PATTERNS: RegExp[] = [
  /private[_]?key/i,
  /mnemonic/i,
  /\bseed\b/i,
  /authorization/i,
  /bearer/i,
];

const VALUE_SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\b0x[0-9a-fA-F]{8,}\b/,
  /\bapi[_-]?key\s*=\s*\S+/i,
  /\bBEGIN (PRIVATE|EC|RSA) KEY\b/,
  /\b[GS][A-Z2-7]{55}\b/,
];

const TRUNCATED_FIELDS = new Set(["detail", "label", "message", "summary"]);

const SIGNATURE_HEADER_PATTERN = /\b(x-cryptara-signature-256|x-cryptara-delivery-id|signature|hmac)\s*[=:]\s*\S+/gi;
const DELIVERY_ID_PATTERN = /\bdelivery[_-]?id\s*[=:]\s*\S+/gi;
const HEX_SIGNATURE_PATTERN = /\b[0-9a-f]{64}\b/gi;
const TIMESTAMP_PATTERN = /\btimestamp\s*[=:]\s*\d{9,13}\b/gi;

function isForbiddenKey(field: string): boolean {
  return FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(field));
}

function valueLeaksSecret(value: string): boolean {
  return VALUE_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function shouldKeep(field: string, value: unknown): boolean {
  if (isForbiddenKey(field)) return false;
  if (typeof value === "string" && valueLeaksSecret(value)) return false;

  return true;
}

function trimString(field: string, value: string): string {
  if (!TRUNCATED_FIELDS.has(field)) return value;

  return value.length > 240 ? `${value.slice(0, 237)}…` : value;
}

function sanitize(field: string, value: unknown): unknown {
  if (!shouldKeep(field, value)) return undefined;

  if (typeof value === "string") {
    return trimString(field, value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(field, entry)).filter((entry) => entry !== undefined);
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitize(key, child);

      if (sanitized !== undefined) {
        out[key] = sanitized;
      }
    }

    return out;
  }

  return undefined;
}

/**
 * Produces a sanitized payload safe to send to in-app, email, Telegram,
 * or Discord channels. Wallet addresses are replaced with stable short
 * hints; secrets + tokens in object keys AND string values are stripped.
 */
export function buildSanitizedAlertPayload(
  alert: Pick<Alert, "triggerType" | "observationKey" | "severity" | "message" | "beforeValue" | "afterValue" | "triggeredAt">,
  observation: AlertObservation["evidence"] | undefined,
  options: { walletAddressHint?: string } = {},
): AlertDelivery["sanitizedPayload"] {
  const sanitizedEvidence = observation ? sanitize("evidence", observation) : {};
  const summary = sanitize("summary", alert.message) as string | undefined;
  const evidenceLinks: string[] = [];
  const sourceLabels = Array.isArray((sanitizedEvidence as { sourceLabels?: unknown }).sourceLabels)
    ? ((sanitizedEvidence as { sourceLabels?: unknown }).sourceLabels as unknown[]).filter((entry): entry is string => typeof entry === "string")
    : [];

  if (observation?.sourceSnapshotHash && shouldKeep("sourceSnapshotHash", observation.sourceSnapshotHash)) {
    evidenceLinks.push(`source-snapshot:${observation.sourceSnapshotHash}`);
  }
  if (observation?.runId && shouldKeep("runId", observation.runId)) {
    evidenceLinks.push(`agent-run:${observation.runId}`);
  }

  const triggerType: AlertTriggerType = alert.triggerType;

  return {
    triggerType,
    severity: alert.severity,
    summary: summary ?? "Alert details redacted.",
    beforeValue: alert.beforeValue,
    afterValue: alert.afterValue,
    observationKey: (sanitize("observationKey", alert.observationKey) as string | undefined) ?? "[redacted]",
    evidenceLinks,
    ...(sourceLabels.length > 0 ? { sourceLabels } : {}),
    ...(options.walletAddressHint ? { walletHint: shortWalletHint(options.walletAddressHint) } : {}),
  };
}

/**
 * Generate a short, non-reversible hint for a wallet address. The full
 * wallet address is never included in any outbound delivery payload.
 */
export function shortWalletHint(walletAddress: string): string {
  const trimmed = walletAddress.trim();
  const tail = trimmed.slice(-4);

  return `wallet:…${tail}`;
}

/**
 * Replace forbidden fields with a short hint inside structured evidence.
 */
export function redactWalletAddressInEvidence(evidence: AlertObservation["evidence"] | undefined): AlertObservation["evidence"] | undefined {
  if (!evidence) return undefined;
  const sanitized = sanitize("evidence", evidence) as AlertObservation["evidence"];

  return {
    ...sanitized,
    sourceLabels: Array.isArray(sanitized.sourceLabels) ? sanitized.sourceLabels.slice(0, 5) : [],
  };
}

/**
 * Redact tokens, webhook URLs, chat IDs, emails, and wallet addresses from
 * delivery error details before they are logged or persisted.
 */
export function sanitizeDeliveryErrorDetail(detail: string | undefined): string | undefined {
  if (!detail) return undefined;

  let out = detail;

  out = out.replace(/https?:\/\/[^\s)"']+/gi, "[url-redacted]");
  out = out.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[email-redacted]");
  out = out.replace(/\b0x[a-fA-F0-9]{40}\b/g, "[wallet-redacted]");
  out = out.replace(/\bG[A-Z2-7]{55}\b/g, "[wallet-redacted]");
  out = out.replace(/\bchat[_-]?id\s*[=:]\s*\S+/gi, "chat_id=[redacted]");
  out = out.replace(/\bbot\d+:[A-Za-z0-9_-]+/gi, "[token-redacted]");
  out = out.replace(/\b(Bearer|token|secret|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[redacted]");
  out = out.replace(/\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi, "/api/webhooks/[redacted]");
  out = out.replace(SIGNATURE_HEADER_PATTERN, "$1=[redacted]");
  out = out.replace(DELIVERY_ID_PATTERN, "delivery_id=[redacted]");
  out = out.replace(TIMESTAMP_PATTERN, "timestamp=[redacted]");
  out = out.replace(HEX_SIGNATURE_PATTERN, "[signature-redacted]");

  return out.length > 400 ? `${out.slice(0, 397)}…` : out;
}

/**
 * Deterministically serialize a sanitized delivery payload into the exact
 * raw body that is transmitted to webhook consumers and signed with
 * HMAC-SHA256. Keys are sorted so the same payload always yields the same
 * bytes, which lets consumers recompute the signature over the received body.
 */
export function buildWebhookRawBody(payload: AlertDelivery["sanitizedPayload"]): string {
  return stableStringify(payload);
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";

  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);

    return `{${entries.join(",")}}`;
  }

  return "null";
}

/**
 * Redact secrets, signatures, delivery IDs, and webhook URLs from an outbound
 * webhook payload before it is logged or persisted for dead-letter review.
 * The transmitted payload itself is already sanitized; this is a defense in
 * depth pass for anything that echoes back headers or transport metadata.
 */
export function sanitizeWebhookPayloadForPersistence(payload: unknown): unknown {
  if (typeof payload === "string") {
    return sanitizeDeliveryErrorDetail(payload);
  }

  if (Array.isArray(payload)) {
    return payload.map((entry) => sanitizeWebhookPayloadForPersistence(entry));
  }

  if (payload && typeof payload === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(payload as Record<string, unknown>)) {
      if (isForbiddenKey(key) || /signature|delivery[_-]?id/i.test(key)) {
        out[key] = "[redacted]";
        continue;
      }

      out[key] = sanitizeWebhookPayloadForPersistence(child);
    }

    return out;
  }

  return payload;
}
