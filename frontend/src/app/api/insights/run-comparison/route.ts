import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/server/security/rateLimit";
import { COMPARISON_LIMITS, RunComparisonError, type RunReader } from "@/server/research/run-comparison/schema";
import { compareRuns } from "@/server/research/run-comparison/service";

/**
 * Read-only comparison of two saved runs.
 *
 * The reader handed to the service has one method, and it is a read — there is
 * no path from this endpoint to starting an agent, recording a replay or
 * changing a stored record. Ownership is verified in the feature before any
 * field of either run reaches the response.
 */
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" } as const;

/** Test seam: lets the route be driven against fixture runs. */
let readerOverride: RunReader | null = null;

export function setRunReader(next: RunReader | null) {
  readerOverride = next;
}

function storageReader(): RunReader {
  return {
    // Storage is imported lazily so the module graph is pulled in only when a
    // request actually reaches it, and the read stays on the server side of
    // the `server-only` boundary.
    async getRun({ runId, walletAddress }) {
      const { getAgentRunRecord } = await import("@/server/storage");
      const record = await getAgentRunRecord(runId);

      // Filtered here as well as in the feature: the record leaves storage
      // only if it belongs to the caller.
      if (!record || record.walletAddress?.toLowerCase() !== walletAddress.trim().toLowerCase()) return null;

      return record;
    },
  };
}

export async function POST(request: NextRequest) {
  const rateLimited = checkRateLimit(request, { namespace: "run-comparison", limit: 40, windowMs: 60_000 });

  if (rateLimited) {
    return rateLimited;
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(declaredLength) && declaredLength > COMPARISON_LIMITS.maxRequestBytes) {
    return NextResponse.json({ error: "payload_too_large", limitBytes: COMPARISON_LIMITS.maxRequestBytes }, { status: 413 });
  }

  let body: unknown;

  try {
    body = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const report = await compareRuns(body, readerOverride ?? storageReader());

    return NextResponse.json({ report }, { headers: noStore });
  } catch (error) {
    if (error instanceof RunComparisonError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: error.status, headers: noStore },
      );
    }

    return NextResponse.json({ error: "run_comparison_failed" }, { status: 500, headers: noStore });
  }
}
