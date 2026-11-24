/**
 * Deterministic field normalization shared by server hashing and the
 * in-browser verifier. Validation stays server-side (zod schema); this module
 * only applies the transformations that change the canonical hash preimage.
 */

import type { RiskSnapshotAsset, RiskSnapshotDocument } from "@/server/snapshots/schema";
import { canonicalizeJson, compareCodePoints, normalizeJson } from "./canonicalJson";

export function normalizeCanonicalId(asset: RiskSnapshotAsset): string {
  const canonicalId = asset.identity.canonicalId.trim();
  if (asset.identity.kind === "evm_contract") return canonicalId.toLowerCase();
  if (asset.identity.kind.startsWith("stellar_") || asset.identity.kind === "soroban_contract") return canonicalId.toUpperCase();
  return canonicalId.toUpperCase();
}

/** Apply the same ordering/casing normalization as `hashRiskSnapshot`. */
export function normalizeRiskSnapshotShape<T extends RiskSnapshotDocument>(parsed: T): T {
  const evidence = [...parsed.evidence]
    .map((item) => ({ ...item, label: item.label.normalize("NFC") }))
    .sort((left, right) => compareCodePoints(
      `${left.label}\u0000${left.url ?? ""}\u0000${left.checkedAt ?? ""}`,
      `${right.label}\u0000${right.url ?? ""}\u0000${right.checkedAt ?? ""}`,
    ));
  const missingData = [...parsed.missingData].sort((left, right) =>
    compareCodePoints(`${left.field}\u0000${left.impact}`, `${right.field}\u0000${right.impact}`));
  const sourceCheckedAt = [...new Set(parsed.freshness.sourceCheckedAt)].sort(compareCodePoints);

  return normalizeJson({
    ...parsed,
    asset: {
      ...parsed.asset,
      network: parsed.asset.network.trim().toLowerCase(),
      identity: {
        ...parsed.asset.identity,
        canonicalId: normalizeCanonicalId(parsed.asset),
        contractAddress: parsed.asset.identity.kind === "evm_contract"
          ? parsed.asset.identity.contractAddress?.toLowerCase()
          : parsed.asset.identity.contractAddress?.toUpperCase(),
        assetCode: parsed.asset.identity.assetCode?.toUpperCase(),
        issuer: parsed.asset.identity.issuer?.toUpperCase(),
      },
      symbol: parsed.asset.symbol.toUpperCase(),
    },
    evidence,
    missingData,
    freshness: { ...parsed.freshness, sourceCheckedAt },
  }) as T;
}

/** Canonical JSON text for a snapshot document, on either runtime. */
export function canonicalSnapshotJson(value: RiskSnapshotDocument): string {
  return canonicalizeJson(normalizeRiskSnapshotShape(value));
}
