/**
 * Storage schema contract shared by all adapters.
 * Used by the health endpoint and deploy readiness checks.
 */
export const storageSchemaContract = {
  tables: [
    "wallets",
    "agent_runs",
    "agent_results",
    "recommendations",
    "user_rules",
    "approvals",
    "transactions",
    "x402_payment_receipts",
    "x402_settlement_ledger",
    "token_identities",
    "source_snapshots",
    "chain_identities",
    "watchlist_collections",
    "watchlist_collection_items",
  ],
  adapterApi: [
    "listAgentRunRecords",
    "getAgentRunRecord",
    "createAgentRunRecord",
    "listRecommendationRecords",
    "createRecommendationRecord",
    "listTransactionRecords",
    "createTransactionRecord",
    "listApprovalRecords",
    "createApprovalRecord",
    "listX402PaymentReceipts",
    "getX402PaymentReceiptByHeaderHash",
    "createX402PaymentReceipt",
    "getUserRuleRecord",
    "upsertUserRuleRecord",
  ],
  migration: "db/migrations",
  sensitiveColumns: {
    wallets: ["address"],
  },
};