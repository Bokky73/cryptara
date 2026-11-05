import type { RouteConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import type { X402ChainFamily } from "@/server/types";

export const X402_DEEP_SCAN_RESOURCE = "/api/x402/deep-scan";
export const X402_TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";
export const X402_CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";

export const X402_PAYMENT_EXPIRY_SECONDS = 300;

const fallbackPayTo = "0x000000000000000000000000000000000000dEaD";
export const DEFAULT_X402_PAY_TO = "0x3ED3E93047b4bCF2e6Ab0744Db08a132d0c97D7d";
export const DEFAULT_X402_PRICE_USD = "$0.99";

export type X402RuntimeConfig = {
  protectedResource: string;
  payTo: string;
  priceUsd: string;
  network: Network;
  asset: string;
  facilitatorUrl: string;
  cdpApiKeyId?: string;
  cdpApiKeySecret?: string;
  productionReady: boolean;
  chainFamily: X402ChainFamily;
  paymentExpirySeconds: number;
  supportedSchemes: Array<"exact" | "exact-stellar">;
};

function clean(value: string | undefined) {
  return value?.trim() || undefined;
}

function getDefaultNetwork() {
  return process.env.VERCEL_ENV === "production" || process.env.PRODUCTION_DEPLOY === "1" ? "eip155:8453" : "eip155:84532";
}

function detectChainFamily(network: string): X402ChainFamily {
  if (network.startsWith("stellar:")) return "stellar";
  return "evm";
}

export function getX402RuntimeConfig(): X402RuntimeConfig {
  const cdpApiKeyId = clean(process.env.CDP_API_KEY_ID);
  const cdpApiKeySecret = clean(process.env.CDP_API_KEY_SECRET);
  const network = (clean(process.env.X402_NETWORK) ?? getDefaultNetwork()) as Network;
  const facilitatorUrl = clean(process.env.X402_FACILITATOR_URL) ?? (cdpApiKeyId && cdpApiKeySecret ? X402_CDP_FACILITATOR_URL : X402_TESTNET_FACILITATOR_URL);
  const payTo = clean(process.env.X402_PAY_TO) ?? DEFAULT_X402_PAY_TO;
  const priceUsd = clean(process.env.X402_PRICE_USD) ?? DEFAULT_X402_PRICE_USD;
  const chainFamily = detectChainFamily(network);
  const stellarEnabled = clean(process.env.X402_STELLAR_ENABLED) === "1";

  const usesCdpFacilitator = facilitatorUrl.includes("api.cdp.coinbase.com");
  const paymentExpirySeconds = Number(clean(process.env.X402_PAYMENT_EXPIRY_SECONDS) ?? X402_PAYMENT_EXPIRY_SECONDS);

  const supportedSchemes: X402RuntimeConfig["supportedSchemes"] = ["exact"];
  if (stellarEnabled && chainFamily === "stellar") {
    supportedSchemes.push("exact-stellar");
  }

  return {
    protectedResource: X402_DEEP_SCAN_RESOURCE,
    payTo,
    priceUsd,
    network,
    asset: clean(process.env.X402_ASSET) ?? (chainFamily === "stellar" ? "USDC:stellar" : "USDC"),
    facilitatorUrl,
    cdpApiKeyId,
    cdpApiKeySecret,
    chainFamily,
    paymentExpirySeconds: Number.isFinite(paymentExpirySeconds) && paymentExpirySeconds > 0 ? paymentExpirySeconds : X402_PAYMENT_EXPIRY_SECONDS,
    supportedSchemes,
    productionReady: Boolean(
      payTo !== fallbackPayTo &&
        clean(process.env.X402_PAY_TO) &&
        clean(process.env.X402_PRICE_USD) &&
        clean(process.env.X402_NETWORK) &&
        clean(process.env.X402_FACILITATOR_URL) &&
        (!usesCdpFacilitator || (cdpApiKeyId && cdpApiKeySecret)),
    ),
  };
}

export function getX402RouteConfig(config = getX402RuntimeConfig()): RouteConfig {
  return {
    accepts: [
      {
        scheme: "exact",
        price: config.priceUsd,
        network: config.network,
        payTo: config.payTo,
      },
    ],
    description: "Cryptara premium deep scan for AI Risk Report",
    mimeType: "application/json",
  };
}

export function validateX402RuntimeConfig(config = getX402RuntimeConfig()) {
  const issues: string[] = [];

  if (!/^\$[0-9]+(\.[0-9]+)?$/.test(config.priceUsd)) {
    issues.push("X402_PRICE_USD must use dollar format, for example $0.01.");
  }

  if (config.chainFamily === "evm" && config.network.startsWith("eip155:") && !/^0x[a-fA-F0-9]{40}$/.test(config.payTo)) {
    issues.push("X402_PAY_TO must be a valid EVM address for eip155 networks.");
  }

  if (config.chainFamily === "stellar" && config.network.startsWith("stellar:") && !/^G[A-Z2-7]{55}$/.test(config.payTo)) {
    issues.push("X402_PAY_TO must be a valid Stellar account ID for stellar networks.");
  }

  if (!config.network.startsWith("eip155:") && !config.network.startsWith("solana:") && !config.network.startsWith("stellar:")) {
    issues.push("X402_NETWORK must use CAIP-2 format, for example eip155:84532 or stellar:pubnet.");
  }

  if (!config.facilitatorUrl.startsWith("https://")) {
    issues.push("X402_FACILITATOR_URL must use https.");
  }

  if (config.facilitatorUrl.includes("api.cdp.coinbase.com") && (!config.cdpApiKeyId || !config.cdpApiKeySecret)) {
    issues.push("CDP_API_KEY_ID and CDP_API_KEY_SECRET are required for the CDP x402 facilitator.");
  }

  if (config.network === "eip155:8453" && !config.facilitatorUrl.includes("api.cdp.coinbase.com")) {
    issues.push("Base mainnet x402 payments must use the authenticated CDP facilitator.");
  }

  if (config.chainFamily === "stellar" && config.supportedSchemes.includes("exact-stellar")) {
    if (!config.facilitatorUrl) {
      issues.push("Stellar x402 requires a configured facilitator URL.");
    }
  }

  if (config.chainFamily === "stellar" && config.paymentExpirySeconds > 600) {
    issues.push("Stellar x402 payment expiry must not exceed 600 seconds.");
  }

  if (!config.supportedSchemes.length) {
    issues.push("At least one x402 payment scheme must be supported.");
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
