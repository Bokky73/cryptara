import { createFacilitatorConfig } from "@coinbase/x402";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getX402RuntimeConfig, validateX402RuntimeConfig } from "@/server/x402/config";
import { getRegisteredSchemes } from "@/server/x402/schemes";

/**
 * Name of the internal header used to carry the HMAC-signed settlement context
 * from the x402 resource server to the route guards. Any client-supplied value
 * for this header MUST be stripped at the middleware boundary.
 */
export const X402_SETTLEMENT_CONTEXT_HEADER = "x-x402-settlement-context";

/**
 * Name of the internal header carrying the HMAC signature. Kept separate from
 * the payload header so the signature can be verified independently.
 */
export const X402_SETTLEMENT_SIGNATURE_HEADER = "x-x402-settlement-signature";

export interface SettlementContext {
  requestId: string;
  amount: string;
  recipient: string;
  network: string;
  asset: string;
  payer: string;
  txHash: string;
  settledAt: number;
  requestBodyHash: string;
}

export interface VerifiedSettlementContext extends SettlementContext {
  verified: true;
}

let cachedSecret: Buffer | null = null;

/**
 * Resolve the server-only HMAC secret used to sign settlement contexts.
 *
 * The secret is read from the environment. If no secret is configured (e.g.
 * local development), an ephemeral per-process secret is generated. The secret
 * is never logged.
 */
function getSettlementSecret(): Buffer {
  if (cachedSecret) {
    return cachedSecret;
  }

  const envSecret =
    process.env.X402_SETTLEMENT_SECRET ??
    process.env.X402_INTERNAL_HMAC_SECRET ??
    "";

  if (envSecret.length >= 32) {
    cachedSecret = Buffer.from(envSecret, "utf8");
  } else {
    // Ephemeral fallback for dev/test. Signatures will not survive a restart,
    // which is acceptable because settlement contexts are short-lived.
    cachedSecret = randomBytes(32);
  }

  return cachedSecret;
}

function canonicalize(context: SettlementContext): string {
  // Deterministic serialization so both signer and verifier agree on bytes.
  return JSON.stringify({
    requestId: context.requestId,
    amount: context.amount,
    recipient: context.recipient,
    network: context.network,
    asset: context.asset,
    payer: context.payer,
    txHash: context.txHash,
    settledAt: context.settledAt,
    requestBodyHash: context.requestBodyHash,
  });
}

function computeSignature(context: SettlementContext): string {
  return createHmac("sha256", getSettlementSecret())
    .update(canonicalize(context))
    .digest("hex");
}

/**
 * Sign a verified settlement context and return the headers that should be
 * attached to the downstream request. The payload is base64-encoded JSON and
 * the signature is a hex HMAC-SHA256 over the canonical payload.
 */
export function signSettlementContext(context: SettlementContext): {
  payloadHeader: string;
  signatureHeader: string;
} {
  const payload = Buffer.from(canonicalize(context), "utf8").toString("base64");
  const signature = computeSignature(context);

  return {
    payloadHeader: payload,
    signatureHeader: signature,
  };
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verify an HMAC-signed settlement context. Returns the parsed context when the
 * signature is valid, otherwise `null`. This helper is used by `guards.ts` so
 * that direct route invocation cannot bypass verification.
 */
export function verifySettlementContext(
  payloadHeader: string | null | undefined,
  signatureHeader: string | null | undefined,
): VerifiedSettlementContext | null {
  if (!payloadHeader || !signatureHeader) {
    return null;
  }

  let parsed: SettlementContext;
  try {
    const decoded = Buffer.from(payloadHeader, "base64").toString("utf8");
    parsed = JSON.parse(decoded) as SettlementContext;
  } catch {
    return null;
  }

  if (
    !parsed ||
    typeof parsed.requestId !== "string" ||
    typeof parsed.amount !== "string" ||
    typeof parsed.recipient !== "string" ||
    typeof parsed.network !== "string" ||
    typeof parsed.asset !== "string" ||
    typeof parsed.payer !== "string" ||
    typeof parsed.txHash !== "string" ||
    typeof parsed.settledAt !== "number" ||
    typeof parsed.requestBodyHash !== "string"
  ) {
    return null;
  }

  const expected = computeSignature(parsed);
  if (!safeEqualHex(expected, signatureHeader)) {
    return null;
  }

  return { ...parsed, verified: true };
}

export function createX402ResourceServer() {
  const config = getX402RuntimeConfig();
  const validation = validateX402RuntimeConfig(config);

  if (!validation.ok) {
    throw new Error(`Invalid x402 configuration: ${validation.issues.join(" ")}`);
  }

  const facilitatorClient = new HTTPFacilitatorClient(
    config.facilitatorUrl.includes("api.cdp.coinbase.com")
      ? createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret)
      : { url: config.facilitatorUrl },
  );

  const server = new x402ResourceServer(facilitatorClient);
  const schemes = getRegisteredSchemes(config);

  for (const registered of schemes) {
    server.register(config.network as Network, registered.scheme);
  }

  return server;
}