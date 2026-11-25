import { StrKey } from "@stellar/stellar-sdk";
import { getAddress, isAddress } from "viem";
import { getScanNetwork, normalizeScanNetworkId, scanNetworks } from "@/lib/scanNetworks";

export type TokenInputKind = "evm-address" | "stellar-classic" | "soroban-contract" | "dexscreener-url" | "symbol";

export type TokenInputIssueCode =
  | "empty" | "too_long" | "invalid_evm_address" | "invalid_evm_checksum"
  | "invalid_stellar_asset" | "invalid_dexscreener_url" | "unsupported_dexscreener_chain";

export type ParsedTokenQuery =
  | { ok: true; kind: TokenInputKind; query: string; address: string; suggestedChain?: string; pairAddress?: string; warning?: "invalid_evm_checksum" }
  | { ok: false; code: TokenInputIssueCode; suggestedChain?: string };

type SuccessfulQuery = Extract<ParsedTokenQuery, { ok: true }>;

const maxInputLength = 260;
const evmAddressPattern = /^0x[0-9a-fA-F]{40}$/;
const stellarCodePattern = /^[A-Z0-9]{1,12}$/;
const stellarShortKeyPattern = /^[CG][A-Z0-9]{8,}$/i;
const dexHosts = new Set(["dexscreener.com", "www.dexscreener.com"]);
const httpUrlPattern = /^https?:\/\//i;
const dexHostPattern = /^(?:https?:\/\/)?(?:www\.)?dexscreener\.com(?:\/|$)/i;

export function isSupportedScanNetwork(network?: string): boolean {
  return Boolean(getScanNetwork(normalizeScanNetworkId(network)));
}

function checksumAddress(address: string) {
  return getAddress(address.toLowerCase());
}

function stellarSuggestion(options?: { chain?: string }) {
  const network = options?.chain ? getScanNetwork(normalizeScanNetworkId(options.chain)) : undefined;

  return network?.chainFamily === "stellar" ? network.id : "stellar-testnet";
}

function parseEvmAddress(value: string): SuccessfulQuery | null {
  if (!evmAddressPattern.test(value)) return null;

  const letters = value.slice(2).replace(/[0-9]/g, "");
  const hasLower = /[a-f]/.test(letters);
  const hasUpper = /[A-F]/.test(letters);
  const warning: "invalid_evm_checksum" | undefined = hasLower && hasUpper && !isAddress(value, { strict: true }) ? "invalid_evm_checksum" : undefined;
  const address = checksumAddress(value);

  return { ok: true, kind: "evm-address", query: address, address, ...(warning ? { warning } : {}) };
}

function parseStellarValue(value: string, suggestedChain: string): SuccessfulQuery | null {
  if (/^(?:xlm|native)$/i.test(value)) {
    return { ok: true, kind: "stellar-classic", query: "XLM", address: "XLM", suggestedChain };
  }

  if (StrKey.isValidContract(value)) {
    const address = value.toUpperCase();

    return { ok: true, kind: "soroban-contract", query: address, address, suggestedChain };
  }

  const separator = value.indexOf(":");
  if (separator > 0) {
    const code = value.slice(0, separator).toUpperCase();
    const issuer = value.slice(separator + 1);

    if (stellarCodePattern.test(code) && StrKey.isValidEd25519PublicKey(issuer)) {
      const address = issuer.toUpperCase();

      return { ok: true, kind: "stellar-classic", query: `${code}:${address}`, address, suggestedChain };
    }

    return null;
  }

  return null;
}

function findDexNetwork(segment: string) {
  const normalized = segment.trim().toLowerCase();
  const byId = getScanNetwork(normalizeScanNetworkId(normalized));

  if (byId) return byId;

  return scanNetworks.find((network) => network.dexScreenerChainId?.toLowerCase() === normalized);
}

function isDexHost(hostname: string) {
  return dexHosts.has(hostname.toLowerCase());
}

function parseDexScreenerUrl(value: string, options?: { chain?: string }): ParsedTokenQuery | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || !isDexHost(url.hostname) || url.port || url.username || url.password || url.search || url.hash) {
    return { ok: false, code: "invalid_dexscreener_url" };
  }

  const segments = url.pathname.split("/");
  if (segments.length !== 3 || segments[0] !== "" || !segments[1] || !segments[2]) {
    return { ok: false, code: "invalid_dexscreener_url" };
  }

  const [firstSegment, encodedAddress] = segments.slice(1);
  let addressValue: string;

  try {
    addressValue = decodeURIComponent(encodedAddress);
  } catch {
    return { ok: false, code: "invalid_dexscreener_url" };
  }

  const tokenPath = firstSegment.toLowerCase() === "token";
  const addressLooksStellar = /^[CG][A-Z0-9]{20,}$/i.test(addressValue) || addressValue.includes(":");
  const requestedNetwork = options?.chain ? getScanNetwork(normalizeScanNetworkId(options.chain)) : undefined;
  const selectedSegment = tokenPath ? requestedNetwork?.id ?? (addressLooksStellar ? "stellar" : "base") : firstSegment;
  const network = findDexNetwork(selectedSegment);

  if (!network) return { ok: false, code: "unsupported_dexscreener_chain" };

  const suggestedChain = network.id;
  const stellarNetwork = network.chainFamily === "stellar" ? suggestedChain : stellarSuggestion({ chain: suggestedChain });

  if (network.chainFamily === "stellar") {
    const stellar = parseStellarValue(addressValue, stellarNetwork);

    if (!stellar) return { ok: false, code: "invalid_stellar_asset", suggestedChain };

    return {
      ok: true,
      kind: "dexscreener-url",
      query: value,
      address: stellar.address,
      suggestedChain,
      ...(tokenPath ? {} : { pairAddress: stellar.address }),
    };
  }

  const evm = parseEvmAddress(addressValue);
  if (!evm) return { ok: false, code: "invalid_dexscreener_url" };

  return {
    ok: true,
    kind: "dexscreener-url",
    query: value,
    address: evm.address,
    suggestedChain,
    ...(tokenPath ? {} : { pairAddress: evm.address }),
    ...(evm.warning ? { warning: evm.warning } : {}),
  };
}

function looksLikeStellarInput(value: string) {
  return /^(?:xlm|native)$/i.test(value) || value.includes(":") || stellarShortKeyPattern.test(value);
}

export function parseTokenQuery(raw: string, options?: { chain?: string }): ParsedTokenQuery {
  const value = typeof raw === "string" ? raw.trim() : "";

  if (!value) return { ok: false, code: "empty" };
  if (value.length > maxInputLength) return { ok: false, code: "too_long" };

  if (httpUrlPattern.test(value) || dexHostPattern.test(value)) {
    const dex = parseDexScreenerUrl(value, options);

    return dex ?? { ok: false, code: "invalid_dexscreener_url" };
  }

  const evm = parseEvmAddress(value);
  if (evm) return evm;
  if (/^0x/i.test(value)) return { ok: false, code: "invalid_evm_address" };

  if (looksLikeStellarInput(value)) {
    const suggestedChain = stellarSuggestion(options);
    const stellar = parseStellarValue(value, suggestedChain);

    return stellar ?? { ok: false, code: "invalid_stellar_asset", suggestedChain };
  }

  return { ok: true, kind: "symbol", query: value, address: "" };
}
