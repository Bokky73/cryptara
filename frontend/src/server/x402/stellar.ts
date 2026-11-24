import "server-only";

import { getX402RuntimeConfig } from "@/server/x402/config";
import {
  PubnetGatedError,
  evaluatePubnetReadiness,
  type PubnetReadiness,
} from "@/server/stellar/pubnetGate";

/**
 * Normalized, verified settlement context for a Stellar x402 payment.
 *
 * Only produced after on-chain verification; `server.ts` signs this and hands
 * it to the guard layer via the internal HMAC header. Nothing here is derived
 * from client-supplied `x-payment-*` / `x-stellar-payment-proof` headers.
 */
export interface StellarSettlementContext {
  network: string;
  recipient: string;
  amount: string;
  txHash: string;
  /** Horizon ledger close time of the verified transaction, ISO-8601. */
  settledAt: string;
}

/** Raised when a Stellar settlement proof fails verification. */
export class StellarSettlementError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "StellarSettlementError";
    this.code = code;
  }
}

/** Minimal shape of a Horizon payment record we care about. */
interface HorizonPaymentRecord {
  type?: string;
  transaction_hash?: string;
  transaction_successful?: boolean;
  to?: string;
  from?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  created_at?: string;
}

/** USDC on Stellar is issued by Circle; the issuer differs per network. */
const USDC_ISSUERS: Record<string, string> = {
  "stellar:pubnet": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  "stellar:testnet": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

function horizonBaseUrl(network: string): string {
  return network === "stellar:pubnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";
}

/** Stellar amounts are decimal strings with 7 dp; compare as integer stroops. */
function toStroops(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d{1,7})?$/.test(trimmed)) {
    throw new StellarSettlementError("invalid_amount", `Malformed Stellar amount: ${amount}`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, "0"));
}

/**
 * Verifies a Stellar transaction hash against Horizon and returns a normalized
 * settlement context.
 *
 * Rejects when the transaction is missing/failed, when it does not contain a
 * USDC payment to `config.payTo` on the expected network, or when the paid
 * amount is below the required price. The caller is responsible for replay
 * protection (persistent receipt storage) after this returns.
 */
export async function verifyStellarSettlement(params: {
  txHash: string;
  requiredPrice: string;
  network?: string;
}): Promise<StellarSettlementContext> {
  const config = getX402RuntimeConfig();
  const network = params.network ?? config.network;

  if (!network.startsWith("stellar:")) {
    throw new StellarSettlementError("wrong_network", `Not a Stellar network: ${network}`);
  }

  // Pubnet payments are refused while the readiness gate is closed.
  await assertStellarPubnetPaymentAllowed();

  const txHash = params.txHash?.trim();
  if (!txHash || !/^[0-9a-f]{64}$/i.test(txHash)) {
    throw new StellarSettlementError("invalid_tx_hash", "Malformed Stellar transaction hash");
  }

  const expectedIssuer = USDC_ISSUERS[network];
  if (!expectedIssuer) {
    throw new StellarSettlementError("unsupported_network", `Unsupported Stellar network: ${network}`);
  }

  const url = `${horizonBaseUrl(network)}/transactions/${txHash}/payments`;
  let records: HorizonPaymentRecord[];
  try {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new StellarSettlementError(
        "tx_not_found",
        `Stellar transaction ${txHash} not found on ${network}`,
      );
    }
    const body = (await response.json()) as { _embedded?: { records?: HorizonPaymentRecord[] } };
    records = body._embedded?.records ?? [];
  } catch (error) {
    if (error instanceof StellarSettlementError) throw error;
    throw new StellarSettlementError(
      "horizon_unavailable",
      `Unable to verify Stellar transaction ${txHash}: ${(error as Error).message}`,
    );
  }

  const matching = records.find(
    (record) =>
      record.type === "payment" &&
      record.transaction_successful !== false &&
      record.to === config.payTo &&
      record.asset_type === "credit_alphanum4" &&
      record.asset_code === "USDC" &&
      record.asset_issuer === expectedIssuer,
  );

  if (!matching) {
    throw new StellarSettlementError(
      "recipient_mismatch",
      `Stellar transaction ${txHash} has no USDC payment to ${config.payTo}`,
    );
  }

  const paid = toStroops(matching.amount ?? "0");
  const required = toStroops(params.requiredPrice);
  if (paid < required) {
    throw new StellarSettlementError(
      "insufficient_amount",
      `Stellar payment ${matching.amount} is below required price ${params.requiredPrice}`,
    );
  }

  return {
    network,
    recipient: config.payTo,
    amount: matching.amount ?? "0",
    txHash: txHash.toLowerCase(),
    settledAt: matching.created_at ?? new Date().toISOString(),
  };
}

/**
 * The pubnet boundary for x402 payments (issue #149).
 *
 * Scheme registration is synchronous and the readiness gate is not, so the
 * decision is made here, at the request boundary, where awaiting is free. Every
 * pubnet payment path funnels through these two functions rather than reading
 * configuration directly, so there is one place that can say yes.
 */

/** True when the configured x402 network is Stellar pubnet. */
export function isStellarPubnetPayment(network = getX402RuntimeConfig().network): boolean {
  return network === "stellar:pubnet";
}

/**
 * Whether pubnet may be offered in a 402 `accepts` list.
 *
 * Testnet and EVM are unaffected: they never consult the gate.
 */
export async function isStellarPubnetPaymentAdvertised(): Promise<boolean> {
  if (!isStellarPubnetPayment()) return false;
  return (await evaluatePubnetReadiness()).ready;
}

/**
 * Refuses a pubnet payment while the gate is closed.
 *
 * Throws `PubnetGatedError`, which carries the specific reason, so a caller can
 * tell an operator which condition to fix instead of reporting a generic
 * payment failure.
 */
export async function assertStellarPubnetPaymentAllowed(): Promise<void> {
  if (!isStellarPubnetPayment()) return;

  const readiness: PubnetReadiness = await evaluatePubnetReadiness();
  if (!readiness.ready) throw new PubnetGatedError(readiness);
}

export { PubnetGatedError };
