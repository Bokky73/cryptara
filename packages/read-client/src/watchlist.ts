import { array, number, oneOf, optional, record, shape, text } from "./validation.js";
import type { Transport } from "./transport.js";
import type { ReadOptions, WalletQuery } from "./types.js";

const classification = ["watch", "risky", "scam", "early_opportunity"] as const;
const scanStatus = ["completed", "partial", "failed", "stale"] as const;
const assetType = ["native", "classic", "contract", "issuer_account", "sac", "sep41"] as const;
const sources = ["dexscreener", "stellar_market", "manual", "manual_watchlist"] as const;

export const watchlistEntrySchema = shape({
  id: text, walletAddress: text, identityKey: text, chain: text, source: oneOf(sources), createdAt: text,
  network: optional(text), assetKey: optional(text), issuer: optional(text), contractAddress: optional(text),
  pairAddress: optional(text), symbol: optional(text), tokenName: optional(text), note: optional(text),
  assetType: optional(oneOf(assetType)),
  lastScannedAt: optional(text), latestScanRunId: optional(text),
  latestClassification: optional(oneOf(classification)),
  latestScore: optional(number),
  latestStatus: optional(oneOf(scanStatus)),
  successfulScanRunIds: optional(array(text)),
});

export const watchlistSchema = shape({ entries: array(watchlistEntrySchema) });
export type Watchlist = ReturnType<typeof watchlistSchema>;
export type WatchlistEntry = Watchlist["entries"][number];

/** Shared contract for the scan metadata the watchlist UI renders beside an entry. */
export const watchlistScanRunSchema = shape({
  id: text, entryId: text, walletAddress: text, identityKey: text,
  classification: oneOf(classification), classificationReasons: array(text),
  confidence: number, score: number, scannedAt: text, status: oneOf(scanStatus),
  agentRunId: optional(text), previousRunId: optional(text),
  riskReport: optional(record), sourceLineage: optional(array(record)), missingData: optional(array(record)),
});
export type WatchlistScanRun = ReturnType<typeof watchlistScanRunSchema>;

/**
 * Creates the watchlist resource client.
 *
 * @param get Transport function.
 * @returns Object exposing watchlist query methods.
 */
export const watchlistClient = (get: Transport) => ({ list: (query: Partial<WalletQuery> = {}, options?: ReadOptions) => get("/api/watchlist", query, watchlistSchema, options) });
