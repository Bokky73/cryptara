import { createHash } from "node:crypto";
import { canonicalJson } from "@/server/evaluation/harness/determinism";

export type CacheKeyInput = {
  chainFamily: "evm" | "stellar";
  network: string;
  walletAddress?: string;
  resource: string;
  params?: Record<string, unknown>;
};

export function createCacheKey(input: CacheKeyInput): string {
  return `gr:${input.chainFamily}:${input.network.trim().toLowerCase()}:${input.walletAddress?.trim().toLowerCase() || "anonymous"}:${input.resource}:${canonicalJson(input.params ?? {})}`;
}

export function portfolioCacheKey(input: Omit<CacheKeyInput, "resource">) {
  return createCacheKey({ ...input, resource: "portfolio" });
}

export function walletCacheTag(walletAddress: string) {
  return `wallet:${walletAddress.trim().toLowerCase()}`;
}

export function resourceCacheTag(resource: string) {
  return `resource:${resource}`;
}

/** Stable identifier used by both the risk route and the registry relay. */
export function riskRecordAssetId(network: string, assetKey: string) {
  return createHash("sha256").update(`${network}:${assetKey}`).digest("hex");
}

export function stellarRiskCacheTag(network: string, assetKeyOrId: string) {
  const assetId = /^[a-f0-9]{64}$/i.test(assetKeyOrId)
    ? assetKeyOrId.toLowerCase()
    : riskRecordAssetId(network, assetKeyOrId);
  return `stellar:risk:${network}:${assetId}`;
}

export function ruleCacheTag(walletAddress: string) {
  return `rules:${walletAddress.trim().toLowerCase()}`;
}

export const RISK_REGISTRY_CACHE_TAG = resourceCacheTag("risk-registry");
export const RULES_CACHE_TAG = resourceCacheTag("rules");
