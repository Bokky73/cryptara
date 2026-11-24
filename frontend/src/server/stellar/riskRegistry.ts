import "server-only";

import { createHash } from "node:crypto";
import { Address, BASE_FEE, Contract, TransactionBuilder, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  createStellarRpcDataLayer,
  createStellarRpcServer,
} from "@/server/stellar/client";
import type { StellarNetworkId } from "@/lib/stellar/config";
import { getStellarNetwork, getStellarRegistryContractId } from "@/lib/stellar/config";
import { invalidateRiskRecordCacheAsync } from "@/server/cache/invalidation";

export type RiskRegistryPublication = {
  publisher: string;
  assetKey: string;
  assetLabel: string;
  score: number;
  confidenceBps: number;
  verdict: string;
  evidenceUri: string;
  updatedAt: number;
  report: unknown;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

export function canonicalReportJson(report: unknown) {
  return JSON.stringify(stableValue(report));
}

export function sha256Bytes(value: string) {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

export function getRiskRegistryContractId(network: StellarNetworkId) {
  const config = getStellarNetwork(network);
  return config ? getStellarRegistryContractId(config) : undefined;
}

function requireRegistry(network: StellarNetworkId) {
  const contractId = getRiskRegistryContractId(network);
  if (!contractId) throw new Error(`Risk registry is not deployed for ${network}.`);
  return new Contract(contractId);
}

function parseRiskPublicationTransaction(transaction: ReturnType<typeof TransactionBuilder.fromXDR>, contractId: string) {
  if ("innerTransaction" in transaction) throw new Error("Fee-bump transactions are not accepted by the risk registry relay.");
  if (transaction.operations.length !== 1) throw new Error("Risk publication must contain exactly one operation.");
  if (transaction.signatures.length === 0) throw new Error("Risk publication transaction is not signed.");

  const operation = transaction.operations[0];
  if (operation.type !== "invokeHostFunction" || operation.func.switch().name !== "hostFunctionTypeInvokeContract") {
    throw new Error("Only a risk registry contract invocation can be submitted.");
  }

  const invocation = operation.func.value() as xdr.InvokeContractArgs;
  const target = Address.fromScAddress(invocation.contractAddress()).toString();
  const method = invocation.functionName().toString("utf-8");
  const publisherArgument = invocation.args()[0];
  const publisher = publisherArgument ? Address.fromScVal(publisherArgument).toString() : undefined;

  if (target !== contractId || method !== "publish_risk") {
    throw new Error("The signed transaction does not target the configured risk registry publication method.");
  }
  if (!publisher || publisher !== transaction.source) {
    throw new Error("The transaction source must match the risk publication publisher.");
  }

  const assetIdArgument = invocation.args()[1];
  const assetId = assetIdArgument ? Buffer.from(assetIdArgument.bytes() as Uint8Array).toString("hex") : undefined;
  if (!assetId) throw new Error("Risk publication is missing the asset identifier.");

  return { publisher, assetId };
}

export async function prepareRiskPublication(networkId: StellarNetworkId, publication: RiskRegistryPublication) {
  const { network, server } = createStellarRpcServer(networkId);
  const registry = requireRegistry(network.id);
  const source = await server.getAccount(publication.publisher);
  const reportJson = canonicalReportJson(publication.report);
  if (Buffer.byteLength(reportJson, "utf8") > 100_000) throw new Error("Risk report payload is too large.");
  const assetId = sha256Bytes(`${network.id}:${publication.assetKey}`);
  const reportHash = sha256Bytes(reportJson);
  const operation = registry.call(
    "publish_risk",
    new Address(publication.publisher).toScVal(),
    nativeToScVal(assetId),
    nativeToScVal(network.shortName, { type: "symbol" }),
    nativeToScVal(publication.assetLabel),
    nativeToScVal(publication.score, { type: "u32" }),
    nativeToScVal(publication.confidenceBps, { type: "u32" }),
    nativeToScVal(publication.verdict.slice(0, 32), { type: "symbol" }),
    nativeToScVal(reportHash),
    nativeToScVal(publication.evidenceUri),
    nativeToScVal(publication.updatedAt, { type: "u64" }),
  );
  const transaction = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: network.networkPassphrase })
    .addOperation(operation)
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(transaction);

  return {
    xdr: prepared.toXDR(),
    network: network.id,
    networkPassphrase: network.networkPassphrase,
    contractId: registry.contractId(),
    source: publication.publisher,
    assetId: Buffer.from(assetId).toString("hex"),
    reportHash: Buffer.from(reportHash).toString("hex"),
    reportJson,
    expiresAt: Date.now() + 120_000,
  };
}

export async function submitRiskPublication(networkId: StellarNetworkId, signedXdr: string) {
  const { network } = createStellarRpcServer(networkId);
  const registry = requireRegistry(network.id);
  const transaction = TransactionBuilder.fromXDR(signedXdr, network.networkPassphrase);
  const { assetId } = parseRiskPublicationTransaction(transaction, registry.contractId());
  const submitted = await createStellarRpcDataLayer(networkId).submitTransaction(
    transaction,
  );
  await invalidateRiskRecordCacheAsync(network.id, assetId);

  return {
    network: network.id,
    hash: submitted.value.hash,
    status: submitted.value.status,
    errorResultXdr: submitted.value.errorResult?.toXDR("base64"),
    latestLedger: submitted.value.latestLedger,
    latestLedgerCloseTime: submitted.value.latestLedgerCloseTime,
    providerMeta: submitted.meta,
  };
}

export async function getRiskPublicationStatus(networkId: StellarNetworkId, hash: string) {
  const network = getStellarNetwork(networkId);
  if (!network) throw new Error(`Unsupported Stellar network: ${networkId}`);
  const result = await createStellarRpcDataLayer(networkId).pollTransaction(hash);

  return {
    network: network.id,
    hash,
    status: result.value.status,
    ledger: "ledger" in result.value ? result.value.ledger : undefined,
    createdAt: "createdAt" in result.value ? result.value.createdAt : undefined,
    providerMeta: result.meta,
  };
}

export async function readRiskRecord(networkId: StellarNetworkId, assetKey: string) {
  const { network, server } = createStellarRpcServer(networkId);
  const registry = requireRegistry(network.id);
  const assetId = sha256Bytes(`${network.id}:${assetKey}`);
  const source = await server.getAccount("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
  const transaction = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: network.networkPassphrase })
    .addOperation(registry.call("get_risk", nativeToScVal(assetId), nativeToScVal(network.shortName, { type: "symbol" })))
    .setTimeout(30)
    .build();
  const simulation = await createStellarRpcDataLayer(
    networkId,
  ).simulateTransaction(transaction);

  if (
    !("result" in simulation.value) ||
    !simulation.value.result?.retval ||
    simulation.value.result.retval.switch() === xdr.ScValType.scvVoid()
  )
    return null;
  return scValToNative(simulation.value.result.retval) as Record<string, unknown>;
}
