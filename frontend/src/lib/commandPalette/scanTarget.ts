import { StrKey } from "@stellar/stellar-sdk";
import { isAddress } from "viem";
import { scanNetworks } from "@/lib/scanNetworks";
import type { Command, PaletteScope } from "./schema";

export type ScanRequest = { query: string; chain: string };
export type ScanTarget = ScanRequest & { kind: string };

function parseDexScreener(value: string): ScanTarget | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!["dexscreener.com", "www.dexscreener.com"].includes(url.hostname)) return null;
    const [slug, address] = url.pathname.split("/").filter(Boolean);
    const network = scanNetworks.find(item => item.dexScreenerChainId === slug?.toLowerCase());
    if (!network || !/^0x[0-9a-f]{40}([0-9a-f]{24})?$/i.test(address ?? "")) return null;
    return { kind: "DexScreener link", query: `https://dexscreener.com/${slug.toLowerCase()}/${address}`, chain: network.id };
  } catch { return null; }
}

/** Recognizes complete, valid token identifiers only, so ordinary searches never become scans. */
export function detectScanTarget(input: string, scope: PaletteScope | null): ScanTarget | null {
  const value = input.trim();
  if (isAddress(value)) {
    const chain = scope?.family === "evm" ? scanNetworks.find(item => item.goPlusChainId === scope.network)?.id : undefined;
    return { kind: "EVM contract address", query: value, chain: chain ?? "base" };
  }
  const stellarChain = scope?.family === "stellar" && scope.network === "stellar-pubnet" ? "stellar-pubnet" : "stellar-testnet";
  const asset = /^([a-zA-Z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(value);
  if (asset) return StrKey.isValidEd25519PublicKey(asset[2]) ? { kind: "Stellar asset", query: value, chain: stellarChain } : null;
  if (/^C[A-Z2-7]{55}$/.test(value)) return StrKey.isValidContract(value) ? { kind: "Stellar contract", query: value, chain: stellarChain } : null;
  return /dexscreener\.com\//i.test(value) ? parseDexScreener(value) : null;
}

export function scanHref(request: ScanRequest, run: string): string {
  return `/scan?${new URLSearchParams({ query: request.query, chain: request.chain, run })}`;
}

export function scanCommand(request: ScanRequest, group: "Scan" | "Recent"): Command {
  const network = scanNetworks.find(item => item.id === request.chain)?.name ?? request.chain;
  return { id: JSON.stringify(["scan", request.chain, request.query]), label: group === "Scan" ? "Run AI Risk Scan" : `Scan ${request.query}`,
    description: group === "Scan" ? `${request.query} on ${network}` : `Scanned on ${network}`, href: "/scan", group, keywords: [request.query, request.chain] };
}
