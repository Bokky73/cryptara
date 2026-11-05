import { devFixtures } from "./fixtures";
import { e2eSeedBundle, E2E_FIXTURE_CREATED_AT } from "./e2eFixtures";
import { createApprovalRecord, createRecommendationRecord, createTransactionRecord } from "../storage";
import logger from "@/server/observability/logger/logger";
type G = typeof globalThis & { __cryptaraRecommendations?: unknown[]; __cryptaraApprovals?: unknown[]; __cryptaraTransactions?: unknown[]; };
function clear() { const s = globalThis as G; s.__cryptaraRecommendations = []; s.__cryptaraApprovals = []; s.__cryptaraTransactions = []; }
export async function resetDevEnvironment() { if (process.env.APP_MODE === "production") throw new Error("Cannot reset in production"); logger.info("dev.seed", "Resetting environment..."); clear(); return { reset: true }; }
export async function seedDevEnvironment() {
  if (process.env.APP_MODE === "production") throw new Error("Cannot seed in production");
  logger.info("dev.seed", "Seeding environment with fixtures..."); clear();
  for (const tx of devFixtures.transactions) createTransactionRecord({ hash: tx.hash, type: "swap", asset: "USDC", valueUsd: 50, status: tx.status === "completed" ? "confirmed" : "pending", lifecycleStatus: tx.status === "completed" ? "confirmed" : "pending", network: "base", walletAddress: tx.walletAddress, chainFamily: tx.chainFamily as "evm", createdAt: E2E_FIXTURE_CREATED_AT });
  for (const recommendation of e2eSeedBundle.recommendations) { const r = createRecommendationRecord(recommendation); r.createdAt = E2E_FIXTURE_CREATED_AT; }
  for (const approval of e2eSeedBundle.approvals) { const r = createApprovalRecord(approval); r.createdAt = E2E_FIXTURE_CREATED_AT; }
  for (const transaction of e2eSeedBundle.transactions) createTransactionRecord({ ...transaction, createdAt: E2E_FIXTURE_CREATED_AT });
  return { seeded: true, counts: { recommendations: e2eSeedBundle.recommendations.length, approvals: e2eSeedBundle.approvals.length, transactions: devFixtures.transactions.length + e2eSeedBundle.transactions.length } };
}
