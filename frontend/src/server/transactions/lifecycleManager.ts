import { createHash } from "node:crypto";
import type { Hash } from "viem";
import { parseUnits, toFunctionSelector } from "viem";
import type { ChainFamily } from "@/lib/chainIdentity";
import { getChainFamily, isTransactionHashForChain } from "@/lib/chainIdentity";
import {
  getStellarChainAdapter,
  type StellarVerificationExpectation,
} from "@/server/transactions/adapters/stellar";
import {
  deriveEvmTransactionHash,
  getEvmChainAdapter,
  type EvmVerificationExpectation,
} from "@/server/transactions/adapters/evm";
import { attachExplorerUrl } from "@/server/transactions/explorer";
import {
  appendLifecycleEventByName,
  canonicalizeTransactionHash,
  createTransactionRecord,
  createTransactionObservation,
  getTransactionRecord,
  getTransactionRecordByIdempotencyKey,
  isImmutableTerminal,
  listTransactionLifecycleEvents,
  listTransactionObservations,
  removeTransactionRecordByHash,
  updateTransactionRecord,
} from "@/server/storage";
import type {
  PollTransactionResult,
  SubmitTransactionInput,
  SubmitTransactionResult,
  TransactionLifecycleEvent,
  TransactionLifecycleStatus,
  TransactionRecord,
  TransactionObservation,
  TransactionExpectedEffect,
  ChainFamily as TypesChainFamily,
} from "@/server/types";

export type CanonicalizedHash = Hash | string;

export const SUBMISSION_TTL_MS = 5 * 60_000;
export const POLL_INTERVAL_MS = 6_000;
export const POLL_DEADLINE_MS = 5 * 60_000;
export const MAX_POLL_ATTEMPTS = 50;

export const PREPARED_LIFECYCLE: TransactionLifecycleStatus = "prepared";
export const SUBMISSION_FAILED_EVENT = "submission_failed" as const;

export type SubmissionOutcome = "ignored_duplicate" | "submitted" | "terminally_recorded";

export type SubmissionReport = {
  transaction: TransactionRecord;
  result: SubmitTransactionResult;
  outcome: SubmissionOutcome;
};

export type PrepareTransactionInput = {
  chainFamily: TypesChainFamily;
  network: string;
  walletAddress: string;
  sourceAccount?: string;
  decisionId?: string;
  decisionAction?: TransactionRecord["decisionAction"];
  asset: string;
  valueUsd?: number;
  expectedEffects?: TransactionExpectedEffect[];
  simulationStatus?: NonNullable<TransactionRecord["simulationStatus"]>;
  policyStatus?: NonNullable<TransactionRecord["policyStatus"]>;
  idempotencyKey: string;
  /** Pre-built EVM calldata (0x-prefixed hex) or Stellar envelope XDR (base64) */
  rawPayload?: string;
};

export type PrepareTransactionResult = {
  transaction: TransactionRecord;
  idempotent: boolean;
  created: boolean;
};

export type ConfirmationExpectation = {
  walletAddress?: string;
  decisionWalletAddress?: string;
  sourceAccount?: string;
  expectedEffects?: TransactionExpectedEffect[];
};

type LifecycleStorageDependencies = {
  getByHash: typeof getTransactionRecord;
  getByIdempotencyKey: typeof getTransactionRecordByIdempotencyKey;
  create: typeof createTransactionRecord;
  update: typeof updateTransactionRecord;
  removeByHash: typeof removeTransactionRecordByHash;
  appendEvent: typeof appendLifecycleEventByName;
  listEvents: typeof listTransactionLifecycleEvents;
  createObservation: typeof createTransactionObservation;
  listObservations: typeof listTransactionObservations;
};

const defaultStorage: LifecycleStorageDependencies = {
  getByHash: getTransactionRecord,
  getByIdempotencyKey: getTransactionRecordByIdempotencyKey,
  create: createTransactionRecord,
  update: updateTransactionRecord,
  removeByHash: removeTransactionRecordByHash,
  appendEvent: appendLifecycleEventByName,
  listEvents: listTransactionLifecycleEvents,
  createObservation: createTransactionObservation,
  listObservations: listTransactionObservations,
};

let storageOverride: LifecycleStorageDependencies | undefined;

export function setLifecycleStorage(deps: Partial<LifecycleStorageDependencies>) {
  storageOverride = { ...defaultStorage, ...deps };
}

function getStorage(): LifecycleStorageDependencies {
  return storageOverride ?? defaultStorage;
}

export class TransactionLifecycleError extends Error {
  public readonly code: string;
  public readonly detail?: Record<string, unknown>;
  constructor(code: string, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = "TransactionLifecycleError";
    this.code = code;
    this.detail = detail;
  }
}

export const LIFECYCLE_TRANSITIONS: Record<TransactionLifecycleStatus, readonly TransactionLifecycleStatus[]> = {
  prepared: ["submitted", "pending", "failed", "expired", "user_rejected"],
  submitted: ["pending", "confirming", "confirmed", "failed", "replaced", "dropped", "expired", "manual_review"],
  pending: ["pending", "confirming", "confirmed", "failed", "replaced", "dropped", "expired", "manual_review"],
  confirming: ["confirming", "confirmed", "failed", "replaced", "reorged", "manual_review"],
  confirmed: ["confirmed", "reorged", "manual_review"],
  reorged: ["reorged", "confirming", "confirmed", "replaced", "dropped", "manual_review"],
  manual_review: ["manual_review", "confirming", "confirmed", "failed", "replaced", "reorged", "dropped"],
  failed: ["failed", "manual_review"],
  replaced: ["replaced", "manual_review"],
  dropped: ["dropped", "manual_review"],
  expired: ["expired", "manual_review"],
  user_rejected: ["user_rejected"],
};

export function assertLifecycleTransition(current: TransactionLifecycleStatus, next: TransactionLifecycleStatus) {
  if (current === next) return;
  if (!LIFECYCLE_TRANSITIONS[current].includes(next)) {
    throw new TransactionLifecycleError("lifecycle_regression", `Rejected transaction lifecycle regression ${current} -> ${next}.`, { current, next });
  }
}

export function reconcileObservation(record: TransactionRecord, observation: TransactionObservation): {
  status: TransactionLifecycleStatus;
  updates: Partial<TransactionRecord>;
  event: TransactionLifecycleEvent["event"];
  detail: Record<string, unknown>;
} {
  const required = Math.max(1, observation.requiredConfirmations);
  const base = {
    lastPolledAt: observation.observedAt,
    pollAttempts: (record.pollAttempts ?? 0) + 1,
    observationCount: (record.observationCount ?? 0) + 1,
    confirmationCount: observation.confirmations,
    requiredConfirmations: required,
  };
  const detail = { provider: observation.provider, status: observation.status, confirmations: observation.confirmations, requiredConfirmations: required, evidenceKey: observation.evidenceKey };

  if (observation.status === "provider_disagreement") {
    return { status: "manual_review", updates: { ...base, manualReviewReason: observation.detail ?? "Providers disagree on transaction finality." }, event: "provider_disagreement", detail };
  }
  if (observation.status === "replaced") {
    return { status: "replaced", updates: { ...base, replacementHash: observation.replacementHash, terminalAt: observation.observedAt }, event: "replacement_detected", detail };
  }
  if (observation.status === "expired") {
    return { status: "expired", updates: { ...base, terminalAt: observation.observedAt, failureReason: "Provider validity window expired." }, event: "expired", detail };
  }
  if (observation.status === "failed") {
    const conflict = record.lifecycleStatus === "confirmed";
    return conflict
      ? { status: "manual_review", updates: { ...base, manualReviewReason: "A provider reported failure after confirmation." }, event: "manual_review_required", detail }
      : { status: "failed", updates: { ...base, terminalAt: observation.observedAt, failureReason: observation.detail ?? "Provider reported transaction failure." }, event: "failed", detail };
  }
  if (observation.status === "not_found") {
    if (record.lastObservedBlockHash || record.lifecycleStatus === "confirmed" || record.lifecycleStatus === "confirming") {
      return { status: "reorged", updates: { ...base, finalityReached: false, missingObservationCount: (record.missingObservationCount ?? 0) + 1, manualReviewReason: "Previously included transaction disappeared from provider view." }, event: "reorg_detected", detail };
    }
    const missing = (record.missingObservationCount ?? 0) + 1;
    return missing >= 3
      ? { status: "dropped", updates: { ...base, missingObservationCount: missing, terminalAt: observation.observedAt, failureReason: "Transaction was absent for three bounded polls." }, event: "dropped_detected", detail }
      : { status: record.lifecycleStatus === "submitted" ? "pending" : record.lifecycleStatus, updates: { ...base, missingObservationCount: missing }, event: "observation_recorded", detail };
  }
  if (observation.status === "duplicate") {
    return { status: record.lifecycleStatus, updates: base, event: "duplicate_rejected", detail };
  }
  if (observation.status === "pending") {
    const status = record.lifecycleStatus === "confirming" ? "confirming" : "pending";
    return { status, updates: { ...base, missingObservationCount: 0 }, event: "observation_recorded", detail };
  }

  if (record.lastObservedBlockHash && observation.blockHash && record.lastObservedBlockHash !== observation.blockHash) {
    return { status: "reorged", updates: { ...base, finalityReached: false, lastObservedBlockHash: observation.blockHash, manualReviewReason: "Observed inclusion block hash changed." }, event: "reorg_detected", detail };
  }
  const finalityReached = observation.confirmations >= required;
  return finalityReached
    ? { status: "confirmed", updates: { ...base, finalityReached: true, terminalAt: observation.observedAt, lastObservedBlockHash: observation.blockHash, missingObservationCount: 0 }, event: "confirmed", detail }
    : { status: "confirming", updates: { ...base, finalityReached: false, lastObservedBlockHash: observation.blockHash, missingObservationCount: 0 }, event: "confirmation_progress", detail };
}

export function assertHashMatchesFamily(hash: string, family: ChainFamily) {
  if (!isTransactionHashForChain(hash, family)) {
    throw new TransactionLifecycleError(
      "hash_chain_family_mismatch",
      `Transaction hash does not match chain family ${family}.`,
      { hash, family },
    );
  }
}

function normalizeHashForRecord(hash: string, family: ChainFamily): string {
  return family === "stellar" ? canonicalizeTransactionHash(hash, "stellar") : canonicalizeTransactionHash(hash, "evm");
}

export async function deriveSubmitHash(input: SubmitTransactionInput): Promise<string> {
  if (input.chainFamily === "evm") {
    return deriveEvmTransactionHash(input.signedPayload);
  }

  return getStellarChainAdapter({ network: input.network }).deriveHash(input.signedPayload);
}

function buildBaseRecord(
  input: Pick<SubmitTransactionInput, "asset" | "valueUsd" | "chainFamily" | "network" | "walletAddress" | "sourceAccount" | "decisionId" | "decisionAction" | "simulationStatus" | "policyStatus" | "expectedEffects" | "idempotencyKey">,
  hash: string,
): Omit<TransactionRecord, "createdAt" | "lifecycleStatus" | "status"> {
  return {
    hash,
    type: "swap",
    asset: input.asset,
    valueUsd: input.valueUsd ?? 0,
    chainFamily: input.chainFamily,
    network: input.network,
    walletAddress: input.walletAddress,
    sourceAccount: input.sourceAccount,
    decisionId: input.decisionId,
    decisionAction: input.decisionAction,
    userApproved: true,
    simulationStatus: input.simulationStatus,
    policyStatus: input.policyStatus,
    expectedEffects: input.expectedEffects,
    idempotencyKey: input.idempotencyKey,
  };
}

export async function prepareTransaction(input: PrepareTransactionInput): Promise<PrepareTransactionResult> {
  const storage = getStorage();
  const family = input.chainFamily;

  if (family !== getChainFamily(input.network)) {
    throw new TransactionLifecycleError(
      "network_chain_family_mismatch",
      `Network ${input.network} does not match chain family ${family}.`,
    );
  }

  const existing = await storage.getByIdempotencyKey(input.walletAddress, input.idempotencyKey);
  if (existing) {
    return { transaction: existing, idempotent: true, created: false };
  }

  const record = await storage.create({
    hash: canonicalizeTransactionHash(`pending:${input.walletAddress}:${input.idempotencyKey}`, family),
    type: "swap",
    asset: input.asset,
    valueUsd: input.valueUsd ?? 0,
    status: PREPARED_LIFECYCLE,
    lifecycleStatus: PREPARED_LIFECYCLE,
    chainFamily: family,
    network: input.network,
    walletAddress: input.walletAddress,
    sourceAccount: input.sourceAccount,
    decisionId: input.decisionId,
    decisionAction: input.decisionAction,
    userApproved: true,
    simulationStatus: input.simulationStatus,
    policyStatus: input.policyStatus,
    expectedEffects: input.expectedEffects,
    idempotencyKey: input.idempotencyKey,
    explorerUrl: undefined,
    calldata: input.rawPayload,
    stellarDetails: input.rawPayload && input.chainFamily === "stellar"
      ? { envelopeXdr: input.rawPayload }
      : undefined,
  });

  await storage.appendEvent(record.hash, "prepared", {
    walletAddress: input.walletAddress,
    network: input.network,
    chainFamily: family,
    idempotencyKey: input.idempotencyKey,
  });

  return { transaction: record, idempotent: false, created: true };
}

export async function submitTransaction(input: SubmitTransactionInput): Promise<SubmissionReport> {
  if (input.userApproved !== true) {
    throw new TransactionLifecycleError("approval_required", "User wallet approval is mandatory before submission.");
  }

  const storage = getStorage();
  const family = input.chainFamily;

  if (family !== getChainFamily(input.network)) {
    throw new TransactionLifecycleError("network_chain_family_mismatch", `Network ${input.network} does not match chain family ${family}.`);
  }

  const existingByKey = input.idempotencyKey
    ? await storage.getByIdempotencyKey(input.walletAddress, input.idempotencyKey)
    : undefined;
  if (existingByKey && existingByKey.hash !== canonicalizeTransactionHash(`pending:${input.walletAddress}:${input.idempotencyKey}`, family)) {
    return {
      transaction: existingByKey,
      outcome: "ignored_duplicate",
      result: {
        hash: existingByKey.hash,
        chainFamily: existingByKey.chainFamily,
        network: existingByKey.network,
        submittedAt: existingByKey.submittedAt ?? existingByKey.createdAt,
        status: existingByKey.lifecycleStatus ?? "prepared",
        explorerUrl: existingByKey.explorerUrl,
        idempotent: true,
        reuseReason: "idempotency_key",
        lifecycle: await storage.listEvents(existingByKey.hash),
      },
    };
  }

  const normalizedHash = await deriveSubmitHash(input).catch(() => {
    // Cannot derive a chain-native hash (non-hash payload used with simulator).
    // Fall back to a synthetic canonical hash using the payload bytes so the
    // lifecycle record has a stable, unique identifier without blocking on
    // provider resolution.
    const fallbackPayload = input.signedPayload ?? `${input.chainFamily}:${input.walletAddress}:${input.idempotencyKey ?? Date.now()}`;
    const syntheticHash = `0x${createHash("sha256").update(fallbackPayload).digest("hex")}`;
    return normalizeHashForRecord(syntheticHash, family);
  });
  const existingByHash = await storage.getByHash(normalizedHash);

  if (existingByHash) {
    await storage.appendEvent(normalizedHash, "duplicate_rejected", { reason: "duplicate_hash", walletAddress: input.walletAddress });
    return {
      transaction: existingByHash,
      outcome: "ignored_duplicate",
      result: {
        hash: existingByHash.hash,
        chainFamily: existingByHash.chainFamily,
        network: existingByHash.network,
        submittedAt: existingByHash.submittedAt ?? existingByHash.createdAt,
        status: existingByHash.lifecycleStatus ?? "prepared",
        explorerUrl: existingByHash.explorerUrl,
        idempotent: true,
        reuseReason: "duplicate_hash",
        lifecycle: await storage.listEvents(existingByHash.hash),
      },
    };
  }

  if (existingByKey) {
    // A prepared placeholder exists with the same idempotency key. Remove it so
    // the real record below can use the same key without violating the unique
    // (wallet_address, idempotency_key) index.
    await storage.removeByHash(existingByKey.hash);
  }

  const base = buildBaseRecord(input, normalizedHash);
  const record = await storage.create({ ...base, status: "prepared", lifecycleStatus: "prepared" });
  await storage.appendEvent(normalizedHash, "prepared", { walletAddress: input.walletAddress, network: input.network, chainFamily: family });

  let submitResult;
  try {
    submitResult = await submitToChainAdapter(input);
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "Unknown adapter failure during submission.";
    await storage.appendEvent(normalizedHash, SUBMISSION_FAILED_EVENT, {
      reason: failureReason,
      network: input.network,
      chainFamily: family,
    }, { label: family === "stellar" ? "stellar_rpc" : "evm_rpc", url: getProviderUrl(family, input.network) });

    const failedRecord = await storage.update(normalizedHash, {
      lifecycleStatus: "failed",
      status: "failed",
      terminalAt: new Date().toISOString(),
      failureReason,
    }) ?? record;

    return {
      transaction: failedRecord,
      outcome: "terminally_recorded",
      result: {
        hash: failedRecord.hash,
        chainFamily: failedRecord.chainFamily,
        network: failedRecord.network,
        submittedAt: failedRecord.submittedAt ?? failedRecord.createdAt,
        status: failedRecord.lifecycleStatus,
        explorerUrl: failedRecord.explorerUrl,
        idempotent: false,
        lifecycle: await storage.listEvents(failedRecord.hash),
      },
    };
  }

  const submittedAt = submitResult.broadcastAcceptedAt ?? new Date().toISOString();

  const updated = await storage.update(normalizedHash, {
    lifecycleStatus: "submitted",
    status: "submitted",
    submittedAt,
    explorerUrl: attachExplorerUrl({ hash: normalizedHash, network: input.network, chainFamily: family }),
  }) ?? record;

  await storage.appendEvent(normalizedHash, "submitted", {
    network: input.network,
    providerUrl: submitResult.providerUrl,
    detail: submitResult.detail,
  }, { label: "chain_adapter", url: submitResult.providerUrl });

  return {
    transaction: updated,
    outcome: "submitted",
    result: {
      hash: updated.hash,
      chainFamily: updated.chainFamily,
      network: updated.network,
      submittedAt,
      status: updated.lifecycleStatus ?? "prepared",
      explorerUrl: updated.explorerUrl,
      idempotent: false,
      lifecycle: await storage.listEvents(updated.hash),
    },
  };
}

async function submitToChainAdapter(input: SubmitTransactionInput) {
  if (input.chainFamily === "evm") {
    const adapter = getEvmChainAdapter({ network: input.network });
    return adapter.submit(input.signedPayload, { expectedEffects: input.expectedEffects });
  }

  const adapter = getStellarChainAdapter({ network: input.network });
  return adapter.submit(input.signedPayload, {
    sourceAccount: input.sourceAccount,
    expectedEffects: input.expectedEffects,
  });
}

function getProviderUrl(family: ChainFamily, network: string): string {
  return family === "stellar" ? `stellar:${network}` : `evm:${network}`;
}

function deriveEvmMethodSelector(method: string | undefined): string | undefined {
  if (!method) return undefined;
  try {
    return toFunctionSelector(method).toLowerCase();
  } catch {
    return undefined;
  }
}

// Scale a human-readable decimal amount (e.g. "1.5") to base units (e.g. wei).
// Delegates the decimal parsing to viem's parseUnits so we do not reimplement
// fixed-point math inline — the helper only resolves which decimals to use.
// Caller-supplied `decimals` on the effect is authoritative; if absent we fall
// back to a coarse name-based heuristic that covers the well-known stablecoins
// and wraps to 18 otherwise. Production callers should always set `decimals`
// explicitly via a chain asset registry; the heuristic is intentional last resort.
function inferEvmTokenDecimals(contractOrSymbol: string | undefined): number {
  if (!contractOrSymbol) return 18;
  const normalized = contractOrSymbol.trim().toLowerCase();
  if (normalized === "usdc" || normalized === "usdc.e" || normalized.includes("/usdc")) return 6;
  if (normalized.includes("usdt")) return 6;
  if (normalized.includes("dai")) return 18;
  if (normalized.includes("wbtc")) return 8;
  return 18;
}

function resolveEvmDecimals(effect: { decimals?: number; contractAddress?: string; assetKey?: string }): number {
  if (typeof effect.decimals === "number" && Number.isInteger(effect.decimals) && effect.decimals >= 0 && effect.decimals <= 36) {
    return effect.decimals;
  }
  return inferEvmTokenDecimals(effect.contractAddress ?? effect.assetKey);
}

function scaleAmountToBaseUnits(
  amount: string | undefined,
  effect: { decimals?: number; contractAddress?: string; assetKey?: string },
): bigint | undefined {
  if (amount === undefined) return undefined;
  try {
    return parseUnits(amount, resolveEvmDecimals(effect));
  } catch {
    return undefined;
  }
}

function buildChainExpectation(
  family: ChainFamily,
  expectation: ConfirmationExpectation | undefined,
): EvmVerificationExpectation | StellarVerificationExpectation | undefined {
  if (!expectation) return undefined;
  const wallet = expectation.walletAddress ?? expectation.decisionWalletAddress;
  if (!wallet && !(expectation.expectedEffects && expectation.expectedEffects.length > 0)) {
    return undefined;
  }
   const effects = expectation.expectedEffects?.map((effect) => ({
     kind: effect.kind,
     fromAddress: effect.fromAddress,
     toAddress: effect.toAddress,
    contractAddress: effect.contractAddress,
    method: effect.method,
    amount: effect.amount,
    assetKey: effect.assetKey,
    decimals: effect.decimals,
  }));

  if (family === "evm") {
    const evmEffects = effects?.map((effect) => {
      const enriched: NonNullable<EvmVerificationExpectation["expectedEffects"]>[number] = {
        ...effect,
        requireObservedSource: true,
        methodSelector: deriveEvmMethodSelector(effect.method),
      };
      const baseUnits = scaleAmountToBaseUnits(effect.amount, effect);
      if (baseUnits !== undefined) {
        enriched.amountBaseUnits = baseUnits.toString();
      }
      return enriched;
    });
    const evmExpectation: EvmVerificationExpectation = {};
    if (wallet) evmExpectation.walletAddress = wallet;
    if (evmEffects && evmEffects.length > 0) evmExpectation.expectedEffects = evmEffects;
    return evmExpectation;
  }

  // Stellar verifier is symmetric with the EVM branch now: project amount
  // into amountBaseUnits via the same scaling helper so the adapter can do a
  // BigInt-safe comparison on integer-shaped base units. Asset identity
  // (assetKey) is forwarded unchanged. Stellar tokens use 7 decimal places
  // rather than the EVM default of 18. Spread then augment so the inferred
  // type carries amountBaseUnits unambiguously without re-declaring every
  // field by hand.
  const stellarEffects = effects?.map((effect) => {
    const baseUnits = scaleAmountToBaseUnits(effect.amount, { ...effect, decimals: effect.decimals ?? 7 });
    return {
      ...effect,
      ...(baseUnits !== undefined ? { amountBaseUnits: baseUnits.toString() } : {}),
    };
  });
  const stellarExpectation: StellarVerificationExpectation = {};
  if (wallet) stellarExpectation.walletAddress = wallet;
  if (expectation.sourceAccount) stellarExpectation.sourceAccount = expectation.sourceAccount;
  if (stellarEffects && stellarEffects.length > 0) stellarExpectation.expectedEffects = stellarEffects;
  return stellarExpectation;
}

export async function confirmTransaction(
  hash: string,
  expectation: ConfirmationExpectation = {},
): Promise<TransactionRecord> {
  const storage = getStorage();
  const normalizedHash = normalizeHashForRecord(hash, getChainFamilyForHash(hash));
  const record = await storage.getByHash(normalizedHash);

  if (!record) {
    throw new TransactionLifecycleError(
      "transaction_not_found",
      `Transaction ${hash} has not been recorded by the lifecycle. Submit before confirming.`,
      { hash },
    );
  }

  if (isImmutableTerminal(record.lifecycleStatus)) {
    return record;
  }

  return (await pollTransaction(normalizedHash, { expectation })).transaction;
}

function getChainFamilyForHash(hash: string): ChainFamily {
  return isTransactionHashForChain(hash, "stellar") ? "stellar" : "evm";
}

export async function recordUserRejection(
  hash: string,
  input: { walletAddress?: string; reason?: string; source?: "wallet" | "frontend" } = {},
): Promise<TransactionRecord> {
  const storage = getStorage();
  const family = isTransactionHashForChain(hash, "stellar") ? "stellar" : "evm";
  const normalizedHash = canonicalizeTransactionHash(hash, family);
  const record = await storage.getByHash(normalizedHash);

  if (!record) {
    throw new TransactionLifecycleError(
      "transaction_not_found",
      `Transaction ${hash} not found in lifecycle store; cannot reject.`,
      { hash },
    );
  }

  if (input.walletAddress && record.walletAddress && input.walletAddress.toLowerCase() !== record.walletAddress.toLowerCase()) {
    throw new TransactionLifecycleError(
      "wallet_mismatch",
      `Connected wallet ${input.walletAddress} cannot reject transaction owned by ${record.walletAddress}.`,
      { hash, recordedWallet: record.walletAddress, callerWallet: input.walletAddress },
    );
  }

  if (isImmutableTerminal(record.lifecycleStatus)) {
    return record;
  }

  const rejectedAt = new Date().toISOString();
  await storage.appendEvent(normalizedHash, "user_rejected", {
    reason: input.reason,
    source: input.source ?? "wallet",
    walletAddress: input.walletAddress ?? record.walletAddress,
  });

  return await storage.update(normalizedHash, {
    lifecycleStatus: "user_rejected",
    status: "user_rejected",
    terminalAt: rejectedAt,
    failureReason: input.reason ?? "User rejected the transaction.",
  }) ?? record;
}

export async function pollTransaction(hash: string, options: { network?: string; familyHint?: ChainFamily; expectation?: ConfirmationExpectation } = {}): Promise<PollTransactionResult> {
  const storage = getStorage();
  const record = await storage.getByHash(hash);

  if (!record) {
    throw new TransactionLifecycleError("transaction_not_found", `Transaction ${hash} not found in lifecycle store.`, { hash });
  }

  if (isImmutableTerminal(record.lifecycleStatus)) {
    return { transaction: record, polled: false, terminalReached: true, events: await storage.listEvents(record.hash), observations: await storage.listObservations(record.hash) };
  }
  if ((record.pollAttempts ?? 0) >= MAX_POLL_ATTEMPTS) {
    const reason = `Polling stopped after ${MAX_POLL_ATTEMPTS} bounded attempts.`;
    const updated = (await storage.update(record.hash, { lifecycleStatus: "manual_review", status: "manual_review", manualReviewReason: reason })) ?? record;
    await storage.appendEvent(record.hash, "manual_review_required", { reason, maxPollAttempts: MAX_POLL_ATTEMPTS });
    return { transaction: updated, polled: false, terminalReached: false, events: await storage.listEvents(record.hash), observations: await storage.listObservations(record.hash) };
  }

  const family = options.familyHint ?? record.chainFamily;
  const network = options.network ?? record.network;
  const adapter = family === "stellar" ? getStellarChainAdapter({ network }) : getEvmChainAdapter({ network });
  const adapterExpectation = buildChainExpectation(family, options.expectation ?? {
    walletAddress: record.walletAddress,
    sourceAccount: record.sourceAccount,
    expectedEffects: record.expectedEffects,
  });
  const pollResult = adapterExpectation
    ? await adapter.poll(hash as never, { expectation: adapterExpectation })
    : await adapter.poll(hash as never);
  const observedAt = pollResult.polledAt ?? new Date().toISOString();
  const observationStatus = pollResult.observationStatus ?? (
    pollResult.status === "failed" ? "failed" : pollResult.status === "replaced" ? "replaced" : pollResult.status === "pending" ? "pending" : "included"
  );
  const blockNumber = "blockNumber" in pollResult && pollResult.blockNumber !== undefined ? Number(pollResult.blockNumber) : undefined;
  const ledgerSequence = "ledger" in pollResult ? pollResult.ledger : undefined;
  const confirmations = pollResult.confirmations ?? (pollResult.status === "confirmed" ? 1 : 0);
  const requiredConfirmations = pollResult.requiredConfirmations ?? (family === "stellar" ? 2 : 3);
  const replacementHash = "replacementHash" in pollResult ? pollResult.replacementHash : undefined;
  const blockHash = "blockHash" in pollResult ? pollResult.blockHash : undefined;
  const evidenceKey = createHash("sha256").update(JSON.stringify({ family, network, provider: pollResult.providerUrl, observationStatus, blockNumber, blockHash, ledgerSequence, confirmations, requiredConfirmations, replacementHash })).digest("hex");
  const created = await storage.createObservation({
    hash: record.hash,
    evidenceKey,
    chainFamily: family,
    network,
    provider: family === "stellar" ? "stellar_rpc" : "evm_rpc",
    providerUrl: pollResult.providerUrl,
    status: observationStatus,
    blockNumber,
    blockHash,
    ledgerSequence,
    confirmations,
    requiredConfirmations,
    replacementHash,
    nonce: "nonce" in pollResult ? pollResult.nonce : undefined,
    detail: "verificationDetail" in pollResult ? pollResult.verificationDetail : ("revertReason" in pollResult ? pollResult.revertReason : undefined),
    observedAt,
  });
  if (!created.created) {
    if (observationStatus === "not_found") {
      const decision = reconcileObservation(record, created.observation);
      const updated = (await storage.update(hash, { ...decision.updates, observationCount: record.observationCount ?? 1, lifecycleStatus: decision.status, status: decision.status })) ?? record;
      if (decision.status === "dropped") await storage.appendEvent(hash, "dropped_detected", decision.detail);
      return { transaction: updated, polled: true, terminalReached: isImmutableTerminal(updated.lifecycleStatus), events: await storage.listEvents(hash), observations: await storage.listObservations(hash) };
    }
    return { transaction: record, polled: true, terminalReached: isImmutableTerminal(record.lifecycleStatus), events: await storage.listEvents(hash), observations: await storage.listObservations(hash) };
  }
  await storage.appendEvent(hash, "observation_recorded", { evidenceKey, observationStatus, confirmations, requiredConfirmations }, { label: created.observation.provider, url: created.observation.providerUrl });
  const decision = reconcileObservation(record, created.observation);
  let nextStatus = decision.status;
  try {
    assertLifecycleTransition(record.lifecycleStatus, nextStatus);
  } catch (error) {
    nextStatus = "manual_review";
    decision.updates.manualReviewReason = error instanceof Error ? error.message : "Conflicting lifecycle transition.";
    await storage.appendEvent(hash, "manual_review_required", { current: record.lifecycleStatus, proposed: decision.status });
  }
  await storage.appendEvent(hash, decision.event, decision.detail, { label: created.observation.provider, url: created.observation.providerUrl });
  const updated = (await storage.update(hash, { ...decision.updates, lifecycleStatus: nextStatus, status: nextStatus })) ?? record;
  return { transaction: updated, polled: true, terminalReached: nextStatus === "confirmed" || isImmutableTerminal(nextStatus), events: await storage.listEvents(hash), observations: await storage.listObservations(hash) };
}

export async function expireTransactionIfStale(hash: string, options: { now?: () => Date; ttlMs?: number } = {}): Promise<{ expired: boolean; transaction?: TransactionRecord; events: TransactionLifecycleEvent[] }> {
  const storage = getStorage();
  const record = await storage.getByHash(hash);

  if (!record || isImmutableTerminal(record.lifecycleStatus)) {
    return { expired: false, transaction: record, events: await storage.listEvents(hash) };
  }

  const ttl = options.ttlMs ?? SUBMISSION_TTL_MS;
  const nowFn = options.now ?? (() => new Date());
  const nowMs = nowFn().getTime();
  const submittedAtTs = record.submittedAt ? new Date(record.submittedAt).getTime() : new Date(record.createdAt).getTime();
  const elapsed = nowMs - submittedAtTs;

  if (elapsed < ttl) {
    return { expired: false, transaction: record, events: await storage.listEvents(hash) };
  }

  const polledAt = new Date(nowMs).toISOString();
  const updated = await storage.update(hash, {
    lifecycleStatus: "expired",
    status: "expired",
    terminalAt: polledAt,
    lastPolledAt: polledAt,
    failureReason: "Submission TTL exceeded without a terminal response from chain provider.",
  }) ?? record;

  await storage.appendEvent(hash, "expired", { ttlMs: ttl, elapsedMs: elapsed });

  return { expired: true, transaction: updated, events: await storage.listEvents(hash) };
}

export async function listHashEvents(hash: string): Promise<TransactionLifecycleEvent[]> {
  return listTransactionLifecycleEvents(hash);
}
