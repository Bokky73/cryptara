import assert from "node:assert/strict";
import { canonicalAssetIdentity, canonicalizeJson, hashRiskSnapshot } from "../src/server/snapshots/canonical";
import { verifyRiskSnapshotRecord } from "../src/server/snapshots/integrity";
import { assertPrivacySafeSnapshot, redactRiskReportSnapshot } from "../src/server/snapshots/redaction";
import { createRiskSnapshot, findLatestRiskSnapshot, readRiskSnapshot, revokeRiskSnapshot } from "../src/server/snapshots/store";
import { hashRiskSnapshotInBrowser } from "../src/lib/snapshots/clientHash";
import type { RiskSnapshotRecord } from "../src/server/snapshots/schema";
import { MemoryStorageAdapter } from "../src/server/storage/adapters/memory";
import type { TokenScanResult } from "../src/server/types";
import { POST as createSnapshotPOST } from "../src/app/api/snapshots/route";
import { GET as readSnapshotGET } from "../src/app/api/snapshots/[id]/route";
import { POST as revokeSnapshotPOST } from "../src/app/api/snapshots/[id]/revoke/route";

const GENERATED_AT = "2026-08-25T12:00:00.000Z";
const EXPIRES_AT = "2026-09-25T12:00:00.000Z";
const WALLET_SEED = "0x9999999999999999999999999999999999999999";
const STRATEGY_SEED = "sell-before-user-specific-threshold";
const SECRET_SEED = "provider-secret-should-never-export";
const TX_SEED = "signed-transaction-plan-seed";

function fixture(kind: "evm" | "stellar-classic" | "soroban"): TokenScanResult {
  const evmAddress = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";
  const issuer = `G${"A".repeat(55)}`;
  const sorobanContract = `C${"B".repeat(55)}`;
  const stellar = kind !== "evm";
  const symbol = kind === "evm" ? "RAC" : kind === "stellar-classic" ? "USDC" : "SORO";
  const tokenAddress = kind === "evm" ? evmAddress : kind === "soroban" ? sorobanContract : `${symbol}:${issuer}`;
  const scan = {
    symbol,
    tokenAddress,
    chain: stellar ? "stellar-testnet" : "base",
    normalizedInput: {
      query: tokenAddress,
      chain: stellar ? "stellar-testnet" : "base",
      contractAddress: kind === "stellar-classic" ? undefined : tokenAddress,
      symbol,
      tokenName: `${symbol} Asset`,
      assetKey: stellar ? tokenAddress : undefined,
      assetType: kind === "stellar-classic" ? "classic" : kind === "soroban" ? "contract" : undefined,
      issuer: kind === "stellar-classic" ? issuer : undefined,
      source: kind === "evm" ? "contract_address" : "stellar_asset",
    },
    overallRiskScore: 31,
    opportunityScore: 69,
    verdict: "watch",
    summary: `Public summary. Wallet ${WALLET_SEED} is intentionally seeded for redaction.`,
    reasons: ["Liquidity is measurable", `Private strategy: ${STRATEGY_SEED}`],
    suggestedAction: { type: "hold", fromToken: symbol, toToken: "USDC", percent: 0 },
    riskBreakdown: [],
    sources: [
      { label: "Provider B", status: "unavailable", detail: "Unavailable" },
      { label: "Provider A", status: "connected", detail: "Live" },
    ],
    dataQuality: { mode: "partial", connectedSources: 1, unavailableSources: 1, mockSources: 0, sourceCount: 2, reliability: 0.82, detail: "Partial" },
    scannedAt: GENERATED_AT,
    riskReport: {
      id: "internal-report-id",
      chain: stellar ? "stellar-testnet" : "base",
      contractAddress: kind === "stellar-classic" ? undefined : tokenAddress,
      symbol,
      tokenName: `${symbol} Asset`,
      buyRisk: 31,
      confidence: 0.82,
      verdict: "watch",
      summary: `Public summary. Wallet ${WALLET_SEED} is intentionally seeded for redaction.`,
      topReasons: ["Liquidity is measurable", `Private strategy: ${STRATEGY_SEED}`],
      input: {
        query: tokenAddress,
        chain: stellar ? "stellar-testnet" : "base",
        contractAddress: kind === "stellar-classic" ? undefined : tokenAddress,
        symbol,
        tokenName: `${symbol} Asset`,
        assetKey: stellar ? tokenAddress : undefined,
        assetType: kind === "stellar-classic" ? "classic" : kind === "soroban" ? "contract" : undefined,
        issuer: kind === "stellar-classic" ? issuer : undefined,
        source: kind === "evm" ? "contract_address" : "stellar_asset",
      },
      agentCards: [],
      sources: [
        { label: "Provider B", status: "unavailable", detail: "Secret omitted", checkedAt: "2026-08-25T11:59:30Z" },
        { label: "Provider A", status: "connected", detail: "Live", checkedAt: "2026-08-25T11:59:45Z", url: `https://provider.example/evidence?apiKey=${SECRET_SEED}`, reliability: 0.9, cache: { policy: "short", ttlSeconds: 300, freshnessSeconds: 15 } },
      ],
      missingData: [{ field: "holderDistribution", reason: `Internal note ${STRATEGY_SEED}`, impact: "medium" }],
      executionPreview: { walletAddress: WALLET_SEED, transactionPlan: TX_SEED, providerSecret: SECRET_SEED } as never,
      createdAt: GENERATED_AT,
    },
  } as TokenScanResult & Record<string, unknown>;
  scan.walletAddress = WALLET_SEED;
  scan.strategyRules = STRATEGY_SEED;
  scan.internalNote = "do-not-export";
  return scan;
}

function recordFor(document: ReturnType<typeof redactRiskReportSnapshot>): RiskSnapshotRecord {
  return {
    id: "snapshot_00000000-0000-4000-8000-000000000001",
    schemaVersion: "1",
    snapshot: document,
    canonicalHash: hashRiskSnapshot(document),
    identityKey: canonicalAssetIdentity(document.asset),
    revocationTokenHash: "0".repeat(64),
    createdAt: GENERATED_AT,
    expiresAt: document.expiresAt,
  };
}

async function main() {
  assert.equal(canonicalizeJson({ z: 1, a: 2 }), canonicalizeJson({ a: 2, z: 1 }), "object key order must not affect canonical JSON");
  for (const kind of ["evm", "stellar-classic", "soroban"] as const) {
    const source = fixture(kind);
    const first = redactRiskReportSnapshot(source, { expiresAt: EXPIRES_AT, productVersion: "test" });
    const equivalent = JSON.parse(JSON.stringify(source)) as TokenScanResult;
    equivalent.riskReport!.sources.reverse();
    const second = redactRiskReportSnapshot(equivalent, { expiresAt: EXPIRES_AT, productVersion: "test" });
    assert.equal(hashRiskSnapshot(first), hashRiskSnapshot(second), `${kind} hash must be deterministic`);
    assert.equal(
      await hashRiskSnapshotInBrowser(first),
      hashRiskSnapshot(first),
      `${kind} browser Web Crypto hash must match the server canonical hash`,
    );
    assert.equal(verifyRiskSnapshotRecord(recordFor(first), Date.parse(GENERATED_AT)).ok, true);
  }

  const source = fixture("evm");
  const document = redactRiskReportSnapshot(source, { expiresAt: EXPIRES_AT, productVersion: "test" });
  const serialized = JSON.stringify(document);
  for (const secret of [WALLET_SEED, STRATEGY_SEED, SECRET_SEED, TX_SEED, "do-not-export"]) {
    assert.equal(serialized.includes(secret), false, `redacted export leaked ${secret}`);
  }
  assertPrivacySafeSnapshot(document, [WALLET_SEED, STRATEGY_SEED, SECRET_SEED, TX_SEED]);

  const materialMutation = structuredClone(document);
  materialMutation.scores.buyRisk += 1;
  assert.notEqual(hashRiskSnapshot(document), hashRiskSnapshot(materialMutation), "material mutation must change hash");
  const tampered = recordFor(document);
  tampered.snapshot = materialMutation;
  const tamperedResult = verifyRiskSnapshotRecord(tampered, Date.parse(GENERATED_AT));
  assert.equal(tamperedResult.ok, false);
  if (!tamperedResult.ok) assert.equal(tamperedResult.code, "tampered");

  const unknown = { ...recordFor(document), schemaVersion: "999" };
  const unknownResult = verifyRiskSnapshotRecord(unknown, Date.parse(GENERATED_AT));
  assert.equal(unknownResult.ok, false);
  if (!unknownResult.ok) assert.equal(unknownResult.code, "unknown_version");
  const expired = { ...recordFor(document), expiresAt: "2026-08-25T11:00:00.000Z" };
  const expiredResult = verifyRiskSnapshotRecord(expired, Date.parse(GENERATED_AT));
  assert.equal(expiredResult.ok, false);
  if (!expiredResult.ok) assert.equal(expiredResult.code, "expired");
  const collided = { ...recordFor(document), identityKey: "evm:base:evm_contract:0xdead" };
  const collidedResult = verifyRiskSnapshotRecord(collided, Date.parse(GENERATED_AT));
  assert.equal(collidedResult.ok, false);
  if (!collidedResult.ok) assert.equal(collidedResult.code, "identity_collision");

  const adapter = new MemoryStorageAdapter();
  const created = await createRiskSnapshot(source, { now: Date.now(), productVersion: "test" }, adapter);
  assert.equal((await readRiskSnapshot(created.id, adapter)).ok, true);
  assert.equal((await revokeRiskSnapshot(created.id, "wrong-token", adapter)).ok, false);
  assert.equal((await revokeRiskSnapshot(created.id, created.revocationToken, adapter)).ok, true);
  const revoked = await readRiskSnapshot(created.id, adapter);
  assert.equal(revoked.ok, false);
  if (!revoked.ok) assert.equal(revoked.code, "revoked");

  const createResponse = await createSnapshotPOST(new Request("http://localhost/api/snapshots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report: source, expiresInSeconds: 3_600 }),
  }));
  assert.equal(createResponse.status, 201);
  const createdApi = await createResponse.json() as { id: string; revocationToken: string; hash: string };
  assert.match(createdApi.hash, /^sha256:[0-9a-f]{64}$/);

  const routeContext = { params: Promise.resolve({ id: createdApi.id }) };
  const readResponse = await readSnapshotGET(new Request(`http://localhost/api/snapshots/${createdApi.id}`), routeContext);
  assert.equal(readResponse.status, 200);
  assert.match(readResponse.headers.get("cache-control") ?? "", /no-store/);
  const downloadResponse = await readSnapshotGET(new Request(`http://localhost/api/snapshots/${createdApi.id}?download=1`), routeContext);
  assert.equal(downloadResponse.status, 200);
  assert.match(downloadResponse.headers.get("content-disposition") ?? "", /attachment/);

  const revokeResponse = await revokeSnapshotPOST(new Request(`http://localhost/api/snapshots/${createdApi.id}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revocationToken: createdApi.revocationToken }),
  }), routeContext);
  assert.equal(revokeResponse.status, 200);
  const revokedReadResponse = await readSnapshotGET(new Request(`http://localhost/api/snapshots/${createdApi.id}`), routeContext);
  assert.equal(revokedReadResponse.status, 410);

  // Latest-snapshot lookup must return the newest valid record for the same asset.
  const comparisonAdapter = new MemoryStorageAdapter();
  const older = await createRiskSnapshot(source, { now: Date.parse("2026-08-26T12:00:00Z"), productVersion: "test" }, comparisonAdapter);
  const newer = await createRiskSnapshot(source, { now: Date.parse("2026-08-27T12:00:00Z"), productVersion: "test" }, comparisonAdapter);
  const comparisonNow = Date.parse("2026-08-28T12:00:00Z");
  const identityKey = canonicalAssetIdentity(document.asset);
  assert.equal((await findLatestRiskSnapshot(identityKey, { now: comparisonNow }, comparisonAdapter))?.id, newer.id);
  assert.equal(
    (await findLatestRiskSnapshot(identityKey, { excludeId: newer.id, now: comparisonNow }, comparisonAdapter))?.id,
    older.id,
  );
  assert.equal(await findLatestRiskSnapshot("evm:nowhere:asset", { now: comparisonNow }, comparisonAdapter), null);

  console.log("PASS risk snapshots: deterministic EVM/Stellar/Soroban hashes, browser/server hash parity, redaction, tamper detection, expiry, identity collision, latest-snapshot lookup, API download, and revocation");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
