import assert from "node:assert/strict";
import { configureEvmSimulator, clearEvmSimulator, getEvmChainAdapter } from "../src/server/transactions/adapters/evm";
import { configureStellarSimulator, clearStellarSimulator, getStellarChainAdapter } from "../src/server/transactions/adapters/stellar";
import { assertLifecycleTransition, reconcileObservation, runReconciliationSweep } from "../src/server/transactions/lifecycleManager";
import { createTransactionObservation, listTransactionObservations } from "../src/server/storage";
import type { TransactionObservation, TransactionRecord } from "../src/server/types";

const now = "2026-08-27T00:00:00.000Z";
const evmHash = `0x${"1".repeat(64)}` as `0x${string}`;
const stellarHash = "A".repeat(64);

function record(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    hash: evmHash, type: "swap", asset: "USDC", valueUsd: 10, status: "submitted", lifecycleStatus: "submitted",
    chainFamily: "evm", network: "ethereum", createdAt: now, submittedAt: now, pollAttempts: 0, observationCount: 0,
    ...overrides,
  };
}

function observation(overrides: Partial<TransactionObservation> = {}): TransactionObservation {
  return {
    id: "obs", hash: evmHash, evidenceKey: "evidence", chainFamily: "evm", network: "ethereum",
    provider: "evm_rpc", status: "included", blockNumber: 100, blockHash: `0x${"2".repeat(64)}`,
    confirmations: 1, requiredConfirmations: 3, observedAt: now, ...overrides,
  };
}

async function main() {

const persisted = observation({ evidenceKey: "idempotent-evidence" });
const firstWrite = createTransactionObservation(persisted);
const secondWrite = createTransactionObservation(persisted);
assert.equal(firstWrite.created, true);
assert.equal(secondWrite.created, false);
assert.equal(listTransactionObservations(evmHash).filter((item) => item.evidenceKey === persisted.evidenceKey).length, 1);

const confirming = reconcileObservation(record(), observation());
assert.equal(confirming.status, "confirming", "one receipt confirmation must not be final");
assert.equal(confirming.updates.finalityReached, false);

const final = reconcileObservation(record({ lifecycleStatus: "confirming", status: "confirming" }), observation({ confirmations: 3 }));
assert.equal(final.status, "confirmed");
assert.equal(final.updates.finalityReached, true);

const reorg = reconcileObservation(record({ lifecycleStatus: "confirmed", status: "confirmed", lastObservedBlockHash: `0x${"2".repeat(64)}` }), observation({ status: "not_found", confirmations: 0 }));
assert.equal(reorg.status, "reorged");

const replacement = reconcileObservation(record(), observation({ status: "replaced", confirmations: 0, replacementHash: `0x${"3".repeat(64)}` }));
assert.equal(replacement.status, "replaced");
assert.equal(replacement.updates.replacementHash, `0x${"3".repeat(64)}`);

const disagreement = reconcileObservation(record(), observation({ status: "provider_disagreement", confirmations: 0, detail: "RPC A included; RPC B missing" }));
assert.equal(disagreement.status, "manual_review");

const dropped = reconcileObservation(record({ lifecycleStatus: "pending", status: "pending", missingObservationCount: 2 }), observation({ status: "not_found", confirmations: 0 }));
assert.equal(dropped.status, "dropped");

const duplicate = reconcileObservation(record({ lifecycleStatus: "pending", status: "pending" }), observation({ status: "duplicate", confirmations: 0 }));
assert.equal(duplicate.status, "pending");

const terminalConflict = reconcileObservation(record({ lifecycleStatus: "confirmed", status: "confirmed" }), observation({ status: "failed", confirmations: 0 }));
assert.equal(terminalConflict.status, "manual_review");
assert.throws(() => assertLifecycleTransition("confirmed", "pending"), /regression/);

configureEvmSimulator("evm", "ethereum", { pollSequence: [
  { status: "confirmed", confirmations: 1, blockNumber: 100 },
  { status: "confirmed", confirmations: 3, blockNumber: 100 },
  { status: "provider_disagreement" },
] });
const evm = getEvmChainAdapter({ network: "ethereum", confirmationDepth: 3 });
assert.equal((await evm.poll(evmHash)).status, "confirming");
assert.equal((await evm.poll(evmHash)).status, "confirmed");
assert.equal((await evm.poll(evmHash)).status, "manual_review");
clearEvmSimulator();

configureStellarSimulator("stellar", "stellar-testnet", { pollSequence: [
  { status: "pending" },
  { status: "duplicate" },
  { status: "confirmed", ledger: 200, latestLedger: 200, confirmations: 1 },
  { status: "confirmed", ledger: 200, latestLedger: 201, confirmations: 2 },
  { status: "failed" },
] });
const stellar = getStellarChainAdapter({ network: "stellar-testnet", confirmationDepth: 2 });
assert.equal((await stellar.poll(stellarHash)).status, "pending");
assert.equal((await stellar.poll(stellarHash)).observationStatus, "duplicate");
assert.equal((await stellar.poll(stellarHash)).status, "confirming");
assert.equal((await stellar.poll(stellarHash)).status, "confirmed");
assert.equal((await stellar.poll(stellarHash)).status, "failed");
clearStellarSimulator();

// Bounded reconciliation sweep: EVM nonce replacement + Stellar ledger expiry.
configureEvmSimulator("evm", "ethereum", { pollSequence: [
  { status: "replaced", confirmations: 0, replacementHash: `0x${"4".repeat(64)}` },
] });
configureStellarSimulator("stellar", "stellar-testnet", { pollSequence: [
  { status: "not_found" },
] });
const sweepRecords: TransactionRecord[] = [
  record({ hash: evmHash, chainFamily: "evm", network: "ethereum", lifecycleStatus: "pending", status: "pending" }),
  record({ hash: stellarHash, chainFamily: "stellar", network: "stellar-testnet", lifecycleStatus: "submitted", status: "submitted", timeBounds: { maxTime: "2026-08-26T00:00:00.000Z" } }),
];
const sweep = await runReconciliationSweep({
  records: sweepRecords,
  now: new Date(now),
  limit: 10,
  adapters: {
    evm: getEvmChainAdapter({ network: "ethereum", confirmationDepth: 3 }),
    stellar: getStellarChainAdapter({ network: "stellar-testnet", confirmationDepth: 2 }),
  },
});
assert.equal(sweep.processed, 2);
const evmResult = sweep.results.find((item) => item.hash === evmHash);
assert.equal(evmResult?.status, "replaced");
assert.equal(evmResult?.reason, "nonce_replaced");
const stellarResult = sweep.results.find((item) => item.hash === stellarHash);
assert.equal(stellarResult?.status, "expired");
assert.equal(stellarResult?.reason, "time_bounds_expired");
clearEvmSimulator();
clearStellarSimulator();

console.log("transaction reconciliation fixtures passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
