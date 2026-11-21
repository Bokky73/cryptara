import { array, boolean, literal, nullable, number, optional, record, shape, text } from "./validation.js";
import type { Transport } from "./transport.js";
import type { ReadOptions, StellarNetwork } from "./types.js";

export const publicationSchema = shape({
  id: text,
  network: text,
  txHash: text,
  publisher: text,
  assetKey: text,
  assetLabel: text,
  score: number,
  verdict: text,
  reportHash: text,
  verified: boolean,
  hashMatch: optional(boolean),
  ledger: optional(number),
  publishedAt: text,
  createdAt: text
});

export const registryHistorySchema = shape({
  ok: literal(true),
  count: number,
  records: array(publicationSchema)
});

export const registryRecordSchema = shape({
  ok: literal(true),
  record: nullable(publicationSchema)
});

export const registryStatusSchema = shape({
  network: text,
  hash: text,
  status: text,
  ledger: optional(number),
  providerMeta: record
});

export const watcherProbeSchema = shape({
  ok: literal(true),
  registryAddress: text,
  isWatcherAuthorized: boolean,
  activeWatcherCount: number,
  readyForGatedReads: boolean
});

export type RegistryHistory = ReturnType<typeof registryHistorySchema>;
export type RegistryRecord = ReturnType<typeof registryRecordSchema>;
export type RegistryStatus = ReturnType<typeof registryStatusSchema>;
export type WatcherProbeResult = ReturnType<typeof watcherProbeSchema>;

/**
 * Creates the Stellar registry resource client.
 * Includes watcher registry readiness probe to prevent reader lockouts.
 *
 * @param get Transport function.
 * @returns Object exposing publication history, lookup, watcher probe, and transaction status methods.
 */
export const registryClient = (get: Transport) => ({
  history: (query: { network?: StellarNetwork } = {}, options?: ReadOptions) =>
    get("/api/stellar/registry/history", query, registryHistorySchema, options),
  find: (query: { network: StellarNetwork; txHash: string }, options?: ReadOptions) =>
    get("/api/stellar/registry/history", query, registryRecordSchema, options),
  status: (query: { network: StellarNetwork; hash: string }, options?: ReadOptions) =>
    get("/api/stellar/registry/status", query, registryStatusSchema, options),
  probeWatcher: (query: { network: StellarNetwork; watcherRegistry: string; sampleWatcher?: string }, options?: ReadOptions) =>
    get("/api/stellar/registry/probe-watcher", query, watcherProbeSchema, options),
});
