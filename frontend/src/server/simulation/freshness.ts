import type { SimulationFreshnessConfig, SimulationFreshnessResult, SimulationResultDetail } from "@/server/types";

const DEFAULT_CONFIG: SimulationFreshnessConfig = {
  maxBlockAge: 50,
  maxLedgerAge: 50,
  maxElapsedMs: 300_000,
};

export type SimulationStaleCode =
  | "SIMULATION_STALE"
  | "SIMULATION_EXPIRED"
  | "SIMULATION_BLOCK_DRIFT"
  | "SIMULATION_LEDGER_DRIFT"
  | "SIMULATION_QUOTE_EXPIRED"
  | "SIMULATION_MISSING_TIMESTAMP"
  | "SIMULATION_NOT_PASSED";

export interface SimulationStaleError {
  code: SimulationStaleCode;
  message: string;
  expiredAt?: string;
}

function stale(code: SimulationStaleCode, message: string, expiredAt?: string): SimulationFreshnessResult {
  return { fresh: false, reason: message, code, expiredAt } as SimulationFreshnessResult;
}

export function checkSimulationFreshness(
  simulation: SimulationResultDetail,
  currentBlockNumber?: number,
  currentLedgerSeq?: number,
  configOverrides?: Partial<SimulationFreshnessConfig>,
): SimulationFreshnessResult {
  if (simulation.status === "not_required") {
    return { fresh: true };
  }

  if (simulation.status === "failed") {
    return stale("SIMULATION_NOT_PASSED", "Simulation failed and must be re-run before approval.");
  }

  if (simulation.status === "unavailable") {
    return stale("SIMULATION_NOT_PASSED", "Simulation result is unavailable. Re-run simulation before proceeding.");
  }

  if (simulation.status === "unsupported") {
    return stale("SIMULATION_NOT_PASSED", "Simulation is not supported for this transaction type or chain. Approval is blocked until simulation support is available.");
  }

  if (simulation.status === "pending") {
    return stale("SIMULATION_NOT_PASSED", "Simulation result is still pending. Wait for completion or re-run.");
  }

  if (simulation.status !== "passed") {
    return stale("SIMULATION_NOT_PASSED", "Simulation status is unrecognised. Re-run to verify.");
  }

  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const now = Date.now();

  if (simulation.simulatedAt) {
    const simulatedAtMs = new Date(simulation.simulatedAt).getTime();

    if (Number.isNaN(simulatedAtMs)) {
      return stale("SIMULATION_MISSING_TIMESTAMP", "Simulation timestamp is invalid. Re-run simulation.");
    }

    const elapsedMs = now - simulatedAtMs;

    if (elapsedMs > config.maxElapsedMs) {
      const expiredAt = new Date(simulatedAtMs + config.maxElapsedMs).toISOString();

      return stale(
        "SIMULATION_EXPIRED",
        `Simulation expired due to elapsed time. Results are valid for ${Math.round(config.maxElapsedMs / 60_000)} minutes. Re-run simulation.`,
        expiredAt,
      );
    }
  } else {
    return stale("SIMULATION_MISSING_TIMESTAMP", "Simulation timestamp is missing. Re-run simulation.");
  }

  if (simulation.quoteExpiry) {
    const quoteExpiryMs = new Date(simulation.quoteExpiry).getTime();

    if (!Number.isNaN(quoteExpiryMs) && now > quoteExpiryMs) {
      return stale(
        "SIMULATION_QUOTE_EXPIRED",
        "The price quote embedded in this simulation has expired. Re-run to get a current quote.",
        simulation.quoteExpiry,
      );
    }
  }

  if (typeof simulation.blockNumber === "number" && typeof currentBlockNumber === "number") {
    const blockDiff = currentBlockNumber - simulation.blockNumber;

    if (blockDiff > config.maxBlockAge) {
      return stale(
        "SIMULATION_BLOCK_DRIFT",
        `Simulation ran ${blockDiff} blocks ago (max ${config.maxBlockAge}). Re-run to confirm state has not changed.`,
      );
    }
  }

  if (typeof simulation.ledgerSeq === "number" && typeof currentLedgerSeq === "number") {
    const ledgerDiff = currentLedgerSeq - simulation.ledgerSeq;

    if (ledgerDiff > config.maxLedgerAge) {
      return stale(
        "SIMULATION_LEDGER_DRIFT",
        `Simulation ran ${ledgerDiff} ledgers ago (max ${config.maxLedgerAge}). Re-run to confirm state has not changed.`,
      );
    }
  }

  return { fresh: true };
}

export function checkCalldataMatch(simulation: SimulationResultDetail, currentCalldataHash?: string): boolean {
  if (simulation.status === "not_required") return true;
  if (!simulation.calldataHash || !currentCalldataHash) return false;

  return simulation.calldataHash.toLowerCase() === currentCalldataHash.toLowerCase();
}

export function checkParamsMatch(
  simulation: SimulationResultDetail,
  currentParams: {
    amount?: string;
    route?: string[];
    slippageBps?: number;
    sequenceNumber?: number | string;
    fee?: string;
  },
): boolean {
  if (simulation.status === "not_required") return true;

  if (simulation.fromAmount === undefined || currentParams.amount === undefined || currentParams.amount !== simulation.fromAmount) return false;

  if (simulation.route === undefined || currentParams.route === undefined) return false;
  if (currentParams.route.length !== simulation.route.length) return false;
  for (let i = 0; i < currentParams.route.length; i++) {
    if (currentParams.route[i].toLowerCase() !== simulation.route[i].toLowerCase()) return false;
  }

  if (simulation.slippageBps === undefined || currentParams.slippageBps === undefined || currentParams.slippageBps !== simulation.slippageBps) return false;

  if (simulation.sequenceNumber === undefined || currentParams.sequenceNumber === undefined) return false;
  if (String(currentParams.sequenceNumber) !== String(simulation.sequenceNumber)) return false;

  if (simulation.fee === undefined || currentParams.fee === undefined || currentParams.fee !== simulation.fee) return false;

  return true;
}

export function isHighRiskExecution(action?: string, riskScore?: number): boolean {
  const tradeActions = new Set(["reduce_exposure", "swap_to_stable", "prepare_transaction"]);

  return tradeActions.has(action ?? "") && (riskScore ?? 0) >= 50;
}

export function hashCalldata(calldata: string): string {
  let hash = 5381;
  for (let i = 0; i < calldata.length; i++) {
    hash = (hash * 33) ^ calldata.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
