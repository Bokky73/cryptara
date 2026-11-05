import { TransactionBuilder, Transaction } from "@stellar/stellar-sdk";
import type { StellarAuthorization } from "@/server/types";

const STELLAR_AUTH_PREFIX = "CRYPTARA_INTENT:";

function hashToHex(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  const bytes = new Uint8Array(32);
  const h = (hash >>> 0);
  for (let i = 0; i < 8; i++) {
    bytes[i] = (h >> (i * 4)) & 0xff;
  }
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildIntentMemoHex(intentHash: string): string {
  return hashToHex(STELLAR_AUTH_PREFIX + intentHash);
}

function extractTransaction(signedXdr: string, networkPassphrase: string): Transaction {
  const raw = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  if (raw instanceof Transaction) return raw;
  throw new Error("Fee-bump transactions are not supported for authorization.");
}

export function assertStellarAuthorization(auth: StellarAuthorization, expectedNetworkPassphrase: string): void {
  if (auth.networkPassphrase !== expectedNetworkPassphrase) {
    throw new Error(`Stellar network passphrase mismatch: expected for ${expectedNetworkPassphrase}, got ${auth.networkPassphrase}`);
  }

  const transaction = extractTransaction(auth.signedXdr, auth.networkPassphrase);

  if (transaction.source !== auth.sourceAccount) {
    throw new Error("Stellar source account mismatch between authorization and signed XDR.");
  }

  const seqNo = (transaction as any).sequenceNumber;
  if (seqNo !== auth.sequenceNumber) {
    throw new Error("Stellar sequence number mismatch.");
  }

  if (transaction.operations.length !== auth.operationCount) {
    throw new Error(`Stellar operation count mismatch: expected ${auth.operationCount}, got ${transaction.operations.length}.`);
  }

  const memo = transaction.memo;
  if (!memo || (memo as any).type !== "hash") {
    throw new Error("Stellar transaction must have a hash memo binding the intent.");
  }

  const memoValue = (memo as any).value as string;
  const expectedMemoHex = buildIntentMemoHex(auth.intentHash);
  if (memoValue !== expectedMemoHex) {
    throw new Error("Stellar memo hash does not match the expected intent binding.");
  }

  const timeBounds = transaction.timeBounds;
  if (!timeBounds) {
    throw new Error("Stellar transaction must have time bounds.");
  }

  const tb = timeBounds as any;
  if (Number(tb.minTime) !== auth.timeBounds.minTime || Number(tb.maxTime) !== auth.timeBounds.maxTime) {
    throw new Error("Stellar time bounds mismatch.");
  }

  if (transaction.signatures.length === 0) {
    throw new Error("Stellar transaction is not signed.");
  }
}

export function verifyStellarAuthorizationNotExpired(auth: StellarAuthorization): void {
  const now = Math.floor(Date.now() / 1000);
  if (now > auth.timeBounds.maxTime) {
    throw new Error("Stellar authorization time bounds have expired.");
  }
}

export function bindStellarIntentToAuthorization(
  intentHash: string,
  networkPassphrase: string,
  sourceAccount: string,
  sequenceNumber: string,
  operationCount: number,
  signedXdr: string,
): StellarAuthorization {
  const transaction = extractTransaction(signedXdr, networkPassphrase);
  const timeBounds = transaction.timeBounds as any;

  return {
    networkPassphrase,
    sourceAccount,
    sequenceNumber,
    operationCount,
    timeBounds: {
      minTime: timeBounds ? Number(timeBounds.minTime) : 0,
      maxTime: timeBounds ? Number(timeBounds.maxTime) : 0,
    },
    memoHash: buildIntentMemoHex(intentHash),
    intentHash,
    signedXdr,
  };
}
