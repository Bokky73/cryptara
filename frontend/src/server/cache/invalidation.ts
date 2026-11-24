import { getCacheStore } from "./config";
import {
  RISK_REGISTRY_CACHE_TAG,
  RULES_CACHE_TAG,
  resourceCacheTag,
  ruleCacheTag,
  stellarRiskCacheTag,
  walletCacheTag,
} from "./keys";

/** Clear matching entries locally and broadcast the invalidation to other instances. */
export function invalidateCacheTags(tags: readonly string[]) {
  return getCacheStore().invalidateTags(tags);
}

export async function invalidateCacheTagsAsync(tags: readonly string[]) {
  const store = getCacheStore();
  return store.invalidateTagsAsync ? store.invalidateTagsAsync(tags) : store.invalidateTags(tags);
}

export function invalidateWalletCache(walletAddress: string) {
  return invalidateCacheTags([walletCacheTag(walletAddress)]);
}

export function invalidatePortfolioForWallet(walletAddress: string) {
  return invalidateCacheTags([walletCacheTag(walletAddress), resourceCacheTag("portfolio")]);
}

export function invalidateRiskRecordCache(network: string, assetKeyOrId: string) {
  return invalidateCacheTags([stellarRiskCacheTag(network, assetKeyOrId), RISK_REGISTRY_CACHE_TAG]);
}

export function invalidateRulesCache(walletAddress?: string) {
  return invalidateCacheTags(walletAddress ? [ruleCacheTag(walletAddress), RULES_CACHE_TAG] : [RULES_CACHE_TAG]);
}

export async function invalidateRiskRecordCacheAsync(network: string, assetKeyOrId: string) {
  return invalidateCacheTagsAsync([stellarRiskCacheTag(network, assetKeyOrId), RISK_REGISTRY_CACHE_TAG]);
}

export async function invalidateRulesCacheAsync(walletAddress?: string) {
  return invalidateCacheTagsAsync(walletAddress ? [ruleCacheTag(walletAddress), RULES_CACHE_TAG] : [RULES_CACHE_TAG]);
}
