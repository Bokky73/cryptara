import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/server/security/rateLimit";
import { listTransactionRecords } from "@/server/storage";
import { FEE_LIMITS, FeeAnalysisError, type FeeReader } from "@/server/research/fee-analysis/schema";
import { createEvmReceiptSource } from "@/server/research/fee-analysis/evmReceipt";
import { createStellarMetaSource } from "@/server/research/fee-analysis/stellarMeta";
import { analyseFees } from "@/server/research/fee-analysis/service";

/**
 * Wallet-scoped, read-only fee analysis.
 *
 * Records are fetched for the requested wallet only, and the feature performs
 * its own ownership check on top of that: a record whose owner is not an
 * account the caller named is excluded and reported, rather than quietly
 * aggregated. Nothing is written — no lifecycle record, no finality state, no
 * fee policy — and the endpoint caches nothing.
 */
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" } as const;

function productionReader(): FeeReader {
  const readEvmReceipt = createEvmReceiptSource();
  const readStellarMeta = createStellarMetaSource();

  return { readEvmReceipt, readStellarMeta };
}

export async function POST(request: NextRequest) {
  const rateLimited = checkRateLimit(request, { namespace: "fee-analysis", limit: 20, windowMs: 60_000 });

  if (rateLimited) {
    return rateLimited;
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(declaredLength) && declaredLength > FEE_LIMITS.maxRequestBytes) {
    return NextResponse.json({ error: "payload_too_large", limitBytes: FEE_LIMITS.maxRequestBytes }, { status: 413 });
  }

  let body: unknown;

  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const walletAddress = typeof (body as { walletAddress?: unknown } | null)?.walletAddress === "string"
    ? (body as { walletAddress: string }).walletAddress
    : "";

  if (walletAddress.trim().length === 0) {
    return NextResponse.json({ error: "invalid_request", message: "A wallet address is required." }, { status: 400, headers: noStore });
  }

  try {
    const records = await listTransactionRecords(walletAddress);
    const report = await analyseFees(body, records, productionReader());

    return NextResponse.json({ report }, { headers: noStore });
  } catch (error) {
    if (error instanceof FeeAnalysisError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: 400, headers: noStore },
      );
    }

    return NextResponse.json({ error: "fee_analysis_failed" }, { status: 500, headers: noStore });
  }
}
