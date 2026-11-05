# Stellar data layer

The application has one explicit Stellar data boundary in
`frontend/src/server/stellar`. It never substitutes EVM or demo data for a
Stellar provider failure.

## RPC behavior

`StellarRpcDataLayer` exposes typed health, ledger-entry, simulation,
submission, transaction-polling, and event methods backed by
`@stellar/stellar-sdk`. Every request:

- probes the configured providers and verifies the selected network
  passphrase;
- rejects providers more than three ledgers behind the freshest configured
  provider;
- applies a finite timeout and bounded retry policy;
- fails over only to another provider for the same Stellar network; and
- returns request ID, provider, freshness, ledger, latency, attempt,
  reliability, confidence, disagreement, and fallback metadata.

Provider identity and cache keys always include `stellar-testnet` or
`stellar-pubnet`. Testnet values therefore cannot be read through pubnet cache
keys. `buildAccountLedgerKey` and `buildContractDataLedgerKey` construct XDR
ledger keys through the Stellar SDK rather than assembling base64 manually.

## Curated account data

`StellarAccountDataAdapter` is the replaceable boundary for Horizon or another
curated account source. `HorizonAccountDataAdapter` is the default and applies
the same request IDs, timeout, retry, failover, and reliability metadata.
Portfolio discovery accepts an injected adapter so a future indexed source can
replace Horizon without changing portfolio scoring.

## Durable contract events

`CryptaraEventIngestor` requests only configured contract IDs and event
topics. It discards system events, failed contract calls, unrelated contracts,
and unrelated topics before persistence.

The bundled `JsonFileStellarEventStore` writes events, deduplication IDs, and
the next RPC cursor in one atomic rename. If a process stops before the rename,
the previous cursor is retried; if it stops after the rename, the new cursor
and events are already durable. A fresh process resumes from that cursor and
event IDs prevent duplicate writes. Streams are partitioned by network. A
database implementation can replace the `StellarEventStore` interface in
multi-instance deployments.

Run one resumable batch with:

```bash
STELLAR_EVENT_NETWORK=stellar-testnet \
STELLAR_EVENT_CONTRACT_IDS=C... \
STELLAR_EVENT_TOPIC_NAMES=risk_published \
STELLAR_EVENT_START_LEDGER=12345 \
npm --prefix frontend run stellar:ingest-events
```

Optional settings are `STELLAR_EVENT_STORE_PATH`,
`STELLAR_EVENT_STREAM_ID`, and `STELLAR_EVENT_BATCH_SIZE`. The start ledger is
used only before the first durable cursor exists. Ingestion fails closed if
that ledger is older than the RPC retention window, preventing silent gaps.

## Verification

`npm run test:stellar-data-layer` covers successful reads, SDK ledger keys,
network-isolated caches, provider mismatch and lag, timeout and failover,
malformed XDR, missing entries, typed simulation/submission/polling, replaceable
Horizon adapters, event filtering, restart resume, cursor atomicity, gap
detection, and event-ID deduplication.
