/**
 * Watchlist import validation shared by the browser preview and the import API,
 * so a row is never accepted by one and rejected by the other. Must stay free of
 * Node-only imports.
 */

import { StrKey } from "@stellar/stellar-sdk";
import { scanNetworks } from "@/lib/scanNetworks";
import type {
  WatchlistExportRow,
  WatchlistImportDryRunResult,
  WatchlistImportDryRunRowResult,
  WatchlistImportSource,
} from "@/server/types";

export const MAX_WATCHLIST_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_WATCHLIST_IMPORT_ROWS = 1000;

const FIELD_LIMITS = {
  chain: 40,
  network: 40,
  assetType: 20,
  contractAddress: 80,
  pairAddress: 120,
  symbol: 32,
  tokenName: 120,
  assetKey: 180,
  issuer: 64,
  note: 280,
} as const;

type Field = keyof typeof FIELD_LIMITS;
export type WatchlistImportRow = Partial<Record<Field, string>> & { version?: string; source: WatchlistImportSource };

const FIELDS = Object.keys(FIELD_LIMITS) as Field[];
const SOURCES: readonly WatchlistImportSource[] = ["dexscreener", "stellar_market", "manual", "manual_watchlist"];
const STELLAR_ASSET_TYPES = ["native", "classic", "contract", "issuer_account", "sac", "sep41"];
const EVM_ADDRESS = /^0x[a-f\d]{40}$/i;
// Uniswap v4 style pools are identified by a 32-byte ID rather than an address.
const EVM_PAIR = /^0x(?:[a-f\d]{40}|[a-f\d]{64})$/i;

function stellarNetwork(value: string | undefined): "pubnet" | "testnet" | null {
  switch ((value ?? "").toLowerCase().replace(/^stellar[-:]/, "")) {
    case "public":
    case "pubnet":
    case "mainnet":
      return "pubnet";
    case "test":
    case "testnet":
      return "testnet";
    default:
      return null;
  }
}

function evmNetworkId(chain: string): string | null {
  const id = chain.toLowerCase().replace(/^eip155:/, "");
  const match = scanNetworks.find((network) => network.chainFamily !== "stellar"
    && (network.id === id || network.goPlusChainId === id || network.aliases?.includes(id)));
  return match?.id ?? null;
}

type Scope = { family: "stellar" | "evm"; network: string };

function resolveScope(row: Partial<Record<Field, string>>): Scope | { error: string } {
  const chain = row.chain?.toLowerCase();
  if (!chain) return { error: "Missing chain." };

  if (chain === "stellar" || /^stellar[-:]/.test(chain)) {
    const fromChain = chain === "stellar" ? null : stellarNetwork(chain);
    if (chain !== "stellar" && !fromChain) return { error: `Unknown chain "${row.chain}".` };
    const fromNetwork = row.network ? stellarNetwork(row.network) : null;
    if (row.network && !fromNetwork) return { error: `Unknown network "${row.network}".` };
    if (fromChain && fromNetwork && fromChain !== fromNetwork) return { error: "Chain and network do not match." };
    return { family: "stellar", network: fromChain ?? fromNetwork ?? "pubnet" };
  }

  const network = evmNetworkId(chain);
  if (!network) return { error: `Unknown chain "${row.chain}".` };
  if (row.network && row.network.toLowerCase() !== "mainnet" && evmNetworkId(row.network) !== network) {
    return { error: evmNetworkId(row.network) ? "Chain and network do not match." : `Unknown network "${row.network}".` };
  }
  return { family: "evm", network };
}

function classicAsset(row: Partial<Record<Field, string>>) {
  const [keyCode, keyIssuer] = row.assetKey?.includes(":") ? row.assetKey.split(":") : [row.assetKey, undefined];
  return { code: (keyCode || row.symbol)?.toUpperCase(), issuer: (row.issuer || keyIssuer)?.toUpperCase() };
}

/** Same asset, same key, however the row spells its chain or address. */
export function watchlistAssetKey(row: Partial<Record<Field, string>>): string | null {
  const scope = resolveScope(row);
  if ("error" in scope) return null;
  const prefix = `${scope.family}:${scope.network}`;

  if (scope.family === "stellar") {
    if (row.assetType === "native" || row.assetKey === "native") return `${prefix}/native`;
    if (row.contractAddress) return `${prefix}/contract:${row.contractAddress.toUpperCase()}`;
    const { code, issuer } = classicAsset(row);
    return issuer ? `${prefix}/asset:${code ?? ""}:${issuer}` : null;
  }
  const asset = row.contractAddress ?? row.assetKey ?? row.pairAddress ?? (row.symbol ? `symbol:${row.symbol}` : null);
  return asset ? `${prefix}/${asset.toLowerCase()}` : null;
}

function validateFields(row: WatchlistImportRow, scope: Scope): string[] {
  const errors: string[] = [];
  if (scope.family === "evm") {
    if (row.assetType && row.assetType !== "contract" && row.assetType !== "native") {
      errors.push(`Asset type "${row.assetType}" does not apply to an EVM chain.`);
    }
    if (row.contractAddress && !EVM_ADDRESS.test(row.contractAddress)) errors.push("Invalid EVM contract address.");
    if (row.pairAddress && !EVM_PAIR.test(row.pairAddress)) errors.push("Invalid EVM pair address.");
    if (!watchlistAssetKey(row)) errors.push("Missing contract address or other asset identifier.");
    return errors;
  }

  if (row.assetType && !STELLAR_ASSET_TYPES.includes(row.assetType)) errors.push(`Unknown asset type "${row.assetType}".`);
  if (row.contractAddress && !StrKey.isValidContract(row.contractAddress)) errors.push("Invalid Stellar contract address.");
  const isNative = row.assetType === "native" || row.assetKey === "native";
  const needsContract = row.assetType === "sac" || row.assetType === "sep41";
  if (needsContract && !row.contractAddress) errors.push("Missing Stellar contract address.");
  if (!isNative && !needsContract && !row.contractAddress) {
    const { code, issuer } = classicAsset(row);
    if (!issuer) errors.push("Stellar assets need a full CODE:ISSUER or a contract address.");
    else if (!StrKey.isValidEd25519PublicKey(issuer)) errors.push("Invalid Stellar issuer address.");
    if (row.assetType !== "issuer_account" && (!code || !/^[A-Z\d]{1,12}$/.test(code))) errors.push("Invalid Stellar asset code.");
  }
  return errors;
}

/** Normalize untrusted input, reporting every problem found in the row. */
export function validateWatchlistImportRow(input: unknown): { row: WatchlistImportRow; errors: string[]; assetKey?: string } {
  const row: WatchlistImportRow = { source: "manual_watchlist" };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { row, errors: ["Row is not an object."] };

  const record = input as Record<string, unknown>;
  const errors: string[] = [];
  for (const field of FIELDS) {
    const value = record[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") {
      errors.push(`${field} must be text.`);
      continue;
    }
    const text = value.trim();
    if (text.length > FIELD_LIMITS[field]) errors.push(`${field} is longer than ${FIELD_LIMITS[field]} characters.`);
    if (text) row[field] = text.slice(0, FIELD_LIMITS[field]);
  }
  row.version = typeof record.version === "string" ? record.version : undefined;
  if (row.version !== "1.0.0") errors.push("Unknown or unsupported schema version.");
  if (record.source) {
    if (SOURCES.includes(record.source as WatchlistImportSource)) row.source = record.source as WatchlistImportSource;
    else errors.push("Unknown source.");
  }

  const scope = resolveScope(row);
  if ("error" in scope) errors.push(scope.error);
  else errors.push(...validateFields(row, scope));
  return { row, errors, assetKey: errors.length ? undefined : watchlistAssetKey(row) ?? undefined };
}

export type WatchlistImportInput = { value: unknown; error?: string };

/** Classify rows in order. The first occurrence of an asset is the original. */
export function previewWatchlistImport(inputs: WatchlistImportInput[], existing: Array<Partial<Record<Field, string>>>): WatchlistImportDryRunResult {
  const existingKeys = new Set(existing.map(watchlistAssetKey));
  const seen = new Set<string>();

  const results = inputs.map(({ value, error }, index): WatchlistImportDryRunRowResult => {
    const { row, errors, assetKey } = validateWatchlistImportRow(value);
    const exportRow = row as Partial<WatchlistExportRow>;
    if (error) return { index, row: exportRow, status: "invalid", errors: [error] };
    if (!assetKey) return { index, row: exportRow, status: "invalid", errors };
    if (seen.has(assetKey)) {
      return { index, row: exportRow, status: "duplicate", errors: ["Repeats an earlier row in this file."], assetKey };
    }
    seen.add(assetKey);
    if (existingKeys.has(assetKey)) {
      return { index, row: exportRow, status: "duplicate", errors: ["Already in your watchlist."], assetKey };
    }
    return { index, row: exportRow, status: "valid", errors: [], assetKey };
  });

  const count = (status: WatchlistImportDryRunRowResult["status"]) => results.filter((result) => result.status === status).length;
  return {
    validCount: count("valid"),
    duplicateCount: count("duplicate"),
    collisionCount: count("collision"),
    invalidCount: count("invalid"),
    totalRows: results.length,
    results,
  };
}
