import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Address,
  Contract,
  Keypair,
  Networks,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  buildAccountLedgerKey,
  buildContractDataLedgerKey,
  StellarDataLayerError,
  StellarNetworkCache,
  StellarRpcDataLayer,
  type StellarRpcTransport,
} from "../src/server/stellar/dataLayer";
import {
  CryptaraEventIngestor,
  JsonFileStellarEventStore,
} from "../src/server/stellar/eventIngestion";
import { HorizonAccountDataAdapter } from "../src/server/stellar/horizonAdapter";

const accountId = Keypair.random().publicKey();
const contractId = Address.contract(Buffer.alloc(32, 7)).toString();

function healthyTransport(
  overrides: Partial<StellarRpcTransport> = {},
  input: { passphrase?: string; ledger?: number } = {},
): StellarRpcTransport {
  const ledger = input.ledger ?? 100;
  return {
    getHealth: async () =>
      ({
        status: "healthy",
        latestLedger: ledger,
        oldestLedger: 1,
        ledgerRetentionWindow: ledger,
      }) as never,
    getNetwork: async () =>
      ({
        passphrase: input.passphrase ?? Networks.TESTNET,
        protocolVersion: "27",
      }) as never,
    getLatestLedger: async () => ({ sequence: ledger }) as never,
    getLedgerEntries: async (...keys) =>
      ({
        latestLedger: ledger,
        entries: keys.map((key) => ({ key })),
      }) as never,
    simulateTransaction: async () =>
      ({ id: "simulation", latestLedger: ledger, events: [], _parsed: true }) as never,
    sendTransaction: async () =>
      ({
        status: "PENDING",
        hash: "a".repeat(64),
        latestLedger: ledger,
        latestLedgerCloseTime: 1,
      }) as never,
    getTransaction: async () =>
      ({
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        txHash: "a".repeat(64),
        latestLedger: ledger,
      }) as never,
    getEvents: async () =>
      ({
        events: [],
        cursor: "0",
        latestLedger: ledger,
        oldestLedger: 1,
        latestLedgerCloseTime: "2026-07-28T00:00:00Z",
        oldestLedgerCloseTime: "2026-07-27T00:00:00Z",
      }) as never,
    ...overrides,
  };
}

function dataLayer(
  providers: Record<string, StellarRpcTransport>,
  options: {
    timeoutMs?: number;
    maxLedgerLag?: number;
    retryLimit?: number;
  } = {},
) {
  return new StellarRpcDataLayer("stellar-testnet", {
    providerUrls: Object.keys(providers),
    transportFactory: (url) => providers[url],
    timeoutMs: options.timeoutMs ?? 50,
    retryLimit: options.retryLimit ?? 0,
    retryDelayMs: 0,
    maxLedgerLag: options.maxLedgerLag ?? 3,
    sleep: async () => undefined,
  });
}

function expectDataLayerError(
  error: unknown,
  code: StellarDataLayerError["code"],
) {
  assert.ok(error instanceof StellarDataLayerError);
  assert.equal(error.code, code);
  return error;
}

async function checkSdkLedgerKeys() {
  const accountKey = buildAccountLedgerKey(accountId);
  assert.equal(accountKey.switch(), xdr.LedgerEntryType.account());
  assert.deepEqual(
    Buffer.from(accountKey.account().accountId().ed25519()),
    Keypair.fromPublicKey(accountId).rawPublicKey(),
  );

  const contractKey = buildContractDataLedgerKey(
    contractId,
    xdr.ScVal.scvSymbol("risk"),
  );
  assert.equal(contractKey.switch(), xdr.LedgerEntryType.contractData());
  assert.equal(
    Address.fromScAddress(contractKey.contractData().contract()).toString(),
    contractId,
  );
  assert.equal(
    contractKey.contractData().durability(),
    xdr.ContractDataDurability.persistent(),
  );
}

async function checkSuccessAndNetworkCacheIsolation() {
  const layer = dataLayer({ "https://primary.test": healthyTransport() });
  const result = await layer.getLedgerEntries(
    [buildAccountLedgerKey(accountId)],
    { requestId: "request-success" },
  );
  assert.equal(result.meta.requestId, "request-success");
  assert.equal(result.meta.network, "stellar-testnet");
  assert.equal(result.meta.providerUrl, "https://primary.test");
  assert.equal(result.meta.fallbackUsed, false);
  assert.equal(result.meta.reliability, 0.98);
  assert.equal(result.meta.ledgerHeight, 100);

  const cache = new StellarNetworkCache<string>(5_000);
  cache.set("stellar-testnet", "account", "testnet-value");
  assert.equal(cache.get("stellar-testnet", "account"), "testnet-value");
  assert.equal(cache.get("stellar-pubnet", "account"), undefined);
}

async function checkMismatchLagTimeoutAndFailover() {
  const wrongNetwork = healthyTransport(
    {},
    { passphrase: Networks.PUBLIC, ledger: 101 },
  );
  const fallback = healthyTransport({}, { ledger: 100 });
  const mismatchLayer = dataLayer({
    "https://wrong-network.test": wrongNetwork,
    "https://fallback.test": fallback,
  });
  const mismatchResult = await mismatchLayer.getLedgerEntries([
    buildAccountLedgerKey(accountId),
  ]);
  assert.equal(mismatchResult.meta.fallbackUsed, true);
  assert.equal(mismatchResult.meta.providerDisagreement, true);
  assert.equal(
    mismatchResult.meta.attempts[0]?.errorCode,
    "network_mismatch",
  );
  assert.ok(mismatchResult.meta.confidence < mismatchResult.meta.reliability);
  const mismatchHealth = await mismatchLayer.getHealth();
  assert.equal(mismatchHealth.healthy, false);

  const lagLayer = dataLayer(
    {
      "https://lagging.test": healthyTransport({}, { ledger: 90 }),
      "https://fresh.test": healthyTransport({}, { ledger: 100 }),
    },
    { maxLedgerLag: 2 },
  );
  const lagResult = await lagLayer.getLedgerEntries([
    buildAccountLedgerKey(accountId),
  ]);
  assert.equal(lagResult.meta.providerUrl, "https://fresh.test");
  assert.equal(lagResult.meta.attempts[0]?.errorCode, "provider_lag");
  assert.equal((await lagLayer.getHealth()).healthy, false);

  const timeoutLayer = dataLayer(
    {
      "https://timeout.test": healthyTransport({
        getLedgerEntries: () => new Promise(() => undefined),
      }),
      "https://timeout-fallback.test": healthyTransport(),
    },
    { timeoutMs: 5 },
  );
  const timeoutResult = await timeoutLayer.getLedgerEntries([
    buildAccountLedgerKey(accountId),
  ]);
  assert.equal(timeoutResult.meta.fallbackUsed, true);
  assert.equal(
    timeoutResult.meta.attempts.find((attempt) => !attempt.ok)?.errorCode,
    "timeout",
  );
  assert.ok(timeoutResult.meta.reliability < 0.98);

  let retryCalls = 0;
  const retryLayer = dataLayer(
    {
      "https://retry.test": healthyTransport({
        getLedgerEntries: async (...keys) => {
          retryCalls += 1;
          if (retryCalls === 1) throw new Error("network connection reset");
          return {
            latestLedger: 100,
            entries: keys.map((key) => ({ key })),
          } as never;
        },
      }),
    },
    { retryLimit: 1 },
  );
  const retryResult = await retryLayer.getLedgerEntries([
    buildAccountLedgerKey(accountId),
  ]);
  assert.equal(retryCalls, 2);
  assert.equal(retryResult.meta.attempts.length, 2);
  assert.equal(retryResult.meta.fallbackUsed, false);
}

async function checkFailureModes() {
  const missingLayer = dataLayer({
    "https://missing.test": healthyTransport({
      getLedgerEntries: async () =>
        ({ entries: [], latestLedger: 100 }) as never,
    }),
  });
  await assert.rejects(
    missingLayer.getLedgerEntries([buildAccountLedgerKey(accountId)]),
    (error) => expectDataLayerError(error, "missing_entry") !== undefined,
  );

  const malformedLayer = dataLayer({
    "https://malformed.test": healthyTransport({
      getLedgerEntries: async () => {
        throw new Error("invalid XDR payload");
      },
    }),
  });
  await assert.rejects(
    malformedLayer.getLedgerEntries([buildAccountLedgerKey(accountId)]),
    (error) => {
      const failure = expectDataLayerError(error, "all_providers_failed");
      assert.equal(failure.attempts.at(-1)?.errorCode, "malformed_xdr");
      return true;
    },
  );

  assert.throws(
    () => buildContractDataLedgerKey("not-a-contract", "risk"),
    (error) => expectDataLayerError(error, "invalid_request") !== undefined,
  );
  assert.throws(
    () => buildContractDataLedgerKey(accountId, "risk"),
    (error) => expectDataLayerError(error, "invalid_request") !== undefined,
  );
}

async function checkTypedTransactionMethods() {
  const layer = dataLayer({ "https://transactions.test": healthyTransport() });
  const simulation = await layer.simulateTransaction({} as never, {
    requestId: "simulate-request",
  });
  assert.equal(simulation.meta.requestId, "simulate-request");
  assert.equal(simulation.value.latestLedger, 100);

  const submission = await layer.submitTransaction({} as never, {
    requestId: "submit-request",
  });
  assert.equal(submission.meta.requestId, "submit-request");
  assert.equal(submission.value.status, "PENDING");

  const transaction = await layer.pollTransaction("a".repeat(64), {
    attempts: 2,
    intervalMs: 0,
    requestId: "poll-request",
  });
  assert.equal(transaction.meta.requestId, "poll-request");
  assert.equal(transaction.value.status, rpc.Api.GetTransactionStatus.SUCCESS);
}

async function checkHorizonAdapterReplacement() {
  const calls: string[] = [];
  const adapter = new HorizonAccountDataAdapter({
    providerUrls: {
      "stellar-testnet": [
        "https://horizon-primary.test",
        "https://horizon-fallback.test",
      ],
    },
    retryLimit: 0,
    timeoutMs: 20,
    sleep: async () => undefined,
    serverFactory: (url) => ({
      loadAccount: async () => {
        calls.push(url);
        if (url.includes("primary")) throw new Error("network unavailable");
        return { accountId, balances: [] } as never;
      },
    }),
  });

  const result = await adapter.loadAccount(
    accountId,
    "stellar-testnet",
    "horizon-request",
  );
  assert.equal(result.meta.providerUrl, "https://horizon-fallback.test");
  assert.equal(result.meta.fallbackUsed, true);
  assert.equal(result.meta.requestId, "horizon-request");
  assert.deepEqual(calls, [
    "https://horizon-primary.test",
    "https://horizon-fallback.test",
  ]);
}

function event(
  id: string,
  topic: string,
  contract = contractId,
): rpc.Api.EventResponse {
  return {
    id,
    type: "contract",
    contractId: new Contract(contract),
    topic: [xdr.ScVal.scvSymbol(topic)],
    value: xdr.ScVal.scvString(`value-${id}`),
    ledger: 100,
    ledgerClosedAt: "2026-07-28T00:00:00Z",
    transactionIndex: 1,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    txHash: id.padEnd(64, "0"),
  };
}

function eventTransport(
  cursor: string,
  events: rpc.Api.EventResponse[],
  requests: rpc.Api.GetEventsRequest[] = [],
): StellarRpcTransport {
  return healthyTransport({
    getEvents: async (request) => {
      requests.push(request);
      return {
        events,
        cursor,
        latestLedger: 110,
        oldestLedger: 90,
        latestLedgerCloseTime: "2026-07-28T00:00:00Z",
        oldestLedgerCloseTime: "2026-07-27T00:00:00Z",
      } as never;
    },
  });
}

async function checkDurableEventResumeAndDedup() {
  const directory = await mkdtemp(join(tmpdir(), "cryptara-events-"));
  const path = join(directory, "checkpoints.json");
  const policy = {
    contractIds: [contractId],
    topicNames: ["risk_published"],
  };
  const firstRequests: rpc.Api.GetEventsRequest[] = [];
  const restartedRequests: rpc.Api.GetEventsRequest[] = [];

  try {
    const firstStore = new JsonFileStellarEventStore(path);
    const firstIngestor = new CryptaraEventIngestor(
      dataLayer({
        "https://events.test": eventTransport(
          "cursor-1",
          [
            event("event-1", "risk_published"),
            event("ignored-topic", "unrelated"),
            event(
              "ignored-contract",
              "risk_published",
              Address.contract(Buffer.alloc(32, 8)).toString(),
            ),
          ],
          firstRequests,
        ),
      }),
      firstStore,
      policy,
    );
    const first = await firstIngestor.ingestBatch({
      streamId: "risk-registry",
      startLedger: 90,
    });
    assert.equal(first.fetched, 3);
    assert.equal(first.required, 1);
    assert.equal(first.inserted, 1);
    assert.equal("startLedger" in firstRequests[0]!, true);
    assert.equal(
      firstRequests[0]?.filters[0]?.topics?.[0]?.[0],
      xdr.ScVal.scvSymbol("risk_published").toXDR("base64"),
    );

    // A fresh store instance models a process restart. Replayed event-1 is
    // deduplicated while event-2 and the next cursor are committed atomically.
    const restartedStore = new JsonFileStellarEventStore(path);
    const restartedIngestor = new CryptaraEventIngestor(
      dataLayer({
        "https://events.test": eventTransport(
          "cursor-2",
          [
            event("event-1", "risk_published"),
            event("event-2", "risk_published"),
          ],
          restartedRequests,
        ),
      }),
      restartedStore,
      policy,
    );
    const second = await restartedIngestor.ingestBatch({
      streamId: "risk-registry",
      startLedger: 90,
    });
    assert.equal(second.inserted, 1);
    assert.equal(second.duplicates, 1);
    assert.equal(second.cursor, "cursor-2");
    assert.equal(
      "cursor" in restartedRequests[0]!
        ? restartedRequests[0].cursor
        : undefined,
      "cursor-1",
    );

    const checkpoint = await restartedStore.load({
      network: "stellar-testnet",
      streamId: "risk-registry",
    });
    assert.equal(checkpoint.cursor, "cursor-2");
    assert.deepEqual(
      checkpoint.events.map((item) => item.id),
      ["event-1", "event-2"],
    );
    assert.equal(
      (
        await restartedStore.load({
          network: "stellar-pubnet",
          streamId: "risk-registry",
        })
      ).cursor,
      undefined,
    );

    const onDisk = JSON.parse(await readFile(path, "utf8")) as {
      streams: Record<string, { cursor: string }>;
    };
    assert.equal(
      onDisk.streams["stellar-testnet:risk-registry"]?.cursor,
      "cursor-2",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function checkGapDetection() {
  const ingestor = new CryptaraEventIngestor(
    dataLayer({
      "https://events.test": eventTransport("cursor-gap", []),
    }),
    new JsonFileStellarEventStore(
      join(tmpdir(), `unused-${process.pid}-${Date.now()}.json`),
    ),
    { contractIds: [contractId], topicNames: [] },
  );

  await assert.rejects(
    ingestor.ingestBatch({ streamId: "gap", startLedger: 1 }),
    (error) => {
      const failure = expectDataLayerError(error, "rpc_error");
      assert.match(failure.message, /refusing a gapped resume/);
      return true;
    },
  );
}

async function main() {
  await checkSdkLedgerKeys();
  await checkSuccessAndNetworkCacheIsolation();
  await checkMismatchLagTimeoutAndFailover();
  await checkFailureModes();
  await checkTypedTransactionMethods();
  await checkHorizonAdapterReplacement();
  await checkDurableEventResumeAndDedup();
  await checkGapDetection();
  console.log("Stellar data-layer checks passed.");
}

void main();
