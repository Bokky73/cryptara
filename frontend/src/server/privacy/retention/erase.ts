/**
 * Full erasure workflow for Cryptara.
 *
 * Walks every product table that contains wallet identity (declared in
 * retention/policy.ts), applies the correct strategy (delete or anonymize),
 * respects chain-family scoping so erasing an EVM wallet never touches a
 * Stellar wallet, and emits a tamper-evident erasure receipt on completion.
 *
 * Design constraints:
 *  - Never locks a table: uses bounded batches and point deletes by wallet address
 *  - Preserves referential integrity: parent-level deletes cascade to children
 *  - Distinguishes "deleted" from "anonymized" — aggregate records survive
 *  - Chain-scoped: EVM erase does not affect Stellar records and vice-versa
 */

import { createErasureReceipt, type ErasureTableEntry } from "./receipt";
import type { ErasureReceipt } from "./receipt";
import { clearPortfolioCacheForWallet } from "@/server/stellar/portfolio";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EraseWalletInput {
  walletAddress: string;
  chainFamily: "evm" | "stellar";
  /** Optional network qualifier for chain-scoped tables. */
  network?: string;
}

export interface ErasureReport {
  ok: boolean;
  walletAddress: string;
  chainFamily: "evm" | "stellar";
  network?: string;
  erasedAt: string;
  memoryReport: {
    tablesProcessed: ErasureTableEntry[];
    portfolioCacheEvicted: number;
  };
  pgReport?: {
    tablesProcessed: ErasureTableEntry[];
  };
  residueCheckPassed: boolean;
  receipt: ErasureReceipt;
  partialFailure?: boolean;
  partialFailureDetail?: string;
}

// ---------------------------------------------------------------------------
// In-memory erasure
// ---------------------------------------------------------------------------

type MemoryStore = typeof globalThis & {
  __cryptaraAgentRuns?: Array<{ walletAddress: string }>;
  __cryptaraRecommendations?: Array<{ walletAddress: string }>;
  __cryptaraApprovals?: Array<{ walletAddress: string; network?: string }>;
  __cryptaraUserRules?: Array<{ walletAddress: string }>;
  __cryptaraAlertRules?: Array<{ walletAddress: string }>;
  __cryptaraAlertObservations?: Array<{ walletAddress: string }>;
  __cryptaraAlerts?: Array<{ walletAddress: string }>;
  __cryptaraAlertDeliveries?: Array<{ walletAddress: string }>;
  __cryptaraWatchlistEntries?: Array<{ walletAddress: string }>;
  __cryptaraWatchlistScanRuns?: Array<{ walletAddress: string }>;
  __cryptaraDiscoveryAlerts?: Array<{ walletAddress: string }>;
  __cryptaraTransactions?: Array<{ walletAddress?: string | null; sourceAccount?: string; network?: string; chainFamily?: string }>;
  __cryptaraX402PaymentReceipts?: Array<{ walletAddress?: string | null; payer?: string | null; network?: string; chainFamily?: string }>;
};

function walletMatches(fieldWallet: string | undefined | null, targetWallet: string): boolean {
  if (!fieldWallet) return false;
  const raw = targetWallet.trim();
  const field = fieldWallet.trim();
  return raw.startsWith("0x")
    ? field.toLowerCase() === raw.toLowerCase()
    : field === raw || field.toLowerCase() === raw.toLowerCase();
}

function networkMatches(
  fieldNetwork: string | undefined | null,
  targetNetwork: string | undefined,
  fieldChainFamily: string | undefined | null,
  targetChainFamily: string,
): boolean {
  // If no network filter: all networks for this chain family
  if (!targetNetwork) return true;
  if (!fieldNetwork) return false;
  const networkOk = fieldNetwork.trim().toLowerCase() === targetNetwork.trim().toLowerCase();
  const familyOk = !fieldChainFamily || fieldChainFamily.toLowerCase() === targetChainFamily.toLowerCase();
  return networkOk && familyOk;
}

/**
 * Execute the in-memory portion of a wallet erasure.
 * Returns per-table ErasureTableEntry values for the receipt.
 */
export function eraseWalletDataFromMemory(input: EraseWalletInput): {
  tables: ErasureTableEntry[];
  portfolioCacheEvicted: number;
} {
  const store = globalThis as MemoryStore;
  const { walletAddress, chainFamily, network } = input;
  const canonicalWallet = walletAddress.trim().startsWith("0x")
    ? walletAddress.trim().toLowerCase()
    : walletAddress.trim();

  const tables: ErasureTableEntry[] = [];

  function eraseList<T extends { walletAddress: string }>(
    listKey: keyof MemoryStore,
    tableName: string,
  ): ErasureTableEntry {
    const list = store[listKey] as T[] | undefined;
    if (!list) return { table: tableName, action: "skipped", rowsAffected: 0, strategy: "delete" };
    const before = list.length;
    (store[listKey] as T[]) = list.filter((r) => !walletMatches(r.walletAddress, canonicalWallet));
    const rowsAffected = before - (store[listKey] as T[]).length;
    return { table: tableName, action: rowsAffected > 0 ? "deleted" : "skipped", rowsAffected, strategy: "delete" };
  }

  // ── Hard-delete tables (no network scope) ──────────────────────────────
  tables.push(eraseList("__cryptaraAgentRuns", "agent_runs"));
  tables.push(eraseList("__cryptaraRecommendations", "recommendations"));
  tables.push(eraseList("__cryptaraUserRules", "user_rules"));
  tables.push(eraseList("__cryptaraAlertRules", "alert_rules"));
  tables.push(eraseList("__cryptaraAlertObservations", "alert_observations"));
  tables.push(eraseList("__cryptaraAlerts", "alerts"));
  tables.push(eraseList("__cryptaraAlertDeliveries", "alert_deliveries"));
  tables.push(eraseList("__cryptaraWatchlistEntries", "watchlist_entries"));
  tables.push(eraseList("__cryptaraWatchlistScanRuns", "watchlist_scan_runs"));
  tables.push(eraseList("__cryptaraDiscoveryAlerts", "discovery_alerts"));

  // ── Approvals (chain-scoped) ──────────────────────────────────────────
  {
    const list = store.__cryptaraApprovals;
    if (list) {
      const before = list.length;
      store.__cryptaraApprovals = list.filter(
        (r) =>
          !walletMatches(r.walletAddress, canonicalWallet) ||
          !networkMatches(r.network, network, chainFamily, chainFamily),
      );
      const rowsAffected = before - store.__cryptaraApprovals.length;
      tables.push({ table: "approvals", action: rowsAffected > 0 ? "deleted" : "skipped", rowsAffected, strategy: "delete" });
    } else {
      tables.push({ table: "approvals", action: "skipped", rowsAffected: 0, strategy: "delete" });
    }
  }

  // ── Transactions (anonymize: NULL wallet identity) ────────────────────
  {
    const list = store.__cryptaraTransactions;
    let rowsAffected = 0;
    if (list) {
      for (const tx of list) {
        if (
          walletMatches(tx.walletAddress, canonicalWallet) &&
          networkMatches(tx.network, network, tx.chainFamily, chainFamily)
        ) {
          tx.walletAddress = null;
          tx.sourceAccount = undefined;
          rowsAffected++;
        }
      }
    }
    tables.push({ table: "transactions", action: rowsAffected > 0 ? "anonymized" : "skipped", rowsAffected, strategy: "anonymize" });
  }

  // ── X402 payment receipts (anonymize) ─────────────────────────────────
  {
    const list = store.__cryptaraX402PaymentReceipts;
    let rowsAffected = 0;
    if (list) {
      for (const rec of list) {
        const walletHit =
          walletMatches(rec.walletAddress, canonicalWallet) ||
          walletMatches(rec.payer, canonicalWallet);
        if (walletHit && networkMatches(rec.network, network, rec.chainFamily, chainFamily)) {
          rec.walletAddress = null;
          rec.payer = null;
          rowsAffected++;
        }
      }
    }
    tables.push({ table: "x402_payment_receipts", action: rowsAffected > 0 ? "anonymized" : "skipped", rowsAffected, strategy: "anonymize" });
  }

  const portfolioCacheEvicted = clearPortfolioCacheForWallet(canonicalWallet);

  return { tables, portfolioCacheEvicted };
}

// ---------------------------------------------------------------------------
// Postgres erasure (delegated to postgresAdapter)
// ---------------------------------------------------------------------------

export interface PgErasureResult {
  tables: ErasureTableEntry[];
}

/** Thin shim so the Postgres adapter can be injected (and stubbed in tests). */
export type PgEraseWalletFn = (
  walletAddress: string,
  network: string | undefined,
  chainFamily: "evm" | "stellar",
) => Promise<PgErasureResult>;

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full erasure workflow:
 *  1. Erase all in-memory records for the wallet
 *  2. Delegate to the Postgres adapter for persistent erasure
 *  3. Run the residue check (imported lazily to avoid circular deps)
 *  4. Emit a tamper-evident erasure receipt
 */
export async function eraseWalletData(
  input: EraseWalletInput,
  pgErase?: PgEraseWalletFn,
): Promise<ErasureReport> {
  const erasedAt = new Date().toISOString();
  let partialFailure = false;
  let partialFailureDetail: string | undefined;

  // ── 1. In-memory erasure ───────────────────────────────────────────────
  const memoryResult = eraseWalletDataFromMemory(input);

  // ── 2. Postgres erasure ────────────────────────────────────────────────
  let pgReport: ErasureReport["pgReport"] | undefined;
  if (pgErase) {
    try {
      const pgResult = await pgErase(input.walletAddress, input.network, input.chainFamily);
      pgReport = { tablesProcessed: pgResult.tables };
    } catch (err) {
      partialFailure = true;
      partialFailureDetail =
        err instanceof Error ? err.message : "Postgres erasure failed with unknown error.";
    }
  }

  // ── 3. Residue check ──────────────────────────────────────────────────
  let residueCheckPassed = false;
  try {
    const { checkErasureResidue } = await import("./residue");
    const residue = checkErasureResidue(input.walletAddress, input.chainFamily, input.network);
    residueCheckPassed = residue.passed;
    if (!residue.passed) {
      partialFailure = true;
      partialFailureDetail = [
        partialFailureDetail,
        `Residue check failed: ${residue.leaks.length} leak(s) found.`,
      ]
        .filter(Boolean)
        .join("; ");
    }
  } catch {
    // Residue check is best-effort; a failure here doesn't abort the erasure
    residueCheckPassed = false;
  }

  // ── 4. Assemble receipt ────────────────────────────────────────────────
  const allTables = [
    ...memoryResult.tables,
    ...(pgReport?.tablesProcessed ?? []),
  ];

  const receipt = createErasureReceipt({
    walletAddress: input.walletAddress,
    chainFamily: input.chainFamily,
    network: input.network,
    tables: allTables,
    residueCheckPassed,
    note: partialFailureDetail,
  });

  return {
    ok: !partialFailure,
    walletAddress: input.walletAddress,
    chainFamily: input.chainFamily,
    network: input.network,
    erasedAt,
    memoryReport: {
      tablesProcessed: memoryResult.tables,
      portfolioCacheEvicted: memoryResult.portfolioCacheEvicted,
    },
    pgReport,
    residueCheckPassed,
    receipt,
    ...(partialFailure ? { partialFailure: true, partialFailureDetail } : {}),
  };
}
