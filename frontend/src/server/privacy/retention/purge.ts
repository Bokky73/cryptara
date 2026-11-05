/**
 * Bounded-batch scheduled purge for Cryptara.
 *
 * Deletes or anonymizes records that have exceeded their retention window.
 * Designed to run as a cron job (scripts/retention-purge.mjs) without
 * acquiring long-running table locks.
 *
 * Design constraints:
 *  - In-memory purge processes each store with a single filter pass (O(n))
 *  - Postgres purge uses bounded DELETE/UPDATE batches with a LIMIT clause
 *    so no single statement blocks for more than a few milliseconds
 *  - Both purge paths report a per-table summary for observability
 *  - The purge is idempotent: running it twice produces the same outcome
 *
 * The per-table retention windows are read from the same environment
 * variables as config.ts so operators have one knob per table.
 */

import { getPrivacyRetentionConfig, getRetentionCutoffDate } from "@/server/privacy/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PurgeTableResult {
  table: string;
  action: "deleted" | "anonymized" | "skipped";
  rowsPurged: number;
}

export interface PurgeReport {
  purgedAt: string;
  memory: PurgeTableResult[];
  pg: PurgeTableResult[];
  totalPurged: number;
}

// ---------------------------------------------------------------------------
// In-memory purge
// ---------------------------------------------------------------------------

type MemoryStore = typeof globalThis & {
  __cryptaraAgentRuns?: Array<{ createdAt: string; walletAddress?: string }>;
  __cryptaraAlertObservations?: Array<{ createdAt: string; walletAddress?: string }>;
  __cryptaraAlerts?: Array<{ triggeredAt?: string; createdAt?: string }>;
  __cryptaraWatchlistScanRuns?: Array<{ scannedAt: string }>;
  __cryptaraTransactions?: Array<{ createdAt: string; walletAddress?: string | null; sourceAccount?: string | null }>;
  __cryptaraX402PaymentReceipts?: Array<{ createdAt: string; walletAddress?: string | null; payer?: string | null }>;
};

/**
 * Apply retention policy to in-memory stores.
 * Returns per-table statistics.
 */
export function purgeExpiredMemoryData(now = new Date()): PurgeTableResult[] {
  const config = getPrivacyRetentionConfig();
  const store = globalThis as MemoryStore;
  const results: PurgeTableResult[] = [];

  // ── agent_runs ─────────────────────────────────────────────────────────
  {
    const cutoff = getRetentionCutoffDate(config.agentRunsDays, now);
    const list = store.__cryptaraAgentRuns;
    if (list) {
      const before = list.length;
      store.__cryptaraAgentRuns = list.filter((r) => new Date(r.createdAt) >= cutoff);
      const purged = before - store.__cryptaraAgentRuns.length;
      results.push({ table: "agent_runs", action: purged > 0 ? "deleted" : "skipped", rowsPurged: purged });
    } else {
      results.push({ table: "agent_runs", action: "skipped", rowsPurged: 0 });
    }
  }

  // ── alert_observations ─────────────────────────────────────────────────
  {
    const cutoff = getRetentionCutoffDate(config.alertObservationsDays, now);
    const list = store.__cryptaraAlertObservations;
    if (list) {
      const before = list.length;
      store.__cryptaraAlertObservations = list.filter((r) => new Date(r.createdAt) >= cutoff);
      const purged = before - store.__cryptaraAlertObservations.length;
      results.push({ table: "alert_observations", action: purged > 0 ? "deleted" : "skipped", rowsPurged: purged });
    } else {
      results.push({ table: "alert_observations", action: "skipped", rowsPurged: 0 });
    }
  }

  // ── alerts ─────────────────────────────────────────────────────────────
  {
    const cutoff = getRetentionCutoffDate(config.alertsDays, now);
    const list = store.__cryptaraAlerts;
    if (list) {
      const before = list.length;
      store.__cryptaraAlerts = list.filter((r) => {
        const ts = r.triggeredAt ?? r.createdAt;
        return ts ? new Date(ts) >= cutoff : true;
      });
      const purged = before - store.__cryptaraAlerts.length;
      results.push({ table: "alerts", action: purged > 0 ? "deleted" : "skipped", rowsPurged: purged });
    } else {
      results.push({ table: "alerts", action: "skipped", rowsPurged: 0 });
    }
  }

  // ── watchlist_scan_runs ────────────────────────────────────────────────
  {
    const cutoff = getRetentionCutoffDate(config.watchlistRunsDays, now);
    const list = store.__cryptaraWatchlistScanRuns;
    if (list) {
      const before = list.length;
      store.__cryptaraWatchlistScanRuns = list.filter((r) => new Date(r.scannedAt) >= cutoff);
      const purged = before - store.__cryptaraWatchlistScanRuns.length;
      results.push({ table: "watchlist_scan_runs", action: purged > 0 ? "deleted" : "skipped", rowsPurged: purged });
    } else {
      results.push({ table: "watchlist_scan_runs", action: "skipped", rowsPurged: 0 });
    }
  }

  // ── transactions (anonymize after threshold) ───────────────────────────
  {
    const cutoff = getRetentionCutoffDate(config.transactionsUnlinkDays, now);
    const list = store.__cryptaraTransactions;
    let anonymized = 0;
    if (list) {
      for (const tx of list) {
        if (new Date(tx.createdAt) < cutoff && (tx.walletAddress || tx.sourceAccount)) {
          tx.walletAddress = null;
          tx.sourceAccount = undefined;
          anonymized++;
        }
      }
    }
    results.push({ table: "transactions", action: anonymized > 0 ? "anonymized" : "skipped", rowsPurged: anonymized });
  }

  // ── x402_payment_receipts (anonymize after threshold) ─────────────────
  {
    const cutoff = getRetentionCutoffDate(config.x402ReceiptsUnlinkDays, now);
    const list = store.__cryptaraX402PaymentReceipts;
    let anonymized = 0;
    if (list) {
      for (const rec of list) {
        if (new Date(rec.createdAt) < cutoff && (rec.walletAddress || rec.payer)) {
          rec.walletAddress = null;
          rec.payer = null;
          anonymized++;
        }
      }
    }
    results.push({ table: "x402_payment_receipts", action: anonymized > 0 ? "anonymized" : "skipped", rowsPurged: anonymized });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Postgres purge (injected adapter)
// ---------------------------------------------------------------------------

export interface PgPurgeInput {
  agentRunsCutoff: Date;
  alertObservationsCutoff: Date;
  alertsCutoff: Date;
  watchlistScanRunsCutoff: Date;
  transactionsUnlinkCutoff: Date;
  x402ReceiptsUnlinkCutoff: Date;
  /** Max rows to delete/update per statement to avoid long locks. Default: 500. */
  batchSize?: number;
}

export type PgPurgeFn = (input: PgPurgeInput) => Promise<PurgeTableResult[]>;

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full purge workflow (memory + optional Postgres).
 *
 * Designed to be called from scripts/retention-purge.mjs on a schedule.
 * Returns a structured report for logging and alerting.
 */
export async function runRetentionPurge(
  pgPurge?: PgPurgeFn,
  now = new Date(),
): Promise<PurgeReport> {
  const memoryResults = purgeExpiredMemoryData(now);

  const config = getPrivacyRetentionConfig();
  let pgResults: PurgeTableResult[] = [];

  if (pgPurge) {
    try {
      pgResults = await pgPurge({
        agentRunsCutoff: getRetentionCutoffDate(config.agentRunsDays, now),
        alertObservationsCutoff: getRetentionCutoffDate(config.alertObservationsDays, now),
        alertsCutoff: getRetentionCutoffDate(config.alertsDays, now),
        watchlistScanRunsCutoff: getRetentionCutoffDate(config.watchlistRunsDays, now),
        transactionsUnlinkCutoff: getRetentionCutoffDate(config.transactionsUnlinkDays, now),
        x402ReceiptsUnlinkCutoff: getRetentionCutoffDate(config.x402ReceiptsUnlinkDays, now),
      });
    } catch (err) {
      // Non-fatal: the memory purge completed; log the PG failure
      const msg = err instanceof Error ? err.message : String(err);
      pgResults = [{ table: "postgres_purge", action: "skipped", rowsPurged: 0 }];
      console.error(`[retention-purge] Postgres purge failed: ${msg}`);
    }
  }

  const totalPurged =
    memoryResults.reduce((s, r) => s + r.rowsPurged, 0) +
    pgResults.reduce((s, r) => s + r.rowsPurged, 0);

  return {
    purgedAt: now.toISOString(),
    memory: memoryResults,
    pg: pgResults,
    totalPurged,
  };
}
