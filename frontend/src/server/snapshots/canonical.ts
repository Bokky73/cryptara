import { createHash } from "node:crypto";
import { canonicalizeJson } from "@/lib/snapshots/canonicalJson";
import { normalizeCanonicalId, normalizeRiskSnapshotShape } from "@/lib/snapshots/normalizeRiskSnapshot";
import {
  parseRiskSnapshotDocument,
  type RiskSnapshotAsset,
  type RiskSnapshotDocument,
} from "./schema";

export { canonicalizeJson } from "@/lib/snapshots/canonicalJson";

export function canonicalAssetIdentity(asset: RiskSnapshotAsset): string {
  const network = asset.network.trim().toLowerCase();
  const { identity } = asset;
  const canonicalId = normalizeCanonicalId(asset);

  return `${asset.chainFamily}:${network}:${identity.kind}:${canonicalId}`;
}

export function normalizeRiskSnapshotDocument(value: unknown): RiskSnapshotDocument {
  return parseRiskSnapshotDocument(normalizeRiskSnapshotShape(parseRiskSnapshotDocument(value)));
}

export function hashRiskSnapshot(value: unknown): string {
  const canonical = canonicalizeJson(normalizeRiskSnapshotDocument(value));
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}
