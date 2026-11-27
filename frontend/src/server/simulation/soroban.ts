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
        message: "The Stellar RPC provider serves a different network.",
        retryable: false,
        detail: errorMessage(error),
      },
      diagnostics: ["Network passphrase verification failed."],
      detail: "Stellar simulation failed closed: the provider serves a different network.",
      providerMeta: {
        provider: "soroban_rpc",
        network: networkConfig.id,
        checkedAt: base.checkedAt,
        latencyMs: 0,
      },
    };
  }

  if (isTimeoutError(error)) {
    return {
      ...base,
      status: "unavailable",
      error: {
        code: "timeout",
        message: "Stellar simulation timed out.",
        retryable: true,
        detail: errorMessage(error),
      },
      detail: "Stellar simulation is unavailable because the provider timed out.",
      providerMeta: {
        provider: "soroban_rpc",
        network: networkConfig.id,
        checkedAt: base.checkedAt,
        latencyMs: 0,
      },
    };
  }

  return {
    ...base,
    status: "unavailable",
    error: {
      code: "provider_unavailable",
      message: "Stellar simulation is unavailable.",
      retryable: true,
      detail: redactSecrets(errorMessage(error)),
    },
    detail: "Stellar simulation is unavailable. The provider did not return a usable result.",
    providerMeta: {
      provider: "soroban_rpc",
      network: networkConfig.id,
      checkedAt: base.checkedAt,
      latencyMs: 0,
    },
  };
}

// ─── Main adapter ──────────────────────────────────────────────────────

export async function simulateSorobanTransaction(
  request: StellarSimulationRequest,
  options: SorobanSimulationOptions = {},
): Promise<SimulationResult> {
  const now = options.now ?? Date.now;
  const config: SimulationProviderConfig = {
    ...defaultSimulationProviderConfig,
    timeoutMs: options.timeoutMs ?? defaultSimulationProviderConfig.timeoutMs,
    retries: options.retries ?? defaultSimulationProviderConfig.retries,
    backoffMs: options.backoffMs ?? defaultSimulationProviderConfig.backoffMs,
    maxStateAge: options.maxStateAge ?? defaultSimulationProviderConfig.maxStateAge,
  };

  const networkConfig = getStellarNetwork(request.chain);
  if (!networkConfig) {
    return {
      provider: "soroban_rpc",
      status: "unsupported",
      chain: request.chain,
      chainFamily: "stellar",
      network: request.chain,
      checkedAt: new Date(now()).toISOString(),
      binding: { transactionHash: "", quoteHash: request.quoteHash },
      error: {
        code: "unsupported_route",
        message: `Unsupported Stellar network: ${request.chain}`,
        retryable: false,
      },
      detail: `Stellar simulation is unsupported for network ${request.chain}.`,
    };
  }

  const transactionHash = hashPreparedTransaction({
    chainFamily: "stellar",
    network: request.chain,
    rawPayload: request.xdr,
    sourceAccount: request.sourceAccount,
    networkPassphrase: request.expectedPassphrase ?? request.networkPassphrase ?? networkConfig.networkPassphrase,
  });
  const binding = { transactionHash, quoteHash: request.quoteHash };

  const expectedPassphrase = request.expectedPassphrase ?? request.networkPassphrase ?? networkConfig.networkPassphrase;

  let transaction: Transaction;
  try {
    transaction = parsePreparedTransaction(request.xdr, expectedPassphrase);
  } catch (error) {
    return {
      provider: "soroban_rpc",
      status: "failed",
      chain: request.chain,
      chainFamily: "stellar",
      network: networkConfig.id,
      checkedAt: new Date(now()).toISOString(),
      binding,
      error: {
        code: "malformed_request",
        message: "The prepared Stellar XDR could not be parsed.",
        retryable: false,
        detail: redactSecrets(errorMessage(error)),
      },
      revertReason: "malformed_xdr",
      diagnostics: ["The prepared transaction XDR is malformed or uses the wrong network passphrase."],
      detail: "Stellar simulation failed closed: the prepared transaction XDR is invalid.",
    };
  }

  if (transaction.source !== request.sourceAccount) {
    return {
      provider: "soroban_rpc",
      status: "failed",
      chain: request.chain,
      chainFamily: "stellar",
      network: networkConfig.id,
      checkedAt: new Date(now()).toISOString(),
      binding,
      error: {
        code: "invalid_request",
        message: "The prepared transaction source does not match the request wallet.",
        retryable: false,
      },
      diagnostics: ["Source account mismatch."],
      detail: "Stellar simulation failed closed: source account mismatch.",
    };
  }

  let transport = options.transport;
  if (!transport) {
    try {
      transport = createSorobanSimulationTransport(request.chain, {
        timeoutMs: options.timeoutMs,
        retries: options.retries,
      });
    } catch (error) {
      return {
        provider: "soroban_rpc",
        status: "unsupported",
        chain: request.chain,
        chainFamily: "stellar",
        network: networkConfig.id,
        checkedAt: new Date(now()).toISOString(),
        binding,
        error: {
          code: "unsupported_route",
          message: "No Stellar RPC transport is configured.",
          retryable: false,
          detail: redactSecrets(errorMessage(error)),
        },
        detail: "Stellar simulation is unsupported because no RPC transport is configured.",
      };
    }
  }

  let latestLedger: number | undefined;
  try {
    const [networkInfo, latest] = await Promise.all([
      transport.getNetwork(),
      transport.getLatestLedger(),
    ]);

    if (networkInfo.passphrase !== expectedPassphrase) {
      return {
        provider: "soroban_rpc",
        status: "failed",
        chain: request.chain,
        chainFamily: "stellar",
        network: networkConfig.id,
        checkedAt: new Date(now()).toISOString(),
        binding,
        error: {
          code: "wrong_network",
          message: "The Stellar network passphrase does not match the prepared transaction.",
          retryable: false,
          detail: `Expected ${expectedPassphrase}, provider reports ${networkInfo.passphrase}.`,
        },
        diagnostics: ["Network passphrase verification failed."],
        detail: "Stellar simulation failed closed: network passphrase mismatch.",
      };
    }

    latestLedger = latest.sequence;

    // Ledger-bound check: a prepared transaction whose max ledger is already
    // behind the provider's latest ledger can no longer be submitted.
    const ledgerBounds = transaction.ledgerBounds;
    if (ledgerBounds && ledgerBounds.maxLedger > 0 && latestLedger > ledgerBounds.maxLedger) {
      return {
        provider: "soroban_rpc",
        status: "failed",
        chain: request.chain,
        chainFamily: "stellar",
        network: networkConfig.id,
        checkedAt: new Date(now()).toISOString(),
        binding,
        ledgerSeq: latestLedger,
        error: {
          code: "stale_state",
          message: "The prepared transaction ledger bound has been exceeded.",
          retryable: true,
          detail: `Latest ledger ${latestLedger} exceeds transaction max ledger ${ledgerBounds.maxLedger}.`,
        },
        diagnostics: ["Stale ledger: the prepared transaction can no longer be submitted."],
        detail: "Stellar simulation failed closed: the prepared transaction is stale.",
      };
    }

    // Provider-lag check: if the provider is materially behind the expected
    // ledger, the simulation reflects stale state and cannot be trusted.
    if (options.expectedLedger !== undefined) {
      const lag = options.expectedLedger - latestLedger;
      if (lag > config.maxStateAge) {
        return {
          provider: "soroban_rpc",
          status: "failed",
          chain: request.chain,
          chainFamily: "stellar",
          network: networkConfig.id,
          checkedAt: new Date(now()).toISOString(),
          binding,
          ledgerSeq: latestLedger,
          error: {
            code: "stale_state",
            message: "The Stellar provider is too far behind the expected ledger.",
            retryable: true,
            detail: `Provider ledger ${latestLedger} lags expected ledger ${options.expectedLedger} by ${lag}.`,
          },
          diagnostics: ["Stale ledger: provider state is too old to trust."],
          detail: "Stellar simulation failed closed: provider ledger is stale.",
        };
      }
    }
  } catch (error) {
    return buildFailureResult(request, binding, networkConfig, error, options);
  }

  try {
    const startedAt = now();
    const simulated = await transport.simulate(transaction);
    const latencyMs = simulated.latencyMs ?? Math.max(0, now() - startedAt);
    const ledgerSeq = simulated.latestLedger ?? latestLedger;
    const checkedAt = new Date(now()).toISOString();
    const providerMeta = {
      provider: "soroban_rpc" as const,
      network: networkConfig.id,
      checkedAt,
      latencyMs,
      providerUrl: simulated.providerUrl,
    };

    const value = simulated.value;

    if (rpc.Api.isSimulationError(value)) {
      const message = redactSecrets(value.error ?? "The simulated operation reverted.");
      return {
        provider: "soroban_rpc",
        status: "failed",
        chain: request.chain,
        chainFamily: "stellar",
        network: networkConfig.id,
        checkedAt,
        binding,
        ledgerSeq,
        simulatedAt: checkedAt,
        error: {
          code: "revert",
          message: "The simulated Stellar operation reverted.",
          retryable: false,
          detail: message,
        },
        revertReason: message,
        revertReasonHuman: "The simulated Stellar operation reverted.",
        diagnostics: [`Provider reported ${countEntries(value.events)} diagnostic event(s).`],
        detail: `Soroban simulation reverted: ${message}`,
        providerMeta,
      };
    }

    const expectedOutput = extractExpectedOutput(value);
    const footprint = extractFootprint(value);
    const resources = extractResources(transaction, value);
    const authCount = (value as rpc.Api.SimulateTransactionSuccessResponse).result?.auth.length ?? 0;

    return {
      provider: "soroban_rpc",
      status: "passed",
      chain: request.chain,
      chainFamily: "stellar",
      network: networkConfig.id,
      checkedAt,
      binding,
      ledgerSeq,
      simulatedAt: checkedAt,
      simulatedXdrHash: hashPreparedTransaction({
        chainFamily: "stellar",
        network: request.chain,
        rawPayload: request.xdr,
        sourceAccount: request.sourceAccount,
        networkPassphrase: expectedPassphrase,
      }),
      balanceDeltas: [
        {
          token: "XLM",
          symbol: "XLM",
          delta: `-${resources.ledgerFee ?? "0"}`,
          direction: "outflow",
        },
      ],
      authorizationRisk: [
        {
          contractId: "soroban-invocation",
          requiredAuthCount: authCount,
          requiresUserAuth: authCount > 0,
          detail: authCount > 0 ? "The wallet must authorise this contract invocation." : "No contract authorisation is required.",
        },
      ],
      footprint,
      resources,
      expectedOutput: expectedOutput.amount
        ? { token: expectedOutput.token ?? "soroban-return", amount: expectedOutput.amount }
        : undefined,
      restoreRequired: resources.requiresRestore,
      detail: `Soroban simulation passed on ${networkConfig.id} (ledger ${ledgerSeq}).`,
      providerMeta,
    };
  } catch (error) {
    return buildFailureResult(request, binding, networkConfig, error, options);
  }
}
