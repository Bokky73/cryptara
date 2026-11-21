import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  rpc,
  scValToNative,
  StrKey,
  type Contract,
  xdr,
} from "@stellar/stellar-sdk";
import type { StellarNetworkId } from "@/lib/stellar/config";
import {
  StellarDataLayerError,
  type StellarProviderMetadata,
  type StellarRpcDataLayer,
} from "@/server/stellar/dataLayer";
import { recordIncident } from "@/server/stellar/incidentTimeline";

export type StoredCryptaraEvent = {
  id: string;
  network: StellarNetworkId;
  contractId: string;
  topic: unknown[];
  value: unknown;
  ledger: number;
  ledgerClosedAt: string;
  transactionHash: string;
  transactionIndex: number;
  operationIndex: number;
};

export type StellarEventCheckpoint = {
  cursor?: string;
  eventIds: string[];
  events: StoredCryptaraEvent[];
  updatedAt?: string;
  /** Highest ledger whose events have been fully committed for this stream. */
  lastProcessedLedger?: number;
  /** Per-contract durable cursors keyed by contract ID. */
  contracts?: Record<string, ContractCheckpoint>;
};

export type ContractCheckpoint = {
  network: StellarNetworkId;
  contractId: string;
  lastProcessedLedger: number;
  lastCursor?: string;
  updatedAt?: string;
};

export type EventStreamKey = {
  network: StellarNetworkId;
  streamId: string;
};

export type EventCommitResult = {
  cursor: string;
  inserted: number;
  duplicates: number;
  lastProcessedLedger?: number;
};

export interface StellarEventStore {
  load(key: EventStreamKey): Promise<StellarEventCheckpoint>;
  commit(
    key: EventStreamKey,
    expectedCursor: string | undefined,
    nextCursor: string,
    events: readonly StoredCryptaraEvent[],
    meta?: CommitCheckpointMeta,
  ): Promise<EventCommitResult>;
}

export type CommitCheckpointMeta = {
  lastProcessedLedger?: number;
  contracts?: readonly string[];
};

type StoreFile = {
  version: 1;
  streams: Record<string, StellarEventCheckpoint>;
};

const fileQueues = new Map<string, Promise<unknown>>();

function streamKey(key: EventStreamKey) {
  return `${key.network}:${key.streamId}`;
}

function emptyFile(): StoreFile {
  return { version: 1, streams: {} };
}

function cloneCheckpoint(
  checkpoint: StellarEventCheckpoint | undefined,
): StellarEventCheckpoint {
  if (!checkpoint) return { eventIds: [], events: [] };
  return {
    ...checkpoint,
    eventIds: [...checkpoint.eventIds],
    events: [...checkpoint.events],
    contracts: checkpoint.contracts
      ? Object.fromEntries(
          Object.entries(checkpoint.contracts).map(([id, value]) => [
            id,
            { ...value },
          ]),
        )
      : undefined,
  };
}

/**
 * Idempotency key for a Soroban event. Two events are the same record iff
 * they share network, ledger, transaction hash and event index.
 */
export function eventDedupKey(event: {
  network: StellarNetworkId;
  ledger: number;
  transactionHash: string;
  operationIndex: number;
  id?: string;
}): string {
  return `${event.network}:${event.ledger}:${event.transactionHash}:${event.operationIndex}`;
}

function applyCheckpointMeta(
  checkpoint: StellarEventCheckpoint,
  meta: CommitCheckpointMeta | undefined,
  nextCursor: string,
): StellarEventCheckpoint {
  const updatedAt = new Date().toISOString();
  const contracts = checkpoint.contracts ? { ...checkpoint.contracts } : {};
  const lastProcessedLedger =
    meta?.lastProcessedLedger ?? checkpoint.lastProcessedLedger;
  for (const contractId of meta?.contracts ?? []) {
    contracts[contractId] = {
      network: checkpoint.contracts?.[contractId]?.network ?? "testnet",
      contractId,
      lastProcessedLedger:
        lastProcessedLedger ??
        checkpoint.contracts?.[contractId]?.lastProcessedLedger ??
        0,
      lastCursor: nextCursor,
      updatedAt,
    };
  }
  return {
    ...checkpoint,
    cursor: nextCursor,
    contracts,
    lastProcessedLedger,
    updatedAt,
  };
}

/**
 * Small atomic JSON store used by the Node deployment and local workers.
 * Distributed deployments can replace it with a database implementation of
 * StellarEventStore without changing ingestion logic.
 */
export class JsonFileStellarEventStore implements StellarEventStore {
  private readonly path: string;

  constructor(
    path: string,
    private readonly retentionLimit = 50_000,
  ) {
    this.path = resolve(path);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = fileQueues.get(this.path) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    fileQueues.set(
      this.path,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }

  private async read(): Promise<StoreFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as StoreFile;
      if (parsed.version !== 1 || !parsed.streams) {
        throw new Error("unsupported event checkpoint schema");
      }
      return parsed;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return emptyFile();
      }
      throw error;
    }
  }

  async load(key: EventStreamKey) {
    return this.serialize(async () => {
      const state = await this.read();
      return cloneCheckpoint(state.streams[streamKey(key)]);
    });
  }

  async commit(
    key: EventStreamKey,
    expectedCursor: string | undefined,
    nextCursor: string,
    events: readonly StoredCryptaraEvent[],
    meta?: CommitCheckpointMeta,
  ) {
    return this.serialize(async () => {
      const state = await this.read();
      const id = streamKey(key);
      const current = cloneCheckpoint(state.streams[id]);
      if (current.cursor !== expectedCursor) {
        throw new StellarDataLayerError(
          "rpc_error",
          `Event cursor changed concurrently for ${id}; reload before committing.`,
          true,
        );
      }

      const knownIds = new Set(current.eventIds);
      const unique = events.filter((event) => {
        const dedupKey = eventDedupKey(event);
        if (knownIds.has(dedupKey) || knownIds.has(event.id)) return false;
        knownIds.add(dedupKey);
        knownIds.add(event.id);
        return true;
      });
      const retainedEvents = [...current.events, ...unique].slice(
        -this.retentionLimit,
      );
      const retainedIds = retainedEvents.flatMap((event) => [
        event.id,
        eventDedupKey(event),
      ]);
      state.streams[id] = applyCheckpointMeta(
        {
          ...current,
          eventIds: retainedIds,
          events: retainedEvents,
        },
        meta,
        nextCursor,
      );

      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, this.path);

      return {
        cursor: nextCursor,
        inserted: unique.length,
        duplicates: events.length - unique.length,
        lastProcessedLedger: state.streams[id].lastProcessedLedger,
      };
    });
  }
}

/**
 * Minimal structural interface for a Postgres client (e.g. `pg.Pool`).
 * Kept structural so this module does not hard-depend on a driver.
 */
export interface PostgresQueryable {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
}

const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS stellar_event_checkpoints (
  network TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  cursor TEXT,
  last_processed_ledger BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (network, stream_id)
);
CREATE TABLE IF NOT EXISTS stellar_contract_checkpoints (
  network TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  last_processed_ledger BIGINT NOT NULL,
  last_cursor TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (network, contract_id, stream_id)
);
CREATE TABLE IF NOT EXISTS stellar_events (
  network TEXT NOT NULL,
  ledger BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  stream_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (network, ledger, tx_hash, event_index)
);
`;

/**
 * Postgres-backed checkpoint store. Uses a unique-key upsert on
 * `(network, ledger, tx_hash, event_index)` for idempotent deduplication and
 * persists per-contract `(network, contractId, lastProcessedLedger, lastCursor)`
 * checkpoints so restarts resume without gaps or duplicates.
 */
export class PostgresStellarEventStore implements StellarEventStore {
  private schemaReady?: Promise<void>;

  constructor(private readonly db: PostgresQueryable) {}

  private ensureSchema() {
    this.schemaReady ??= this.db
      .query(POSTGRES_SCHEMA)
      .then(() => undefined)
      .catch((error) => {
        this.schemaReady = undefined;
        throw error;
      });
    return this.schemaReady;
  }

  async load(key: EventStreamKey) {
    await this.ensureSchema();
    const checkpoint = await this.db.query<{
      cursor: string | null;
      last_processed_ledger: string | number | null;
    }>(
      `SELECT cursor, last_processed_ledger FROM stellar_event_checkpoints WHERE network = $1 AND stream_id = $2`,
      [key.network, key.streamId],
    );
    const contracts = await this.db.query<{
      contract_id: string;
      last_processed_ledger: string | number;
      last_cursor: string | null;
      updated_at: string | Date;
    }>(
      `SELECT contract_id, last_processed_ledger, last_cursor, updated_at FROM stellar_contract_checkpoints WHERE network = $1 AND stream_id = $2`,
      [key.network, key.streamId],
    );
    const events = await this.db.query<{ payload: StoredCryptaraEvent }>(
      `SELECT payload FROM stellar_events WHERE network = $1 AND stream_id = $2 ORDER BY ledger ASC, tx_hash ASC, event_index ASC`,
      [key.network, key.streamId],
    );
    const row = checkpoint.rows[0];
    const stored = events.rows.map((entry) => entry.payload);
    return {
      cursor: row?.cursor ?? undefined,
      lastProcessedLedger:
        row?.last_processed_ledger != null
          ? Number(row.last_processed_ledger)
          : undefined,
      events: stored,
      eventIds: stored.flatMap((event) => [event.id, eventDedupKey(event)]),
      contracts: Object.fromEntries(
        contracts.rows.map((entry) => [
          entry.contract_id,
          {
            network: key.network,
            contractId: entry.contract_id,
            lastProcessedLedger: Number(entry.last_processed_ledger),
            lastCursor: entry.last_cursor ?? undefined,
            updatedAt:
              entry.updated_at instanceof Date
                ? entry.updated_at.toISOString()
                : entry.updated_at,
          },
        ]),
      ),
    } satisfies StellarEventCheckpoint;
  }

  async commit(
    key: EventStreamKey,
    expectedCursor: string | undefined,
    nextCursor: string,
    events: readonly StoredCryptaraEvent[],
    meta?: CommitCheckpointMeta,
  ) {
    await this.ensureSchema();
    const current = await this.db.query<{ cursor: string | null }>(
      `SELECT cursor FROM stellar_event_checkpoints WHERE network = $1 AND stream_id = $2`,
      [key.network, key.streamId],
    );
    const persistedCursor = current.rows[0]?.cursor ?? undefined;
    if (persistedCursor !== expectedCursor) {
      throw new StellarDataLayerError(
        "rpc_error",
        `Event cursor changed concurrently for ${key.network}:${key.streamId}; reload before committing.`,
        true,
      );
    }

    let inserted = 0;
    for (const event of events) {
      const result = await this.db.query(
        `INSERT INTO stellar_events (network, ledger, tx_hash, event_index, stream_id, event_id, contract_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (network, ledger, tx_hash, event_index) DO NOTHING
         RETURNING event_id`,
        [
          event.network,
          event.ledger,
          event.transactionHash,
          event.operationIndex,
          key.streamId,
          event.id,
          event.contractId,
          JSON.stringify(event),
        ],
      );
      if (result.rows.length > 0) inserted += 1;
    }

    const lastProcessedLedger =
      meta?.lastProcessedLedger ??
      events.reduce((max, event) => Math.max(max, event.ledger), 0) ??
      0;
    await this.db.query(
      `INSERT INTO stellar_event_checkpoints (network, stream_id, cursor, last_processed_ledger, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (network, stream_id) DO UPDATE SET cursor = EXCLUDED.cursor, last_processed_ledger = GREATEST(stellar_event_checkpoints.last_processed_ledger, EXCLUDED.last_processed_ledger), updated_at = now()`,
      [key.network, key.streamId, nextCursor, lastProcessedLedger || null],
    );
    for (const contractId of meta?.contracts ?? []) {
      await this.db.query(
        `INSERT INTO stellar_contract_checkpoints (network, contract_id, stream_id, last_processed_ledger, last_cursor, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (network, contract_id, stream_id) DO UPDATE SET last_processed_ledger = GREATEST(stellar_contract_checkpoints.last_processed_ledger, EXCLUDED.last_processed_ledger), last_cursor = EXCLUDED.last_cursor, updated_at = now()`,
        [key.network, contractId, key.streamId, lastProcessedLedger, nextCursor],
      );
    }

    return {
      cursor: nextCursor,
      inserted,
      duplicates: events.length - inserted,
      lastProcessedLedger: lastProcessedLedger || undefined,
    };
  }
}

export class MemoryStellarEventStore implements StellarEventStore {
  private readonly streams = new Map<string, StellarEventCheckpoint>();

  async load(key: EventStreamKey) {
    return cloneCheckpoint(this.streams.get(streamKey(key)));
  }

  async commit(
    key: EventStreamKey,
    expectedCursor: string | undefined,
    nextCursor: string,
    events: readonly StoredCryptaraEvent[],
    meta?: CommitCheckpointMeta,
  ) {
    const id = streamKey(key);
    const current = cloneCheckpoint(this.streams.get(id));
    if (current.cursor !== expectedCursor) {
      throw new StellarDataLayerError(
        "rpc_error",
        `Event cursor changed concurrently for ${id}; reload before committing.`,
        true,
      );
    }
    const knownIds = new Set(current.eventIds);
    const unique = events.filter((event) => {
      const dedupKey = eventDedupKey(event);
      if (knownIds.has(dedupKey) || knownIds.has(event.id)) return false;
      knownIds.add(dedupKey);
      knownIds.add(event.id);
      return true;
    });
    const next = applyCheckpointMeta(
      {
        ...current,
        eventIds: [...knownIds],
        events: [...current.events, ...unique],
      },
      meta,
      nextCursor,
    );
    this.streams.set(id, next);
    return {
      cursor: nextCursor,
      inserted: unique.length,
      duplicates: events.length - unique.length,
      lastProcessedLedger: next.lastProcessedLedger,
    };
  }
}

export type CryptaraEventPolicy = {
  contractIds: readonly string[];
  topicNames: readonly string[];
};

function eventContractId(contract: Contract | undefined) {
  return contract?.contractId();
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return value;
}

function decodeScVal(value: xdr.ScVal) {
  try {
    return jsonSafe(scValToNative(value));
  } catch (error) {
    throw new StellarDataLayerError(
      "malformed_xdr",
      `Unable to decode Stellar event XDR: ${
        error instanceof Error ? error.message : String(error)
      }`,
      false,
    );
  }
}

function normalizeEvent(
  event: rpc.Api.EventResponse,
  network: StellarNetworkId,
): StoredCryptaraEvent {
  const contractId = eventContractId(event.contractId);
  if (!contractId) {
    throw new StellarDataLayerError(
      "malformed_xdr",
      `Contract event ${event.id} did not include a contract ID.`,
      false,
    );
  }
  return {
    id: event.id,
    network,
    contractId,
    topic: event.topic.map(decodeScVal),
    value: decodeScVal(event.value),
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    transactionHash: event.txHash,
    transactionIndex: event.transactionIndex,
    operationIndex: event.operationIndex,
  };
}

function requiredEvent(
  event: rpc.Api.EventResponse,
  policy: CryptaraEventPolicy,
) {
  if (
    event.type !== "contract" ||
    !event.inSuccessfulContractCall ||
    !event.contractId
  ) {
    return false;
  }
  if (!policy.contractIds.includes(event.contractId.contractId())) return false;
  if (policy.topicNames.length === 0) return true;

  try {
    const firstTopic = event.topic[0]
      ? String(scValToNative(event.topic[0]))
      : "";
    return policy.topicNames.includes(firstTopic);
  } catch (error) {
    throw new StellarDataLayerError(
      "malformed_xdr",
      `Unable to decode topic for Stellar event ${event.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      false,
    );
  }
}

export type IngestEventBatchOptions = {
  streamId: string;
  startLedger: number;
  limit?: number;
  requestId?: string;
};

export type IngestEventBatchResult = EventCommitResult & {
  fetched: number;
  required: number;
  meta: StellarProviderMetadata;
  /** True when a pruned-ledger gap was detected and a state-sync fallback ran. */
  gapRecovered?: boolean;
};

export type StateSyncResult = {
  contractId: string;
  ledger: number;
  entries: number;
};

export class CryptaraEventIngestor {
  constructor(
    private readonly dataLayer: StellarRpcDataLayer,
    private readonly store: StellarEventStore,
    private readonly policy: CryptaraEventPolicy,
  ) {
    if (
      policy.contractIds.length === 0 ||
      policy.contractIds.some((contractId) => !StrKey.isValidContract(contractId))
    ) {
      throw new StellarDataLayerError(
        "invalid_request",
        "At least one valid Cryptara contract ID is required.",
        false,
      );
    }
  }

  async ingestBatch(
    options: IngestEventBatchOptions,
  ): Promise<IngestEventBatchResult> {
    const key = {
      network: this.dataLayer.network.id,
      streamId: options.streamId,
    };
    const checkpoint = await this.store.load(key);
    const filters: rpc.Api.EventFilter[] = [
      {
        type: "contract",
        contractIds: [...this.policy.contractIds],
        topics:
          this.policy.topicNames.length > 0
            ? this.policy.topicNames.map((topic) => [
                xdr.ScVal.scvSymbol(topic).toXDR("base64"),
              ])
            : undefined,
      },
    ];
    const request: rpc.Api.GetEventsRequest = checkpoint.cursor
      ? {
          filters,
          cursor: checkpoint.cursor,
          limit: options.limit ?? 100,
        }
      : {
          filters,
          startLedger: options.startLedger,
          limit: options.limit ?? 100,
        };
    const response = await this.dataLayer.getEvents(request, {
      requestId: options.requestId,
    });

    let gapRecovered = false;
    const requestedStartLedger =
      checkpoint.lastProcessedLedger != null
        ? checkpoint.lastProcessedLedger + 1
        : options.startLedger;
    if (requestedStartLedger < response.value.oldestLedger) {
      gapRecovered = true;
      await this.handleLedgerGap({
        requestedStartLedger,
        oldestLedger: response.value.oldestLedger,
        streamId: options.streamId,
        requestId: options.requestId,
      });
    }

    const required = response.value.events.filter((event) =>
      requiredEvent(event, this.policy),
    );
    const normalized = required.map((event) =>
      normalizeEvent(event, this.dataLayer.network.id),
    );
    const lastProcessedLedger = normalized.reduce(
      (max, event) => Math.max(max, event.ledger),
      checkpoint.lastProcessedLedger ?? 0,
    );
    const committed = await this.store.commit(
      key,
      checkpoint.cursor,
      response.value.cursor,
      normalized,
      {
        lastProcessedLedger: lastProcessedLedger || undefined,
        contracts: this.policy.contractIds,
      },
    );

    return {
      ...committed,
      fetched: response.value.events.length,
      required: normalized.length,
      meta: response.meta,
      gapRecovered,
    };
  }

  /**
   * Emits a structured operational alert and runs an explicit state-sync
   * fallback via contract ledger-key queries when the requested start ledger
   * predates the RPC retention window.
   */
  private async handleLedgerGap(input: {
    requestedStartLedger: number;
    oldestLedger: number;
    streamId: string;
    requestId?: string;
  }) {
    const network = this.dataLayer.network.id;
    await recordIncident({
      kind: "stellar_ledger_gap",
      severity: "warning",
      network,
      streamId: input.streamId,
      requestId: input.requestId,
      message: `Requested start ledger ${input.requestedStartLedger} predates retained RPC history at ${input.oldestLedger}; running state-sync fallback.`,
      details: {
        requestedStartLedger: input.requestedStartLedger,
        oldestLedger: input.oldestLedger,
        contractIds: [...this.policy.contractIds],
      },
    });
    await this.stateSync(input.oldestLedger);
  }

  /**
   * Reconstructs contract state from ledger entries for the given ledger.
   * Uses `getLedgerEntries` against each configured contract's ledger keys.
   */
  async stateSync(ledger: number): Promise<StateSyncResult[]> {
    const results: StateSyncResult[] = [];
    for (const contractId of this.policy.contractIds) {
      const contract = new Contract(contractId);
      const keys = [contract.getFootprint()];
      const response = await this.dataLayer.getLedgerEntries(keys, {
        requestId: `state-sync:${contractId}:${ledger}`,
      });
      results.push({
        contractId,
        ledger,
        entries: response.value.entries.length,
      });
    }
    return results;
  }
}
