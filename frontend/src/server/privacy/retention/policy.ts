/**
 * Per-table retention policy declarations for Cryptara.
 *
 * Every product table that holds wallet-linked records is listed here with:
 *  - retentionDays: how long records are kept before purge-eligibility
 *  - strategy: "delete" removes rows; "anonymize" nullifies identity columns
 *  - chainScoped: whether the policy applies per-chain (evm vs stellar)
 *  - legalBasis: documented rationale or compliance anchor
 *  - walletColumns: identity columns that must be cleared on anonymization
 *  - retentionEnvVar: optional env-var that overrides the default
 *
 * Strategies:
 *  - "delete"    – Hard-delete the row; referential integrity via ON DELETE CASCADE
 *  - "anonymize" – NULL-out wallet identity columns; row is preserved for audit/aggregate
 *
 * Tables whose rows must survive erasure (public ledger, aggregate metrics) are
 * listed with strategy "anonymize" and a stated retention rationale.
 */

export type RetentionStrategy = "delete" | "anonymize";

export interface TableRetentionPolicy {
  /** Logical table name matching schema.sql. */
  table: string;
  /** Days after which the record becomes purge-eligible (0 = delete on request). */
  retentionDays: number;
  /** How to handle the record at expiry or on erasure request. */
  strategy: RetentionStrategy;
  /** Columns carrying wallet identity that must be removed on anonymize. */
  walletColumns: string[];
  /** Whether the policy is scoped per chain-family (evm / stellar). */
  chainScoped: boolean;
  /**
   * Documented rationale: why this window and strategy were chosen.
   * References GDPR Art.17, CCPA §1798.105, or operational necessity.
   */
  legalBasis: string;
  /** Environment variable name that operators may set to override retentionDays. */
  retentionEnvVar?: string;
  /**
   * Whether rows in this table survive a full wallet erasure request (true) or
   * must be deleted / anonymized immediately upon erasure (false = immediate).
   */
  survivesErasure: boolean;
}

// ---------------------------------------------------------------------------
// Default retention windows (days)
// ---------------------------------------------------------------------------
//  These match the values in privacy/config.ts so both systems are consistent.
//  The retention engine reads from config.ts (environment-overridable).
//  The policy table here is the human-readable declaration.

const AGENT_RUNS_DAYS = 90;
const ALERT_OBSERVATIONS_DAYS = 30;
const ALERTS_DAYS = 90;
const WATCHLIST_RUNS_DAYS = 90;
const TRANSACTIONS_UNLINK_DAYS = 365;
const X402_RECEIPTS_UNLINK_DAYS = 1095; // 3 years accounting compliance

// ---------------------------------------------------------------------------
// Policy catalogue
// ---------------------------------------------------------------------------

export const RETENTION_POLICIES: readonly TableRetentionPolicy[] = [
  // ── Wallet registry ──────────────────────────────────────────────────────
  {
    table: "wallets",
    retentionDays: 0,
    strategy: "delete",
    walletColumns: ["address"],
    chainScoped: false,
    survivesErasure: false,
    legalBasis:
      "GDPR Art.17 right to erasure. The wallets table is a session-only registry; " +
      "no downstream aggregate depends on it. Hard-delete on request.",
  },

  // ── Agent evaluation ─────────────────────────────────────────────────────
  {
    table: "agent_runs",
    retentionDays: AGENT_RUNS_DAYS,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: false,
    survivesErasure: false,
    retentionEnvVar: "RETENTION_AGENT_RUNS_DAYS",
    legalBasis:
      "Operational necessity: 90-day window supports dispute resolution and model " +
      "quality monitoring. ON DELETE CASCADE removes agent_results and source_snapshots. " +
      "Deleted immediately on erasure request regardless of age.",
  },
  {
    table: "agent_results",
    retentionDays: AGENT_RUNS_DAYS,
    strategy: "delete",
    walletColumns: [],
    chainScoped: false,
    survivesErasure: false,
    legalBasis:
      "Cascade-deleted by agent_runs. No independent wallet identity column.",
  },
  {
    table: "source_snapshots",
    retentionDays: AGENT_RUNS_DAYS,
    strategy: "delete",
    walletColumns: [],
    chainScoped: false,
    survivesErasure: false,
    legalBasis:
      "Cascade-deleted by agent_runs (or agent_results). No independent wallet identity column.",
  },

  // ── Recommendations ──────────────────────────────────────────────────────
  {
    table: "recommendations",
    retentionDays: AGENT_RUNS_DAYS,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: false,
    survivesErasure: false,
    retentionEnvVar: "RETENTION_AGENT_RUNS_DAYS",
    legalBasis:
      "Operational necessity: same 90-day window as agent_runs. Deleted immediately on erasure.",
  },

  // ── Approvals ────────────────────────────────────────────────────────────
  {
    table: "approvals",
    retentionDays: 180,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: true,
    survivesErasure: false,
    legalBasis:
      "Operational necessity: 6-month window supports post-trade dispute resolution. " +
      "Deleted on erasure request. Network-scoped so EVM and Stellar records are independent.",
  },

  // ── Transactions (audit-preserved, anonymized) ───────────────────────────
  {
    table: "transactions",
    retentionDays: TRANSACTIONS_UNLINK_DAYS,
    strategy: "anonymize",
    walletColumns: ["wallet_address", "source_account"],
    chainScoped: true,
    survivesErasure: true,
    retentionEnvVar: "RETENTION_TRANSACTIONS_UNLINK_DAYS",
    legalBasis:
      "Financial audit compliance: transaction hashes are public ledger facts. " +
      "Row is retained for aggregate risk metrics but wallet identity columns are " +
      "irreversibly NULL-ed at deletion or after 365 days. GDPR Recital 26: " +
      "anonymized data is no longer personal data.",
  },

  // ── X402 payment receipts (accounting-preserved, anonymized) ────────────
  {
    table: "x402_payment_receipts",
    retentionDays: X402_RECEIPTS_UNLINK_DAYS,
    strategy: "anonymize",
    walletColumns: ["wallet_address", "payer"],
    chainScoped: true,
    survivesErasure: true,
    retentionEnvVar: "RETENTION_X402_RECEIPTS_UNLINK_DAYS",
    legalBasis:
      "Accounting compliance: payment receipts must be retained for 3 years for " +
      "tax and settlement audit purposes. Wallet identity columns are irreversibly " +
      "NULL-ed on erasure or after 1095 days. Amount, asset, and tx hash are " +
      "preserved without personal linkage.",
  },

  // ── User rules ───────────────────────────────────────────────────────────
  {
    table: "user_rules",
    retentionDays: 0,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: false,
    survivesErasure: false,
    legalBasis:
      "User preference data. No separate retention need beyond account lifetime. " +
      "Deleted on erasure.",
  },

  // ── Alert rules ──────────────────────────────────────────────────────────
  {
    table: "alert_rules",
    retentionDays: 0,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: false,
    survivesErasure: false,
    legalBasis:
      "User preference data. Cascade deletes alerts and alert_deliveries. " +
      "Deleted on erasure.",
  },

  // ── Alert observations ───────────────────────────────────────────────────
  {
    table: "alert_observations",
    retentionDays: ALERT_OBSERVATIONS_DAYS,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: false,
    survivesErasure: false,
    retentionEnvVar: "RETENTION_ALERT_OBSERVATIONS_DAYS",
    legalBasis:
      "Short-lived signal data: 30-day window supports alert deduplication. " +
      "Deleted on erasure.",
  },

  // ── Alerts ───────────────────────────────────────────────────────────────
  {
    table: "alerts",
    retentionDays: ALERTS_DAYS,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: false,
    survivesErasure: false,
    retentionEnvVar: "RETENTION_ALERTS_DAYS",
    legalBasis:
      "Operational history: 90-day window supports user notification review. " +
      "Cascade-deleted with alert_rules or deleted on erasure.",
  },

  // ── Alert deliveries ─────────────────────────────────────────────────────
  {
    table: "alert_deliveries",
    retentionDays: ALERTS_DAYS,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: false,
    survivesErasure: false,
    retentionEnvVar: "RETENTION_ALERTS_DAYS",
    legalBasis:
      "Delivery audit log: same 90-day window as alerts. Cascade-deleted. " +
      "Deleted on erasure.",
  },

  // ── Watchlist entries ────────────────────────────────────────────────────
  {
    table: "watchlist_entries",
    retentionDays: 0,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: false,
    survivesErasure: false,
    legalBasis:
      "User preference data. Cascade deletes watchlist_scan_runs. " +
      "Deleted on erasure.",
  },

  // ── Watchlist scan runs ──────────────────────────────────────────────────
  {
    table: "watchlist_scan_runs",
    retentionDays: WATCHLIST_RUNS_DAYS,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: false,
    survivesErasure: false,
    retentionEnvVar: "RETENTION_WATCHLIST_RUNS_DAYS",
    legalBasis:
      "Operational history: 90-day window. Cascade-deleted with watchlist_entries " +
      "or purged independently on retention expiry.",
  },

  // ── Discovery alerts ─────────────────────────────────────────────────────
  {
    table: "discovery_alerts",
    retentionDays: ALERTS_DAYS,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: false,
    survivesErasure: false,
    retentionEnvVar: "RETENTION_ALERTS_DAYS",
    legalBasis:
      "Discovery notification history: same 90-day window as alerts. " +
      "Deleted on erasure.",
  },

  // ── Recovery requests ────────────────────────────────────────────────────
  {
    table: "recovery_requests",
    retentionDays: TRANSACTIONS_UNLINK_DAYS,
    strategy: "delete",
    walletColumns: ["wallet_address"],
    chainScoped: true,
    survivesErasure: false,
    legalBasis:
      "Emergency recovery audit trail: 1-year retention for dispute resolution. " +
      "Hard-deleted on erasure.",
  },

  // ── Risk snapshots (public, immutable, no identity) ──────────────────────
  {
    table: "risk_snapshots",
    retentionDays: 0,
    strategy: "delete",
    walletColumns: [],
    chainScoped: false,
    survivesErasure: true,
    legalBasis:
      "Public, privacy-redacted snapshots: no wallet_address or personal data. " +
      "Immutable by schema trigger. Excluded from erasure scope.",
  },

  // ── Token identities ─────────────────────────────────────────────────────
  {
    table: "token_identities",
    retentionDays: 0,
    strategy: "anonymize",
    walletColumns: ["wallet_address"],
    chainScoped: false,
    survivesErasure: true,
    legalBasis:
      "Token intelligence data (contract_address, symbol, etc.) is not personal. " +
      "wallet_address is NULL-ed on erasure if present. Token data is preserved.",
  },

  // ── Erasure receipts (no wallet identity, append-only) ───────────────────
  {
    table: "erasure_receipts",
    retentionDays: 0,
    strategy: "delete",
    walletColumns: [],
    chainScoped: false,
    survivesErasure: true,
    legalBasis:
      "Erasure receipt table. Contains only a wallet hash (one-way SHA-256), " +
      "not the raw address. Preserved as proof of deletion for compliance audits.",
  },
] as const;

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Look up the policy for a given table. Throws if the table is unregistered. */
export function getTablePolicy(table: string): TableRetentionPolicy {
  const policy = RETENTION_POLICIES.find((p) => p.table === table);
  if (!policy) {
    throw new Error(`No retention policy declared for table "${table}". Add it to retention/policy.ts.`);
  }
  return policy;
}

/** Return only tables with a specific strategy. */
export function getPoliciesByStrategy(strategy: RetentionStrategy): TableRetentionPolicy[] {
  return RETENTION_POLICIES.filter((p) => p.strategy === strategy);
}

/** Return tables that should be erased (not survived) on a wallet erasure request. */
export function getErasureTargetPolicies(): TableRetentionPolicy[] {
  return RETENTION_POLICIES.filter((p) => !p.survivesErasure && p.walletColumns.length > 0);
}

/** Return tables that are anonymized (survive erasure, identity stripped). */
export function getAnonymizationTargetPolicies(): TableRetentionPolicy[] {
  return RETENTION_POLICIES.filter(
    (p) => p.survivesErasure && p.strategy === "anonymize" && p.walletColumns.length > 0,
  );
}
