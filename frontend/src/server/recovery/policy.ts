import type { RecoveryChain, RecoveryIncidentMode, RecoveryNetworkFreshness, RecoveryRequest, RecoveryType } from "@/server/types";
import { RECOVERY_RULES_VERSION } from "@/server/types";

/**
 * Server-side gates for emergency pause / revoke / allowance / trustline
 * recovery. The module intentionally never holds wallet secrets and never
 * signs; signatures come from the connected user wallet. The execution policy
 * (in src/server/agents/execution/policy.ts) is also sourced here so the
 * prepare API and the recovery UI stay deterministic.
 */

const RECOVERY_FRESHNESS_WINDOW_MS = 15 * 60_000;
const RECOVERY_EXPIRY_WINDOW_MS = 10 * 60_000;
const INCIDENT_DEFAULT_REASON = "Global incident pause was enabled by an admin.";

declare global {
  var __cryptaraIncidentMode: RecoveryIncidentMode | undefined;
}

function ensureIncidentModeRecord(): RecoveryIncidentMode {
  globalThis.__cryptaraIncidentMode ??= {
    enabled: false,
    updatedAt: new Date(0).toISOString(),
  };

  return globalThis.__cryptaraIncidentMode;
}

export function getIncidentMode(): RecoveryIncidentMode {
  return { ...ensureIncidentModeRecord() };
}

export function isIncidentMode(): boolean {
  return ensureIncidentModeRecord().enabled;
}

/**
 * Toggle incident mode. This is an env-gated admin operation meant to be
 * triggered from a deployment owner (Vercel route guard), GitHub Action or
 * admin UI. It does not bypass the approval-only invariants: it only stops
 * new transaction preparation. Existing in-flight previews remain visible.
 */
export function setIncidentMode(enabled: boolean, options: { reason?: string; updatedBy?: string } = {}): RecoveryIncidentMode {
  const record = ensureIncidentModeRecord();

  globalThis.__cryptaraIncidentMode = {
    enabled,
    reason: options.reason ?? (enabled ? INCIDENT_DEFAULT_REASON : undefined),
    updatedBy: options.updatedBy,
    updatedAt: new Date().toISOString(),
  };

  return { ...record };
}

const EVM_TYPES: RecoveryType[] = ["pause_agent", "revoke_agent", "reduce_allowance", "revoke_allowance"];
const STELLAR_TYPES: RecoveryType[] = ["remove_trustline"];

export function expectedChainFamily(type: RecoveryType): RecoveryChain {
  if (STELLAR_TYPES.includes(type)) {
    return "stellar";
  }

  if (EVM_TYPES.includes(type)) {
    return "evm";
  }

  return "any";
}

export function assertChainFamilyMatches(type: RecoveryType, family: RecoveryChain | undefined) {
  const expected = expectedChainFamily(type);

  if (expected === "any") {
    return;
  }

  if (family !== expected) {
    throw new Error(`Recovery type ${type} expects chain family ${expected}; received ${family ?? "unknown"}.`);
  }
}

export function assertWalletMatches(recovery: { walletAddress: string }, walletAddress: string | undefined) {
  if (!walletAddress) {
    throw new Error("Connected wallet is required before submitting a recovery action.");
  }

  if (recovery.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error("Connected wallet does not match the recovery wallet.");
  }
}

export function getRecoveryFreshnessWindowMs() {
  return RECOVERY_FRESHNESS_WINDOW_MS;
}

export function getRecoveryExpiryWindowMs() {
  return RECOVERY_EXPIRY_WINDOW_MS;
}

/**
 * Mark a record as stale when its freshness window has passed without
 * promotion to `submitted` or `confirmed`. Stale records remain visible in the
 * UI but cannot be `submitted` directly — the user must re-prepare.
 */
export function applyStaleIfExpired<T extends RecoveryRequest>(record: T, now: number = Date.now()): T {
  if (record.status === "confirmed" || record.status === "failed" || record.status === "stale") {
    return record;
  }

  const lastTouched = new Date(record.updatedAt).getTime();
  const ageMs = now - lastTouched;

  if (ageMs < RECOVERY_FRESHNESS_WINDOW_MS) {
    return record;
  }

  return {
    ...record,
    status: "stale",
    staleAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: record.error ?? "Recovery record became stale before submission. Re-prepare before retrying.",
  };
}

export function getPolicyVersion() {
  return RECOVERY_RULES_VERSION;
}

/**
 * Build a default freshly-marked freshness record. The UI surfaces this on
 * every recovery card so stale data is never mistaken for live onchain truth.
 */
export function buildFreshness(family: RecoveryChain, network: string, ledger?: number, blockNumber?: number, checkedAtMs: number = Date.now()): RecoveryNetworkFreshness {
  return {
    network,
    chainFamily: family,
    ledger,
    blockNumber,
    checkedAt: new Date(checkedAtMs).toISOString(),
    freshnessSeconds: 0,
    degraded: false,
  };
}

/**
 * Compute a freshness record with degraded marker when the cached ledger is
 * older than the recovery freshness window.
 */
export function computeFreshness(base: RecoveryNetworkFreshness, now: number = Date.now()): RecoveryNetworkFreshness {
  const ageMs = Math.max(0, now - new Date(base.checkedAt).getTime());
  const freshnessSeconds = Math.round(ageMs / 1000);

  return {
    ...base,
    freshnessSeconds,
    degraded: ageMs > RECOVERY_FRESHNESS_WINDOW_MS,
  };
}

/**
 * Default consequences surfaced to the user. The UI must never hide reserve,
 * fee or asset consequences for trustline removal or ERC-20 revoke/reduce.
 */
export function getRecoveryConsequences(input: {
  recoveryType: RecoveryType;
  chainFamily: RecoveryChain;
  asset?: string;
  consumer?: string;
  stellarReserveXlm?: string;
  stellarExpectedFeeXlm?: string;
  evmExpectedFeeUsd?: string;
  isInfiniteApproval?: boolean;
  currentAllowance?: string;
  newAllowance?: string;
  issuerRevocable?: boolean;
  issuerClawback?: boolean;
}): string[] {
  const consequences: string[] = [];

  switch (input.recoveryType) {
    case "pause_agent": {
      consequences.push("Agent execution is paused for the connected wallet.");
      consequences.push("Existing in-flight previews remain valid until they expire.");
      consequences.push("No new agent prepare requests will be accepted while pause is active.");
      break;
    }
    case "revoke_agent": {
      consequences.push("The agent authorization is revoked for this wallet.");
      consequences.push("Future agent prepare calls for this wallet will be rejected.");
      break;
    }
    case "reduce_allowance": {
      consequences.push("Token allowance is reduced but not removed; you can still spend up to the reduced cap.");
      if (input.currentAllowance && input.newAllowance) {
        consequences.push(`Allowance moves from ${input.currentAllowance} to ${input.newAllowance}.`);
      }
      if (input.evmExpectedFeeUsd) {
        consequences.push(`Expected network fee is approximately ${input.evmExpectedFeeUsd} USD.`);
      }
      break;
    }
    case "revoke_allowance": {
      consequences.push("Token allowance is fully revoked; any future spend will request a new approval.");
      if (input.evmExpectedFeeUsd) {
        consequences.push(`Expected network fee is approximately ${input.evmExpectedFeeUsd} USD.`);
      }
      if (input.isInfiniteApproval) {
        consequences.push("Detected an infinite approval; the onchain revoke call always targets amount=0.");
      }
      break;
    }
    case "remove_trustline": {
      consequences.push("Stellar trustline will be removed after remaining asset balance reaches zero.");
      if (input.stellarReserveXlm) {
        consequences.push(`Releases ${input.stellarReserveXlm} XLM base reserve back to the source account.`);
      }
      if (input.stellarExpectedFeeXlm) {
        consequences.push(`Expected network fee is approximately ${input.stellarExpectedFeeXlm} XLM.`);
      }
      if (input.asset) {
        consequences.push(`Future payments of ${input.asset} to this account will fail until the trustline is re-added.`);
      }
      if (input.issuerRevocable) {
        consequences.push("Issuer retains AUTH_REVOCABLE; previously authorized balances can still be reclaimed by the issuer.");
      }
      if (input.issuerClawback) {
        consequences.push("Issuer retains AUTH_CLAWBACK; the issuer can claw back any remaining trustline balance before removal completes.");
      }
      break;
    }
    default: {
      consequences.push("Recovery action has no defined consequences yet; review before submitting.");
    }
  }

  return consequences;
}
