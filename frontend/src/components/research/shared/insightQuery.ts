export const INSIGHT_WINDOWS = ["1h", "24h", "7d", "30d", "90d"] as const;

export type InsightQueryParams = {
  asset?: string;
  network?: string;
  chainFamily?: "evm" | "stellar";
  window?: (typeof INSIGHT_WINDOWS)[number];
  /** A second asset to compare with. */
  compare?: string;
};

export type InsightQueryKey = keyof InsightQueryParams;

export const INSIGHT_QUERY_KEYS: readonly InsightQueryKey[] = ["asset", "network", "chainFamily", "window", "compare"];

/**
 * Accepted asset spellings. Deliberately narrow: a bare Stellar account or
 * secret key matches none of them, so pasting one never puts it in a shared URL.
 */
const ASSET_PATTERNS = [
  /^0x[a-f\d]{40}$/i,
  /^C[A-Z2-7]{55}$/,
  /^[A-Za-z\d]{1,12}:G[A-Z2-7]{55}$/,
  /^[A-Za-z\d.]{1,20}(?:[/-][A-Za-z\d.]{1,20})?$/,
];

const isAsset = (value: string) => ASSET_PATTERNS.some((pattern) => pattern.test(value));

const VALIDATORS: Record<InsightQueryKey, (value: string) => boolean> = {
  asset: isAsset,
  compare: isAsset,
  network: (value) => /^[a-z\d][a-z\d:-]{0,39}$/.test(value),
  chainFamily: (value) => value === "evm" || value === "stellar",
  window: (value) => (INSIGHT_WINDOWS as readonly string[]).includes(value),
};

/** The trimmed value when valid for the key, otherwise undefined. */
export function validateInsightParam(key: InsightQueryKey, value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && VALIDATORS[key](trimmed) ? trimmed : undefined;
}

/** Same search string in, same parameters out. Invalid values are dropped. */
export function parseInsightQuery(search: string): InsightQueryParams {
  const query = new URLSearchParams(search);
  const params: Partial<Record<InsightQueryKey, string>> = {};
  for (const key of INSIGHT_QUERY_KEYS) {
    const value = validateInsightParam(key, query.get(key));
    if (value) params[key] = value;
  }
  // A Stellar network name decides the family; a conflicting family is ignored.
  if (params.network?.startsWith("stellar-") && params.chainFamily === "evm") delete params.chainFamily;
  return params as InsightQueryParams;
}

/** Apply a patch, leaving parameters this module does not own untouched. */
export function patchInsightQuery(search: string, patch: Partial<Record<InsightQueryKey, string | null | undefined>>): string {
  const query = new URLSearchParams(search);
  for (const key of INSIGHT_QUERY_KEYS) {
    if (!(key in patch)) continue;
    const value = validateInsightParam(key, patch[key]);
    if (value) query.set(key, value);
    else query.delete(key);
  }
  const next = query.toString();
  return next ? `?${next}` : "";
}
