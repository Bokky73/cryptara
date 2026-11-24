import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import type { Alert, AlertDelivery, AlertDeliveryChannel } from "@/server/types";
import {
  createAlertDelivery,
  listAlertDeliveries,
  updateAlertDelivery,
} from "@/server/storage";
import { sanitizeDeliveryErrorDetail } from "@/server/observability/alertSanitize";
import { HttpTransportError } from "@/server/observability/delivery/http";
import { deliverEmailAlert } from "@/server/observability/delivery/email";
import { deliverTelegramAlert } from "@/server/observability/delivery/telegram";
import { deliverDiscordAlert } from "@/server/observability/delivery/discord";
import { assertSafeWebhookUrl } from "@/server/observability/urlSafety";

export type DeliveryResult = {
  status: AlertDelivery["status"];
  channel: AlertDeliveryChannel;
  errorDetail?: string;
  attemptCount?: number;
  providerMessageId?: string;
  terminal?: boolean;
  nextRetryAt?: string;
  lastAttemptAt?: string;
};

export type DeliverAlertOptions = {
  idempotencyKey?: string;
  withRetry?: boolean;
  signal?: AbortSignal;
};

export type RetryAlertDeliveryResult =
  | { ok: true; delivery: AlertDelivery }
  | { ok: false; status: number; error: string };

const MAX_ATTEMPTS = 4;
const DEFAULT_BACKOFF_MS = 250;

/**
 * Bounded exponential backoff schedule for webhook delivery retries:
 * 30s, 2m, 10m, 30m. Indexed by the attempt number that just failed
 * (attempt 1 -> 30s, attempt 2 -> 2m, ...).
 */
export const WEBHOOK_BACKOFF_SCHEDULE_MS: readonly number[] = [
  30_000,
  120_000,
  600_000,
  1_800_000,
];

export type WebhookSignature = {
  timestamp: string;
  deliveryId: string;
  signature: string;
};

export type SignedWebhookRequest = {
  headers: Record<string, string>;
  rawBody: string;
};

/**
 * Compute the HMAC-SHA256 signature over `${timestamp}.${rawBody}` using the
 * configured webhook signing secret. Returns `undefined` when no secret is
 * configured so callers can decide whether to hard-fail.
 */
export function signWebhookPayload(
  rawBody: string,
  timestamp: string,
  secret: string,
): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/**
 * Build the signed headers for an outbound webhook request. Consumers verify
 * `X-Cryptara-Signature-256` against `${timestamp}.${rawBody}` and use
 * `X-Cryptara-Delivery-Id` for replay defense.
 */
export function buildSignedWebhookRequest(
  rawBody: string,
  options: { secret?: string; deliveryId?: string; timestamp?: string } = {},
): SignedWebhookRequest {
  const secret = options.secret ?? process.env.ALERT_WEBHOOK_SIGNING_SECRET ?? "";
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const deliveryId = options.deliveryId ?? randomUUID();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-cryptara-delivery-id": deliveryId,
    "x-cryptara-timestamp": timestamp,
  };

  if (secret) {
    headers["x-cryptara-signature-256"] = signWebhookPayload(rawBody, timestamp, secret);
  }

  return { headers, rawBody };
}

/**
 * Validate a webhook destination at registration time. Throws when the URL
 * fails SSRF guards in `urlSafety.ts`.
 */
export function validateWebhookDestination(url: string): string {
  return assertSafeWebhookUrl(url);
}

/**
 * Validate a webhook destination immediately before delivery. Re-runs the
 * SSRF guards so DNS rebinding / config drift cannot smuggle a private target.
 */
export function assertWebhookDeliverable(url: string): string {
  return assertSafeWebhookUrl(url);
}

/**
 * Single entry point that the alert engine fans out to. Each channel has
 * its own adapter; all adapters must return a DeliveryResult so the engine
 * can persist the audit row.
 *
 * Test/chaos hook: `ALERT_FORCE_FAIL_CHANNELS=email,discord` flips the
 * matching channels to a deterministic "failed" result so the failure path
 * of the alert engine can be exercised in fixtures and staging.
 *
 * Adapters never claim `delivered` without a validated provider response.
 */
export async function deliverAlertToChannel(
  channel: AlertDeliveryChannel,
  payload: AlertDelivery["sanitizedPayload"],
  alert: Pick<Alert, "walletAddress" | "triggerType" | "severity">,
  options: DeliverAlertOptions = {},
): Promise<DeliveryResult> {
  const forcedFailures = getForcedFailureChannels();

  if (forcedFailures.has(channel)) {
    return {
      status: "failed",
      channel,
      errorDetail: "ALERT_FORCE_FAIL_CHANNELS override forced this channel to fail.",
      attemptCount: 1,
      terminal: true,
      lastAttemptAt: new Date().toISOString(),
    };
  }

  if (options.signal?.aborted) {
    return {
      status: "failed",
      channel,
      errorDetail: sanitizeDeliveryErrorDetail("Delivery request was cancelled."),
      attemptCount: 0,
      terminal: true,
      lastAttemptAt: new Date().toISOString(),
    };
  }

  const maxAttempts = options.withRetry === false ? 1 : MAX_ATTEMPTS;
  let lastFailure: DeliveryResult | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      return {
        status: "failed",
        channel,
        errorDetail: sanitizeDeliveryErrorDetail("Delivery request was cancelled."),
        attemptCount: attempt - 1,
        terminal: true,
        lastAttemptAt: new Date().toISOString(),
      };
    }

    const result = await deliverOnce(channel, payload, alert, options);
    const stamped: DeliveryResult = {
      ...result,
      attemptCount: attempt,
      lastAttemptAt: new Date().toISOString(),
    };

    if (result.status === "delivered" || result.status === "skipped") {
      return stamped;
    }

    if (result.terminal) {
      return { ...stamped, terminal: true, status: "dead_letter" };
    }

    lastFailure = stamped;

    if (attempt < maxAttempts) {
      const delayMs = resolveBackoffMs(attempt);
      if (delayMs > 0) {
        const nextRetryAt = new Date(Date.now() + delayMs).toISOString();
        lastFailure = { ...stamped, nextRetryAt };
        await sleep(delayMs);
      }
    }
  }

  return {
    status: "dead_letter",
    channel,
    errorDetail: lastFailure?.errorDetail ?? "Delivery failed after bounded retries.",
    attemptCount: maxAttempts,
    terminal: true,
    lastAttemptAt: new Date().toISOString(),
    ...(lastFailure?.nextRetryAt ? { nextRetryAt: lastFailure.nextRetryAt } : {}),
  };
}

export function buildDeliveryIdempotencyKey(
  alertId: string,
  channel: AlertDeliveryChannel,
  event: string,
): string {
  return `${alertId}:${channel}:${event}`;
}

export function findDeliveryByIdempotencyKey(
  alertId: string,
  walletAddress: string,
  idempotencyKey: string,
): AlertDelivery | undefined {
  const wallet = walletAddress.trim().toLowerCase();

  return listAlertDeliveries(alertId, wallet).find(
    (delivery) => delivery.idempotencyKey === idempotencyKey,
  );
}

export function persistDeliveryResult(
  alert: Pick<Alert, "id" | "walletAddress">,
  channel: AlertDeliveryChannel,
  payload: AlertDelivery["sanitizedPayload"],
  result: DeliveryResult,
  idempotencyKey: string,
): AlertDelivery {
  const existing = findDeliveryByIdempotencyKey(alert.id, alert.walletAddress, idempotencyKey);
  const patch: Partial<AlertDelivery> = {
    status: result.status,
    attemptCount: result.attemptCount ?? 0,
    ...(result.errorDetail
      ? { errorDetail: sanitizeDeliveryErrorDetail(result.errorDetail) }
      : { errorDetail: undefined }),
    ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
    ...(result.terminal !== undefined ? { terminal: result.terminal } : {}),
    ...(result.nextRetryAt ? { nextRetryAt: result.nextRetryAt } : {}),
    ...(result.lastAttemptAt ? { lastAttemptAt: result.lastAttemptAt } : {}),
    ...(result.status === "delivered" ? { sentAt: new Date().toISOString() } : {}),
    idempotencyKey,
    sanitizedPayload: payload,
  };

  if (existing) {
    return (
      updateAlertDelivery(existing.id, alert.walletAddress, patch) ?? {
        ...existing,
        ...patch,
      }
    );
  }

  return createAlertDelivery({
    alertId: alert.id,
    walletAddress: alert.walletAddress,
    channel,
    status: result.status,
    sanitizedPayload: payload,
    attemptCount: result.attemptCount ?? 0,
    idempotencyKey,
    ...(result.errorDetail ? { errorDetail: sanitizeDeliveryErrorDetail(result.errorDetail) } : {}),
    ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
    ...(result.terminal !== undefined ? { terminal: result.terminal } : {}),
    ...(result.nextRetryAt ? { nextRetryAt: result.nextRetryAt } : {}),
    ...(result.lastAttemptAt ? { lastAttemptAt: result.lastAttemptAt } : {}),
    ...(result.status === "delivered" ? { sentAt: new Date().toISOString() } : {}),
  });
}

/**
 * Wallet-scoped maintainer retry for a failed, non-terminal delivery.
 * Never retries recipient/config terminal failures.
 */
export async function retryAlertDelivery(
  deliveryId: string,
  walletAddress: string,
): Promise<RetryAlertDeliveryResult> {
  const wallet = walletAddress.trim().toLowerCase();
  const delivery = listAlertDeliveries(undefined, wallet).find((row) => row.id === deliveryId);

  if (!delivery) {
    return { ok: false, status: 404, error: "Delivery not found." };
  }

  if (delivery.status === "delivered") {
    return { ok: false, status: 409, error: "Delivery already completed." };
  }

  if (delivery.status === "dead_letter" || delivery.terminal === true) {
    return { ok: false, status: 409, error: "Terminal failures must not be retried." };
  }

  if (delivery.status !== "failed" && delivery.status !== "pending") {
    return { ok: false, status: 409, error: "Only pending or failed deliveries can be retried." };
  }

  const result = await deliverAlertToChannel(
    delivery.channel,
    delivery.sanitizedPayload,
    {
      walletAddress: delivery.walletAddress,
      triggerType: delivery.sanitizedPayload.triggerType,
      severity: delivery.sanitizedPayload.severity,
    },
    {
      idempotencyKey: delivery.idempotencyKey,
      withRetry: true,
    },
  );

  const updated = updateAlertDelivery(delivery.id, wallet, {
    status: result.status,
    attemptCount: (delivery.attemptCount ?? 0) + (result.attemptCount ?? 1),
    ...(result.errorDetail
      ? { errorDetail: sanitizeDeliveryErrorDetail(result.errorDetail) }
      : { errorDetail: undefined }),
    ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
    ...(result.terminal !== undefined ? { terminal: result.terminal } : {}),
    ...(result.nextRetryAt ? { nextRetryAt: result.nextRetryAt } : {}),
    ...(result.lastAttemptAt ? { lastAttemptAt: result.lastAttemptAt } : {}),
    ...(result.status === "delivered" ? { sentAt: new Date().toISOString() } : {}),
  });

  if (!updated) {
    return { ok: false, status: 500, error: "Failed to persist delivery retry." };
  }

  return { ok: true, delivery: updated };
}

function getForcedFailureChannels(): Set<AlertDeliveryChannel> {
  const raw = process.env.ALERT_FORCE_FAIL_CHANNELS;
  if (!raw) return new Set();
  const out = new Set<AlertDeliveryChannel>();

  for (const piece of raw.split(",")) {
    const trimmed = piece.trim().toLowerCase();
    if (trimmed === "in_app" || trimmed === "email" || trimmed === "telegram" || trimmed === "discord") {
      out.add(trimmed);
    }
  }

  return out;
}

async function deliverOnce(
  channel: AlertDeliveryChannel,
  payload: AlertDelivery["sanitizedPayload"],
  alert: Pick<Alert, "walletAddress" | "triggerType" | "severity">,
  options: DeliverAlertOptions,
): Promise<DeliveryResult> {
  try {
    if (channel === "discord" || channel === "telegram") {
      const destination = resolveWebhookDestination(channel, payload);
      if (destination) {
        try {
          assertWebhookDeliverable(destination);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unsafe webhook destination.";
          return {
            status: "failed",
            channel,
            errorDetail: sanitizeDeliveryErrorDetail(message),
            terminal: true,
          };
        }
      }
    }

    switch (channel) {
      case "in_app":
        return { status: "delivered", channel: "in_app" };
      case "email": {
        const outcome = await deliverEmailAlert(payload, alert, {
          idempotencyKey: options.idempotencyKey,
          signal: options.signal,
        });
        if ("skipped" in outcome) {
          return { status: "skipped", channel, errorDetail: outcome.reason, terminal: true };
        }
        return {
          status: "delivered",
          channel,
          providerMessageId: outcome.providerMessageId,
          terminal: false,
        };
      }
      case "telegram": {
        const outcome = await deliverTelegramAlert(payload, alert, { signal: options.signal });
        if ("skipped" in outcome) {
          return { status: "skipped", channel, errorDetail: outcome.reason, terminal: true };
        }
        return {
          status: "delivered",
          channel,
          providerMessageId: outcome.providerMessageId,
          terminal: false,
        };
      }
      case "discord": {
        const outcome = await deliverDiscordAlert(payload, alert, { signal: options.signal });
        if ("skipped" in outcome) {
          return { status: "skipped", channel, errorDetail: outcome.reason, terminal: true };
        }
        return {
          status: "delivered",
          channel,
          ...(outcome.providerMessageId ? { providerMessageId: outcome.providerMessageId } : {}),
          terminal: false,
        };
      }
      default:
        return { status: "skipped", channel, errorDetail: "unknown channel", terminal: true };
    }
  } catch (error) {
    if (error instanceof HttpTransportError) {
      return {
        status: "failed",
        channel,
        errorDetail: sanitizeDeliveryErrorDetail(error.message),
        terminal: error.terminal,
      };
    }

    const message = error instanceof Error ? error.message : "Delivery failed.";
    return {
      status: "failed",
      channel,
      errorDetail: sanitizeDeliveryErrorDetail(message),
      terminal: false,
    };
  }
}

function resolveWebhookDestination(
  channel: AlertDeliveryChannel,
  payload: AlertDelivery["sanitizedPayload"],
): string | undefined {
  const record = payload as unknown as Record<string, unknown>;
  const candidate =
    (typeof record.webhookUrl === "string" && record.webhookUrl) ||
    (typeof record.destination === "string" && record.destination) ||
    undefined;

  if (candidate) return candidate;

  if (channel === "discord") {
    return process.env.DISCORD_WEBHOOK_URL || undefined;
  }

  return undefined;
}

function resolveBackoffMs(attempt: number): number {
  const raw = process.env.ALERT_DELIVERY_BACKOFF_MS;
  if (raw !== undefined && raw !== "") {
    const override = Number(raw);
    if (Number.isFinite(override)) return Math.max(0, override);
  }

  const scheduled = WEBHOOK_BACKOFF_SCHEDULE_MS[Math.max(0, attempt - 1)];
  if (scheduled !== undefined) return scheduled;

  return DEFAULT_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
