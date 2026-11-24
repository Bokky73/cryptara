/**
 * Soroban simulation adapter.
 *
 * Runs the Stellar `simulateTransaction` RPC method against the EXACT
 * prepared transaction (parsed from the server-built XDR) and normalizes the
 * response into the shared chain-aware simulation contract.
 *
 * Fail-closed guarantees:
 *  - the network passphrase of the XDR is verified against the configured
 *    Stellar network before any simulation runs (wrong network fails closed),
 *  - the latest ledger reported by the provider is verified against the
 *    transaction's ledger bounds and an optional expected ledger (stale state
 *    fails closed),
 *  - malformed XDR, provider timeouts, and unavailable providers produce
 *    structured unavailable/failed results, never a success claim,
 *  - no private key is ever required — only the wallet's public key is used.
 */
import { rpc, TransactionBuilder, xdr, scValToNative, type Transaction } from "@stellar/stellar-sdk";
import { getStellarNetwork, type StellarNetworkConfig } from "@/lib/stellar/config";
import { StellarDataLayerError, StellarRpcDataLayer } from "@/server/stellar/dataLayer";
import {
  defaultSimulationProviderConfig,
  type SimulationProviderConfig,
  type SimulationResult,
  type StellarSimulationRequest,
  type StellarSimulationResult,
} from "@/server/simulation/types";
import { hashPreparedTransaction, redactSecrets } from "@/server/simulation/hash";

// ─── Dependency injection surface ─────────────────────────────────────

/**
 * Minimal transport surface used by the adapter.  The production dependency
 * wraps the `StellarRpcDataLayer` (which verifies passphrase + latest ledger
 * and performs provider failover); tests inject a mock so no live network is
 * needed.
 */
export type SorobanSimulationTransport = {
  simulate: (transaction: Transaction) => Promise<{
    value: rpc.Api.SimulateTransactionResponse;
    latestLedger?: number;
    providerUrl?: string;
    latencyMs?: number;
  }>;
  getNetwork: () => Promise<{ passphrase: string }>;
  getLatestLedger: () => Promise<{ sequence: number }>;
};

export type SorobanSimulationOptions = {
  transport?: SorobanSimulationTransport;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  maxStateAge?: number;
  /** Expected current ledger; if the provider lags by more than maxStateAge the result fails closed. */
  expectedLedger?: number;
  now?: () => number;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Production transport (StellarRpcDataLayer) ───────────────────────

export function createSorobanSimulationTransport(chain: string, options: { timeoutMs?: number; retries?: number } = {}): SorobanSimulationTransport {
  const network = getStellarNetwork(chain);
  if (!network) {
    throw new Error(`Unsupported Stellar network: ${chain}`);
  }

  const layer = new StellarRpcDataLayer(network.id, {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryLimit: options.retries ?? 1,
  });

  return {
    async simulate(transaction) {
      const result = await layer.simulateTransaction(transaction);
      return {
        value: result.value,
        latestLedger: result.meta.highestObservedLedger ?? result.meta.ledgerHeight,
        providerUrl: result.meta.providerUrl,
        latencyMs: result.meta.latencyMs,
      };
    },
    getNetwork: () => Promise.resolve({ passphrase: network.networkPassphrase }),
    getLatestLedger: async () => {
      const health = await layer.getHealth();
      return { sequence: health.highestObservedLedger ?? 0 };
    },
  };
}

// ─── Normalization helpers ─────────────────────────────────────────────

function parsePreparedTransaction(xdrPayload: string, passphrase: string): Transaction {
  const transaction = TransactionBuilder.fromXDR(xdrPayload, passphrase);
  if ("innerTransaction" in transaction) {
    throw new Error("Fee-bump transactions are not supported by the simulation adapter.");
  }
  return transaction as Transaction;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof StellarDataLayerError && error.code === "timeout";
}

function isWrongNetworkError(error: unknown): boolean {
  return (
    error instanceof StellarDataLayerError &&
    error.attempts.some((attempt) => attempt.errorCode === "network_mismatch")
  );
}

function isRevertError(error: unknown): boolean {
  return error instanceof StellarDataLayerError && error.code === "simulation_failed";
}

function extractExpectedOutput(value: rpc.Api.SimulateTransactionResponse): { token?: string; amount?: string } {
  const result = (value as rpc.Api.SimulateTransactionSuccessResponse).result;
  if (!result) return {};

  try {
    const native = scValToNative(result.retval);
    if (typeof native === "bigint" || typeof native === "number") {
      return { amount: String(native) };
    }
    if (native !== null && typeof native === "object") {
      // Soroban DEX returns a swap struct; surface a stable string form.
      return { amount: JSON.stringify(native) };
    }
  } catch {
    return {};
  }

  return {};
}

function countEntries(entries: readonly unknown[] | undefined): number {
  return Array.isArray(entries) ? entries.length : 0;
}

function extractFootprint(
  value: rpc.Api.SimulateTransactionResponse,
): { readOnly?: string[]; readWrite?: string[]; requiresRestore?: boolean } {
  const success = value as rpc.Api.SimulateTransactionSuccessResponse;

  if ("restorePreamble" in success && success.restorePreamble) {
    return { requiresRestore: true };
  }

  if (!success.transactionData) return {};

  try {
    const builder = success.transactionData as unknown as {
      getReadOnly: () => xdr.LedgerKey[];
      getReadWrite: () => xdr.LedgerKey[];
    };
    const encode = (key: xdr.LedgerKey) => {
      try {
        return redactSecrets(key.toXDR("base64"));
      } catch {
        return "unparseable-key";
      }
    };
    return {
      readOnly: builder.getReadOnly().map(encode),
      readWrite: builder.getReadWrite().map(encode),
    };
  } catch {
    return {};
  }
}

function extractResources(
  transaction: Transaction,
  value: rpc.Api.SimulateTransactionResponse,
): { ledgerFee?: string; operationsCount?: number; requiresRestore?: boolean; gasUnits?: string } {
  const success = value as rpc.Api.SimulateTransactionSuccessResponse;
  const ledgerFee = success.minResourceFee ? String(success.minResourceFee) : undefined;
  const operationsCount = transaction.operations.length;
  const requiresRestore = "restorePreamble" in success && Boolean(success.restorePreamble);

  return { ledgerFee, operationsCount, requiresRestore };
}

// ─── Footprint & auth-entry verification ──────────────────────────────

/**
 * A single contract invocation observed in the prepared transaction, used to
 * cross-check the simulated footprint.  Only the contract id and function
 * name are surfaced (never argument values) so the verification stays
 * deterministic and free of secrets.
 */
export type SorobanInvocation = {
  contractId: string;
  functionName: string;
};

/**
 * Extracts the contract invocations encoded in the prepared transaction's
 * `invokeHostFunction` operations.  Returns an empty list when the transaction
 * carries no Soroban operations.
 */
export function extractInvocations(transaction: Transaction): SorobanInvocation[] {
  const invocations: SorobanInvocation[] = [];

  for (const operation of transaction.operations) {
    if (operation.type !== "invokeHostFunction") continue;
    try {
      const hostFunction = operation.func;
      if (hostFunction.switch().name !== "hostFunctionTypeInvokeContract") continue;
      const invoke = hostFunction.invokeContract();
      invocations.push({
        contractId: invoke.contractAddress().contractId().toString("hex"),
        functionName: invoke.functionName().toString(),
      });
    } catch {
      // Unparseable host function — surface a sentinel so verification fails closed.
      invocations.push({ contractId: "unparseable", functionName: "unparseable" });
    }
  }

  return invocations;
}

/**
 * Verifies that the simulated resource footprint and auth entries correspond
 * exactly to the contract invocations present in the prepared transaction.
 *
 * Fail-closed rules:
 *  - every invocation must be represented by at least one read-write footprint
 *    entry (the invoked contract's own ledger entry),
 *  - the number of auth entries must not exceed the number of invocations
 *    (an unexpected extra auth entry implies an unrequested sub-invocation),
 *  - a restore preamble is rejected because it implies the simulation touched
 *    state the prepared transaction did not account for.
 *
 * Returns a structured verdict so callers can surface an actionable
 * `SIMULATION_STALE` / tamper error instead of submitting.
 */
export type SorobanFootprintVerification = {
  ok: boolean;
  code?: "footprint_mismatch" | "unexpected_auth_entry" | "restore_required";
  message?: string;
  invocationCount: number;
  readOnlyCount: number;
  readWriteCount: number;
  authEntryCount: number;
};

export function verifySorobanFootprint(
  transaction: Transaction,
  value: rpc.Api.SimulateTransactionResponse,
): SorobanFootprintVerification {
  const invocations = extractInvocations(transaction);
  const success = value as rpc.Api.SimulateTransactionSuccessResponse;
  const footprint = extractFootprint(value);
  const readOnlyCount = countEntries(footprint.readOnly);
  const readWriteCount = countEntries(footprint.readWrite);

  let authEntryCount = 0;
  try {
    const sorobanData = success.transactionData as unknown as {
      resources?: () => { footprint?: () => { readWrite?: () => unknown[] } };
    };
    const auth = (success.transactionData as unknown as { auth?: () => unknown[] }).auth;
    if (typeof auth === "function") {
      authEntryCount = countEntries(auth());
    }
  } catch {
    authEntryCount = 0;
  }

  const base = {
    invocationCount: invocations.length,
    readOnlyCount,
    readWriteCount,
    authEntryCount,
  };

  if (footprint.requiresRestore) {
    return {
      ...base,
      ok: false,
      code: "restore_required",
      message: "The simulation requires a state restore; re-simulate after restoring the ledger entry.",
    };
  }

  if (invocations.length === 0) {
    // No Soroban invocations — nothing to cross-check.
    return { ...base, ok: true };
  }

  if (readWriteCount < invocations.length) {
    return {
      ...base,
      ok: false,
      code: "footprint_mismatch",
      message: `Simulated footprint exposes ${readWriteCount} read-write entries for ${invocations.length} contract invocation(s).`,
    };
  }

  if (authEntryCount > invocations.length) {
    return {
      ...base,
      ok: false,
      code: "unexpected_auth_entry",
      message: `Simulation produced ${authEntryCount} auth entries for ${invocations.length} contract invocation(s); unexpected sub-invocation detected.`,
    };
  }

  return { ...base, ok: true };
}

// ─── Error mapping ─────────────────────────────────────────────────────

function buildFailureResult(
  request: StellarSimulationRequest,
  binding: { transactionHash: string; quoteHash: string },
  networkConfig: StellarNetworkConfig,
  error: unknown,
  options: SorobanSimulationOptions,
): StellarSimulationResult {
  const now = (options.now ?? Date.now)();
  const base = {
    provider: "soroban_rpc" as const,
    chain: request.chain,
    chainFamily: "stellar" as const,
    network: networkConfig.id,
    checkedAt: new Date(now).toISOString(),
    binding,
    detail: "",
  };

  if (isRevertError(error)) {
    const message = redactSecrets(errorMessage(error));
    return {
      ...base,
      status: "failed",
      revertReason: message,
      revertReasonHuman: "The simulated Stellar operation reverted.",
      diagnostics: ["The Soroban RPC simulation reported an error."],
      detail: `Soroban simulation reverted: ${message}`,
      providerMeta: {
        provider: "soroban_rpc",
        network: networkConfig.id,
        checkedAt: base.checkedAt,
        latencyMs: 0,
      },
    };
  }

  if (isWrongNetworkError(error)) {
    return {
      ...base,
      status: "failed",
      error: {
        code: "wrong_network",
        message: "The St

/* … truncated 11639 chars — edit only what you need near the top … */
