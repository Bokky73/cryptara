/**
 * Verifiable, privacy-preserving audit bundle export.
 *
 * A compact, versioned artifact that proves how a recommendation became an
 * approval or a terminal transaction state — without exposing unrelated
 * holdings, raw provider payloads, secrets, signed XDR, or full wallet
 * identifiers. Every identifier is one-way hashed at build time; the bundle is
 * canonicalized and hashed so any material change fails verification.
 */

import { createHash } from "node:crypto";

import type {
  RecommendationRecord,
  TransactionRecord,
  UserApprovalRecord,
} from "@/server/types";

export const AUDIT_BUNDLE_VERSION = 1;

/** A one-way digest for evidence referenced by the bundle (no raw payload). */
export interface AuditEvidenceDigest {
  id: string;
  kind: "simulation" | "policy" | "quote" | "receipt";
  sha256: string;
}

/** A redacted decision entry (recommendation → action + score). */
export interface AuditDecisionEntry {
  id: string;
  createdAt: string;
  action: string;
  decisionScore: number;
  confidence: number;
  summary: string;
  evidence: AuditEvidenceDigest[];
}

/** A redacted approval transition (who approved → which tx). */
export interface AuditApprovalEntry {
  id: string;
  createdAt: string;
  txHash: string;
  network?: string;
  action?: string;
  status: string;
}

/** A redacted transaction observation (lifecycle, no signed payload/XDR). */
export interface AuditTransactionEntry {
  hash: string;
  type: string;
  asset: string;
  valueUsd: number;
  status: string;
  createdAt: string;
  terminalAt?: string;
  network: string;
  decisionId?: string;
  evidence: AuditEvidenceDigest[];
}

export interface AuditBundleScope {
  /** SHA-256 of the wallet address — never the raw identifier. */
  walletHash: string;
  chainFamily: string;
  network?: string;
  recordIds: string[];
}

export interface AuditBundle {
  version: typeof AUDIT_BUNDLE_VERSION;
  generatedAt: string;
  product: { name: string; version: string };
  scope: AuditBundleScope;
  decisions: AuditDecisionEntry[];
  approvals: AuditApprovalEntry[];
  transactions: AuditTransactionEntry[];
}

export type AuditBundleSection = "decisions" | "approvals" | "transactions";

/** Stable, deterministic JSON serialization (sorted keys) for hashing. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

/** SHA-256 hex of the canonicalized bundle (the integrity anchor). */
export function buildAuditBundleHash(bundle: AuditBundle): string {
  return createHash("sha256").update(canonicalize(bundle), "utf8").digest("hex");
}

/** One-way wallet identifier used in the bundle scope and audit events. */
export function hashWalletIdentifier(walletAddress: string): string {
  return createHash("sha256").update(walletAddress.trim(), "utf8").digest("hex");
}

/** Digest a piece of evidence without retaining its raw bytes. */
export function digestEvidence(
  id: string,
  kind: AuditEvidenceDigest["kind"],
  payload: string,
): AuditEvidenceDigest {
  return { id, kind, sha256: createHash("sha256").update(payload, "utf8").digest("hex") };
}

export interface BuildAuditBundleInput {
  walletAddress: string;
  chainFamily: string;
  network?: string;
  productVersion: string;
  decisions: RecommendationRecord[];
  approvals: UserApprovalRecord[];
  transactions: TransactionRecord[];
  redact: {
    decision: (r: RecommendationRecord) => AuditDecisionEntry;
    approval: (a: UserApprovalRecord) => AuditApprovalEntry;
    transaction: (t: TransactionRecord) => AuditTransactionEntry;
  };
}

/** Assemble a versioned bundle from already-redacted entries. */
export function buildAuditBundle(input: BuildAuditBundleInput): AuditBundle {
  const decisions = input.decisions.map(input.redact.decision);
  const approvals = input.approvals.map(input.redact.approval);
  const transactions = input.transactions.map(input.redact.transaction);

  const recordIds = [
    ...decisions.map((d) => d.id),
    ...approvals.map((a) => a.id),
    ...transactions.map((t) => t.hash),
  ];

  return {
    version: AUDIT_BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    product: { name: "cryptara", version: input.productVersion },
    scope: {
      walletHash: hashWalletIdentifier(input.walletAddress),
      chainFamily: input.chainFamily,
      network: input.network,
      recordIds,
    },
    decisions,
    approvals,
    transactions,
  };
}
