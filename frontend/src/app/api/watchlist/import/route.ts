import { NextResponse, type NextRequest } from "next/server";
import { parseWatchlistCsvRows } from "@/server/discovery/watchlistCsv";
import {
  MAX_WATCHLIST_IMPORT_BYTES,
  MAX_WATCHLIST_IMPORT_ROWS,
  previewWatchlistImport,
  watchlistAssetKey,
  type WatchlistImportInput,
} from "@/server/discovery/watchlistImport";
import { getWatchlistIdentityKey } from "@/server/identity/tokenIdentity";
import { resolveWalletSession } from "@/server/security/walletSession";
import {
  addWatchlistEntriesBulk,
  ensureStorageReady,
  listWatchlistEntries,
  updateWatchlistEntryDetails,
} from "@/server/storage";
import type { WatchlistEntryInput, WatchlistExportRow } from "@/server/types";

type PendingEntry = WatchlistEntryInput & { identityKey: string };

const DETAIL_FIELDS = ["note", "pairAddress", "symbol", "tokenName"] as const;

function pickDetails(row: Partial<WatchlistExportRow>) {
  return Object.fromEntries(DETAIL_FIELDS.flatMap((field) => (row[field] ? [[field, row[field]]] : [])));
}

async function readInputs(request: NextRequest): Promise<WatchlistImportInput[] | NextResponse> {
  const contentType = request.headers.get("content-type") || "";

  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_WATCHLIST_IMPORT_BYTES) {
      return NextResponse.json({ error: "File too large" }, { status: 413 });
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (contentType.includes("application/json")) {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.entries)) {
        return NextResponse.json({ error: "Invalid JSON format. Expected { entries: [] }" }, { status: 400 });
      }
      if (data.entries.length > MAX_WATCHLIST_IMPORT_ROWS) {
        return NextResponse.json({ error: "Too many rows" }, { status: 413 });
      }
      return data.entries.map((value: unknown) => ({ value }));
    }
    if (contentType.includes("text/csv")) return parseWatchlistCsvRows(text, MAX_WATCHLIST_IMPORT_ROWS);
    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  } catch {
    return NextResponse.json({ error: "Failed to parse input" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const suppliedWallet = searchParams.get("wallet");
  const strategy = searchParams.get("strategy") ?? "skip";

  if (!suppliedWallet) {
    return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  }
  if (strategy !== "skip" && strategy !== "update") {
    return NextResponse.json({ error: "strategy must be skip or update" }, { status: 400 });
  }

  const session = resolveWalletSession(request, { suppliedWallet });
  if (session.response) return session.response;
  const wallet = session.wallet!;

  const inputs = await readInputs(request);
  if (inputs instanceof NextResponse) return inputs;

  await ensureStorageReady();
  const existing = listWatchlistEntries(wallet);
  const result = previewWatchlistImport(inputs, existing);

  for (const rowResult of result.results) {
    if (rowResult.row.chain && rowResult.status !== "invalid") {
      rowResult.canonicalIdentityKey = getWatchlistIdentityKey({ ...rowResult.row, chain: rowResult.row.chain });
    }
  }

  if (searchParams.get("dry_run") === "true") {
    return NextResponse.json(result);
  }

  // All or nothing: the client excludes invalid rows explicitly.
  if (result.invalidCount > 0) {
    return NextResponse.json({ error: "Cannot apply import with invalid rows", result }, { status: 400 });
  }

  const existingByKey = new Map(existing.map((entry) => [watchlistAssetKey(entry), entry]));
  const pending = new Map<string, PendingEntry>();

  for (const rowResult of result.results) {
    const { row, assetKey, canonicalIdentityKey } = rowResult;
    if (!assetKey || !canonicalIdentityKey || !row.chain) continue;

    const current = existingByKey.get(assetKey);
    const queued = pending.get(assetKey);
    if (!current && !queued) {
      pending.set(assetKey, {
        walletAddress: wallet,
        chain: row.chain,
        network: row.network,
        assetType: row.assetType as WatchlistEntryInput["assetType"],
        contractAddress: row.contractAddress,
        pairAddress: row.pairAddress,
        symbol: row.symbol,
        tokenName: row.tokenName,
        assetKey: row.assetKey,
        issuer: row.issuer,
        source: row.source as WatchlistEntryInput["source"],
        note: row.note,
        identityKey: canonicalIdentityKey,
      });
      rowResult.outcome = "imported";
    } else if (strategy === "skip") {
      rowResult.outcome = "skipped";
    } else {
      if (current) updateWatchlistEntryDetails(current.id, pickDetails(row));
      else if (queued) Object.assign(queued, pickDetails(row));
      rowResult.outcome = "updated";
    }
  }

  const { appliedCount } = addWatchlistEntriesBulk([...pending.values()]);
  const outcomeCount = (outcome: string) => result.results.filter((entry) => entry.outcome === outcome).length;

  return NextResponse.json({
    success: true,
    appliedCount,
    updatedCount: outcomeCount("updated"),
    skippedCount: outcomeCount("skipped"),
    result,
  });
}
