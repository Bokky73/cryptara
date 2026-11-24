/**
 * CSV serialization for redacted audit bundles.
 *
 * The bundle produced by `server/privacy/auditBundle` is already redacted: only
 * one-way hashes and minimum decision/approval/transaction fields survive. This
 * serializer exports exactly those fields, tagging every row with the bundle
 * hash and its redaction status so the file is self-describing.
 */

import type { AuditBundle } from "@/server/privacy/auditBundle";

export const AUDIT_CSV_HEADERS = [
  "section",
  "id",
  "created_at",
  "type",
  "status",
  "network",
  "asset",
  "value_usd",
  "decision_score",
  "confidence",
  "summary",
  "tx_hash",
  "evidence_sha256",
  "bundle_hash",
  "redaction_status",
] as const;

export const AUDIT_REDACTION_STATUS = "redacted" as const;

/** RFC 4180 field escaping (quote when needed, double embedded quotes). */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function firstEvidenceDigest(evidence: { sha256: string }[]): string {
  return evidence[0]?.sha256 ?? "";
}

/** Flatten a redacted audit bundle into a deterministic RFC 4180 CSV string. */
export function auditBundleToCsv(bundle: AuditBundle, hash: string): string {
  const network = bundle.scope.network ?? "";
  const rows: string[][] = [];

  for (const decision of bundle.decisions) {
    rows.push([
      "decision",
      decision.id,
      decision.createdAt,
      decision.action,
      "",
      network,
      "",
      "",
      decision.decisionScore,
      decision.confidence,
      decision.summary,
      "",
      firstEvidenceDigest(decision.evidence),
      hash,
      AUDIT_REDACTION_STATUS,
    ]);
  }

  for (const approval of bundle.approvals) {
    rows.push([
      "approval",
      approval.id,
      approval.createdAt,
      approval.action ?? "",
      approval.status,
      approval.network ?? network,
      "",
      "",
      "",
      "",
      "",
      approval.txHash,
      "",
      hash,
      AUDIT_REDACTION_STATUS,
    ]);
  }

  for (const transaction of bundle.transactions) {
    rows.push([
      "transaction",
      transaction.hash,
      transaction.createdAt,
      transaction.type,
      transaction.status,
      transaction.network,
      transaction.asset,
      transaction.valueUsd,
      "",
      "",
      "",
      transaction.hash,
      firstEvidenceDigest(transaction.evidence),
      hash,
      AUDIT_REDACTION_STATUS,
    ]);
  }

  const header = [...AUDIT_CSV_HEADERS];
  return [header, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\r\n") + "\r\n";
}
