/**
 * Binding-hash and redaction helpers for the simulation layer.
 *
 * Binding: every simulation result is bound to the EXACT prepared transaction
 * and quote via content hashes.  A result recorded for one payload can never
 * satisfy a different payload or quote because the confirm gate compares the
 * re-derived hashes against the stored binding.
 *
 * Redaction: signed XDR, Stellar secret keys, private keys, and RPC bearer
 * credentials are scrubbed from any string before it is persisted or logged.
 */
import { createHash } from "node:crypto";

// ─── Hashing ───────────────────────────────────────────────────────────

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Hash the exact prepared transaction payload plus its chain context.
 *
 * EVM payloads bind on calldata + target + value + chainId + from wallet.
 * Stellar payloads bind on the base64 XDR + network passphrase + source.
 */
export function hashPreparedTransaction(input: {
  chainFamily: "evm" | "stellar";
  network: string;
  rawPayload: string;
  to?: string;
  value?: string;
  chainId?: number;
  from?: string;
  sourceAccount?: string;
  networkPassphrase?: string;
}): string {
  const canonicalParts: string[] = [input.chainFamily, input.network.trim().toLowerCase()];

  if (input.chainFamily === "evm") {
    canonicalParts.push(
      (input.to ?? "").trim().toLowerCase(),
      input.value ?? "",
      String(input.chainId ?? ""),
      (input.from ?? "").trim().toLowerCase(),
    );
  } else {
    canonicalParts.push(input.sourceAccount ?? "", input.networkPassphrase ?? "");
  }

  canonicalParts.push(input.rawPayload.trim());

  return sha256Hex(canonicalParts.join("\n"));
}

/**
 * Canonicalize and hash the quote the prepared transaction was built from.
 * Only the fields that define the economic intent are included so any
 * difference in route, amounts, or slippage invalidates the binding.
 */
export function hashQuote(input: {
  route?: string[];
  fromAmount?: string;
  expectedOutput?: string;
  minReceive?: string;
  slippageBps?: number;
  priceImpactBps?: number;
  expiresAt?: string;
  extra?: Record<string, string | number | boolean | undefined>;
}): string {
  const parts: string[] = [
    (input.route ?? []).map((token) => token.trim().toLowerCase()).join("|"),
    input.fromAmount ?? "",
    input.expectedOutput ?? "",
    input.minReceive ?? "",
    String(input.slippageBps ?? ""),
    String(input.priceImpactBps ?? ""),
    input.expiresAt ?? "",
  ];

  if (input.extra) {
    for (const key of Object.keys(input.extra).sort()) {
      parts.push(`${key}=${String(input.extra[key] ?? "")}`);
    }
  }

  return sha256Hex(parts.join("\n"));
}

/**
 * Deterministic simulation digest binding an execution approval to the exact
 * simulation it was produced from.  Covers the chain context, quote identity,
 * economic bounds, fee estimate, the block/ledger the simulation ran against,
 * and the simulation TTL.  Any drift in these fields (stale TTL, moved block,
 * changed min-out or fee) yields a different digest and must abort submission.
 */
export function hashSimulation(input: {
  chainFamily: "evm" | "stellar";
  network: string;
  quoteId: string;
  expectedMinOut: string;
  feeEstimate: string;
  simulatedBlockOrLedger: number | string;
  expiresAt: string;
}): string {
  const canonicalParts: string[] = [
    input.chainFamily,
    input.network.trim().toLowerCase(),
    input.quoteId.trim(),
    input.expectedMinOut.trim(),
    input.feeEstimate.trim(),
    String(input.simulatedBlockOrLedger),
    input.expiresAt.trim(),
  ];

  return sha256Hex(canonicalParts.join("\n"));
}

// ─── Redaction ─────────────────────────────────────────────────────────

const STELLAR_SECRET_KEY_PATTERN = /\bS[A-Z2-7]{55}\b/g;
const XDR_SIGNED_PATTERN = /\bAAAA[A-Za-z0-9+/=_-]{80,}\b/g;
const PRIVATE_KEY_HEX_PATTERN = /\b(?:[0-9a-fA-F]){64}\b/g;
const PRIVATE_KEY_UNITY_PATTERN = /\b0x[0-9a-fA-F]{64}\b/g;
const API_KEY_PATTERN = /\b(?:sk|rk|pk|ak)_[A-Za-z0-9]{12,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi;
const RPC_URL_CREDENTIAL_PATTERN = /(https?:\/\/)[^/@\s]+:[^/@\s]+@/g;

/**
 * Redact secrets from any string before it is persisted or logged.
 * Replaces signed XDR, Stellar/hex private keys, and bearer tokens with
 * a fixed placeholder so operators can correlate without leaking material.
 */
export function redactSecrets(value: string): string {
  return value
    .replace(STELLAR_SECRET_KEY_PATTERN, "[REDACTED_STELLAR_SECRET]")
    .replace(XDR_SIGNED_PATTERN, "[REDACTED_SIGNED_XDR]")
    .replace(PRIVATE_KEY_HEX_PATTERN, "[REDACTED_HEX_KEY]")
    .replace(PRIVATE_KEY_UNITY_PATTERN, "[REDACTED_HEX_KEY]")
    .replace(API_KEY_PATTERN, "[REDACTED_API_KEY]")
    .replace(BEARER_PATTERN, "[REDACTED_BEARER]")
    .replace(RPC_URL_CREDENTIAL_PATTERN, "$1[REDACTED]:[REDACTED]@");
}

/**
 * Sanitize a simulation request for logging — drops the raw payload entirely
 * and keeps only a binding hash plus non-sensitive metadata.
 */
export function sanitizeSimulationRequestForLogs(input: {
  chain: string;
  chainFamily: "evm" | "stellar";
  walletAddress: string;
  quoteHash: string;
  xdr?: string;
  data?: string;
  to?: string;
  sourceAccount?: string;
  method?: string;
}): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    chain: input.chain,
    chainFamily: input.chainFamily,
    walletAddress: input.walletAddress,
    quoteHash: input.quoteHash,
    method: input.method,
  };

  if (input.chainFamily === "evm") {
    sanitized.to = input.to;
    sanitized.calldataHash = input.data ? sha256Hex(input.data) : undefined;
  } else {
    sanitized.sourceAccount = input.sourceAccount;
    sanitized.xdrHash = input.xdr ? sha256Hex(input.xdr) : undefined;
  }

  return sanitized;
}
