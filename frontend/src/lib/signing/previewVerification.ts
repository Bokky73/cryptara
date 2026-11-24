/**
 * Client-side signing guard.
 *
 * The server prepares EVM calldata and Stellar envelopes, but the browser must
 * never forward one of those payloads to a wallet without first checking that
 * it is the payload the user actually reviewed. This module re-derives the
 * simulation binding digest in the browser (Web Crypto, no server-only APIs),
 * decodes Stellar XDR envelopes, and compares every economic field against the
 * `TransactionPreview` that was displayed to the user.
 *
 * Fail-closed by design: any blocking issue means "do not open the wallet
 * prompt". The browser cannot sign on the user's behalf and it cannot repair a
 * tampered payload — the only safe action is to refresh and re-simulate.
 */
import { FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type {
  EvmPreparedTransactionPayload,
  PreparedTransactionPayload,
  StellarPreparedTransactionPayload,
  TransactionPreview as Preview,
} from "@/server/types";
import { getChainFamily } from "@/lib/chainIdentity";
import { resolveEvmChainId } from "@/lib/evm/config";
import { getStellarNetwork, normalizeStellarNetworkId } from "@/lib/stellar/config";

export type SigningVerificationCode =
  | "network_family_mismatch"
  | "network_mismatch"
  | "passphrase_mismatch"
  | "recipient_mismatch"
  | "amount_mismatch"
  | "slippage_mismatch"
  | "source_account_mismatch"
  | "operation_count_mismatch"
  | "unexpected_fee_bump"
  | "signed_payload_from_server"
  | "envelope_expired"
  | "malformed_payload"
  | "quote_expired"
  | "quote_stale"
  | "simulation_hash_mismatch"
  | "simulation_digest_missing"
  | "simulation_not_passed"
  | "noncustodial_violation"
  | "preview_blocked"
  | "verification_error";

export type SigningVerificationIssue = {
  code: SigningVerificationCode;
  /** Field that failed verification, for actionable UI/error reporting. */
  field: string;
  message: string;
  /** False for informational warnings that do not block signing. */
  blocking: boolean;
  /** True when the only safe recovery is a fresh prepare + simulation. */
  refreshRequired: boolean;
};

export type SigningVerificationResult = {
  /** True when there are no blocking issues. */
  ok: boolean;
  issues: SigningVerificationIssue[];
  /** Re-derived SHA-256 binding digest, when it could be computed. */
  digest?: string;
  stellar?: StellarEnvelopeInspection;
};

export type StellarOperationInspection = {
  type: string;
  destination?: string;
  contractId?: string;
  amount?: string;
  destinationAmount?: string;
  asset?: string;
};

export type StellarEnvelopeInspection = {
  source: string;
  feeBumpSource?: string;
  isFeeBump: boolean;
  fee: string;
  sequence: string;
  operationCount: number;
  operations: StellarOperationInspection[];
  minTime?: string;
  maxTime?: string;
  expired: boolean;
  signatureCount: number;
};

export class SigningVerificationError extends Error {
  constructor(readonly issues: SigningVerificationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "SigningVerificationError";
  }
}

type IssueSink = (
  code: SigningVerificationCode,
  field: string,
  message: string,
  options?: { blocking?: boolean; refreshRequired?: boolean },
) => void;

function createIssueSink(issues: SigningVerificationIssue[]): IssueSink {
  return (code, field, message, options) => {
    issues.push({
      code,
      field,
      message,
      blocking: options?.blocking ?? true,
      refreshRequired: options?.refreshRequired ?? (options?.blocking ?? true),
    });
  };
}

// ─── Browser-safe hashing (mirrors server/simulation/hash.ts) ───────────

async function sha256Hex(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;

  if (!subtle) {
    throw new Error("Web Crypto is unavailable; the payload cannot be verified in this browser.");
  }

  const bytes = new TextEncoder().encode(input);
  const digest = await subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Re-derive the exact binding digest the server used for a prepared payload. */
export async function hashPreparedTransactionClient(input: {
  chainFamily: "evm" | "stellar";
  network: string;
  rawPayload: string;
  to?: string;
  value?: string;
  chainId?: number;
  from?: string;
  sourceAccount?: string;
  networkPassphrase?: string;
}): Promise<string> {
  const parts: string[] = [input.chainFamily, input.network.trim().toLowerCase()];

  if (input.chainFamily === "evm") {
    parts.push(
      (input.to ?? "").trim().toLowerCase(),
      input.value ?? "",
      String(input.chainId ?? ""),
      (input.from ?? "").trim().toLowerCase(),
    );
  } else {
    parts.push(input.sourceAccount ?? "", input.networkPassphrase ?? "");
  }

  parts.push(input.rawPayload.trim());

  return sha256Hex(parts.join("\n"));
}

/** Re-derive the canonical quote hash bound to a simulation result. */
export async function hashQuoteClient(input: {
  route?: string[];
  fromAmount?: string;
  expectedOutput?: string;
  minReceive?: string;
  slippageBps?: number;
  priceImpactBps?: number;
  expiresAt?: string;
  extra?: Record<string, string | number | boolean | undefined>;
}): Promise<string> {
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

const HEX_64 = /^[0-9a-f]{64}$/i;

function isHex64(value: unknown): value is string {
  return typeof value === "string" && HEX_64.test(value.trim());
}

// ─── Generic field helpers ──────────────────────────────────────────────

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Numeric expiry fields may be epoch seconds or milliseconds.
    return value > 1e12 ? value : value * 1000;
  }

  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();

    if (/^\d+$/.test(trimmed)) {
      const numeric = Number(trimmed);
      return numeric > 1e12 ? numeric : numeric * 1000;
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function sameAddress(left: unknown, right: unknown): boolean {
  if (typeof left !== "string" || typeof right !== "string") return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

/** The displayed recipient can be a flat field or the first expected effect. */
function displayedRecipient(displayParams: Record<string, unknown>): string | undefined {
  const flat = firstString(displayParams, ["targetContract", "contractAddress", "to", "destination"]);
  if (flat) return flat;

  const effects = displayParams.expectedEffects;
  if (!Array.isArray(effects)) return undefined;

  for (const effect of effects) {
    const record = readRecord(effect);
    const recipient = firstString(record, ["contractAddress", "to", "destination"]);
    if (recipient) return recipient;
  }

  return undefined;
}

function checkExpiry(
  value: unknown,
  field: string,
  now: number,
  add: IssueSink,
  label: string,
): void {
  if (value === undefined || value === null || value === "") return;

  const timestamp = parseTimestamp(value);
  if (timestamp === undefined || timestamp <= now) {
    add(
      "quote_expired",
      field,
      `${label} has expired. Refresh the quote and re-simulate before signing.`,
      { refreshRequired: true },
    );
  }
}

function checkNumericMatch(
  expected: unknown,
  actual: unknown,
  field: string,
  label: string,
  add: IssueSink,
): void {
  const expectedValue = finiteNumber(expected);
  const actualValue = finiteNumber(actual);
  if (expectedValue === undefined || actualValue === undefined) return;

  const tolerance = Math.max(1e-9, Math.abs(expectedValue) * 1e-9);
  if (Math.abs(expectedValue - actualValue) > tolerance) {
    add(
      "amount_mismatch",
      field,
      `${label} does not match the reviewed preview (expected ${expectedValue}, payload says ${actualValue}).`,
      { refreshRequired: true },
    );
  }
}

// ─── Stellar envelope decoding ──────────────────────────────────────────

const CONTRACT_ID_PATTERN = /^C[A-Z2-7]{55}$/;

function findContractId(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value === null || value === undefined) return undefined;

  if (typeof value === "string") {
    return CONTRACT_ID_PATTERN.test(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findContractId(entry, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      const found = findContractId(entry, depth + 1);
      if (found) return found;
    }
  }

  return undefined;
}

function describeOperation(value: unknown): StellarOperationInspection {
  const operation = readRecord(value);
  const asset = operation.asset;

  return {
    type: typeof operation.type === "string" ? operation.type : "unknown",
    destination: firstString(operation, ["destination", "to"]),
    amount: firstString(operation, ["amount", "sendAmount"]),
    destinationAmount: firstString(operation, ["destMin", "destAmount", "minAmount"]),
    contractId: findContractId(operation),
    asset: asset && typeof asset === "object" ? JSON.stringify(asset).slice(0, 200) : typeof asset === "string" ? asset : undefined,
  };
}

/**
 * Decode an unsigned envelope in the browser. A Stellar envelope does NOT
 * embed a network passphrase; the passphrase is supplied by the caller and is
 * checked against the selected network by `verifyStellarEnvelope` below.
 */
export function decodeStellarEnvelope(xdr: string, passphrase: string): StellarEnvelopeInspection {
  if (!xdr || typeof xdr !== "string") {
    throw new Error("The prepared Stellar payload has no XDR envelope.");
  }

  const parsed = TransactionBuilder.fromXDR(xdr, passphrase);
  const isFeeBump = parsed instanceof FeeBumpTransaction;
  const transaction = isFeeBump ? parsed.innerTransaction : parsed;

  const bounds = transaction.timeBounds as { minTime?: string | number; maxTime?: string | number } | null | undefined;
  const maxTime = bounds?.maxTime !== undefined && bounds.maxTime !== null ? String(bounds.maxTime) : undefined;
  const minTime = bounds?.minTime !== undefined && bounds.minTime !== null ? String(bounds.minTime) : undefined;
  const maxTimeMs = maxTime !== undefined && maxTime !== "0" ? Number(maxTime) * 1000 : undefined;

  return {
    source: transaction.source,
    feeBumpSource: isFeeBump ? parsed.feeSource : undefined,
    isFeeBump,
    fee: String(transaction.fee),
    sequence: String(transaction.sequence),
    operationCount: transaction.operations.length,
    operations: transaction.operations.map(describeOperation),
    minTime,
    maxTime,
    expired: maxTimeMs !== undefined && Number.isFinite(maxTimeMs) && maxTimeMs <= Date.now(),
    signatureCount: transaction.signatures.length,
  };
}

export type VerifyStellarEnvelopeInput = {
  xdr: string;
  /** The passphrase expected for the user-selected network. */
  passphrase: string;
  expectedSourceAccount?: string;
  expectedOperationCount?: number;
  expectedDestination?: string;
  expectedContractId?: string;
  expectedAmount?: string;
  expectedDestinationAmount?: string;
  now?: number;
};

/** Decode and structurally verify a prepared Stellar envelope. */
export function verifyStellarEnvelope(input: VerifyStellarEnvelopeInput): SigningVerificationResult {
  const issues: SigningVerificationIssue[] = [];
  const add = createIssueSink(issues);
  const now = input.now ?? Date.now();

  let inspection: StellarEnvelopeInspection;

  try {
    inspection = decodeStellarEnvelope(input.xdr, input.passphrase);
  } catch (error) {
    add(
      "malformed_payload",
      "xdr",
      `The prepared Stellar envelope could not be decoded: ${error instanceof Error ? error.message.slice(0, 160) : "unknown error"}.`,
      { refreshRequired: true },
    );
    return { ok: false, issues };
  }

  if (inspection.isFeeBump) {
    add("unexpected_fee_bump", "xdr", "A fee-bump envelope was prepared; only the reviewed transaction may be signed.", { refreshRequired: true });
  }

  if (inspection.signatureCount > 0) {
    add("signed_payload_from_server", "xdr", "The server returned an already-signed envelope. Do not co-sign it.", { refreshRequired: true });
  }

  if (input.expectedSourceAccount && !sameAddress(inspection.source, input.expectedSourceAccount)) {
    add(
      "source_account_mismatch",
      "xdr.sourceAccount",
      `Envelope source ${inspection.source} does not match the reviewed account ${input.expectedSourceAccount}.`,
      { refreshRequired: true },
    );
  }

  if (input.expectedOperationCount !== undefined && inspection.operationCount !== input.expectedOperationCount) {
    add(
      "operation_count_mismatch",
      "xdr.operations",
      `Envelope contains ${inspection.operationCount} operation(s); the preview described ${input.expectedOperationCount}.`,
      { refreshRequired: true },
    );
  }

  if (input.expectedDestination && !inspection.operations.some((op) => sameAddress(op.destination, input.expectedDestination))) {
    add(
      "recipient_mismatch",
      "xdr.operations.destination",
      `No operation sends to the reviewed destination ${input.expectedDestination}.`,
      { refreshRequired: true },
    );
  }

  if (input.expectedContractId && !inspection.operations.some((op) => sameAddress(op.contractId, input.expectedContractId))) {
    add(
      "recipient_mismatch",
      "xdr.operations.contractId",
      `No operation invokes the reviewed contract ${input.expectedContractId}.`,
      { refreshRequired: true },
    );
  }

  if (input.expectedAmount && !inspection.operations.some((op) => finiteNumber(op.amount) === finiteNumber(input.expectedAmount))) {
    add(
      "amount_mismatch",
      "xdr.operations.amount",
      `No operation transfers the reviewed amount ${input.expectedAmount}.`,
      { refreshRequired: true },
    );
  }

  if (
    input.expectedDestinationAmount &&
    !inspection.operations.some((op) => finiteNumber(op.destinationAmount) === finiteNumber(input.expectedDestinationAmount))
  ) {
    add(
      "amount_mismatch",
      "xdr.operations.destinationAmount",
      `No operation delivers at least the reviewed minimum of ${input.expectedDestinationAmount}.`,
      { refreshRequired: true },
    );
  }

  if (inspection.maxTime && inspection.maxTime !== "0" && Number(inspection.maxTime) * 1000 <= now) {
    add("envelope_expired", "xdr.timeBounds.maxTime", "This envelope's time bounds have expired. Re-prepare before signing.", { refreshRequired: true });
  }

  return { ok: issues.length === 0, issues, stellar: inspection };
}

// ─── Prepared payload vs. displayed preview ─────────────────────────────

export type VerifyPreparedPayloadInput = {
  preview: Preview;
  payload: PreparedTransactionPayload | null | undefined;
  walletAddress?: string;
  sourceAccount?: string;
  now?: number;
};

function stellarPassphraseForNetwork(network: string): string | undefined {
  const normalized = normalizeStellarNetworkId(network);

  return normalized ? getStellarNetwork(normalized)?.networkPassphrase : undefined;
}

async function verifyDigest(
  preview: Preview,
  payload: PreparedTransactionPayload,
  walletAddress: string | undefined,
  sourceAccount: string | undefined,
  passphrase: string | undefined,
  add: IssueSink,
): Promise<string | undefined> {
  const simulation = preview.simulation;
  if (simulation?.status === "not_required") return undefined;

  if (!simulation) {
    add(
      "simulation_digest_missing",
      "simulation",
      "No simulation result is attached to this preview. Refresh and re-simulate before signing.",
      { refreshRequired: true },
    );
    return undefined;
  }

  if (simulation.status !== "passed") {
    add(
      "simulation_not_passed",
      "simulation.status",
      `Simulation is ${simulation.status}. Re-run the simulation before signing.`,
      { refreshRequired: true },
    );
    return undefined;
  }

  let digest: string | undefined;

  try {
    if (payload.chainFamily === "evm") {
      if (!walletAddress) {
        add("simulation_digest_missing", "walletAddress", "Connect the EVM wallet so the simulation binding can be re-derived before signing.", {
          refreshRequired: false,
        });
        return undefined;
      }

      const evm = payload as EvmPreparedTransactionPayload;
      digest = await hashPreparedTransactionClient({
        chainFamily: "evm",
        network: preview.network,
        rawPayload: evm.data,
        to: evm.to,
        value: evm.value,
        chainId: evm.chainId,
        from: walletAddress,
      });
    } else {
      const stellar = payload as StellarPreparedTransactionPayload;
      digest = await hashPreparedTransactionClient({
        chainFamily: "stellar",
        network: preview.network,
        rawPayload: stellar.xdr,
        sourceAccount: sourceAccount ?? stellar.sourceAccount,
        networkPassphrase: passphrase ?? stellar.networkPassphrase,
      });
    }
  } catch (error) {
    add("verification_error", "simulation.binding", `Could not re-derive the simulation digest: ${error instanceof Error ? error.message : "unknown error"}.`, {
      refreshRequired: true,
    });
    return undefined;
  }

  // Prefer the explicit binding, then the family-specific digest. Older
  // previews may only carry the generic simulatedTxHash.
  const candidates = [
    { field: "simulation.binding.transactionHash", value: simulation.binding?.transactionHash },
    ...(payload.chainFamily === "stellar"
      ? [{ field: "simulation.simulatedXdrHash", value: simulation.simulatedXdrHash }]
      : []),
    { field: "simulation.simulatedTxHash", value: simulation.simulatedTxHash },
  ].filter((candidate): candidate is { field: string; value: string } => isHex64(candidate.value));

  const boundDigest = candidates[0];
  if (!boundDigest) {
    add(
      "simulation_digest_missing",
      "simulation.binding.transactionHash",
      "The preview has no simulation digest to verify against. Refresh and re-simulate before signing.",
      { refreshRequired: true },
    );
    return digest;
  }

  if (boundDigest.value.trim().toLowerCase() !== digest.toLowerCase()) {
    add(
      "simulation_hash_mismatch",
      boundDigest.field,
      "The prepared payload does not match the hash of the simulated transaction. Signing is blocked — refresh the quote and re-simulate.",
      { refreshRequired: true },
    );
  }

  const quoteHash = simulation.binding?.quoteHash;
  if (isHex64(quoteHash) && preview.quote) {
    const derivedQuoteHash = await hashQuoteClient({
      route: preview.quote.route,
      fromAmount: String(preview.quote.exactInput.amount),
      expectedOutput: String(preview.quote.expectedOutputAmount ?? preview.quote.exactOutput.amount),
      minReceive: String(preview.quote.minReceiveAmount),
      slippageBps: preview.quote.slippageBps,
      priceImpactBps: preview.quote.priceImpactBps,
      expiresAt: preview.quote.expiresAt,
    });

    if (derivedQuoteHash.toLowerCase() !== quoteHash.trim().toLowerCase()) {
      add(
        "simulation_hash_mismatch",
        "simulation.binding.quoteHash",
        "The displayed quote does not match the hash bound to the simulation. Signing is blocked — refresh the quote and re-simulate.",
        { refreshRequired: true },
      );
    }
  }

  return digest;
}

/**
 * The main guard used before any wallet prompt. Compares the server-prepared
 * payload with the user-visible preview, then verifies the simulation digest
 * and (for Stellar) the decoded envelope.
 */
export async function verifyPreparedPayloadAgainstPreview(
  input: VerifyPreparedPayloadInput,
): Promise<SigningVerificationResult> {
  const issues: SigningVerificationIssue[] = [];
  const add = createIssueSink(issues);
  const { preview, payload } = input;
  const now = input.now ?? Date.now();

  if (!payload) {
    add("malformed_payload", "payload", "No prepared payload was returned. Refresh and prepare the transaction again.", { refreshRequired: true });
    return { ok: false, issues };
  }

  if (preview.audit && preview.audit.serverCanSign !== false) {
    add("noncustodial_violation", "audit.serverCanSign", "This preview claims the server can sign. Approval-only signing is required.", { refreshRequired: true });
  }

  if (preview.blockedReason) {
    add("preview_blocked", "blockedReason", `This preview is blocked: ${preview.blockedReason}`, { refreshRequired: true });
  }

  if (preview.quote?.quoteMismatch) {
    add("quote_stale", "quote.quoteMismatch", "The quote does not match the requested asset or network. Refresh before signing.", { refreshRequired: true });
  }

  if (preview.quote?.status === "stale" || preview.quote?.status === "unavailable") {
    add("quote_stale", "quote.status", `Quote status is ${preview.quote.status}. Refresh before signing.`, { refreshRequired: true });
  }

  checkExpiry(preview.quote?.expiresAt, "quote.expiresAt", now, add, "Quote");
  checkExpiry(preview.lifecycle?.expiresAt, "lifecycle.expiresAt", now, add, "Prepared transaction");
  checkExpiry(preview.simulation?.quoteExpiry, "simulation.quoteExpiry", now, add, "Simulation quote");

  const displayParams = readRecord(payload.displayParams);
  checkExpiry(
    displayParams.expiresAt ?? displayParams.quoteExpiresAt ?? displayParams.preparationExpiry,
    "payload.displayParams.expiresAt",
    now,
    add,
    "Prepared quote",
  );

  const expectedFamily = getChainFamily(preview.network);
  let passphrase: string | undefined;
  let stellarResult: SigningVerificationResult | undefined;

  if (payload.chainFamily !== expectedFamily) {
    add(
      "network_family_mismatch",
      "payload.chainFamily",
      `Prepared payload is for ${payload.chainFamily} but the selected network ${preview.network} is ${expectedFamily}.`,
      { refreshRequired: true },
    );
  }

  if (expectedFamily === "evm") {
    const evm = payload as EvmPreparedTransactionPayload;
    const expectedChainId = resolveEvmChainId(preview.network);

    if (expectedChainId !== undefined && evm.chainId !== expectedChainId) {
      add(
        "network_mismatch",
        "payload.chainId",
        `Prepared chain ID ${evm.chainId} does not match ${preview.network} (${expectedChainId}).`,
        { refreshRequired: true },
      );
    }

    if (typeof evm.data !== "string" || !/^0x([0-9a-f]{2})*$/i.test(evm.data)) {
      add("malformed_payload", "payload.data", "Prepared EVM calldata is not valid 0x-prefixed hex.", { refreshRequired: true });
    }

    if (typeof evm.to !== "string" || !/^0x[0-9a-f]{40}$/i.test(evm.to)) {
      add("malformed_payload", "payload.to", "Prepared EVM recipient is not a valid address.", { refreshRequired: true });
    }

    const expectedRecipient = preview.targetContract ?? displayedRecipient(displayParams);
    if (expectedRecipient && !sameAddress(evm.to, expectedRecipient)) {
      add(
        "recipient_mismatch",
        "payload.to",
        `Prepared recipient ${evm.to} does not match the reviewed contract ${expectedRecipient}.`,
        { refreshRequired: true },
      );
    }

    checkNumericMatch(preview.quote?.exactInput.amount, displayParams.amount ?? displayParams.youSend, "payload.displayParams.amount", "Input amount", add);
    checkNumericMatch(preview.quote?.minReceiveAmount, displayParams.minReceive ?? displayParams.minimumReceive, "payload.displayParams.minReceive", "Minimum received", add);
    checkNumericMatch(
      preview.slippageBps ?? preview.quote?.slippageBps,
      displayParams.slippageBps ?? displayParams.maxSlippageBps,
      "payload.displayParams.slippageBps",
      "Slippage cap",
      add,
    );
    checkNumericMatch(preview.percent, displayParams.percent, "payload.displayParams.percent", "Trade percentage", add);

    if (preview.policy?.maxSlippageBps !== undefined && finiteNumber(displayParams.slippageBps) !== undefined) {
      const preparedSlippage = finiteNumber(displayParams.slippageBps) as number;
      if (preparedSlippage > preview.policy.maxSlippageBps) {
        add(
          "slippage_mismatch",
          "payload.displayParams.slippageBps",
          `Prepared slippage ${preparedSlippage} bps exceeds the user policy cap of ${preview.policy.maxSlippageBps} bps.`,
          { refreshRequired: true },
        );
      }
    }
  } else {
    const stellar = payload as StellarPreparedTransactionPayload;
    passphrase = stellarPassphraseForNetwork(preview.network);

    if (!passphrase) {
      add("network_mismatch", "preview.network", `Unsupported Stellar network ${preview.network}.`, { refreshRequired: true });
      passphrase = stellar.networkPassphrase;
    } else if (stellar.networkPassphrase !== passphrase) {
      add(
        "passphrase_mismatch",
        "payload.networkPassphrase",
        `Prepared passphrase does not match the selected Stellar network ${preview.network}.`,
        { refreshRequired: true },
      );
    }

    const expectedSource = input.sourceAccount ?? stellar.sourceAccount;
    if (expectedSource && !sameAddress(stellar.sourceAccount, expectedSource)) {
      add(
        "source_account_mismatch",
        "payload.sourceAccount",
        `Prepared source ${stellar.sourceAccount} does not match the expected account.`,
        { refreshRequired: true },
      );
    }

    if (input.walletAddress && expectedSource && !sameAddress(input.walletAddress, expectedSource)) {
      add(
        "source_account_mismatch",
        "walletAddress",
        `The connected wallet does not match the prepared source account ${expectedSource}.`,
        { refreshRequired: true },
      );
    }

    const displayed = displayedRecipient(displayParams);
    const soroban = readRecord(preview.stellarQuote?.sorobanSimulation);
    const expectedContract = [
      preview.targetContract,
      firstString(soroban, ["contractId"]),
      firstString(displayParams, ["contractId"]),
      displayed,
    ].find((candidate): candidate is string => typeof candidate === "string" && CONTRACT_ID_PATTERN.test(candidate));
    const expectedDestination =
      firstString(displayParams, ["destination", "toAddress"]) ??
      (displayed && !CONTRACT_ID_PATTERN.test(displayed) ? displayed : undefined) ??
      preview.stellarQuote?.pathPaymentOps?.[0]?.destination;
    const expectedAmount =
      preview.quote?.exactInput.amount !== undefined
        ? String(preview.quote.exactInput.amount)
        : firstString(displayParams, ["amount"]);
    const expectedDestinationAmount =
      preview.quote?.minReceiveAmount !== undefined
        ? String(preview.quote.minReceiveAmount)
        : firstString(displayParams, ["minReceive"]);
    const expectedOperationCount =
      finiteNumber(displayParams.operationCount) ??
      preview.stellarQuote?.pathPaymentOps?.length ??
      stellar.operations?.length;

    stellarResult = verifyStellarEnvelope({
      xdr: stellar.xdr,
      passphrase: passphrase ?? stellar.networkPassphrase,
      expectedSourceAccount: expectedSource,
      expectedOperationCount,
      expectedContractId: expectedContract,
      expectedDestination,
      expectedAmount,
      expectedDestinationAmount,
      now,
    });

    issues.push(...stellarResult.issues);

    // The decoded XDR is authoritative: a tampered `operations` description
    // must never be treated as equivalent to the envelope the wallet will sign.
    if (stellar.operations && stellarResult.stellar && stellar.operations.length !== stellarResult.stellar.operationCount) {
      add(
        "operation_count_mismatch",
        "payload.operations",
        `Prepared operation list contains ${stellar.operations.length} operation(s); the XDR contains ${stellarResult.stellar.operationCount}.`,
        { refreshRequired: true },
      );
    }

    if (stellar.fee !== undefined && stellarResult.stellar) {
      checkNumericMatch(stellarResult.stellar.fee, stellar.fee, "payload.fee", "Stellar fee", add);
    }

    checkNumericMatch(preview.quote?.minReceiveAmount, displayParams.minReceive, "payload.displayParams.minReceive", "Minimum received", add);
    checkNumericMatch(
      preview.slippageBps ?? preview.quote?.slippageBps,
      displayParams.slippageBps,
      "payload.displayParams.slippageBps",
      "Slippage cap",
      add,
    );
  }

  const digest = await verifyDigest(preview, payload, input.walletAddress, input.sourceAccount, passphrase, add);

  return {
    ok: issues.every((issue) => !issue.blocking),
    issues,
    digest,
    stellar: stellarResult?.stellar,
  };
}

// ─── Stellar risk-registry publication preview ──────────────────────────

export type RiskPublicationPreviewData = {
  xdr: string;
  network: string;
  networkPassphrase: string;
  contractId: string;
  publisher: string;
  assetId: string;
  reportHash: string;
  expiresAt: number;
  fee: number;
  simulationPassed: boolean;
};

export type VerifyRiskPublicationInput = {
  preview: RiskPublicationPreviewData;
  /** Network selected in the UI (e.g. stellar-testnet). */
  network: string;
  expectedPublisher?: string;
  expectedContractId?: string;
  now?: number;
};

/** Guard used by the Stellar risk-publish flow before opening the wallet. */
export function verifyRiskPublicationPreview(input: VerifyRiskPublicationInput): SigningVerificationResult {
  const issues: SigningVerificationIssue[] = [];
  const add = createIssueSink(issues);
  const now = input.now ?? Date.now();
  const { preview } = input;
  const expectedPassphrase = stellarPassphraseForNetwork(input.network);

  if (!expectedPassphrase) {
    add("network_mismatch", "network", `Unsupported Stellar network ${input.network}.`, { refreshRequired: true });
  } else if (preview.networkPassphrase !== expectedPassphrase) {
    add(
      "passphrase_mismatch",
      "preview.networkPassphrase",
      "Prepared network passphrase does not match the selected Stellar network.",
      { refreshRequired: true },
    );
  }

  if (!preview.simulationPassed) {
    add("simulation_not_passed", "preview.simulationPassed", "Simulation did not pass for this publication preview. Re-prepare before signing.", {
      refreshRequired: true,
    });
  }

  if (!isHex64(preview.reportHash)) {
    add("malformed_payload", "preview.reportHash", "The report hash is not a SHA-256 digest.", { refreshRequired: true });
  }

  const expectedPublisher = input.expectedPublisher ?? preview.publisher;
  if (input.expectedPublisher && !sameAddress(preview.publisher, input.expectedPublisher)) {
    add(
      "source_account_mismatch",
      "preview.publisher",
      `Prepared publisher ${preview.publisher} does not match the connected wallet.`,
      { refreshRequired: true },
    );
  }

  const expectedContractId = input.expectedContractId ?? preview.contractId;
  if (input.expectedContractId && !sameAddress(preview.contractId, input.expectedContractId)) {
    add(
      "recipient_mismatch",
      "preview.contractId",
      "Prepared risk-registry contract does not match the configured contract.",
      { refreshRequired: true },
    );
  }

  checkExpiry(preview.expiresAt, "preview.expiresAt", now, add, "Publication preview");

  const envelope = verifyStellarEnvelope({
    xdr: preview.xdr,
    passphrase: expectedPassphrase ?? preview.networkPassphrase,
    expectedSourceAccount: expectedPublisher,
    expectedOperationCount: 1,
    expectedContractId,
    now,
  });

  issues.push(...envelope.issues);

  if (envelope.stellar && finiteNumber(preview.fee) !== undefined && finiteNumber(envelope.stellar.fee) !== finiteNumber(preview.fee)) {
    add("amount_mismatch", "preview.fee", "Envelope fee does not match the displayed publication fee.", { refreshRequired: true });
  }

  return {
    ok: issues.every((issue) => !issue.blocking),
    issues,
    stellar: envelope.stellar,
  };
}
