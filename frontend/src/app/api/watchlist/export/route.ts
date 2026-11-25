import { WATCHLIST_CSV_HEADERS, escapeWatchlistCsv } from "@/server/discovery/watchlistCsv";
import { NextResponse, NextRequest } from "next/server";
import { listWatchlist } from "@/server/discovery/watchlist";
import { resolveWalletSession } from "@/server/security/walletSession";
import { WatchlistExportFormat, WatchlistExportRow } from "@/server/types";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const wallet = url.searchParams.get("wallet");
  
  if (!wallet) {
    return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  }

  const session = resolveWalletSession(request, { suppliedWallet: wallet });
  if (session.response) return session.response;

  const entries = listWatchlist(wallet);

  const exportedRows: WatchlistExportRow[] = entries.map(entry => ({
    version: "1.0.0",
    chain: entry.chain,
    network: entry.network,
    assetType: entry.assetType,
    contractAddress: entry.contractAddress,
    pairAddress: entry.pairAddress,
    symbol: entry.symbol,
    tokenName: entry.tokenName,
    assetKey: entry.assetKey,
    issuer: entry.issuer,
    source: entry.source,
    note: entry.note,
    createdAt: entry.createdAt,
  }));

  const format = url.searchParams.get("format") || "json";

  if (format === "csv") {
    // Generate CSV
    const headers = WATCHLIST_CSV_HEADERS;
    const csvRows = exportedRows.map(row => headers.map(header => escapeWatchlistCsv(row[header])).join(","));
    const csvString = [headers.join(","), ...csvRows].join("\n");

    return new NextResponse(csvString, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="watchlist_${wallet}.csv"`
      }
    });
  }

  const exportData: WatchlistExportFormat = {
    version: "1.0.0",
    walletAddress: wallet,
    exportedAt: new Date().toISOString(),
    entries: exportedRows,
  };

  return NextResponse.json(exportData);
}
