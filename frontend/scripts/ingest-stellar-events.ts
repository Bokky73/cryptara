import { resolve } from "node:path";
import { normalizeStellarNetworkId } from "../src/lib/stellar/config";
import { StellarRpcDataLayer } from "../src/server/stellar/dataLayer";
import {
  CryptaraEventIngestor,
  JsonFileStellarEventStore,
} from "../src/server/stellar/eventIngestion";

function commaSeparated(value: string | undefined) {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

async function main() {
  const network = normalizeStellarNetworkId(
    process.env.STELLAR_EVENT_NETWORK ?? process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  );
  if (!network) {
    throw new Error(
      "STELLAR_EVENT_NETWORK must select stellar-testnet or stellar-pubnet.",
    );
  }

  const contractIds = commaSeparated(process.env.STELLAR_EVENT_CONTRACT_IDS);
  const topicNames = commaSeparated(process.env.STELLAR_EVENT_TOPIC_NAMES);
  const startLedger = Number(process.env.STELLAR_EVENT_START_LEDGER);
  if (!Number.isSafeInteger(startLedger) || startLedger <= 0) {
    throw new Error("STELLAR_EVENT_START_LEDGER must be a positive ledger number.");
  }

  const storePath = resolve(
    process.env.STELLAR_EVENT_STORE_PATH ?? ".data/stellar-events.json",
  );
  const ingestor = new CryptaraEventIngestor(
    new StellarRpcDataLayer(network),
    new JsonFileStellarEventStore(storePath),
    { contractIds, topicNames },
  );
  const result = await ingestor.ingestBatch({
    streamId: process.env.STELLAR_EVENT_STREAM_ID ?? "cryptara",
    startLedger,
    limit: Number(process.env.STELLAR_EVENT_BATCH_SIZE ?? 100),
  });

  console.log(
    JSON.stringify({
      network,
      cursor: result.cursor,
      fetched: result.fetched,
      required: result.required,
      inserted: result.inserted,
      duplicates: result.duplicates,
      provider: result.meta.providerUrl,
      requestId: result.meta.requestId,
      reliability: result.meta.reliability,
    }),
  );
}

void main();
