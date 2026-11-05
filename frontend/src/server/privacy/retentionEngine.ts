import { getPrivacyRetentionConfig, getRetentionCutoffDate } from "@/server/privacy/config";
import { pruneExpiredRecordsFromPg } from "@/server/storage/postgresAdapter";

type CryptaraMemoryGlobal = typeof globalThis & {
  __cryptaraAgentRuns?: Array<{ createdAt: string }>;
  __cryptaraAlertObservations?: Array<{ createdAt: string }>;
  __cryptaraAlerts?: Array<{ triggeredAt: string }>;
  __cryptaraWatchlistScanRuns?: Array<{ scannedAt: string }>;
  __cryptaraTransactions?: Array<{ createdAt: string; walletAddress?: string; sourceAccount?: string }>;
  __cryptaraX402PaymentReceipts?: Array<{ createdAt: string; walletAddress?: string; payer?: string }>;
};

export async function pruneExpiredStorageData(now = new Date()): Promise<{
  prunedMemoryCount: number;
  unlinkedMemoryAuditCount: number;
  pgPrunedCount: number;
  pgUnlinkedCount: number;
}> {
  const config = getPrivacyRetentionConfig();

  const agentRunsCutoff = getRetentionCutoffDate(config.agentRunsDays, now);
  const alertObservationsCutoff = getRetentionCutoffDate(config.alertObservationsDays, now);
  const alertsCutoff = getRetentionCutoffDate(config.alertsDays, now);
  const watchlistScanRunsCutoff = getRetentionCutoffDate(config.watchlistRunsDays, now);
  const transactionsUnlinkCutoff = getRetentionCutoffDate(config.transactionsUnlinkDays, now);
  const x402ReceiptsUnlinkCutoff = getRetentionCutoffDate(config.x402ReceiptsUnlinkDays, now);

  const memory = globalThis as CryptaraMemoryGlobal;
  let prunedMemoryCount = 0;
  let unlinkedMemoryAuditCount = 0;

  if (memory.__cryptaraAgentRuns) {
    const before = memory.__cryptaraAgentRuns.length;
    memory.__cryptaraAgentRuns = memory.__cryptaraAgentRuns.filter(
      (run) => new Date(run.createdAt) >= agentRunsCutoff
    );
    prunedMemoryCount += before - memory.__cryptaraAgentRuns.length;
  }

  if (memory.__cryptaraAlertObservations) {
    const before = memory.__cryptaraAlertObservations.length;
    memory.__cryptaraAlertObservations = memory.__cryptaraAlertObservations.filter(
      (obs) => new Date(obs.createdAt) >= alertObservationsCutoff
    );
    prunedMemoryCount += before - memory.__cryptaraAlertObservations.length;
  }

  if (memory.__cryptaraAlerts) {
    const before = memory.__cryptaraAlerts.length;
    memory.__cryptaraAlerts = memory.__cryptaraAlerts.filter(
      (alt) => new Date(alt.triggeredAt) >= alertsCutoff
    );
    prunedMemoryCount += before - memory.__cryptaraAlerts.length;
  }

  if (memory.__cryptaraWatchlistScanRuns) {
    const before = memory.__cryptaraWatchlistScanRuns.length;
    memory.__cryptaraWatchlistScanRuns = memory.__cryptaraWatchlistScanRuns.filter(
      (w) => new Date(w.scannedAt) >= watchlistScanRunsCutoff
    );
    prunedMemoryCount += before - memory.__cryptaraWatchlistScanRuns.length;
  }

  if (memory.__cryptaraTransactions) {
    for (const tx of memory.__cryptaraTransactions) {
      if (new Date(tx.createdAt) < transactionsUnlinkCutoff && tx.walletAddress) {
        tx.walletAddress = undefined;
        tx.sourceAccount = undefined;
        unlinkedMemoryAuditCount++;
      }
    }
  }

  if (memory.__cryptaraX402PaymentReceipts) {
    for (const rec of memory.__cryptaraX402PaymentReceipts) {
      if (new Date(rec.createdAt) < x402ReceiptsUnlinkCutoff && rec.walletAddress) {
        rec.walletAddress = undefined;
        rec.payer = undefined;
        unlinkedMemoryAuditCount++;
      }
    }
  }

  let pgPrunedCount = 0;
  let pgUnlinkedCount = 0;

  try {
    const pgResult = await pruneExpiredRecordsFromPg({
      agentRunsCutoff,
      alertObservationsCutoff,
      alertsCutoff,
      watchlistScanRunsCutoff,
      transactionsUnlinkCutoff,
      x402ReceiptsUnlinkCutoff,
    });
    pgPrunedCount = pgResult.prunedCount;
    pgUnlinkedCount = pgResult.unlinkedCount;
  } catch {
    // best-effort PG pruning
  }

  return {
    prunedMemoryCount,
    unlinkedMemoryAuditCount,
    pgPrunedCount,
    pgUnlinkedCount,
  };
}
