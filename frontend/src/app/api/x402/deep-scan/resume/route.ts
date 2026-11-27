import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/server/api/errors";
import { runTokenScan } from "@/server/scan/tokenScan";
import { checkRateLimit } from "@/server/security/rateLimit";
import { getX402PaymentReceiptByHeaderHash } from "@/server/storage";
import { getX402RuntimeConfig } from "@/server/x402/config";
import { stableJsonHash } from "@/server/x402/guards";

export const runtime = "nodejs";

/**
 * Recovery endpoint for a deep scan whose x402 payment already settled but
 * whose response was lost (timeout, refresh, closed tab). It never talks to
 * the facilitator and never creates a new receipt: the existing verified
 * receipt is the only proof of payment that is accepted here.
 */
const resumeSchema = z.object({
  paymentHeaderHash: z.string().regex(/^[a-f0-9]{64}$/),
  query: z.string().min(1).max(260),
  chain: z.string().min(1).max(40).optional(),
  walletAddress: z.string().min(1).max(80).optional(),
});

export async function POST(request: NextRequest) {
  const rateLimited = checkRateLimit(request, { namespace: "x402:deep-scan:resume", limit: 10, windowMs: 60_000 });
  if (rateLimited) return rateLimited;

  const parsed = resumeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError({ code: "validation_error", message: "Invalid x402 receipt resume request.", status: 400 });
  }

  const { paymentHeaderHash, query, chain, walletAddress } = parsed.data;
  const receipt = await getX402PaymentReceiptByHeaderHash(paymentHeaderHash);

  if (!receipt) {
    return jsonError({
      code: "receipt_not_found",
      message: "No settled receipt matches this payment. Review the payment details before signing again.",
      status: 404,
    });
  }

  const config = getX402RuntimeConfig();
  const requestBody = {
    query,
    chain,
    ...(walletAddress ? { walletAddress } : {}),
  };
  const requestBodyHash = stableJsonHash(requestBody);

  // The receipt must be for this exact scan payload, resource and payment
  // terms. A hash collision or a receipt from another configuration must not
  // unlock a different report.
  if (
    receipt.requestBodyHash !== requestBodyHash ||
    receipt.protectedResource !== config.protectedResource ||
    receipt.network !== config.network ||
    receipt.asset !== config.asset ||
    receipt.payTo !== config.payTo ||
    (receipt.verificationStatus !== "verified" && receipt.verificationStatus !== "settled")
  ) {
    return jsonError({
      code: "receipt_mismatch",
      message: "The stored receipt does not match this scan or the current payment configuration.",
      status: 403,
    });
  }

  const expiresAt = receipt.paymentExpiry
    ? Date.parse(receipt.paymentExpiry)
    : Date.parse(receipt.createdAt) + config.paymentExpirySeconds * 1000;

  if (Number.isFinite(expiresAt) && Date.now() > expiresAt) {
    return jsonError({
      code: "receipt_expired",
      message: "The stored receipt has expired. Review the payment details before signing again.",
      status: 410,
    });
  }

  // Identical premium work to the original request, with no second charge and
  // no new settlement attempt.
  const scan = await runTokenScan(query, chain, walletAddress);

  return NextResponse.json(
    {
      premium: {
        unlocked: true,
        tier: "deep_scan",
        provider: "x402",
        protectedResource: config.protectedResource,
        receiptId: receipt.id,
        resumed: true,
        note: "Existing verified x402 receipt was reused; no additional payment was requested.",
      },
      scan,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
