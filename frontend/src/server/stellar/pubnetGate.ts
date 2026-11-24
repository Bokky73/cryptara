import "server-only";

import { rpc } from "@stellar/stellar-sdk";
import { stellarNetworks, getStellarRpcUrls } from "@/lib/stellar/config";
import { getApprovedPubnetConfig, isPubnetRequested, missingApprovedValues } from "@/server/stellar/config";
import { checkContractIdentity, type WasmHashReader } from "@/server/stellar/checks/contractIdentity";
import { checkGovernanceAddresses } from "@/server/stellar/checks/governanceAddresses";
import { checkPaymentConfig } from "@/server/stellar/checks/paymentConfig";
import { checkRpcIndependence, type LedgerReader } from "@/server/stellar/checks/rpcIndependence";
import { errored, type PubnetCheckResult, type PubnetFailureReason } from "@/server/stellar/checks/types";

/**
 * The pubnet readiness gate.
 *
 * Turns mainnet readiness from a documented checklist into something the
 * runtime enforces. The gate fails closed by construction: `ready` is true only
 * when every check returned "pass", so a new check that nobody wired up, a
 * provider outage, or an exception all block pubnet rather than being treated
 * as satisfied.
 *
 * Testnet is untouched. When pubnet is not requested the gate reports that and
 * runs nothing.
 */

export interface PubnetReadiness {
  /** True only when pubnet is requested and every check passed. */
  ready: boolean;
  /** True when the deployment is asking for pubnet at all. */
  requested: boolean;
  checks: PubnetCheckResult[];
  /** The first blocking reason, for callers that refuse an action. */
  blockedBy?: PubnetFailureReason;
  evaluatedAt: string;
}

export interface PubnetGateDependencies {
  readWasmHash: WasmHashReader;
  readLedger: LedgerReader;
}

/**
 * Hard startup invariants for pubnet write flows.
 *
 * These are the conditions that must hold before any pubnet write is even
 * considered. They are checked ahead of the on-chain probes so a deployment
 * that is misconfigured (testnet passphrase, unverified contract IDs, a server
 * that can sign, or non-persistent storage) fails fast with a specific reason
 * instead of reaching the network.
 */
export interface PubnetWriteInvariants {
  /** True only when every invariant holds. */
  ok: boolean;
  /** The first violated invariant, for callers that refuse an action. */
  blockedBy?: PubnetFailureReason;
  /** Human-readable detail for the first violation. */
  detail?: string;
}

const TESTNET_PASSPHRASE_MARKERS = ["testnet", "test network", "test sdf"];

function looksLikeTestnetPassphrase(passphrase: string | undefined | null): boolean {
  if (!passphrase) return false;
  const normalized = passphrase.toLowerCase();
  return TESTNET_PASSPHRASE_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * Evaluates the hard startup invariants for pubnet write flows.
 *
 * Fails closed: any missing or ambiguous value is treated as a violation. The
 * checks are pure and synchronous so they can run at startup and in tests
 * without touching the network.
 */
export function evaluatePubnetWriteInvariants(): PubnetWriteInvariants {
  const approved = getApprovedPubnetConfig();

  // 1. Contract IDs must be present and verified (non-testnet).
  const missing = missingApprovedValues(approved);
  if (missing.length > 0) {
    return {
      ok: false,
      blockedBy: "approved_config_missing",
      detail: `Missing approved pubnet values: ${missing.join(", ")}.`,
    };
  }

  // 2. A testnet passphrase in live pubnet mode is a misconfiguration.
  if (looksLikeTestnetPassphrase(approved.networkPassphrase)) {
    return {
      ok: false,
      blockedBy: "network_mismatch",
      detail: "A testnet network passphrase is configured while pubnet is requested.",
    };
  }

  // 3. The server must never be able to sign pubnet transactions.
  if (approved.serverCanSign !== false) {
    return {
      ok: false,
      blockedBy: "server_can_sign",
      detail: "serverCanSign must be false for pubnet write flows.",
    };
  }

  // 4. Persistent storage must be healthy before writes are allowed.
  if (approved.persistentStorageHealthy !== true) {
    return {
      ok: false,
      blockedBy: "storage_unhealthy",
      detail: "Persistent storage must be healthy for pubnet write flows.",
    };
  }

  return { ok: true };
}

const PROBE_TIMEOUT_MS = 8_000;

/** Reads a contract's WASM hash from pubnet. Returns null when unreadable. */
export const readPubnetWasmHash: WasmHashReader = async (contractId) => {
  const [rpcUrl] = getStellarRpcUrls(stellarNetworks["stellar-pubnet"]);
  if (!rpcUrl) return null;

  try {
    const server = new rpc.Server(rpcUrl, { timeout: PROBE_TIMEOUT_MS / 1_000 });
    const contract = await server.getContractData(
      contractId,
      rpc.Durability.Persistent as never,
    ).catch(() => null);

    // Different SDK minors expose the executable hash in different shapes, so
    // the value is located defensively. Anything unrecognised reads as
    // unverified, which blocks pubnet.
    const raw = contract as unknown as Record<string, unknown> | null;
    const hash =
      (raw?.wasmHash as string | undefined) ??
      ((raw?.val as Record<string, unknown> | undefined)?.wasmHash as string | undefined);

    return typeof hash === "string" && hash ? hash : null;
  } catch {
    return null;
  }
};

/** Reads a provider's latest ledger height. Returns null when unreachable. */
export const readPubnetLedger: LedgerReader = async (rpcUrl) => {
  try {
    const server = new rpc.Server(rpcUrl, { timeout: PROBE_TIMEOUT_MS / 1_000 });
    const latest = await server.getLatestLedger();
    return typeof latest?.sequence === "number" ? latest.sequence : null;
  } catch {
    return null;
  }
};

const defaultDependencies: PubnetGateDependencies = {
  readWasmHash: readPubnetWasmHash,
  readLedger: readPubnetLedger,
};

/**
 * Evaluates every readiness condition.
 *
 * Each check is isolated: one throwing produces an `error` result for that
 * check rather than losing the other four, because an operator needs the whole
 * picture to fix a deployment, not just the first thing that broke.
 */
export async function evaluatePubnetReadiness(
  dependencies: PubnetGateDependencies = defaultDependencies,
): Promise<PubnetReadiness> {
  const evaluatedAt = new Date().toISOString();
  const requested = isPubnetRequested();

  if (!requested) {
    return { ready: false, requested: false, checks: [], evaluatedAt };
  }

  // Hard startup invariants run first so a misconfigured deployment fails fast
  // without reaching the network probes.
  const invariants = evaluatePubnetWriteInvariants();
  if (!invariants.ok) {
    return {
      ready: false,
      requested,
      checks: [],
      blockedBy: invariants.blockedBy ?? "approved_config_missing",
      evaluatedAt,
    };
  }

  const approved = getApprovedPubnetConfig();
  const missing = missingApprovedValues(approved);

  const settled = await Promise.all([
    isolate("contract_identity", "Contract identity on chain", () =>
      checkContractIdentity(dependencies.readWasmHash, approved),
    ),
    isolate("payment_config", "x402 pubnet payment configuration", async () =>
      checkPaymentConfig(approved),
    ),
    isolate("rpc_independence", "RPC provider independence", () =>
      checkRpcIndependence(dependencies.readLedger, approved),
    ),
    isolate("governance_addresses", "Governance-approved addresses", async () =>
      checkGovernanceAddresses(approved),
    ),
  ]);

  const ready = settled.every((check) => check.status === "pass");
  const blocked = settled.find((check) => check.status !== "pass");

  return {
    ready,
    requested,
    checks: settled,
    blockedBy: ready ? undefined : (blocked?.reason ?? (missing.length ? "approved_config_missing" : "check_errored")),
    evaluatedAt,
  };
}

async function isolate(
  id: PubnetCheckResult["id"],
  title: string,
  run: () => Promise<PubnetCheckResult>,
): Promise<PubnetCheckResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return errored(id, title, `The check could not complete: ${message}`);
  }
}

/** True only when pubnet may be advertised to clients. */
export async function isPubnetAdvertised(
  dependencies: PubnetGateDependencies = defaultDependencies,
): Promise<boolean> {
  return (await evaluatePubnetReadiness(dependencies)).ready;
}

export class PubnetGatedError extends Error {
  readonly reason: PubnetFailureReason;
  readonly checks: PubnetCheckResult[];

  constructor(readiness: PubnetReadiness) {
    const blocking = readiness.checks.find((check) => check.status !== "pass");
    super(
      readiness.requested
        ? `Stellar pubnet is gated: ${blocking?.detail ?? "readiness could not be established."}`
        : "Stellar pubnet is not enabled for this deployment.",
    );
    this.name = "PubnetGatedError";
    this.reason = readiness.blockedBy ?? "check_errored";
    this.checks = readiness.checks;
  }
}

/**
 * Refuses a pubnet action unless every condition is satisfied.
 *
 * Callers get a typed reason rather than a generic failure, so the refusal can
 * be surfaced to an operator as the specific thing to fix.
 */
export async function assertPubnetAllowed(
  dependencies: PubnetGateDependencies = defaultDependencies,
): Promise<void> {
  const readiness = await evaluatePubnetReadiness(dependencies);
  if (!readiness.ready) throw new PubnetGatedError(readiness);
}

/** Non-secret summary for the health response and the operations page. */
export function summarizeReadiness(readiness: PubnetReadiness) {
  return {
    requested: readiness.requested,
    ready: readiness.ready,
    blockedBy: readiness.blockedBy ?? null,
    evaluatedAt: readiness.evaluatedAt,
    checks: readiness.checks.map((check) => ({
      id: check.id,
      title: check.title,
      status: check.status,
      reason: check.reason ?? null,
      detail: check.detail,
      observed: check.observed ?? null,
    })),
  };
}
