import type { AssetAmount, Money, Network, PaymentRequirements, Price, SchemeNetworkServer, SupportedKind } from "@x402/core/types";
import {
  STELLAR_TESTNET_USDC_CONTRACT,
  STELLAR_PUBNET_USDC_CONTRACT,
  getX402RuntimeConfig,
} from "@/server/x402/config";

/**
 * Stellar SEP-41 USDC decimal places. The canonical Stellar USDC (Centre-issued)
 * uses 7 decimals, matching the on-chain contract storage.
 */
const STELLAR_USDC_DECIMALS = 7;

const STELLAR_USDC_ASSET_SYMBOL = "USDC";

/**
 * Map a CAIP-2 Stellar network to its known SEP-41 USDC contract ID.
 * Falls back to the runtime config so overrides via env vars are respected.
 */
function getUsdcContractForNetwork(network: Network): string | undefined {
  const config = getX402RuntimeConfig();

  if (network === "stellar:testnet") {
    return config.stellarUsdcContract || STELLAR_TESTNET_USDC_CONTRACT;
  }
  if (network === "stellar:pubnet") {
    return config.stellarPubnetUsdcContract || STELLAR_PUBNET_USDC_CONTRACT;
  }

  return undefined;
}

/**
 * Server-side Stellar x402 scheme implementing the `SchemeNetworkServer`
 * interface so Stellar networks appear in the 402 `accepts` list and the
 * resource server can parse prices into Stellar USDC atomic units.
 *
 * Registration gating:
 * - `stellar:testnet` is registered only when `X402_STELLAR_ENABLED=1`.
 * - `stellar:pubnet` is **fail-closed** unless `X402_STELLAR_PUBNET_ENABLED=1`
 *   AND a valid payTo is provided. Without explicit pubnet opt-in the scheme
 *   is never registered, so the server will never advertise pubnet as an
 *   accepted payment network.
 */
export class StellarExactScheme implements SchemeNetworkServer {
  readonly scheme = "exact";

  /**
   * Returns the decimal precision of Stellar USDC (7).
   */
  getAssetDecimals(_asset: string, _network: Network): number {
    void _asset;
    void _network;
    return STELLAR_USDC_DECIMALS;
  }

  /**
   * Convert a user-facing price into a Stellar USDC `AssetAmount`.
   *
   * Supported price formats:
   * - `AssetAmount` pass-through (asset/amount already resolved)
   * - Dollar string: `"$0.99"`, `"$1.50"`
   * - Plain number or numeric string: `0.99`, `"1.50"`
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    // Already resolved
    if (typeof price === "object" && price !== null && "asset" in price && "amount" in price) {
      return price as AssetAmount;
    }

    const contract = getUsdcContractForNetwork(network);

    if (!contract) {
      throw new Error(`Stellar USDC contract not configured for network ${network}`);
    }

    const decimal = this.parseMoneyToDecimal(price);
    const atomicAmount = BigInt(Math.round(decimal * 10 ** STELLAR_USDC_DECIMALS)).toString();

    return {
      asset: contract,
      amount: atomicAmount,
      extra: {
        symbol: STELLAR_USDC_ASSET_SYMBOL,
        decimals: STELLAR_USDC_DECIMALS,
      },
    };
  }

  /**
   * Enrich payment requirements with Stellar-specific metadata so clients
   * can construct valid Stellar payment payloads.
   *
   * The canonical `payTo`, `network`, and `assetContract` are pinned here so
   * the settlement verifier can compare a client-supplied payload against the
   * exact values the server advertised. Any mismatch is rejected.
   */
  async enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    _supportedKind: SupportedKind,
    _facilitatorExtensions: string[],
  ): Promise<PaymentRequirements> {
    void _supportedKind;
    void _facilitatorExtensions;
    const config = getX402RuntimeConfig();
    const contract = getUsdcContractForNetwork(paymentRequirements.network);

    if (!contract) {
      throw new Error(
        `Stellar USDC contract not configured for network ${paymentRequirements.network}`,
      );
    }

    const expectedPayTo =
      paymentRequirements.network === "stellar:pubnet"
        ? config.stellarPubnetPayTo
        : config.stellarPayTo;

    if (!expectedPayTo) {
      throw new Error(
        `Stellar payTo not configured for network ${paymentRequirements.network}`,
      );
    }

    if (paymentRequirements.payTo && paymentRequirements.payTo !== expectedPayTo) {
      throw new Error(
        `Stellar payTo mismatch for network ${paymentRequirements.network}: ` +
          `expected ${expectedPayTo}, received ${paymentRequirements.payTo}`,
      );
    }

    return {
      ...paymentRequirements,
      payTo: expectedPayTo,
      network: paymentRequirements.network,
      extra: {
        ...paymentRequirements.extra,
        assetContract: contract,
        assetCode: STELLAR_USDC_ASSET_SYMBOL,
        assetDecimals: STELLAR_USDC_DECIMALS,
      },
    };
  }

  /**
   * Validate that a client-supplied settlement payload matches the runtime
   * configuration for the given network. Used by the settlement verifier to
   * reject mismatched `network`/`asset`/`payTo` before redemption.
   */
  validateSettlementPayload(params: {
    network: Network;
    asset: string;
    payTo: string;
  }): { ok: true } | { ok: false; reason: string } {
    const config = getX402RuntimeConfig();
    const expectedContract = getUsdcContractForNetwork(params.network);

    if (!expectedContract) {
      return { ok: false, reason: `unsupported network ${params.network}` };
    }

    if (params.asset !== expectedContract) {
      return {
        ok: false,
        reason: `asset mismatch: expected ${expectedContract}, received ${params.asset}`,
      };
    }

    const expectedPayTo =
      params.network === "stellar:pubnet"
        ? config.stellarPubnetPayTo
        : config.stellarPayTo;

    if (!expectedPayTo) {
      return { ok: false, reason: `payTo not configured for ${params.network}` };
    }

    if (params.payTo !== expectedPayTo) {
      return {
        ok: false,
        reason: `payTo mismatch: expected ${expectedPayTo}, received ${params.payTo}`,
      };
    }

    return { ok: true };
  }

  /**
   * Parse `Money` (string | number) to a decimal number.
   * Handles dollar-format strings like `"$1.50"`.
   */
  private parseMoneyToDecimal(money: Money): number {
    if (typeof money === "number") {
      return money;
    }

    const cleaned = money.replace(/^\$/, "").trim();

    if (cleaned === "") {
      throw new Error(`Cannot parse empty money string: "${money}"`);
    }

    const parsed = Number(cleaned);

    if (!Number.isFinite(parsed)) {
      throw new Error(`Cannot parse money string as number: "${money}"`);
    }

    return parsed;
  }
}
