/**
 * Provider health checks for EVM and Stellar RPC providers.
 * All checks are read-only — no wallet signatures, no transactions.
 * Reports degradation without false success.
 *
 * Issue #18: Provider Health Checks.
 */

import { createEvmPublicClient } from "@/server/transactions/adapters/evm";
import { getStellarRpcHealth } from "@/server/stellar/client";
import { recordAuditEvent, auditProviderHealthCheck, auditProviderDegraded } from "@/server/observability/executionAudit";
import { sharedProviderCircuits, type CircuitState } from "@/server/providers/adapter";
import { redactProviderUrl } from "@/lib/stellar/failover";
import { redactSecrets } from "@/server/observability/logging";

// ── Types ──────────────────────────────────────────────────────────

export type ProviderHealthRecordInput = {
  provider: string;
  kind: string;
  ok: boolean;
  latencyMs?: number;
  errorCode?: string;
  circuitState: CircuitState;
};

const providerHealthSamples = new Map<string, ProviderHealthRecordInput & { recordedAt: string }>();

export function recordProviderHealth(input: ProviderHealthRecordInput): void {
  providerHealthSamples.set(`${input.kind}:${input.provider}`, {
    ...input,
    recordedAt: new Date().toISOString(),
  });
}

export function getProviderHealthSamples(): Array<ProviderHealthRecordInput & { recordedAt: string }> {
  return [...providerHealthSamples.values()];
}

export type HealthStatus = "healthy" | "degraded" | "unavailable" | "unconfigured";

export type ProviderHealthCheck = {
  provider: string;
  family: "evm" | "stellar";
  network: string;
  status: HealthStatus;
  latencyMs?: number;
  detail: string;
  checkedAt: string;
  error?: string;
  score?: number;
  circuitState?: CircuitState;
};

export type ProviderHealthSnapshot = {
  evm: ProviderHealthCheck[];
  stellar: ProviderHealthCheck[];
  checkedAt: string;
  overallStatus: HealthStatus;
  circuits: ReturnType<typeof getProviderCircuitHealth>;
};

export type ProviderCircuitHealth = {
  provider: string;
  state: CircuitState;
  sampleCount: number;
  errorRate: number;
  averageLatencyMs: number;
  score: number;
};

/**
 * Composite provider health score in [0, 100].
 * Penalizes open/half-open circuits, high error rates, and slow latency.
 * An open circuit is treated as fully unavailable (score 0).
 */
export function scoreProviderCircuit(circuit: {
  state: CircuitState;
  errorRate: number;
  averageLatencyMs: number;
}): number {
  if (circuit.state === "open") return 0;
  const latencyPenalty = Math.min(35, circuit.averageLatencyMs / 100);
  const errorPenalty = Math.min(55, circuit.errorRate * 55);
  const statePenalty = circuit.state === "half_open" ? 20 : 0;
  return Math.max(0, Math.round(100 - latencyPenalty - errorPenalty - statePenalty));
}

export function getProviderCircuitHealth(): ProviderCircuitHealth[] {
  return sharedProviderCircuits.snapshots().map((circuit) => ({
    provider: redactSecrets(circuit.key),
    state: circuit.state,
    sampleCount: circuit.sampleCount,
    errorRate: Number(circuit.errorRate.toFixed(3)),
    averageLatencyMs: circuit.averageLatencyMs,
    score: scoreProviderCircuit(circuit),
  }));
}

/**
 * Look up the circuit health entry for a given provider key.
 * Returns `undefined` when the provider has no recorded samples yet.
 */
export function getCircuitHealthFor(providerKey: string): ProviderCircuitHealth | undefined {
  return getProviderCircuitHealth().find((entry) => entry.provider === redactSecrets(providerKey));
}

/**
 * Returns true when the circuit for the given provider key is open,
 * meaning the provider should be treated as unavailable.
 */
export function isProviderCircuitOpen(providerKey: string): boolean {
  const key = redactSecrets(providerKey);
  return sharedProviderCircuits.snapshots().find((entry) => entry.key === key)?.state === "open";
}

// ── Disable switches ───────────────────────────────────────────────

/**
 * Returns true when execution providers are disabled at the environment
 * level. When disabled, the system runs recommendation-only — all agent
 * analysis, risk scoring, and preview preparation continue to work, but
 * no provider-dependent execution paths are attempted.
 */
export function areExecutionProvidersDisabled(): boolean {
  return (
    Boolean(process.env.DISABLE_EXECUTION_PROVIDERS) ||
    Boolean(process.env.RECOMMENDATION_ONLY_MODE)
  );
}

/**
 * Granular disable switches for individual execution capabilities.
 * All default to `false` — everything is enabled unless explicitly disabled.
 */
export function getExecutionDisableFlags() {
  return {
    all: areExecutionProvidersDisabled(),
    quote: Boolean(process.env.DISABLE_QUOTE_PROVIDER),
    simulation: Boolean(process.env.DISABLE_SIMULATION_PROVIDER),
    evmSubmission: Boolean(process.env.DISABLE_EVM_SUBMISSION),
    stellarSubmission: Boolean(process.env.DISABLE_STELLAR_SUBMISSION),
    confirmationPolling: Boolean(process.env.DISABLE_CONFIRMATION_POLLING),
    supabaseWrites: Boolean(process.env.DISABLE_SUPABASE_WRITES),
    x402Settlement: Boolean(process.env.DISABLE_X402_SETTLEMENT),
    recommendationOnly: Boolean(process.env.RECOMMENDATION_ONLY_MODE),
  };
}

// ── EVM Health Check ───────────────────────────────────────────────

export async function checkEvmProviderHealth(params: {
  network: string;
  rpcUrl?: string;
  chainId?: number;
}): Promise<ProviderHealthCheck> {
  const startedAt = Date.now();
  const provider = "evm_rpc";
  const network = params.network;

  try {
    const client = createEvmPublicClient({
      network,
      chainId: params.chainId,
      rpcUrl: params.rpcUrl,
    });

    if (!client) {
      return {
        provider,
        family: "evm",
        network,
        status: "unconfigured",
        detail: `EVM client could not be created for ${network}. Check RPC URL configuration.`,
        checkedAt: new Date().toISOString(),
      };
    }

    const blockNumber = await client.getBlockNumber();
    const latencyMs = Date.now() - startedAt;

    recordAuditEvent(auditProviderHealthCheck({
      correlationId: `health_evm_${network}`,
      provider: `evm_rpc_${network}`,
      providerUrl: params.rpcUrl ? redactProviderUrl(params.rpcUrl) : undefined,
      chainFamily: "evm",
      network,
      healthy: true,
      latencyMs,
    }));

    const circuit = getCircuitHealthFor(`evm_rpc_${network}`);
    const circuitOpen = circuit?.state === "open";

    return {
      provider,
      family: "evm",
      network,
      status: circuitOpen ? "unavailable" : "healthy",
      latencyMs,
      detail: circuitOpen
        ? `EVM RPC circuit open for ${network}; treating provider as unavailable.`
        : `EVM RPC healthy at block ${blockNumber} (${latencyMs}ms).`,
      score: circuit?.score,
      circuitState: circuit?.state,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);

    recordAuditEvent(auditProviderDegraded({
      correlationId: `health_evm_${network}`,
      provider: `evm_rpc_${network}`,
      providerUrl: params.rpcUrl ? redactProviderUrl(params.rpcUrl) : undefined,
      chainFamily: "evm",
      network,
      reason: message,
    }));

    const circuit = getCircuitHealthFor(`evm_rpc_${network}`);

    return {
      provider,
      family: "evm",
      network,
      status: "unavailable",
      latencyMs,
      detail: `EVM RPC is unavailable for ${network}.`,
      error: redactSecrets(message),
      score: circuit?.score,
      circuitState: circuit?.state,
      checkedAt: new Date().toISOString(),
    };
  }
}

// ── Stellar Health Check ───────────────────────────────────────────

export async function checkStellarProviderHealth(params: {
  network: string;
}): Promise<ProviderHealthCheck> {
  const startedAt = Date.now();

  try {
    const health = await getStellarRpcHealth(params.network);
    const latencyMs = health.latencyMs;

    const circuit = getCircuitHealthFor("stellar_rpc");
    const circuitOpen = circuit?.state === "open";

    const status: HealthStatus = circuitOpen ? "unavailable" : health.healthy ? "healthy" : "degraded";

    recordAuditEvent(auditProviderHealthCheck({
      correlationId: `health_stellar_${params.network}`,
      provider: "stellar_rpc",
      providerUrl: health.providerUrl ? redactProviderUrl(health.providerUrl) : undefined,
      chainFamily: "stellar",
      network: params.network,
      healthy: health.healthy && !circuitOpen,
      latencyMs,
    }));

    return {
      provider: "stellar_rpc",
      family: "stellar",
      network: params.network,
      status,
      latencyMs,
      detail: circuitOpen
        ? `Stellar RPC circuit open for ${params.network}; treating provider as unavailable.`
        : health.healthy
          ? `Stellar RPC healthy at ledger ${health.latestLedger} (${latencyMs}ms).`
          : `Stellar RPC degraded: status=${health.status}, ledger=${health.latestLedger}.`,
      score: circuit?.score,
      circuitState: circuit?.state,
      checkedAt: health.checkedAt,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);

    recordAuditEvent(auditProviderDegraded({
      correlationId: `health_stellar_${params.network}`,
      provider: "stellar_rpc",
      chainFamily: "stellar",
      network: params.network,
      reason: message,
    }));

    const circuit = getCircuitHealthFor("stellar_rpc");

    return {
      provider: "stellar_rpc",
      family: "stellar",
      network: params.network,
      status: "unavailable",
      latencyMs,
      detail: `Stellar RPC is unavailable for ${params.network}.`,
      error: redactSecrets(message),
      score: circuit?.score,
      circuitState: circuit?.state,
      checkedAt: new Date().toISOString(),
    };
  }
}

// ── Aggregate health ───────────────────────────────────────────────

const DEFAULT_EVM_NETWORKS = ["goat"];
const DEFAULT_STELLAR_NETWORKS = ["stellar-testnet"];

export async function getProviderHealthSnapshot(options?: {
  evmNetworks?: string[];
  stellarNetworks?: string[];
}): Promise<ProviderHealthSnapshot> {
  const evmNetworks = options?.evmNetworks ?? DEFAULT_EVM_NETWORKS;
  const stellarNetworks = options?.stellarNetworks ?? DEFAULT_STELLAR_NETWORKS;

  const [evm, stellar] = await Promise.all([
    Promise.all(evmNetworks.map((network) => checkEvmProviderHealth({ network }))),
    Promise.all(stellarNetworks.map((network) => checkStellarProviderHealth({ network }))),
  ]);

  const all = [...evm, ...stellar];
  const anyUnavailable = all.some((check) => check.status === "unavailable");
  const anyDegraded = all.some((check) => check.status === "degraded");
  const overallStatus: HealthStatus = anyUnavailable ? "unavailable" : anyDegraded ? "degraded" : "healthy";

  return {
    evm,
    stellar,
    checkedAt: new Date().toISOString(),
    overallStatus,
    circuits: getProviderCircuitHealth(),
  };
}

/**
 * Confidence multiplier in [0, 1] derived from the health snapshot.
 * Used by the agent pipeline to downgrade confidence when providers are
 * degraded or unavailable — never to fabricate data in live mode.
 */
export function getProviderConfidenceMultiplier(snapshot: ProviderHealthSnapshot): number {
  const scores = snapshot.circuits.map((circuit) => circuit.score);
  const circuitScore = scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : 100;

  const statusPenalty =
    snapshot.overallStatus === "unavailable"
      ? 0.5
      : snapshot.overallStatus === "degraded"
        ? 0.75
        : snapshot.overallStatus === "unconfigured"
          ? 0.6
          : 1;

  const multiplier = (circuitScore / 100) * statusPenalty;
  return Math.max(0, Math.min(1, Number(multiplier.toFixed(3))));
}

/**
 * Downgrade a base confidence score using the current provider health.
 * Returns the adjusted confidence and the multiplier applied so callers can
 * surface the degradation to the agent state.
 */
export function applyProviderHealthToConfidence(
  baseConfidence: number,
  snapshot: ProviderHealthSnapshot,
): { confidence: number; multiplier: number; status: HealthStatus } {
  const multiplier = getProviderConfidenceMultiplier(snapshot);
  const confidence = Math.max(0, Math.min(1, Number((baseConfidence * multiplier).toFixed(3))));
  return { confidence, multiplier, status: snapshot.overallStatus };
}

/**
 * Synchronous health snapshot based on configuration only (non-blocking).
 * Returns what SHOULD be available without making live RPC calls.
 */
export function getConfiguredProviderHealth(): ProviderHealthSnapshot {
  const goatRpcUrl = process.env.GOAT_RPC_URL ?? process.env.NEXT_PUBLIC_GOAT_RPC_URL;
  const stellarRpcUrl = process.env.STELLAR_RPC_URL ?? process.env.NEXT_PUBLIC_STELLAR_TESTNET_RPC_URL;

  const evmConfigured = Boolean(goatRpcUrl);
  const stellarConfigured = Boolean(stellarRpcUrl);

  const evm: ProviderHealthCheck = {
    provider: "evm_rpc",
    family: "evm",
    network: "goat",
    status: evmConfigured ? "healthy" : "unconfigured",
    detail: evmConfigured
      ? "EVM RPC URL is configured. Live health check pending."
      : "No EVM RPC URL configured. Set GOAT_RPC_URL or NEXT_PUBLIC_GOAT_RPC_URL.",
    checkedAt: new Date().toISOString(),
  };

  const stellar: ProviderHealthCheck = {
    provider: "stellar_rpc",
    family: "stellar",
    network: "stellar-testnet",
    status: stellarConfigured ? "healthy" : "unconfigured",
    detail: stellarConfigured
      ? "Stellar RPC URL is configured. Live health check pending."
      : "No Stellar RPC URL configured. Set STELLAR_RPC_URL or NEXT_PUBLIC_STELLAR_TESTNET_RPC_URL.",
    checkedAt: new Date().toISOString(),
  };

  const all = [evm, stellar];
  const anyUnavailable = all.some((check) => check.status === "unavailable" || check.status === "unconfigured");

  return {
    evm: [evm],
    stellar: [stellar],
    checkedAt: new Date().toISOString(),
    overallStatus: anyUnavailable ? "unavailable" : "healthy",
    circuits: getProviderCircuitHealth(),
  };
}
