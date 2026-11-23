import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, withApiHandler } from "@/server/api";
import { acknowledgeDiscoveryAlert, listDiscoveryAlerts } from "@/server/storage";

const acknowledgeSchema = z.object({
  action: z.literal("acknowledge"),
  alertId: z.string().min(1).max(120),
});

const listQuerySchema = z.object({
  walletAddress: z.string().min(1).max(80),
});

export const GET = withApiHandler(
  {
    querySchema: listQuerySchema,
    rateLimit: { namespace: "alerts:list", limit: 60, windowMs: 60_000 },
  },
  async ({ query }) => {
    return NextResponse.json({ alerts: listDiscoveryAlerts(query.walletAddress) });
  },
);

export const POST = withApiHandler(
  {
    schema: acknowledgeSchema,
    rateLimit: { namespace: "alerts:ack", limit: 30, windowMs: 60_000 },
    maxBodyBytes: 8 * 1024,
  },
  async ({ body }) => {
    const alert = acknowledgeDiscoveryAlert(body.alertId);

    if (!alert) {
      return jsonError("not_found", "Alert not found");
    }

    return NextResponse.json({ alert });
  },
);
