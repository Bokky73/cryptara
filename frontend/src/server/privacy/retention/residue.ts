/**
 * Residue check for Cryptara wallet erasure.
 *
 * After an erasure workflow completes, this module scans every in-memory store
 * and (optionally) Postgres to assert that no wallet identity survived.
 *
 * "Wallet identity" means any field in walletColumns declared by the policy,
 * which for EVM wallets is case-insensitive and for Stellar wallets is
 * case-sensitive.
 *
 * Aggregate-preserved tables (transactions, x402_payment_receipts) are checked
 * to confirm the identity columns are NULL — not that the rows are gone.
 *
 * The check is intentionally conservative: if a field is non-empty and matches
 * the wallet address, it is a leak regardless of context.
 */

export interface ResidueLeakEntry {
  store: string;
  recordId?: string;
  field: string;
  /** Partial value hint for debugging — never the full identifier. */
  hint: string;
}

export interface ErasureResidueResult {
  /** True only if zero identity leaks were found. */
  passed: boolean;
  walletAddress: string;
  chainFamily: "evm" | "stellar";
  checkedAt: string;
  leaks: ResidueLeakEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function walletMatches(fieldValue: string | null | undefined, canonical: string): boolean {
  if (!fieldValue) return false;
  const field = fieldValue.trim();
  const target = canonical.trim();
  return target.startsWith("0x")
    ? field.toLowerCase() === target.toLowerCase()
    : field === target || field.toLowerCase() === target.toLowerCase();
}

function leak(store: string, field: string, value: string, id?: string): ResidueLeakEntry {
  // Truncate to first 8 chars as a hint — never the full address
  return { store, recordId: id, field, hint: value.slice(0, 8) + "…" };
}

// ---------------------------------------------------------------------------
// In-memory residue check
// ---------------------------------------------------------------------------

type MemoryStore = typeof globalThis & {
  __cryptaraAgentRuns?: Array<{ id?: string; walletAddress?: string }>;
  __cryptaraRecommendations?: Array<{ id?: string; walletAddress?: string }>;
  __cryptaraApprovals?: Array<{ id?: string; walletAddress?: string }>;
  __cryptaraUserRules?: Array<{ walletAddress?: string }>;
  __cryptaraAlertRules?: Array<{ id?: string; walletAddress?: string }>;
  __cryptaraAlertObservations?: Array<{ id?: string; walletAddress?: string }>;
  __cryptaraAlerts?: Array<{ id?: string; walletAddress?: string }>;
  __cryptaraAlertDeliveries?: Array<{ id?: string; walletAddress?: string }>;
  __cryptaraWatchlistEntries?: Array<{ id?: string; walletAddress?: string }>;
  __cryptaraWatchlistScanRuns?: Array<{ id?: string; walletAddress?: string }>;
  __cryptaraDiscoveryAlerts?: Array<{ id?: string; walletAddress?: string }>;
  __cryptaraTransactions?: Array<{ id?: string; hash?: string; walletAddress?: string | null; sourceAccount?: string | null }>;
  __cryptaraX402PaymentReceipts?: Array<{ id?: string; walletAddress?: string | null; payer?: string | null }>;
};

/**
 * Scan all in-memory stores for residual wallet identity.
 */
export function checkErasureResidue(
  walletAddress: string,
  chainFamily: "evm" | "stellar",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _network?: string,
): ErasureResidueResult {
  const canonical = walletAddress.trim().startsWith("0x")
    ? walletAddress.trim().toLowerCase()
    : walletAddress.trim();
  const store = globalThis as MemoryStore;
  const leaks: ResidueLeakEntry[] = [];

  // ── Hard-delete tables: no matching row should exist ─────────────────
  const hardDeleteChecks: Array<[keyof MemoryStore, string]> = [
    ["__cryptaraAgentRuns", "agent_runs"],
    ["__cryptaraRecommendations", "recommendations"],
    ["__cryptaraApprovals", "approvals"],
    ["__cryptaraUserRules", "user_rules"],
    ["__cryptaraAlertRules", "alert_rules"],
    ["__cryptaraAlertObservations", "alert_observations"],
    ["__cryptaraAlerts", "alerts"],
    ["__cryptaraAlertDeliveries", "alert_deliveries"],
    ["__cryptaraWatchlistEntries", "watchlist_entries"],
    ["__cryptaraWatchlistScanRuns", "watchlist_scan_runs"],
    ["__cryptaraDiscoveryAlerts", "discovery_alerts"],
  ];

  for (const [key, tableName] of hardDeleteChecks) {
    const list = store[key] as Array<{ id?: string; walletAddress?: string }> | undefined;
    if (!list) continue;
    for (const record of list) {
      if (walletMatches(record.walletAddress, canonical)) {
        leaks.push(leak(tableName, "walletAddress", record.walletAddress!, record.id));
      }
    }
  }

  // ── Anonymize tables: walletAddress and payer must be NULL / empty ────
  {
    const list = store.__cryptaraTransactions;
    if (list) {
      for (const tx of list) {
        const id = tx.id ?? tx.hash;
        if (walletMatches(tx.walletAddress, canonical)) {
          leaks.push(leak("transactions", "walletAddress", tx.walletAddress!, id));
        }
        if (walletMatches(tx.sourceAccount, canonical)) {
          leaks.push(leak("transactions", "sourceAccount", tx.sourceAccount!, id));
        }
      }
    }
  }

  {
    const list = store.__cryptaraX402PaymentReceipts;
    if (list) {
      for (const rec of list) {
        if (walletMatches(rec.walletAddress, canonical)) {
          leaks.push(leak("x402_payment_receipts", "walletAddress", rec.walletAddress!, rec.id));
        }
        if (walletMatches(rec.payer, canonical)) {
          leaks.push(leak("x402_payment_receipts", "payer", rec.payer!, rec.id));
        }
      }
    }
  }

  return {
    passed: leaks.length === 0,
    walletAddress,
    chainFamily,
    checkedAt: new Date().toISOString(),
    leaks,
  };
}

// ---------------------------------------------------------------------------
// Postgres residue check (injected to avoid circular dependency)
// ---------------------------------------------------------------------------

export type PgResidueCheckFn = (
  walletAddress: string,
  chainFamily: "evm" | "stellar",
  network?: string,
) => Promise<ResidueLeakEntry[]>;

/**
 * Full residue check including Postgres.
 * Pass pgCheck = undefined to check memory-only (e.g. in-process tests).
 */
export async function checkFullErasureResidue(
  walletAddress: string,
  chainFamily: "evm" | "stellar",
  network?: string,
  pgCheck?: PgResidueCheckFn,
): Promise<ErasureResidueResult> {
  const memResult = checkErasureResidue(walletAddress, chainFamily, network);
  let pgLeaks: ResidueLeakEntry[] = [];

  if (pgCheck) {
    try {
      pgLeaks = await pgCheck(walletAddress, chainFamily, network);
    } catch {
      // Best-effort; report as a leak placeholder so the caller knows PG wasn't checked
      pgLeaks = [{ store: "postgres", field: "check_failed", hint: "unavail" }];
    }
  }

  const allLeaks = [...memResult.leaks, ...pgLeaks];
  return {
    passed: allLeaks.length === 0,
    walletAddress,
    chainFamily,
    checkedAt: new Date().toISOString(),
    leaks: allLeaks,
  };
}
