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
};

export type EventStreamKey = {
  network: StellarNetworkId;
  streamId: string;
};

export type EventCommitResult = {
  cursor: string;
  inserted: number;
  duplicates: number;
};

export interface StellarEventStore {
  load(key: EventStreamKey): Promise<StellarEventCheckpoint>;
  commit(
    key: EventStreamKey,
    expectedCursor: string | undefined,
    nextCursor: string,
    events: readonly StoredCryptaraEvent[],
  ): Promise<EventCommitResult>;
}

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
  return checkpoint
    ? {
        ...checkpoint,
        eventIds: [...checkpoint.eventIds],
        events: [...checkpoint.events],
      }
    : { eventIds: [], events: [] };
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
        if (knownIds.has(event.id)) return false;
        knownIds.add(event.id);
        return true;
      });
      const retainedEvents = [...current.events, ...unique].slice(
        -this.retentionLimit,
      );
      const retainedIds = retainedEvents.map((event) => event.id);
      state.streams[id] = {
        cursor: nextCursor,
        eventIds: retainedIds,
        events: retainedEvents,
        updatedAt: new Date().toISOString(),
      };

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
      };
    });
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
      if (knownIds.has(event.id)) return false;
      knownIds.add(event.id);
      return true;
    });
    this.streams.set(id, {
      cursor: nextCursor,
      eventIds: [...knownIds],
      events: [...current.events, ...unique],
      updatedAt: new Date().toISOString(),
    });
    return {
      cursor: nextCursor,
      inserted: unique.length,
      duplicates: events.length - unique.length,
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

    if (!checkpoint.cursor && options.startLedger < response.value.oldestLedger) {
      throw new StellarDataLayerError(
        "rpc_error",
        `Start ledger ${options.startLedger} predates retained RPC history at ${response.value.oldestLedger}; refusing a gapped resume.`,
        false,
        response.meta.attempts,
      );
    }

    const required = response.value.events.filter((event) =>
      requiredEvent(event, this.policy),
    );
    const normalized = required.map((event) =>
      normalizeEvent(event, this.dataLayer.network.id),
    );
    const committed = await this.store.commit(
      key,
      checkpoint.cursor,
      response.value.cursor,
      normalized,
    );

    return {
      ...committed,
      fetched: response.value.events.length,
      required: normalized.length,
      meta: response.meta,
    };
  }
}
