import { array, boolean, nullable, number, optional, record as objectRecord, shape, text } from "./validation.js";
import type { Transport } from "./transport.js";
import type { ReadOptions, WalletQuery } from "./types.js";
import { ReadClientError } from "./errors.js";
export const transactionSchema = shape({ hash: text, type: text, asset: text, valueUsd: number, status: text, lifecycleStatus: text,
  chainFamily: text, network: text, createdAt: text, walletAddress: optional(text), events: array(objectRecord), observations: array(objectRecord),
  stellarDetails: optional(shape({ sequence: optional(text), feeCharged: optional(number), operationCount: optional(number), ledger: optional(number) })),
  finality: shape({ confirmations: number, required: number, reached: boolean }) });
export const historySchema = shape({ items: array(transactionSchema), total: number, nextCursor: optional(text) });
export type TransactionPage = ReturnType<typeof historySchema>;

/** Provider signal rendered by the source snapshot list. Nullable metrics survive the wire as-is. */
export const sourceSnapshotSchema = shape({
  agent: text, label: text, status: text,
  reliability: optional(nullable(number)), latencyMs: optional(nullable(number)),
  checkedAt: optional(text), url: optional(text), error: optional(text), detail: optional(text),
});
export type SourceSnapshot = ReturnType<typeof sourceSnapshotSchema>;

/** Detail response for a single agent run, including its immutable source snapshots. */
export const agentRunDetailSchema = shape({
  record: objectRecord,
  decisionDetail: optional(nullable(objectRecord)),
  sourceSnapshots: optional(nullable(array(sourceSnapshotSchema))),
});
export type AgentRunDetail = ReturnType<typeof agentRunDetailSchema>;

/**
 * Creates the transaction history resource client.
 *
 * @param get Transport function.
 * @returns Object exposing paginated transaction history and agent run queries.
 */
export const historyClient = (get: Transport) => ({
  transactions: (query: Partial<WalletQuery> & { cursor?: string; limit?: number } = {}, options?: ReadOptions) => {
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200)) throw new ReadClientError("configuration", "History limit must be an integer from 1 to 200.");
    return get("/api/history/transactions", query, historySchema, options);
  },
  agentRun: (id: string, options?: ReadOptions) => {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new ReadClientError("configuration", "Invalid agent run ID.");
    return get(`/api/history/agent-runs/${encodeURIComponent(id)}`, {}, agentRunDetailSchema, options);
  },
});
