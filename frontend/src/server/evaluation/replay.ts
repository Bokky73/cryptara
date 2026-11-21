import type { AgentResult } from "@/server/types";
import { diffTranscripts } from "./harness/diff";
import type { AgentRunTranscript } from "./harness/transcript";

export type ReplaySnapshot = {
  agent: AgentResult["agent"];
  sourceSnapshotHash: string;
  riskScore: number;
  recommendedAction: AgentResult["recommendedAction"];
  chainFamily?: "evm" | "stellar";
  fixtureName?: string;
  migrationNote?: string;
  evaluatedAt?: string;
};

export function createReplaySnapshot(
  result: AgentResult,
  sourceSnapshotHash: string,
  evaluatedAt?: string,
): ReplaySnapshot {
  return {
    agent: result.agent,
    sourceSnapshotHash,
    riskScore: result.riskScore,
    recommendedAction: result.recommendedAction,
    evaluatedAt,
  };
}

export function createStellarReplaySnapshot(
  result: AgentResult,
  sourceSnapshotHash: string,
  fixtureName: string,
  evaluatedAt?: string,
): ReplaySnapshot {
  return {
    agent: result.agent,
    sourceSnapshotHash,
    riskScore: result.riskScore,
    recommendedAction: result.recommendedAction,
    chainFamily: "stellar",
    fixtureName,
    evaluatedAt,
  };
}

export function compareReplaySnapshot(snapshot: ReplaySnapshot, replayed: AgentResult) {
  const compatible = snapshot.agent === replayed.agent && snapshot.recommendedAction === replayed.recommendedAction && Math.abs(snapshot.riskScore - replayed.riskScore) <= 3;

  return {
    compatible,
    migrationNote: compatible ? undefined : "Replay drift detected; attach migration note before accepting changed decision behavior.",
  };
}

export function compareReplayTranscript(expected: AgentRunTranscript, replayed: AgentRunTranscript) {
  if (expected.chainFamily !== replayed.chainFamily || expected.network !== replayed.network || expected.assetIdentity.asset !== replayed.assetIdentity.asset) {
    return { compatible: false, migrationNote: "Replay identity drift detected; chain family, network, and asset must remain bound." };
  }
  const diff = diffTranscripts(expected, replayed);
  return { compatible: diff.identical, differences: diff.differences, migrationNote: diff.identical ? undefined : "Replay drift detected; review the stage and field diff before accepting a changed baseline." };
}

/**
 * Canonicalize a replay snapshot into a stable, key-sorted JSON string.
 * Object keys are sorted recursively and undefined values are dropped so that
 * two replays of identical snapshot inputs produce byte-identical output.
 */
export function canonicalizeReplaySnapshot(snapshot: ReplaySnapshot): string {
  return JSON.stringify(sortKeys(snapshot));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) {
        sorted[key] = sortKeys(record[key]);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Stellar-specific replay snapshots registry.
 * Each entry records the expected deterministic outcome for a golden fixture.
 * Update these when the Stellar onchain agent's scoring logic intentionally changes.
 */
export const stellarReplaySnapshots: Record<string, Omit<ReplaySnapshot, "sourceSnapshotHash">> = {
  stellar_xlm: {
    agent: "onchain",
    riskScore: 6,
    recommendedAction: "hold",
    chainFamily: "stellar",
    fixtureName: "stellar_xlm",
    migrationNote: "Native XLM should be low risk with no issuer controls.",
  },
  stellar_known_classic: {
    agent: "onchain",
    riskScore: 10,
    recommendedAction: "hold",
    chainFamily: "stellar",
    fixtureName: "stellar_known_classic",
    migrationNote: "Known classic asset with clean flags and adequate liquidity should be low risk.",
  },
  stellar_restricted_asset: {
    agent: "onchain",
    riskScore: 34,
    recommendedAction: "watch",
    chainFamily: "stellar",
    fixtureName: "stellar_restricted_asset",
    migrationNote: "Restricted asset with clawback and auth flags should be medium risk.",
  },
  stellar_sac: {
    agent: "onchain",
    riskScore: 15,
    recommendedAction: "hold",
    chainFamily: "stellar",
    fixtureName: "stellar_sac",
    migrationNote: "Stellar Asset Contract with classic backing should be low risk.",
  },
  stellar_sep41: {
    agent: "onchain",
    riskScore: 32,
    recommendedAction: "watch",
    chainFamily: "stellar",
    fixtureName: "stellar_sep41",
    migrationNote: "Generic WASM contract without issuer backing should be medium risk with reduced confidence.",
  },
  stellar_invalid_issuer: {
    agent: "onchain",
    riskScore: 74,
    recommendedAction: "avoid",
    chainFamily: "stellar",
    fixtureName: "stellar_invalid_issuer",
    migrationNote: "Asset with unconfirmed issuer should be high/critical risk.",
  },
  stellar_unknown_contract: {
    agent: "onchain",
    riskScore: 75,
    recommendedAction: "avoid",
    chainFamily: "stellar",
    fixtureName: "stellar_unknown_contract",
    migrationNote: "Contract address with no deployed code should be high/critical risk.",
  },
  stellar_unavailable_provider: {
    agent: "onchain",
    riskScore: 77,
    recommendedAction: "avoid",
    chainFamily: "stellar",
    fixtureName: "stellar_unavailable_provider",
    migrationNote: "Unavailable Stellar RPC should produce high risk with reduced confidence.",
  },
};
