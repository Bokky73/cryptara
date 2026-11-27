import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { X402RuntimeConfig } from "@/server/x402/config";
import type { X402ChainFamily } from "@/server/types";
import { getX402PaymentReceiptByHeaderHash, getX402PaymentReceiptByTxHash } from "@/server/storage";

/**
 * Name of the internal header carrying the server-signed settlement context.
 * This header is produced only by `server/x402/server.ts` after the facilitator
 * has verified the settlement. Any client-supplied value is stripped at the
 * middleware boundary and any unsigned/invalid value is rejected here.
 */
export const X402_INTERNAL_CONTEXT_HEADER = "x-payment-context";

/**
 * Name of the internal header carrying the HMAC signature over the context.
 */
export const X402_INTERNAL_SIGNATURE_HEADER = "x-payment-context-signature";

/**
 * Prefix for all internal x402 headers that must be stripped from inbound
 * client requests at the middleware boundary.
 */
export const X402_INTERNAL_HEADER_PREFIX = "x-payment-";

export type VerifiedSettlementContext = {
  amount: string;
  recipient: string;
  network: string;
  asset: string;
  payer: string;
  transactionHash: string;
  settlementTimestamp: string;
  chainFamily: X402ChainFamily;
};

/**
 * Resolves the server-only secret used to sign/verify the internal settlement
 * context. Falls back to an ephemeral per-process secret when no env secret is
 * configured so that unsigned client headers can never be trusted.
 */
function getInternalSigningSecret(): string {
  const secret = process.env.X402_INTERNAL_SIGNING_SECRET ?? process.env.X402_SERVER_SECRET ?? "";
  if (secret) return secret;

  const globalKey = "__x402EphemeralSigningSecret";
  const globalStore = globalThis as unknown as Record<string, string | undefined>;
  if (!globalStore[globalKey]) {
    globalStore[globalKey] = createHash("sha256")
      .update(`x402-ephemeral:${process.pid}:${Date.now()}:${Math.random()}`)
      .digest("hex");
  }
  return globalStore[globalKey] as string;
}

function signContextPayload(payload: string): string {
  return createHmac("sha256", getInternalSigningSecret()).update(payload).digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
  } catch {
    return false;
  }
}

/**
 * Serializes a verified settlement context into a canonical, signed header
 * pair. Used by `server/x402/server.ts` after facilitator verification.
 */
export function signSettlementContext(context: VerifiedSettlementContext): {
  contextHeader: string;
  signatureHeader: string;
} {
  const payload = JSON.stringify({
    amount: context.amount,
    recipient: context.recipient,
    network: context.network,
    asset: context.asset,
    payer: context.payer,
    transactionHash: context.transactionHash,
    settlementTimestamp: context.settlementTimestamp,
    chainFamily: context.chainFamily,
  });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  return {
    contextHeader: encoded,
    signatureHeader: signContextPayload(encoded),
  };
}

/**
 * Verifies and decodes the server-signed settlement context from a request.
 * Returns `undefined` when the header is missing, malformed, or the HMAC does
 * not match — callers must treat that as a payment failure.
 */
export function verifySettlementContext(request: NextRequest | Request): VerifiedSettlementContext | undefined {
  const encoded = (request.headers.get(X402_INTERNAL_CONTEXT_HEADER) ?? "").trim();
  const signature = (request.headers.get(X402_INTERNAL_SIGNATURE_HEADER) ?? "").trim();

  if (!encoded || !signature) return undefined;

  const expected = signContextPayload(encoded);
  if (!safeEqualHex(expected, signature)) return undefined;

  try {
    const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<VerifiedSettlementContext>;
    if (
      typeof decoded.amount !== "string" ||
      typeof decoded.recipient !== "string" ||
      typeof decoded.network !== "string" ||
      typeof decoded.asset !== "string" ||
      typeof decoded.payer !== "string" ||
      typeof decoded.transactionHash !== "string" ||
      typeof decoded.settlementTimestamp !== "string" ||
      (decoded.chainFamily !== "evm" && decoded.chainFamily !== "stellar")
    ) {
      return undefined;
    }
    return decoded as VerifiedSettlementContext;
  } catch {
    return undefined;
  }
}

/**
 * Parses a decimal amount string into a comparable number. Returns `undefined`
 * when the value is not a finite non-negative number.
 */
function parseAmount(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

export function stableJsonHash(value: unknown) {
  const serialized = JSON.stringify(value, Object.keys((value as Record<string, unknown>) ?? {}).sort());

  return createHash("sha256").update(serialized ?? "").digest("hex");
}

export function hashPaymentHeader(header: string) {
  return createHash("sha256").update(header).digest("hex");
}

export function getPaymentSignatureHeader(request: NextRequest | Request) {
  return (
    request.headers.get("payment-signature") ??
    request.headers.get("x-payment-signature") ??
    request.headers.get("x-payment") ??
    request.headers.get("payment") ??
    ""
  ).trim();
}



function isExpired(settlementTimestamp: string, maxAgeSeconds: number): boolean {
  if (!settlementTimestamp) return false;
  const settledAt = new Date(settlementTimestamp).getTime();
  if (Number.isNaN(settledAt)) return false;
  const ageSeconds = (Date.now() - settledAt) / 1000;
  return ageSeconds > maxAgeSeconds;
}

/**
 * Resolves which chain family a payment address belongs to.
 * Used to validate payer identity without forcing Stellar hashes
 * into EVM formats.
 */
function resolvePayerChainFamily(payer: string): X402ChainFamily | undefined {
  if (!payer) return undefined;
  if (/^0x[a-fA-F0-9]{40}$/.test(payer)) return "evm";
  if (/^G[A-Z2-7]{55}$/.test(payer)) return "stellar";
  return undefined;
}

/**
 * Compares two recipient/pay-to addresses respecting chain-family
 * case sensitivity rules. EVM addresses are case-insensitive;
 * Stellar addresses use case-sensitive base32.
 */
function addressesMatch(left: string, right: string, chainFamily: X402ChainFamily): boolean {
  if (chainFamily === "stellar") return left === right;
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * Validates a transaction hash by chain family.
 */
function isValidTransactionHash(hash: string, chainFamily: X402ChainFamily): boolean {
  if (!hash) return true; // optional field
  if (chainFamily === "evm") return /^0x[a-fA-F0-9]{64}$/.test(hash);
  if (chainFamily === "stellar") return /^[a-fA-F0-9]{64}$/.test(hash);
  return true;
}

export async function assertFreshX402Payment(input: {
  request: NextRequest | Request;
  requestBody: unknown;
  config: X402RuntimeConfig;
}) {
  const paymentSignature = getPaymentSignatureHeader(input.request);

  if (!paymentSignature) {
    return {
      ok: false as const,
      status: 402,
      error: "payment_required",
      detail: "Missing x402 PAYMENT-SIGNATURE header.",
    };
  }

  const paymentHeaderHash = hashPaymentHeader(paymentSignature);
  const existing = await getX402PaymentReceiptByHeaderHash(paymentHeaderHash);

  if (existing) {
    return {
      ok: false as const,
      status: 409,
      error: "duplicate_x402_payment",
      detail: "This x402 payment signature was already used for a premium resource.",
      receiptId: existing.id,
    };
  }

  // Verify binding: the payment must match the exact request body/resource.
  const requestBodyHash = stableJsonHash(input.requestBody);
  const requestId = createHash("sha256")
    .update(`${input.config.protectedResource}:${paymentHeaderHash}:${requestBodyHash}`)
    .digest("hex")
    .slice(0, 32);

  // Verify the server-signed settlement context. Client-supplied
  // `x-payment-*` headers are never trusted; only the HMAC-signed context
  // produced by the x402 resource server after facilitator verification is.
  const details = verifySettlementContext(input.request);

  if (!details) {
    return {
      ok: false as const,
      status: 402,
      error: "payment_required",
      detail: "Missing or invalid verified x402 settlement context.",
    };
  }

  const chainFamily = input.config.chainFamily;

  if (details.chainFamily !== chainFamily) {
    return {
      ok: false as const,
      status: 402,
      error: "payer_chain_family_mismatch",
      detail: `Settlement chain family (${details.chainFamily}) does not match configured network (${chainFamily}).`,
    };
  }

  // Enforce amount >= required price.
  const paidAmount = parseAmount(details.amount);
  const requiredAmount = parseAmount(input.config.priceUsd);

  if (paidAmount === undefined) {
    return {
      ok: false as const,
      status: 402,
      error: "payment_amount_mismatch",
      detail: "Settlement amount is missing or malformed.",
    };
  }

  if (requiredAmount !== undefined && paidAmount < requiredAmount) {
    return {
      ok: false as const,
      status: 402,
      error: "payment_amount_mismatch",
      detail: `Payment amount ${details.amount} is less than required ${input.config.priceUsd}.`,
    };
  }

  // Enforce recipient === config.payTo.
  if (!details.recipient || !input.config.payTo || !addressesMatch(details.recipient, input.config.payTo, chainFamily)) {
    return {
      ok: false as const,
      status: 402,
      error: "payment_recipient_mismatch",
      detail: "Payment recipient does not match the configured pay-to address.",
    };
  }

  // Enforce network === expectedNetwork.
  if (!details.network || !input.config.network || details.network !== input.config.network) {
    return {
      ok: false as const,
      status: 402,
      error: "payment_network_mismatch",
      detail: `Payment network ${details.network} does not match required ${input.config.network}.`,
    };
  }

  if (details.asset && input.config.asset && details.asset !== input.config.asset) {
    return {
      ok: false as const,
      status: 402,
      error: "payment_asset_mismatch",
      detail: `Payment asset ${details.asset} does not match required ${input.config.asset}.`,
    };
  }

  // Verify payer identity by chain family.
  // Stellar hashes and accounts are not forced into EVM formats.
  if (details.payer) {
    const payerFamily = resolvePayerChainFamily(details.payer);

    if (!payerFamily) {
      return {
        ok: false as const,
        status: 402,
        error: "invalid_payer_identity",
        detail: "Payer address does not match EVM or Stellar format.",
      };
    }

    if (payerFamily !== chainFamily) {
      return {
        ok: false as const,
        status: 402,
        error: "payer_chain_family_mismatch",
        detail: `Payer identity chain family (${payerFamily}) does not match configured network (${chainFamily}).`,
      };
    }
  }

  if (details.transactionHash && !isValidTransactionHash(details.transactionHash, chainFamily)) {
    return {
      ok: false as const,
      status: 402,
      error: "invalid_transaction_hash",
      detail: `Transaction hash does not match ${chainFamily} format.`,
    };
  }

  // Reject replayed transaction hashes already redeemed in persistent storage.
  if (details.transactionHash) {
    const replayedTx = await getX402PaymentReceiptByTxHash(details.transactionHash);
    if (replayedTx) {
      return {
        ok: false as const,
        status: 409,
        error: "duplicate_x402_payment",
        detail: "This x402 transaction hash was already redeemed for a premium resource.",
        receiptId: replayedTx.id,
      };
    }
  }

  // Verify payment expiry.
  if (isExpired(details.settlementTimestamp, input.config.paymentExpirySeconds)) {
    return {
      ok: false as const,
      status: 402,
      error: "payment_expired",
      detail: `Payment settlement has expired (max age ${input.config.paymentExpirySeconds}s).`,
    };
  }

  return {
    ok: true as const,
    paymentHeaderHash,
    requestBodyHash,
    requestId,
    paymentDetails: {
      amount: details.amount,
      recipient: details.recipient,
      network: details.network,
      asset: details.asset || input.config.asset,
      payer: details.payer || undefined,
      transactionHash: details.transactionHash || undefined,
      settlementTimestamp: details.settlementTimestamp || undefined,
      chainFamily,
    },
  };
}
