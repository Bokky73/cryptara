import { isAddress } from "viem";
import { StrKey } from "@stellar/stellar-sdk";
import { normalizeScanNetworkId } from "@/lib/scanNetworks";
import { getChainFamily } from "@/lib/chainIdentity";
import { parseTokenQuery } from "@/lib/tokenQuery";
import { getDefaultStellarNetwork, normalizeStellarNetworkId } from "@/lib/stellar/config";
import { parseStellarAssetInput } from "@/server/stellar/assetIdentity";

export type NormalizedTokenInput = {
  chain: string;
  contractAddress: string;
  assetKey?: string;
  assetType?: "native" | "classic" | "contract" | "issuer_account" | "deterministic_sac" | "sep41_token" | "unsupported_contract";
  issuer?: string;
  pairAddress?: string;
  symbol?: string;
  name?: string;
  links?: {
    websiteUrl?: string;
    twitterUrl?: string;
    telegramUrl?: string;
  };
  market?: {
    pairAddress?: string;
    dexId?: string;
    pairUrl?: string;
    priceUsd?: number;
    liquidityUsd?: number;
    volume24hUsd?: number;
    fdvUsd?: number;
    marketCapUsd?: number;
    priceChange24hPercent?: number;
    pairAgeDays?: number;
  };
  source: "dexscreener_pair_url" | "dexscreener_token_url" | "contract_address" | "stellar_asset" | "stellar_issuer";
};

type DexScreenerPairResponse = {
  pairs?: Array<{
    chainId?: string;
    dexId?: string;
    url?: string;
    pairAddress?: string;
    priceUsd?: string;
    liquidity?: {
      usd?: number;
    };
    volume?: {
      h24?: number;
    };
    priceChange?: {
      h24?: number;
    };
    fdv?: number;
    marketCap?: number;
    pairCreatedAt?: number;
    baseToken?: {
      address?: string;
      name?: string;
      symbol?: string;
    };
    quoteToken?: {
      address?: string;
      name?: string;
      symbol?: string;
    };
    info?: {
      websites?: Array<{
        label?: string;
        url?: string;
      }>;
      socials?: Array<{
        type?: string;
        url?: string;
      }>;
    };
  }> | null;
};

type DexScreenerPair = NonNullable<DexScreenerPairResponse["pairs"]>[number];

function getPairAgeDays(pairCreatedAt?: number) {
  if (!pairCreatedAt) {
    return undefined;
  }

  return Math.max(0, Math.floor((Date.now() - pairCreatedAt) / 86_400_000));
}

function isDexScreenerAttempt(value: string) {
  return /^(?:https?:\/\/)?(?:www\.)?dexscreener\.com(?:\/|$)/i.test(value);
}

async function resolveDexScreenerPair(chain: string, pairAddress: string): Promise<NormalizedTokenInput | null> {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pairAddress}`, {
    next: { revalidate: 60 * 5 },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as DexScreenerPairResponse;
  const pair = payload.pairs?.[0];
  const tokenAddress = pair?.baseToken?.address;
  const twitterUrl = pair?.info?.socials?.find((social) => social.type?.toLowerCase() === "twitter" || social.type?.toLowerCase() === "x")?.url;
  const telegramUrl = pair?.info?.socials?.find((social) => social.type?.toLowerCase() === "telegram")?.url;
  const websiteUrl = pair?.info?.websites?.[0]?.url;

  if (!tokenAddress) {
    return null;
  }

  return {
    chain: pair.chainId ?? chain,
    contractAddress: tokenAddress,
    pairAddress: pair.pairAddress ?? pairAddress,
    symbol: pair.baseToken?.symbol,
    name: pair.baseToken?.name,
    links: {
      websiteUrl,
      twitterUrl,
      telegramUrl,
    },
    market: {
      pairAddress: pair.pairAddress ?? pairAddress,
      dexId: pair.dexId,
      pairUrl: pair.url,
      priceUsd: pair.priceUsd ? Number(pair.priceUsd) : undefined,
      liquidityUsd: pair.liquidity?.usd,
      volume24hUsd: pair.volume?.h24,
      fdvUsd: pair.fdv,
      marketCapUsd: pair.marketCap,
      priceChange24hPercent: pair.priceChange?.h24,
      pairAgeDays: getPairAgeDays(pair.pairCreatedAt),
    },
    source: "dexscreener_pair_url",
  };
}

function getMatchingToken(pair: DexScreenerPair, contractAddress: string) {
  const normalizedAddress = contractAddress.toLowerCase();

  if (pair.baseToken?.address?.toLowerCase() === normalizedAddress) return pair.baseToken;
  if (pair.quoteToken?.address?.toLowerCase() === normalizedAddress) return pair.quoteToken;

  return null;
}

function pairLiquidity(pair: DexScreenerPair) {
  return pair.liquidity?.usd ?? 0;
}

async function resolveContractAddress(contractAddress: string, requestedChain?: string): Promise<NormalizedTokenInput | null> {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(contractAddress)}`, {
    next: { revalidate: 60 * 5 },
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as DexScreenerPairResponse;
  const exactMatches = (payload.pairs ?? []).filter((pair) => Boolean(getMatchingToken(pair, contractAddress)));

  if (exactMatches.length === 0) return null;

  const normalizedRequestedChain = normalizeScanNetworkId(requestedChain);
  const requestedChainMatches = exactMatches.filter((pair) => normalizeScanNetworkId(pair.chainId) === normalizedRequestedChain);
  const candidates = requestedChainMatches.length > 0 ? requestedChainMatches : exactMatches;
  const pair = [...candidates].sort((left, right) => pairLiquidity(right) - pairLiquidity(left))[0];
  const token = getMatchingToken(pair, contractAddress);

  if (!pair || !token) return null;

  const twitterUrl = pair.info?.socials?.find((social) => social.type?.toLowerCase() === "twitter" || social.type?.toLowerCase() === "x")?.url;
  const telegramUrl = pair.info?.socials?.find((social) => social.type?.toLowerCase() === "telegram")?.url;

  return {
    chain: normalizeScanNetworkId(pair.chainId) || normalizeScanNetworkId(requestedChain) || "base",
    contractAddress,
    pairAddress: pair.pairAddress,
    symbol: token.symbol,
    name: token.name,
    links: {
      websiteUrl: pair.info?.websites?.[0]?.url,
      twitterUrl,
      telegramUrl,
    },
    market: {
      pairAddress: pair.pairAddress,
      dexId: pair.dexId,
      pairUrl: pair.url,
      priceUsd: pair.priceUsd ? Number(pair.priceUsd) : undefined,
      liquidityUsd: pair.liquidity?.usd,
      volume24hUsd: pair.volume?.h24,
      fdvUsd: pair.fdv,
      marketCapUsd: pair.marketCap,
      priceChange24hPercent: pair.priceChange?.h24,
      pairAgeDays: getPairAgeDays(pair.pairCreatedAt),
    },
    source: "contract_address",
  };
}

export async function normalizeTokenInput(query: string, chain?: string): Promise<NormalizedTokenInput | null> {
  const trimmed = query.trim();
  const parsed = parseTokenQuery(trimmed, { chain });
  const dexInput = parsed.ok && parsed.kind === "dexscreener-url" ? parsed : null;
  const evmInput = parsed.ok && parsed.kind === "evm-address" ? parsed : null;
  const evmAddress = Boolean(evmInput);
  const contractAddress = evmInput ? (evmInput.warning ? evmInput.address : trimmed) : trimmed;
  const isStellarUrl = trimmed.includes("stellar") || trimmed.includes("lumenscan");

  if (isDexScreenerAttempt(trimmed) && !dexInput) return null;

  const dexStellarNetwork = dexInput?.suggestedChain ? normalizeStellarNetworkId(dexInput.suggestedChain) : null;
  const stellarNetwork = !evmAddress
    ? dexStellarNetwork
      ?? (!dexInput
        ? normalizeStellarNetworkId(chain)
          ?? (StrKey.isValidContract(trimmed) || StrKey.isValidEd25519PublicKey(trimmed) || trimmed.includes(":") || ["xlm", "native"].includes(trimmed.toLowerCase()) || isStellarUrl
            ? getDefaultStellarNetwork().id
            : null)
        : null)
    : null;

  if (stellarNetwork) {
    const identity = parseStellarAssetInput(trimmed, stellarNetwork);

    if (!identity) return null;

    return {
      chain: stellarNetwork,
      contractAddress: "contractId" in identity ? identity.contractId : identity.issuer,
      assetKey: identity.assetKey,
      assetType: identity.type as NormalizedTokenInput["assetType"],
      issuer: "issuer" in identity ? identity.issuer : undefined,
      symbol: "symbol" in identity ? identity.symbol : undefined,
      name: "name" in identity ? identity.name : identity.type === "issuer_account" ? "Stellar issuer account" : "Soroban contract token",
      source: identity.type === "issuer_account" ? "stellar_issuer" : identity.type === "classic" || identity.type === "native" ? "stellar_asset" : "contract_address",
    };
  }

  if (dexInput) {
    const dexChain = dexInput.suggestedChain ?? "base";
    const dexAddress = dexInput.address;

    if (isAddress(dexAddress)) {
      const pairResolved = await resolveDexScreenerPair(dexChain, dexAddress).catch(() => null);

      return (
        pairResolved ?? {
          chain: dexChain,
          contractAddress: dexAddress,
          source: "dexscreener_token_url",
        }
      );
    }

    return await resolveDexScreenerPair(dexChain, dexAddress).catch(() => null);
  }

  if (evmAddress) {
    const requestedEvmChain = chain && getChainFamily(chain) === "evm" ? chain : undefined;
    const resolved = await resolveContractAddress(contractAddress, requestedEvmChain).catch(() => null);
    const fallbackChain = requestedEvmChain ? normalizeScanNetworkId(requestedEvmChain) : chain ? null : "base";

    return resolved ?? (fallbackChain ? { chain: fallbackChain, contractAddress, source: "contract_address" } : null);
  }

  return null;
}
