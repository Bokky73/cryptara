import { array, literal, number, optional, shape, text } from "./validation.js";
import { ReadClientError } from "./errors.js";
import type { Transport } from "./transport.js";
import type { ReadOptions } from "./types.js";
const documentSchema = shape({ schemaVersion: literal("1"),
  asset: shape({ chainFamily: text, network: text, symbol: text, identity: shape({ kind: text, canonicalId: text, issuer: optional(text), assetCode: optional(text), contractAddress: optional(text) }) }),
  scores: shape({ buyRisk: number, confidence: number }), verdict: text, summary: text, topReasons: array(text),
  evidence: array(shape({ label: text, status: text, checkedAt: optional(text) })), missingData: array(shape({ field: text, impact: text })),
  freshness: shape({ generatedAt: text, staleAt: text, sourceCheckedAt: array(text) }), expiresAt: text,
  product: shape({ name: literal("Cryptara"), version: text }), notices: shape({ informationOnly: literal(true), providerCorrectnessNotProven: literal(true) }) });
export const publicSnapshotSchema = shape({ id: text, schemaVersion: literal("1"), canonicalHash: text, createdAt: text, expiresAt: text, document: documentSchema });
export const snapshotSchema = shape({ snapshot: publicSnapshotSchema });
export type Snapshot = ReturnType<typeof publicSnapshotSchema>;
/**
 * Creates the public snapshot resource client.
 *
 * @param get Transport function.
 * @returns Object exposing snapshot retrieval methods.
 */
export const snapshotsClient = (get: Transport) => ({ get: (id: string, options?: ReadOptions) => {
  if (!/^snapshot_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new ReadClientError("configuration", "Invalid snapshot ID.");
  return get(`/api/snapshots/${encodeURIComponent(id)}`, {}, snapshotSchema, options);
} });
