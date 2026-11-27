import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveWalletSession } from "@/server/security/walletSession";
import { checkRateLimitProfile } from "@/server/security/rateLimit";
import { eraseWalletData } from "@/server/privacy/retention/erase";
import { deleteWalletDataFromPg } from "@/server/storage";
import { isPersistentStorage } from "@/server/storage/adapters";
import type { PgErasureResult } from "@/server/privacy/retention/erase";

/**
 * POST /api/wallet-privacy/delete
 * DELETE /api/wallet-privacy/delete
 *
 * Full erasure workflow:
 *  1. Erase every in-memory record linked to the wallet identity
 *  2. Delegate to Postgres for persistent erasure
 *  3. Run the residue check
 *  4. Return a tamper-evident erasure receipt the requester can verify
 *
 * Chain-scoping: erasing an EVM wallet never affects a Stellar wallet.
 */

async function pgEraseDelegate(
  walletAddress: string,
  network: string | undefined,
  chainFamily: "evm" | "stellar",
): Promise<PgErasureResult> {
  if (!isPersistentStorage()) {
    return { tables: [] };
  }
  const result = await deleteWalletDataFromPg(walletAddress, network, chainFamily);
  return {
    tables: [
      {
        table: "pg_deleted",
        action: "deleted",
        rowsAffected: result.deletedCount,
        strategy: "delete",
      },
      {
        table: "pg_anonymized",
        action: "anonymized",
        rowsAffected: result.unlinkedAuditCount,
        strategy: "anonymize",
      },
    ],
  };
}

export async function DELETE(request: NextRequest) {
  const rateLimited = checkRateLimitProfile(request, "alertRuleWrite");
  if (rateLimited) return rateLimited;

  const url = new URL(request.url);
  const suppliedWallet = url.searchParams.get("walletAddress");
  const network = url.searchParams.get("network") ?? undefined;
  const chainFamily = (url.searchParams.get("chainFamily") as "evm" | "stellar") ?? undefined;

  const session = resolveWalletSession(request, { suppliedWallet });
  if (session.response) return session.response;

  return handleErasure(session.wallet!, network, chainFamily);
}

export async function POST(request: NextRequest) {
  const rateLimited = checkRateLimitProfile(request, "alertRuleWrite");
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => ({}));
  const suppliedWallet = typeof body?.walletAddress === "string" ? body.walletAddress : undefined;
  const network = typeof body?.network === "string" ? body.network : undefined;
  const chainFamily =
    body?.chainFamily === "evm" || body?.chainFamily === "stellar"
      ? (body.chainFamily as "evm" | "stellar")
      : undefined;

  const session = resolveWalletSession(request, { suppliedWallet });
  if (session.response) return session.response;

  return handleErasure(session.wallet!, network, chainFamily);
}

async function handleErasure(
  walletAddress: string,
  network: string | undefined,
  chainFamily: "evm" | "stellar" | undefined,
): Promise<NextResponse> {
  const normalized = walletAddress.trim();
  const isEvm = normalized.startsWith("0x");
  const resolvedChainFamily: "evm" | "stellar" = chainFamily ?? (isEvm ? "evm" : "stellar");

  try {
    const report = await eraseWalletData(
      { walletAddress: normalized, chainFamily: resolvedChainFamily, network },
      pgEraseDelegate,
    );

    const response = NextResponse.json({
      ok: report.ok,
      deletedAt: report.erasedAt,
      walletAddress: normalized,
      network: report.network,
      chainFamily: report.chainFamily,
      memoryRecordsRemoved: report.memoryReport.tablesProcessed.reduce(
        (s, t) => (t.action === "deleted" ? s + t.rowsAffected : s),
        0,
      ),
      memoryAuditRecordsUnlinked: report.memoryReport.tablesProcessed.reduce(
        (s, t) => (t.action === "anonymized" ? s + t.rowsAffected : s),
        0,
      ),
      portfolioCacheEvicted: report.memoryReport.portfolioCacheEvicted,
      pgResult: {
        deletedCount: report.pgReport?.tablesProcessed.find((t) => t.table === "pg_deleted")?.rowsAffected ?? 0,
        unlinkedAuditCount: report.pgReport?.tablesProcessed.find((t) => t.table === "pg_anonymized")?.rowsAffected ?? 0,
      },
      residueCheckPassed: report.residueCheckPassed,
      receipt: report.receipt,
      ...(report.partialFailure
        ? { partialFailure: true, partialFailureDetail: report.partialFailureDetail, retryable: true }
        : {}),
    });

    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        deletedAt: new Date().toISOString(),
        walletAddress: normalized,
        error: message,
        partialFailure: true,
        retryable: true,
      },
      { status: 500 },
    );
  }
}
