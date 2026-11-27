import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withCacheHeaders } from "@/server/cache/strategy";
import { checkRateLimitProfile } from "@/server/security/rateLimit";
import { resolveWalletSession } from "@/server/security/walletSession";
import { listAlertDeliveries } from "@/server/storage";
import { retryAlertDelivery } from "@/server/observability/alertDeliveries";

const querySchema = z.object({
  walletAddress: z.string().optional(),
  alertId: z.string().optional(),
});

const retryBodySchema = z.object({
  deliveryId: z.string().min(1),
  walletAddress: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const rateLimited = checkRateLimitProfile(request, "alertRead");
  if (rateLimited) return rateLimited;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    walletAddress: url.searchParams.get("walletAddress") ?? undefined,
    alertId: url.searchParams.get("alertId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const session = resolveWalletSession(request, { suppliedWallet: parsed.data.walletAddress });
  if (session.response) return session.response;
  const wallet = session.wallet!;

  const deliveries = (await listAlertDeliveries(parsed.data.alertId, wallet)).map((delivery) => ({
    id: delivery.id,
    deliveryId: delivery.id,
    alertId: delivery.alertId,
    channel: delivery.channel,
    // status may be "dead_letter" for terminal failures; terminal mirrors that state.
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    terminal: delivery.terminal ?? delivery.status === "dead_letter",
    ...(delivery.errorDetail ? { errorDetail: delivery.errorDetail } : {}),
    ...(delivery.providerMessageId ? { providerMessageId: delivery.providerMessageId } : {}),
    ...(delivery.nextRetryAt ? { nextRetryAt: delivery.nextRetryAt } : {}),
    ...(delivery.lastAttemptAt ? { lastAttemptAt: delivery.lastAttemptAt } : {}),
    ...(delivery.sentAt ? { sentAt: delivery.sentAt } : {}),
    createdAt: delivery.createdAt,
    // sanitizedPayload is returned without wallet secrets; adapters already sanitize.
    sanitizedPayload: delivery.sanitizedPayload,
  }));

  return withCacheHeaders(NextResponse.json(deliveries), "alerts");
}

/**
 * Wallet-scoped maintainer retry for a failed, non-terminal delivery.
 * Never retries recipient/config terminal failures.
 */
export async function POST(request: NextRequest) {
  const rateLimited = checkRateLimitProfile(request, "alertAcknowledge");
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => ({}));
  const parsed = retryBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const session = resolveWalletSession(request, { suppliedWallet: parsed.data.walletAddress });
  if (session.response) return session.response;
  const wallet = session.wallet!;

  const result = await retryAlertDelivery(parsed.data.deliveryId, wallet);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return withCacheHeaders(
    NextResponse.json({
      id: result.delivery.id,
      deliveryId: result.delivery.id,
      alertId: result.delivery.alertId,
      channel: result.delivery.channel,
      status: result.delivery.status,
      attemptCount: result.delivery.attemptCount,
      terminal: result.delivery.terminal ?? result.delivery.status === "dead_letter",
      ...(result.delivery.errorDetail ? { errorDetail: result.delivery.errorDetail } : {}),
      ...(result.delivery.providerMessageId ? { providerMessageId: result.delivery.providerMessageId } : {}),
      ...(result.delivery.nextRetryAt ? { nextRetryAt: result.delivery.nextRetryAt } : {}),
      ...(result.delivery.lastAttemptAt ? { lastAttemptAt: result.delivery.lastAttemptAt } : {}),
      ...(result.delivery.sentAt ? { sentAt: result.delivery.sentAt } : {}),
    }),
    "alerts",
  );
}
