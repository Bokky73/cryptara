import { isAddress } from "viem";
import {
  canonicalClassicAssetKey,
  canonicalizeAddress,
  getChainFamily,
  isStellarAccountAddress,
  isStellarContractAddress,
  normalizeNetwork,
} from "@/lib/chainIdentity";

export type CanonicalIdentityStatus = "resolved" | "ambiguous" | "unresolved" | "rejected";

export type CanonicalTokenCandidate = {
  chain: string;
  network?: string;
  contractAddress?: string;
  assetKey?: string;
  issuer?: string;
  symbol?: string;
  tokenName?: string;
  source: string;
};

export type CanonicalTokenInput = CanonicalTokenCandidate & {
  candidates?: CanonicalTokenCandidate[];
  warningAcknowledged?: boolean;
};

export type CanonicalTokenResolution = {
  status: CanonicalIdentityStatus;
  identityKey?: string;
  chainFamily: "evm" | "stellar";
  network?: string;
  symbol?: string;
  tokenName?: string;
  contractAddress?: string;
  issuer?: string;
  assetKey?: string;
  confidence: number;
  evidence: string[];
  warnings: string[];
  candidates: string[];
};

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/u;
const LATIN = /[A-Za-z]/u;
const CYRILLIC = /[\u0400-\u04FF]/u;
const GREEK = /[\u0370-\u03FF]/u;
const CONFUSABLES: Record<string, string> = { "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x" };

function inspectLabel(value: string | undefined, field: string, warnings: string[]) {
  if (!value) return;
  const normalized = value.normalize("NFKC");
  if (ZERO_WIDTH.test(value)) warnings.push(`${field} contains zero-width characters`);
  if ((LATIN.test(normalized) && CYRILLIC.test(normalized)) || (LATIN.test(normalized) && GREEK.test(normalized))) {
    warnings.push(`${field} mixes writing systems`);
  }
  if ([...normalized].some((character) => CONFUSABLES[character])) warnings.push(`${field} contains homoglyph characters`);
}

/** Extract a bare address from a CAIP-19 / explorer URL / raw address input. */
function extractAddress(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const caip = trimmed.match(/^eip155:\d+\/erc20:(0x[0-9a-fA-F]{40})$/u);
  if (caip) return caip[1];
  const url = trimmed.match(/(0x[0-9a-fA-F]{40})/u);
  if (url) return url[1];
  return trimmed;
}

function candidateKey(candidate: CanonicalTokenCandidate): string | undefined {
  const family = getChainFamily(candidate.chain);
  const network = normalizeNetwork(candidate.network ?? candidate.chain, family);
  if (family === "evm") {
    const address = extractAddress(candidate.contractAddress);
    if (!address || !isAddress(address)) return undefined;
    return `eip155:${network}/erc20:${address.toLowerCase()}`;
  }
  if (candidate.assetKey && candidate.issuer) {
    if (!isStellarAccountAddress(candidate.issuer)) return undefined;
    return `stellar:${network}/asset:${canonicalClassicAssetKey(candidate.assetKey, candidate.issuer)}`;
  }
  if (candidate.contractAddress) {
    if (!isStellarContractAddress(candidate.contractAddress)) return undefined;
    return `stellar:${network}/asset:${canonicalizeAddress(candidate.contractAddress, "stellar")}`;
  }
  if (candidate.assetKey === "native" || candidate.symbol?.toUpperCase() === "XLM") return `stellar:${network}/asset:native`;
  return undefined;
}

function candidateLabel(candidate: CanonicalTokenCandidate) {
  return candidateKey(candidate) ?? `${candidate.chain}:${candidate.symbol ?? candidate.tokenName ?? "unknown"}`;
}

/** Resolve a token to a chain/network-scoped identity and fail closed on ambiguity. */
export function resolveCanonicalTokenIdentity(input: CanonicalTokenInput): CanonicalTokenResolution {
  const family = getChainFamily(input.chain);
  const warnings: string[] = [];
  const evidence: string[] = [];
  inspectLabel(input.symbol, "symbol", warnings);
  inspectLabel(input.tokenName, "token name", warnings);
  const key = candidateKey(input);
  if (input.contractAddress && !key && family === "evm") warnings.push("contract address is invalid for the requested chain");
  if (input.issuer && !isStellarAccountAddress(input.issuer)) warnings.push("issuer is not a valid Stellar account");
  if (!key) {
    warnings.push("no canonical contract, issuer asset, or native asset anchor");
    return { status: warnings.some((item) => item.includes("invalid") || item.includes("not a valid")) ? "rejected" : "unresolved", chainFamily: family, confidence: 0, evidence, warnings, candidates: [] };
  }

  evidence.push(family === "evm" ? "chain-scoped contract address" : input.assetKey === "native" ? "native asset anchor" : input.issuer ? "issuer + asset code" : "chain-scoped contract address");
  const allCandidates = [input, ...(input.candidates ?? [])];
  const keys = [...new Set(allCandidates.map(candidateLabel))];
  const ambiguous = keys.length > 1;
  if (ambiguous) warnings.push("multiple canonical candidates were supplied");
  const suspicious = warnings.some((item) => item.includes("zero-width") || item.includes("homoglyph") || item.includes("mixes writing"));
  if (suspicious && !input.warningAcknowledged) warnings.push("explicit warning acknowledgement is required before execution");
  const status: CanonicalIdentityStatus = ambiguous ? "ambiguous" : suspicious && !input.warningAcknowledged ? "rejected" : "resolved";
  const confidence = status === "resolved" ? (suspicious ? 0.62 : 0.94) : ambiguous ? 0.25 : 0.1;
  const network = normalizeNetwork(input.network ?? input.chain, family);
  const evmAddress = family === "evm" ? extractAddress(input.contractAddress) : input.contractAddress;
  return {
    status,
    identityKey: key,
    chainFamily: family,
    network,
    symbol: input.symbol?.normalize("NFKC").trim().toUpperCase(),
    tokenName: input.tokenName?.normalize("NFKC").trim(),
    contractAddress: evmAddress ? canonicalizeAddress(evmAddress, family) : undefined,
    issuer: input.issuer,
    assetKey: input.assetKey,
    confidence,
    evidence,
    warnings,
    candidates: keys,
  };
}

export class CanonicalTokenRegistry {
  private readonly cache = new Map<string, { expiresAt: number; resolution: CanonicalTokenResolution }>();

  constructor(private readonly ttlMs = 60_000, private readonly now: () => number = Date.now) {}

  resolve(input: CanonicalTokenInput) {
    const cacheKey = candidateLabel(input);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.resolution);
    const resolution = resolveCanonicalTokenIdentity(input);
    if (resolution.status === "resolved") this.cache.set(cacheKey, { expiresAt: this.now() + this.ttlMs, resolution });
    return structuredClone(resolution);
  }

  invalidate(identityKey?: string) {
    if (!identityKey) this.cache.clear();
    else this.cache.delete(identityKey);
  }
}
