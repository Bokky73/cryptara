import "server-only";
import crypto from "crypto";
import type { Alert, AlertDelivery } from "@/server/types";
import {
  HttpTransportError,
  sendAlertHttpRequest,
  throwForHttpStatus,
} from "@/server/observability/delivery/http";

export type EmailDeliverySuccess = {
  providerMessageId: string;
};

/**
 * HMAC-SHA256 over `timestamp + "." + body`, returned as lowercase hex.
 */
export function signEmailWebhookPayload(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Constant-time verification for receivers of the signed email webhook.
 */
export function verifyEmailWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  signatureHex: string,
): boolean {
  const expected = Buffer.from(signEmailWebhookPayload(secret, timestamp, body), "utf8");
  const observed = Buffer.from(signatureHex.replace(/^sha256=/i, "").trim(), "utf8");

  if (expected.length !== observed.length) return false;

  return crypto.timingSafeEqual(expected, observed);
}

function parseProviderMessageId(bodyText: string): string | undefined {
  if (!bodyText.trim()) return undefined;

  try {
    const parsed = JSON.parse(bodyText) as { ok?: unknown; id?: unknown };
    if (parsed.ok === false) return undefined;
    if (typeof parsed.id === "string" && parsed.id.trim()) return parsed.id.trim();
    if (typeof parsed.id === "number" && Number.isFinite(parsed.id)) return String(parsed.id);
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * Deliver via a signed generic email webhook.
 * Claims delivered only when the response is 2xx and includes a provider message id.
 */
export async function deliverEmailAlert(
  payload: AlertDelivery["sanitizedPayload"],
  _alert: Pick<Alert, "walletAddress" | "triggerType" | "severity">,
  options: { idempotencyKey?: string; signal?: AbortSignal } = {},
): Promise<EmailDeliverySuccess | { skipped: true; reason: string }> {
  const url = process.env.ALERT_EMAIL_WEBHOOK_URL?.trim();
  const secret = process.env.ALERT_EMAIL_WEBHOOK_SECRET?.trim();

  if (!url || !secret) {
    return {
      skipped: true,
      reason: "ALERT_EMAIL_WEBHOOK_URL or ALERT_EMAIL_WEBHOOK_SECRET is not configured",
    };
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    channel: "email",
    timestamp,
    payload,
  });
  const signature = signEmailWebhookPayload(secret, timestamp, body);

  const response = await sendAlertHttpRequest({
    url,
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-alert-timestamp": timestamp,
      "x-alert-signature": `sha256=${signature}`,
      "x-cryptara-timestamp": timestamp,
      "x-cryptara-signature-256": `sha256=${signature}`,
      ...(options.idempotencyKey
        ? {
            "x-idempotency-key": options.idempotencyKey,
            "x-cryptara-delivery-id": options.idempotencyKey,
          }
        : {}),
    },
    body,
    signal: options.signal,
  });

  const classifiedOk = response.status >= 200 && response.status < 300;
  if (!classifiedOk) {
    throwForHttpStatus(response.status);
  }

  const providerMessageId = parseProviderMessageId(response.bodyText);
  if (!providerMessageId) {
    throw new HttpTransportError(
      "malformed",
      "Email webhook returned success without a usable provider message id.",
      { retryable: false, terminal: true, status: response.status },
    );
  }

  return { providerMessageId };
}
