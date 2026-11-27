import { NextRequest, NextResponse } from "next/server";
import { withCacheHeaders } from "@/server/cache/strategy";
import { checkRateLimit } from "@/server/security/rateLimit";
import { getAgentRunRecord, getDecisionDetail, getSourceSnapshotDetails } from "@/server/storage";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rateLimited = checkRateLimit(request, { namespace: "history:agent-run-detail", limit: 80, windowMs: 60_000 });

  if (rateLimited) {
    return rateLimited;
  }

  const { id } = await params;
  const record = await getAgentRunRecord(id);

  if (!record) {
    return NextResponse.json({ error: "agent_run_not_found" }, { status: 404 });
  }

  const decisionDetail = await getDecisionDetail(id);
  const sourceSnapshots = await getSourceSnapshotDetails(id);

  return withCacheHeaders(
    NextResponse.json({ record, decisionDetail, sourceSnapshots }),
    "history",
  );
}
