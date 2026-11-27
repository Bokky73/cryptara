import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { resolveWalletSession } from "@/server/security/walletSession";
import { checkRateLimitProfile } from "@/server/security/rateLimit";
import { getAuditSourceRecords } from "@/server/storage";
import { buildAuditBundle, buildAuditBundleHash } from "@/server/privacy/auditBundle";
import { redactDecision, redactApproval, redactTransaction } from "@/server/privacy/auditRedaction";
import { AUDIT_EXPORT_PRODUCT_VERSION, getAuditExportConfig } from "@/server/privacy/config";
import { recordAuditEvent } from "@/server/observability/executionAudit";

export const dynamic = "force-dynamic";

/** Extract an optional explicit record selection from the request body. */
function parseSelection(body: unknown): string[] | undefined {
  if (body && typeof body === "object" && Array.isArray((body as { recordIds?: unknown }).recordIds)) {
    const ids = (body as { recordIds: unknown[] }).recordIds
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim().slice(0, 160));
    return ids.length > 0 ? ids : undefined;
  }
  return undefined;
}

/**
 * Export a verifiable, redacted audit bundle for the authenticated wallet.
 * Requires a wallet-scoped session; never selects or exports another wallet's
 * records. The bundle is hashed and returned but never retained server-side.
 */
export async function POST(request: NextRequest) {
  const rateLimited = checkRateLimitProfile(request, "alertRead");
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => ({}));
  const suppliedWallet = typeof body?.walletAddress === "string" ? body.walletAddress : undefined;
  const network = typeof body?.network === "string" ? body.network : undefined;
  const chainFamily = body?.chainFamily === "stellar" ? "stellar" : "evm";

  const session = resolveWalletSession(request, { suppliedWallet });
  if (session.response) return session.response;

  const config = getAuditExportConfig();
  const selection = parseSelection(body);

  if (selection && selection.length > config.maxSelectionRecords) {
    return NextResponse.json(
      { error: "selection_too_large", detail: `Selection exceeds ${config.maxSelectionRecords} records.` },
      { status: 413 },
    );
  }

  const source = await getAuditSourceRecords(session.wallet);
  const selectionSet = selection ? new Set(selection) : undefined;

  const decisions = source.decisions
    .filter((r) => !selectionSet || selectionSet.has(r.id))
    .slice(0, config.maxRecordsPerSection);
  const approvals = source.approvals
    .filter((r) => !selectionSet || selectionSet.has(r.id))
    .slice(0, config.maxRecordsPerSection);
  const transactions = source.transactions
    .filter((r) => !selectionSet || selectionSet.has(r.hash))
    .slice(0, config.maxRecordsPerSection);

  const bundle = buildAuditBundle({
    walletAddress: session.wallet,
    chainFamily,
    network,
    productVersion: AUDIT_EXPORT_PRODUCT_VERSION,
    decisions,
    approvals,
    transactions,
    redact: { decision: redactDecision, approval: redactApproval, transaction: redactTransaction },
  });

  const hash = buildAuditBundleHash(bundle);
  const payload = JSON.stringify({ bundle, hash });

  if (Buffer.byteLength(payload, "utf8") > config.maxBundleBytes) {
    return NextResponse.json(
      { error: "bundle_too_large", detail: `Bundle exceeds ${config.maxBundleBytes} bytes.` },
      { status: 413 },
    );
  }

  // Record an audit event (no bundle bytes retained).
  recordAuditEvent({
    id: `audit_export_${Date.now().toString(36)}`,
    correlationId: `export_${Date.now().toString(36)}`,
    kind: "privacy_export",
    occurredAt: new Date().toISOString(),
    outcome: "ok",
    network,
    detail: JSON.stringify({
      walletHash: bundle.scope.walletHash,
      decisions: decisions.length,
      approvals: approvals.length,
      transactions: transactions.length,
    }),
  });

  const response = NextResponse.json({ bundle, hash });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
