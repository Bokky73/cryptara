import { NextResponse } from "next/server";
import { z } from "zod";
import { getChainFamily, isStellarAccountAddress } from "@/lib/chainIdentity";
import { checkRateLimit } from "@/server/security/rateLimit";
import { validateApproval } from "@/server/transactions/approvalFlow";
import { getTransactionRecordByIdempotencyKey } from "@/server/storage";
import { recordUserRejection } from "@/server/transactions/lifecycleManager";

const approveBodySchema = z.object({
  idempotencyKey: z.string().min(1).max(160),
  walletAddress: z.string().min(1).max(80),
  chainFamily: z.enum(["evm", "stellar"]),
  network: z.string().min(1).max(64),
  sourceAccount: z.string().optional(),
  /** The connected wallet address for server-side mismatch check */
  connectedWallet: z.string().min(1).max(80),
  /** The connected network for server-side mismatch check */
  connectedNetwork: z.string().min(1).max(64),
});

const rejectBodySchema = z.object({
  action: z.literal("reject"),
  idempotencyKey: z.string().min(1).max(160),
  walletAddress: z.string().min(1).max(80),
  reason: z.string().max(280).optional(),
});

/**
 * POST /api/execute/approve
 *
 * Validates a prepared transaction before the user signs it in their wallet.
 * Returns the typed payload (EVM calldata or Stellar XDR metadata) that the
 * client sends to the wallet for signing.
 *
 * If wallet or network mismatch is detected, the response includes the
 * mismatch details so the client can show the user a clear error.
 */
export async function POST(request: Request) {
  const rateLimited = checkRateLimit(request, { namespace: "execute:approve", limit: 30, windowMs: 60_000 });
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => ({}));

  // Check if this is a rejection
  const rejectParsed = rejectBodySchema.safeParse(body);
  if (rejectParsed.success) {
    return handleRejection(rejectParsed.data);
  }

  const parsed = approveBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Validate chain family matches network
  const walletFamily = getChainFamily(parsed.data.network);
  if (parsed.data.chainFamily !== walletFamily) {
    return NextResponse.json(
      {
        allowed: false,
        blockedReason: `Network ${parsed.data.network} belongs to ${walletFamily} but family ${parsed.data.chainFamily} was supplied.`,
        walletOk: true,
        networkOk: false,
        expired: false,
        actionSafe: true,
      },
      { status: 400 },
    );
  }

  try {
    const result = await validateApproval(
      {
        idempotencyKey: parsed.data.idempotencyKey,
        walletAddress: parsed.data.walletAddress,
        chainFamily: parsed.data.chainFamily,
        network: parsed.data.network,
        sourceAccount: parsed.data.sourceAccount,
      },
      parsed.data.connectedWallet,
      parsed.data.connectedNetwork,
    );

    if (!result.allowed) {
      const status = result.expired ? 410 : !result.walletOk ? 403 : !result.networkOk ? 403 : !result.actionSafe ? 403 : 422;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        allowed: false,
        blockedReason: error instanceof Error ? error.message : "Approval validation failed.",
        walletOk: true,
        networkOk: true,
        expired: false,
        actionSafe: true,
      },
      { status: 500 },
    );
  }
}

async function handleRejection(input: { idempotencyKey: string; walletAddress: string; reason?: string }) {
  try {
    const record = await getTransactionRecordByIdempotencyKey(input.walletAddress, input.idempotencyKey);

    if (record) {
      await recordUserRejection(record.hash, {
        walletAddress: input.walletAddress,
        reason: input.reason ?? "User rejected in wallet.",
        source: "wallet",
      });
    }

    return NextResponse.json({ ok: true, status: "user_rejected" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record rejection." },
      { status: 500 },
    );
  }
}
