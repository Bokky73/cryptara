import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gateFeature } from "@/server/features/evaluator";
import { StrKey } from "@stellar/stellar-sdk";
import { runTokenScan } from "@/server/scan/tokenScan";
import { checkRateLimit } from "@/server/security/rateLimit";
import { createX402PaymentReceipt, findX402PaymentReceiptByTxHash } from "@/server/storage";
import { getX402RuntimeConfig } from "@/server/x402/config";
import { hashPaymentHeader, stableJsonHash } from "@/server/x402/guards";
import { verifyStellarSettlement } from "@/server/x402/stellar";
export const runtime = "nodejs";

const querySchema = z.object({
  query: z.string().min(1).max(260),
  chain: z.string().min(1).max(40).optional(),
  walletAddress: z.string().min(1).max(80).optional(),
  /** Base64-encoded JSON with Stellar payment proof: { payer, network, signedPayload, timestamp, nonce } */
  paymentProof: z.string().min(1).max(4096),
});

/**
 * Parse the client-supplied Stellar payment proof envelope.
 *
 * The proof is a base64-encoded JSON object containing:
 * - txHash: the Stellar transaction hash of the settlement
 * - payer: Stellar account address (G...) — advisory only, confirmed on-chain
 * - network: "stellar:testnet" or "stellar:pubnet"
 * - timestamp: ISO-8601 timestamp (must be within 5 minutes)
 * - nonce: random nonce string for replay protection
 *
 * NOTE: These fields are untrusted. They are only used to locate the
 * transaction; the actual settlement is verified on-chain via
 * `verifyStellarSettlement` before any premium work runs.
 */
function parseStellarPaymentProof(proof: Record<string, unknown>): {
  txHash: string;
  payer: string;
  network: string;
  nonce: string;
} {
  const txHash = String(proof.txHash ?? "");
  const payer = String(proof.payer ?? "");
  const network = String(proof.network ?? "");
  const timestamp = String(proof.timestamp ?? "");
  const nonce = String(proof.nonce ?? "");

  // 1. Validate tx hash shape (Stellar tx hashes are 64 hex chars)
  if (!/^[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error("Invalid Stellar transaction hash in payment proof.");
  }

  // 2. Validate payer is a valid Stellar account address
  if (!payer || !StrKey.isValidEd25519PublicKey(payer)) {
    throw new Error("Invalid Stellar payer address in payment proof.");
  }

  // 3. Validate network
  if (network !== "stellar:testnet" && network !== "stellar:pubnet") {
    throw new Error(`Unsupported Stellar network in payment proof: ${network}`);
  }

  // 4. Pubnet fail-closed gate
  if (network === "stellar:pubnet") {
    throw new Error("Stellar pubnet x402 payments are not enabled. Pubnet is fail-closed until a production facilitator and controlled payment flow are proven.");
  }

  // 5. Validate timestamp freshness (within 5 minutes)
  const proofTime = new Date(timestamp).getTime();
  const now = Date.now();
  const maxAge = 5 * 60 * 1000;

  if (!Number.isFinite(proofTime) || now - proofTime > maxAge || proofTime > now + 30_000) {
    throw new Error("Stellar payment proof is expired or timestamp is in the future.");
  }

  // 6. Validate nonce presence (replay protection handled by tx hash receipt)
  if (!nonce || nonce.length < 16) {
    throw new Error("Stellar payment proof nonce is too short for replay protection.");
  }

  return { txHash, payer, network, nonce };
}

async function stellarDeepScanHandler(request: NextRequest): Promise<NextResponse<unknown>> {
  const rateLimited = checkRateLimit(request, { namespace: "x402:stellar-deep-scan", limit: 10, windowMs: 60_000 });

  if (rateLimited) {
    return rateLimited;
  }

  const config = getX402RuntimeConfig();

  // Fail-closed: Stellar must be explicitly enabled
  if (!config.stellarEnabled) {
    return jsonError({ code: "stellar_disabled", message: "Stellar x402 payments are not enabled. Set X402_STELLAR_ENABLED=1 and X402_STELLAR_PAY_TO to a valid G... address.", status: 402 });
  }

  const parsed = querySchema.safeParse({
    query: request.nextUrl.searchParams.get("query") ?? "",
    chain: request.nextUrl.searchParams.get("chain") ?? undefined,
    walletAddress: request.nextUrl.searchParams.get("walletAddress") ?? undefined,
    paymentProof: request.headers.get("x-stellar-payment-proof") ?? "",
  });

  if (!parsed.success) {
    return jsonError({ code: "validation_error", message: "Invalid input", status: 400, details: parsed.error.flatten() });
  }

  const x402Gate = gateFeature("x402_stellar_deep_scan", parsed.data.walletAddress ?? "");
  if (!x402Gate.enabled) {
    return NextResponse.json(
      { error: "feature_disabled", feature: "x402_stellar_deep_scan", detail: x402Gate.detail },
      { status: 403 },
    );
  }

  // Decode and verify the Stellar payment proof
  let proof: Record<string, unknown>;
  try {
    const decoded = Buffer.from(parsed.data.paymentProof, "base64").toString("utf-8");
    proof = JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return jsonError({ code: "invalid_payment_proof", message: "The x-stellar-payment-proof header must be a valid base64-encoded JSON object.", status: 400 });
  }

  let proofFields: { txHash: string; payer: string; network: string; nonce: string };
  try {
    proofFields = parseStellarPaymentProof(proof);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment proof verification failed.";
    return jsonError({ code: "payment_failure", message, status: 402 });
  }

  // Replay check: reject a tx hash that has already been redeemed for any payload.
  const existingReceipt = findX402PaymentReceiptByTxHash(proofFields.txHash);
  if (existingReceipt) {
    return jsonError({
      code: "duplicate_payment",
      message: "This Stellar payment transaction was already used.",
      status: 402,
      legacy: { receiptId: existingReceipt.id },
    });
  }

  // Cryptographic on-chain verification: do not trust client-supplied fields.
  let settlement: { payer: string; network: string; amount: string; recipient: string; txHash: string };
  try {
    settlement = await verifyStellarSettlement({
      txHash: proofFields.txHash,
      expectedNetwork: proofFields.network,
      expectedRecipient: config.stellarPayTo,
      requiredAmount: config.priceUsd,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stellar settlement verification failed.";
    return jsonError({ code: "payment_failure", message, status: 402 });
  }

  // Defense in depth: re-assert the settlement invariants even though
  // verifyStellarSettlement already enforces them.
  if (
    settlement.txHash.toLowerCase() !== proofFields.txHash.toLowerCase() ||
    settlement.recipient !== config.stellarPayTo ||
    settlement.network !== proofFields.network
  ) {
    return jsonError({ code: "payment_failure", message: "Stellar settlement does not match the expected payment terms.", status: 402 });
  }

  const paymentHeaderHash = hashPaymentHeader(parsed.data.paymentProof);
  const requestBody = { query: parsed.data.query, chain: parsed.data.chain, walletAddress: parsed.data.walletAddress };

  const receipt = createX402PaymentReceipt({
    requestId: `${config.protectedResource}:stellar:${paymentHeaderHash.slice(0, 16)}`,
    paymentHeaderHash,
    walletAddress: parsed.data.walletAddress,
    network: settlement.network,
    asset: "USDC",
    amount: settlement.amount,
    priceUsd: config.priceUsd,
    payTo: settlement.recipient,
    facilitatorUrl: config.facilitatorUrl,
    protectedResource: config.protectedResource,
    requestBodyHash: stableJsonHash(requestBody),
    payer: settlement.payer,
    txHash: settlement.txHash,
    verificationStatus: "verified",
  });

  if ("verificationStatus" in receipt && receipt.verificationStatus === "duplicate") {
    return jsonError({ code: "duplicate_payment", message: "This Stellar payment proof was already used.", status: 402, legacy: { receiptId: receipt.id } });
  }

  const scan = await runTokenScan(parsed.data.query, parsed.data.chain, parsed.data.walletAddress);

  return NextResponse.json({
    premium: {
      unlocked: true,
      tier: "deep_scan",
      provider: "x402_stellar",
      protectedResource: config.protectedResource,
      receiptId: receipt.id,
      note: "Stellar x402 payment was verified before premium analysis ran.",
    },
    scan,
  });
}

export const GET = stellarDeepScanHandler;
