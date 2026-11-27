/**
 * Comprehensive Privacy Lifecycle & Data Retention Check Script.
 * Runs with:
 *   npm run test:privacy
 */

import type { NextRequest } from "next/server";
import {
  createAgentRunRecord,
  createAlert,
  createAlertObservation,
  createApprovalRecord,
  createRecommendationRecord,
  createTransactionRecord,
  createX402PaymentReceipt,
  deleteWalletData,
  deleteWalletDataFromPg,
  exportWalletData,
  exportWalletDataFromPg,
  pruneExpiredRecordsFromPg,
  getUserRuleRecord,
  listAgentRunRecords,
  listAlertObservations,
  listAlertRules,
  listAlerts,
  listApprovalRecords,
  listRecommendationRecords,
  listTransactionRecords,
  listWatchlistEntries,
  listX402PaymentReceipts,
  storageSchemaContract,
  upsertAlertRule,
  upsertUserRuleRecord,
} from "../src/server/storage";
import { getPrivacyRetentionConfig, getRetentionCutoffDate } from "../src/server/privacy/config";
import { pruneExpiredStorageData } from "../src/server/privacy/retentionEngine";
import { redactSecrets, redactSensitiveObject, redactWalletAddress } from "../src/server/observability/logging";
import { encodeWalletCookie } from "../src/server/security/walletSession";
import { GET as exportGET, POST as exportPOST } from "../src/app/api/wallet-privacy/export/route";
import { DELETE as deleteDELETE, POST as deletePOST } from "../src/app/api/wallet-privacy/delete/route";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function createMockNextRequest(urlStr: string, method: string, headersObj: Record<string, string> = {}, body?: unknown): NextRequest {
  const reqInit: RequestInit = {
    method,
    headers: new Headers(headersObj),
  };
  if (body) {
    reqInit.body = JSON.stringify(body);
  }
  return new Request(urlStr, reqInit) as unknown as NextRequest;
}

async function runPrivacyLifecycleCheck() {
  console.log("🔒 Running Comprehensive Privacy Lifecycle & Retention Test Suite...\n");

  // 1. Storage Schema & Privacy API Exports Check
  console.log("1. Checking Storage Schema Contract & Exported Privacy APIs...");
  assert(storageSchemaContract.adapterApi.includes("exportWalletData"), "exportWalletData missing from adapterApi contract");
  assert(storageSchemaContract.adapterApi.includes("deleteWalletData"), "deleteWalletData missing from adapterApi contract");
  assert(typeof exportWalletData === "function", "exportWalletData is not exported by @/server/storage!");
  assert(typeof deleteWalletData === "function", "deleteWalletData is not exported by @/server/storage!");
  assert(typeof deleteWalletDataFromPg === "function", "deleteWalletDataFromPg is not exported!");
  assert(typeof exportWalletDataFromPg === "function", "exportWalletDataFromPg is not exported!");
  assert(typeof pruneExpiredRecordsFromPg === "function", "pruneExpiredRecordsFromPg is not exported!");
  console.log("   ✅ Schema contract & storage exports verified.\n");

  // 2. Log & Telemetry Privacy Redaction Check
  console.log("2. Verifying In-Flight Log Redaction...");
  const evmWallet = "0x1111222233334444555566667777888899990000";
  const stellarWallet = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const bearerToken = "Bearer secret_token_12345";

  const rawLog = `User ${evmWallet} with Stellar account ${stellarWallet} authenticated with ${bearerToken}`;
  const redactedLog = redactSecrets(rawLog);

  assert(!redactedLog.includes(evmWallet), "EVM wallet address was not redacted in logs!");
  assert(!redactedLog.includes(stellarWallet), "Stellar wallet address was not redacted in logs!");
  assert(!redactedLog.includes("secret_token_12345"), "Bearer token was not redacted in logs!");

  const redactedHint = redactWalletAddress(evmWallet);
  assert(redactedHint.includes("…"), "redactWalletAddress did not produce hint!");
  assert(!redactedHint.includes(evmWallet.slice(6, 30)), "Wallet body leaked in hint!");

  const objToSanitize = {
    user: evmWallet,
    secretKey: "super_secret",
    rawPayload: { auth: "bearer_xyz" },
  };
  const sanitizedObj = redactSensitiveObject(objToSanitize);
  assert((sanitizedObj as { secretKey: string }).secretKey === "[REDACTED_PAYLOAD]", "Object secret key not redacted!");
  console.log("   ✅ Log and telemetry redaction verified.\n");

  // 3. Seeding User A and User B Datasets across EVM & Stellar (Multiple Networks)
  console.log("3. Seeding User A and User B Datasets across Networks...");
  const userA_EVM = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const userA_Stellar = "GAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const userB_EVM = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const userB_Stellar = "GBBCBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  // User A EVM records on Ethereum
  await createAgentRunRecord({
    walletAddress: userA_EVM,
    mode: "portfolio_review",
    results: [],
  });
  await upsertUserRuleRecord({
    walletAddress: userA_EVM,
    maxRiskScore: 50,
    maxTradePercent: 10,
    maxMemeExposurePercent: 5,
    allowedChains: ["ethereum", "polygon"],
    blockedTokens: [],
    allowedActions: ["reduce_exposure", "swap_to_stable"],
    autoExecute: false,
    createdAt: new Date().toISOString(),
  });
  await createRecommendationRecord({
    runId: "run_userA_1",
    walletAddress: userA_EVM,
    action: "reduce_exposure",
    decisionScore: 85,
    confidence: 0.9,
    summary: "Favorable buy opportunity",
  });
  await createTransactionRecord({
    walletAddress: userA_EVM,
    hash: "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
    type: "swap",
    asset: "USDC",
    valueUsd: 100,
    status: "confirmed",
    lifecycleStatus: "confirmed",
    chainFamily: "evm",
    network: "ethereum",
  });

  // User A EVM records on Polygon
  await createTransactionRecord({
    walletAddress: userA_EVM,
    hash: "0xa2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2",
    type: "swap",
    asset: "MATIC",
    valueUsd: 250,
    status: "confirmed",
    lifecycleStatus: "confirmed",
    chainFamily: "evm",
    network: "polygon",
  });

  // User B EVM records on Ethereum
  await createAgentRunRecord({
    walletAddress: userB_EVM,
    mode: "token_scan",
    results: [],
  });
  await upsertUserRuleRecord({
    walletAddress: userB_EVM,
    maxRiskScore: 70,
    maxTradePercent: 20,
    maxMemeExposurePercent: 15,
    allowedChains: ["ethereum"],
    blockedTokens: [],
    allowedActions: ["reduce_exposure"],
    autoExecute: false,
    createdAt: new Date().toISOString(),
  });
  await createTransactionRecord({
    walletAddress: userB_EVM,
    hash: "0xb1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1",
    type: "swap",
    asset: "ETH",
    valueUsd: 500,
    status: "confirmed",
    lifecycleStatus: "confirmed",
    chainFamily: "evm",
    network: "ethereum",
  });

  // User A & B Stellar records
  await createAgentRunRecord({
    walletAddress: userA_Stellar,
    mode: "token_scan",
    results: [],
  });
  await createAgentRunRecord({
    walletAddress: userB_Stellar,
    mode: "token_scan",
    results: [],
  });

  console.log("   ✅ Seeding completed successfully.\n");

  // 4. Testing Authenticated Export API Route Handler & Session Gates
  console.log("4. Testing Authenticated Export Route Handler & Session Gates...");

  // 4a. 401 Unauthorized without session cookie
  const unauthExportReq = createMockNextRequest(
    `http://localhost:3000/api/wallet-privacy/export?walletAddress=${userA_EVM}`,
    "GET"
  );
  const unauthExportRes = await exportGET(unauthExportReq);
  assert(unauthExportRes.status === 401, `Expected 401 for unauthenticated export, got ${unauthExportRes.status}`);

  // 4b. 403 Forbidden when session wallet != target wallet
  const forbiddenExportReq = createMockNextRequest(
    `http://localhost:3000/api/wallet-privacy/export?walletAddress=${userB_EVM}`,
    "GET",
    { Cookie: `gr_wallet_session=${encodeWalletCookie(userA_EVM)}` }
  );
  const forbiddenExportRes = await exportGET(forbiddenExportReq);
  assert(forbiddenExportRes.status === 403, `Expected 403 for mismatched wallet export, got ${forbiddenExportRes.status}`);

  // 4c. 200 OK with valid matching session cookie
  const validExportReq = createMockNextRequest(
    `http://localhost:3000/api/wallet-privacy/export?walletAddress=${userA_EVM}`,
    "GET",
    { Cookie: `gr_wallet_session=${encodeWalletCookie(userA_EVM)}` }
  );
  const validExportRes = await exportGET(validExportReq);
  assert(validExportRes.status === 200, `Expected 200 for valid export, got ${validExportRes.status}`);
  const exportPayload = (await validExportRes.json()) as { memoryData: { transactions: Array<{ hash: string }> } };
  assert(exportPayload.memoryData.transactions.length >= 2, "Export did not return User A transactions!");
  console.log("   ✅ Export route handler verified (401, 403, 200 OK).\n");

  // 5. Testing Network-Scoped Deletion & Full Deletion Route Handler
  console.log("5. Testing Network-Scoped Deletion & Full Deletion Route Handler...");

  // 5a. 401 Unauthorized on DELETE route
  const unauthDeleteReq = createMockNextRequest(
    `http://localhost:3000/api/wallet-privacy/delete?walletAddress=${userA_EVM}`,
    "DELETE"
  );
  const unauthDeleteRes = await deleteDELETE(unauthDeleteReq);
  assert(unauthDeleteRes.status === 401, `Expected 401 for unauthenticated delete, got ${unauthDeleteRes.status}`);

  // 5b. Network-scoped deletion: Delete User A on network "ethereum" only
  const netDeleteReq = createMockNextRequest(
    `http://localhost:3000/api/wallet-privacy/delete?walletAddress=${userA_EVM}&network=ethereum`,
    "DELETE",
    { Cookie: `gr_wallet_session=${encodeWalletCookie(userA_EVM)}` }
  );
  const netDeleteRes = await deleteDELETE(netDeleteReq);
  assert(netDeleteRes.status === 200, `Expected 200 for network-scoped delete, got ${netDeleteRes.status}`);

  // Verify Ethereum tx unlinked, but Polygon tx remains
  const txsAfterNetDelete = await listTransactionRecords();
  const ethTxA = txsAfterNetDelete.find((tx) => tx.hash === "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1");
  const polyTxA = txsAfterNetDelete.find((tx) => tx.hash === "0xa2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2");
  assert(ethTxA?.walletAddress === "" || ethTxA?.walletAddress === undefined, "Ethereum tx was not unlinked!");
  assert(polyTxA?.walletAddress === userA_EVM, "Polygon tx was unlinked inadvertently!");
  console.log("   ✅ Network-scoped deletion verified (Ethereum deleted, Polygon preserved).\n");

  // 5c. Full Wallet Deletion via DELETE route handler
  const fullDeleteReq = createMockNextRequest(
    `http://localhost:3000/api/wallet-privacy/delete?walletAddress=${userA_EVM}`,
    "DELETE",
    { Cookie: `gr_wallet_session=${encodeWalletCookie(userA_EVM)}` }
  );
  const fullDeleteRes = await deleteDELETE(fullDeleteReq);
  assert(fullDeleteRes.status === 200, `Expected 200 for full delete, got ${fullDeleteRes.status}`);

  // Verify User A data is completely deleted / unlinked
  const userARunsAfter = await listAgentRunRecords(userA_EVM);
  assert(userARunsAfter.length === 0, "User A agent runs still exist after deletion!");
  const exportAAfter = await exportWalletData(userA_EVM);
  assert(exportAAfter.memoryData.userRules.length === 0, "User A rules still exist after deletion!");

  // Verify Polygon tx unlinked now
  const polyTxAAfter = (await listTransactionRecords()).find((tx) => tx.hash === "0xa2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2");
  assert(polyTxAAfter?.walletAddress === "" || polyTxAAfter?.walletAddress === undefined, "Polygon tx not unlinked after full delete!");

  // Verify User B data is 100% intact
  const userBRunsAfter = await listAgentRunRecords(userB_EVM);
  assert(userBRunsAfter.length >= 1, "User B agent runs deleted inadvertently!");
  const userBTxsAfter = await listTransactionRecords(userB_EVM);
  assert(userBTxsAfter.length >= 1, "User B transactions deleted inadvertently!");
  console.log("   ✅ Full deletion and audit unlinking verified.\n");

  // 6. Testing Idempotence of Deletion Route Handler
  console.log("6. Testing Idempotence of Deletion...");
  const retryDeleteReq = createMockNextRequest(
    `http://localhost:3000/api/wallet-privacy/delete?walletAddress=${userA_EVM}`,
    "DELETE",
    { Cookie: `gr_wallet_session=${encodeWalletCookie(userA_EVM)}` }
  );
  const retryDeleteRes = await deleteDELETE(retryDeleteReq);
  assert(retryDeleteRes.status === 200, `Expected 200 on retry delete, got ${retryDeleteRes.status}`);
  const retryPayload = (await retryDeleteRes.json()) as { ok: boolean; memoryRecordsRemoved: number };
  assert(retryPayload.ok === true, "Retry delete reported failure!");
  assert(retryPayload.memoryRecordsRemoved === 0, "Retry delete removed non-zero records!");
  console.log("   ✅ Retrying deletion returned clean success status.\n");

  // 7. Testing Retention Policy Pruning Engine
  console.log("7. Testing Retention Policy Pruning Engine...");
  const now = new Date();
  const retentionConfig = getPrivacyRetentionConfig();

  // Create an old agent run past retention cutoff
  const oldDate = new Date(now.getTime() - (retentionConfig.agentRunsDays + 10) * 86400 * 1000).toISOString();
  await createAgentRunRecord({
    walletAddress: "0xoldwallet000000000000000000000000000000000",
    mode: "portfolio_review",
    results: [],
    inputSnapshot: { createdAt: oldDate },
  });

  const pruneResult = await pruneExpiredStorageData();
  assert(typeof pruneResult.prunedMemoryCount === "number", "Prune result missing prunedMemoryCount");
  console.log(`   ✅ Retention engine executed; pruned ${pruneResult.prunedMemoryCount} expired records.\n`);

  console.log("🎉 ALL COMPREHENSIVE PRIVACY LIFECYCLE & RETENTION TESTS PASSED CLEANLY!");
}

runPrivacyLifecycleCheck().catch((error) => {
  console.error("❌ Privacy lifecycle test failed:", error);
  process.exit(1);
});
