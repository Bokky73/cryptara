import type { AgentInputIdentity, ResolvedTokenIdentity } from "@/server/types";
import { buildTokenIdentityGraph } from "@/server/identity/identityGraph";

import { StrKey } from "@stellar/stellar-sdk";

const evmAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const genericSymbols = new Set(["AI", "GOAT", "MOON", "PEPE", "MEME", "DOGE", "CAT", "BTC", "ETH"]);

function normalizeUrl(value?: string) {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function normalizeChain(value?: string) {
  return value?.trim().toLowerCase();
}

function normalizeAddress(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (evmAddressPattern.test(trimmed)) return trimmed.toLowerCase();
  if (StrKey.isValidContract(trimmed) || StrKey.isValidEd25519PublicKey(trimmed)) return trimmed.toUpperCase();
  return undefined;
}

function normalizeEvmChainId(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim().toLowerCase();
  const caipMatch = trimmed.match(/^eip155:(\d+)$/);
  if (caipMatch) return caipMatch[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  return undefined;
}

function normalizeStellarNetwork(value?: string) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return "mainnet";
  if (trimmed === "public" || trimmed === "pubnet" || trimmed === "mainnet") return "mainnet";
  if (trimmed === "test" || trimmed === "testnet") return "testnet";
  return trimmed;
}

function getConfidenceLabel(confidence: number): ResolvedTokenIdentity["confidenceLabel"] {
  if (confidence >= 0.72) return "high";
  if (confidence >= 0.42) return "medium";
  return "low";
}

export function resolveTokenIdentity(input: AgentInputIdentity): ResolvedTokenIdentity {
  const contractAddress = normalizeAddress(input.contractAddress);
  const chain = normalizeChain(input.chain);
  const symbol = input.symbol?.trim().toUpperCase();
  const tokenName = input.tokenName?.trim();
  const websiteUrl = normalizeUrl(input.websiteUrl);
  const twitterUrl = normalizeUrl(input.twitterUrl);
  const telegramUrl = normalizeUrl(input.telegramUrl);
  const discordUrl = normalizeUrl(input.discordUrl);
  const identityGraph = buildTokenIdentityGraph({ ...input, websiteUrl, twitterUrl, telegramUrl, discordUrl });
  const matchReasons: string[] = [];
  const warnings: string[] = [];
  let confidence = 0;

  if (contractAddress) {
    confidence += 0.38;
    matchReasons.push("contract address");
  } else if (input.contractAddress) {
    warnings.push("contract address is not a valid address");
  }

  if (chain) {
    confidence += 0.14;
    matchReasons.push("chain");
  }

  if (websiteUrl) {
    confidence += 0.14;
    matchReasons.push("website");
  }

  if (twitterUrl || telegramUrl || discordUrl) {
    confidence += 0.12;
    matchReasons.push("official social link");
  }

  if (input.coingeckoId) {
    confidence += 0.12;
    matchReasons.push("CoinGecko id");
  }

  if (input.dexScreenerPairUrl) {
    confidence += 0.08;
    matchReasons.push("DexScreener pair");
  }

  if (input.coinmarketcapId) {
    confidence += 0.1;
    matchReasons.push("CoinMarketCap id");
  }

  if (input.pairAddress) {
    confidence += 0.08;
    matchReasons.push("pair address");
  }

  if (symbol && tokenName) {
    confidence += 0.1;
    matchReasons.push("symbol and token name");
  } else if (symbol) {
    confidence += 0.04;
    matchReasons.push("symbol only");
  }

  if (symbol && genericSymbols.has(symbol) && !contractAddress) {
    confidence -= 0.18;
    warnings.push("generic or collision-prone symbol without contract address");
  }

  if (identityGraph.collision.risk === "high") {
    confidence -= 0.12;
    warnings.push(identityGraph.collision.detail);
  }

  if (identityGraph.officialLinks.conflicts.length > 0) {
    confidence -= 0.16;
    warnings.push(...identityGraph.officialLinks.conflicts);
  } else {
    confidence += identityGraph.officialLinks.confidenceBoost;
  }

  if (!contractAddress && !websiteUrl && !input.coingeckoId && !input.dexScreenerPairUrl) {
    warnings.push("identity depends on weak token labels");
  }

  const boundedConfidence = Math.min(0.96, Math.max(0.08, confidence));
  const identityKey =
    contractAddress && chain
      ? buildCanonicalAssetId({ chain, contractAddress, assetKey: input.assetKey, issuer: input.issuer, network: input.network, assetType: input.assetType })
      : contractAddress
        ? contractAddress
        : input.assetKey && chain
          ? buildCanonicalAssetId({ chain, contractAddress: undefined, assetKey: input.assetKey, issuer: input.issuer, network: input.network, assetType: input.assetType })
          : [symbol, tokenName, websiteUrl, input.coingeckoId].filter(Boolean).join(":").toLowerCase() || "unknown-token";

  return {
    ...input,
    chain,
    contractAddress,
    symbol,
    tokenName,
    websiteUrl,
    twitterUrl,
    telegramUrl,
    discordUrl,
    identityKey,
    confidence: boundedConfidence,
    confidenceLabel: getConfidenceLabel(boundedConfidence),
    matchReasons,
    warnings,
    identityGraph: {
      nodes: identityGraph.nodes,
      edges: identityGraph.edges,
    },
    symbolCollision: identityGraph.collision,
    officialLinkVerification: identityGraph.officialLinks,
  };
}

/**
 * Builds a CAIP-19-style canonical asset identifier.
 *
 * EVM:     eip155:<chainId>/erc20:<lowercaseAddress>
 * Stellar: stellar:<network>/asset:<code:issuer>  (classic)
 *          stellar:<network>/contract:<C...>       (Soroban SAC)
 *          stellar:<network>/native                (native XLM)
 *
 * Distinct issuers/contracts never collapse into the same key, so spoofed
 * tickers on different addresses cannot collide in history or watchlists.
 */
export function buildCanonicalAssetId(entry: {
  chain?: string;
  network?: string;
  assetType?: string;
  contractAddress?: string;
  assetKey?: string;
  issuer?: string;
}): string {
  const chain = normalizeChain(entry.chain) || "unknown-chain";

  if (chain === "stellar") {
    const network = normalizeStellarNetwork(entry.network);
    if (entry.assetType === "native") {
      return `stellar:${network}/native`;
    }
    const contract = normalizeAddress(entry.contractAddress);
    if (contract && StrKey.isValidContract(contract)) {
      return `stellar:${network}/contract:${contract}`;
    }
    const code = entry.assetKey?.trim().toUpperCase();
    const issuer = entry.issuer?.trim();
    if (code && issuer) {
      const normalizedIssuer = StrKey.isValidEd25519PublicKey(issuer) ? issuer.toUpperCase() : issuer;
      return `stellar:${network}/asset:${code}:${normalizedIssuer}`;
    }
    if (code) {
      return `stellar:${network}/asset:${code}`;
    }
    if (contract) {
      return `stellar:${network}/contract:${contract}`;
    }
    return `stellar:${network}/unknown-asset`;
  }

  // EVM
  const chainId = normalizeEvmChainId(entry.chain) ?? normalizeEvmChainId(entry.network);
  const address = normalizeAddress(entry.contractAddress);
  if (chainId && address && evmAddressPattern.test(address)) {
    return `eip155:${chainId}/erc20:${address}`;
  }
  if (address) {
    return `${chain}:${address}`;
  }
  if (entry.assetKey) {
    return `${chain}:${entry.assetKey.trim().toLowerCase()}`;
  }
  return `${chain}:unknown-asset`;
}

export function getWatchlistIdentityKey(entry: {
  chain: string;
  network?: string;
  assetType?: string;
  contractAddress?: string;
  assetKey?: string;
  issuer?: string;
  symbol?: string;
}): string {
  const chain = normalizeChain(entry.chain) || "unknown-chain";

  if (chain === "stellar") {
    return buildCanonicalAssetId(entry);
  }

  // EVM
  if (entry.contractAddress) {
    return buildCanonicalAssetId(entry);
  }

  if (entry.assetKey) {
    return buildCanonicalAssetId(entry);
  }

  const network = entry.network?.trim().toLowerCase() || "mainnet";
  const symbolStr = entry.symbol ? `:${entry.symbol.trim().toLowerCase()}` : "";
  return `${chain}:${network}:unknown-asset${symbolStr}`;
}
