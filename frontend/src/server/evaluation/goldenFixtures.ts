export const goldenFixtureSuite = [
  "blue_chip_clean_token",
  "verified_stablecoin",
  "honeypot",
  "cannot_sell",
  "low_liquidity",
  "fake_official_social",
  "phishing_claim",
  "symbol_collision",
  "provider_unavailable",
  "conflicting_sources",
  // Discovery fixtures
  "dexscreener_new_pair",
  "stellar_new_asset",
  "dedup_collapse_duplicates",
  "polling_resume_after_restart",
  "provider_outage_backoff",
  "stale_cursor_freshness",
  "stellar_xlm",
  "stellar_known_classic",
  "stellar_restricted_asset",
  "stellar_sac",
  "stellar_sep41",
  "stellar_invalid_issuer",
  "stellar_unknown_contract",
  "stellar_unavailable_provider",
  // EVM L2 edge cases
  "evm_l2_optimism_clean",
  "evm_l2_arbitrum_bridged",
  "evm_l2_base_honeypot",
  "evm_l2_polygon_low_liquidity",
  // Stellar classic / Soroban edge cases
  "stellar_classic_anchored_asset",
  "stellar_classic_revoked_issuer",
  "stellar_soroban_clean_contract",
  "stellar_soroban_honeypot_contract",
] as const;

export type GoldenFixtureName = (typeof goldenFixtureSuite)[number];

/** Versioned, non-secret identities used by the offline replay check. */
export const goldenTranscriptSet = [
  { name: "evm_clean_wallet", chainFamily: "evm" as const, network: "testnet", asset: "USDC" },
  { name: "stellar_clean_wallet", chainFamily: "stellar" as const, network: "stellar-testnet", asset: "XLM" },
] as const;

export const goldenScoreSnapshots: Record<GoldenFixtureName, { min: number; max: number; criticalNeverDowngrade?: boolean }> = {
  blue_chip_clean_token: { min: 0, max: 35 },
  verified_stablecoin: { min: 0, max: 25 },
  honeypot: { min: 75, max: 100, criticalNeverDowngrade: true },
  cannot_sell: { min: 75, max: 100, criticalNeverDowngrade: true },
  low_liquidity: { min: 50, max: 90 },
  fake_official_social: { min: 50, max: 100 },
  phishing_claim: { min: 75, max: 100, criticalNeverDowngrade: true },
  symbol_collision: { min: 40, max: 85 },
  provider_unavailable: { min: 40, max: 80 },
  conflicting_sources: { min: 50, max: 95 },
  // Discovery fixtures — these are boundary tests, not score assertions
  dexscreener_new_pair: { min: 0, max: 100 },
  stellar_new_asset: { min: 0, max: 100 },
  dedup_collapse_duplicates: { min: 0, max: 100 },
  polling_resume_after_restart: { min: 0, max: 100 },
  provider_outage_backoff: { min: 0, max: 100 },
  stale_cursor_freshness: { min: 0, max: 100 },
  stellar_xlm: { min: 0, max: 35 },
  stellar_known_classic: { min: 0, max: 25 },
  stellar_restricted_asset: { min: 25, max: 49 },
  stellar_sac: { min: 0, max: 25 },
  stellar_sep41: { min: 25, max: 55 },
  stellar_invalid_issuer: { min: 50, max: 90 },
  stellar_unknown_contract: { min: 50, max: 90 },
  stellar_unavailable_provider: { min: 50, max: 90 },
  // EVM L2 edge cases
  evm_l2_optimism_clean: { min: 0, max: 35 },
  evm_l2_arbitrum_bridged: { min: 0, max: 45 },
  evm_l2_base_honeypot: { min: 75, max: 100, criticalNeverDowngrade: true },
  evm_l2_polygon_low_liquidity: { min: 50, max: 90 },
  // Stellar classic / Soroban edge cases
  stellar_classic_anchored_asset: { min: 0, max: 35 },
  stellar_classic_revoked_issuer: { min: 50, max: 90 },
  stellar_soroban_clean_contract: { min: 0, max: 35 },
  stellar_soroban_honeypot_contract: { min: 75, max: 100, criticalNeverDowngrade: true },
};

export function assertGoldenScore(name: GoldenFixtureName, score: number) {
  const snapshot = goldenScoreSnapshots[name];

  return score >= snapshot.min && score <= snapshot.max;
}
