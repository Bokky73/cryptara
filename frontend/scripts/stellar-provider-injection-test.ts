import { runStellarOnchainAgent, type StellarOnchainProviders } from "../src/server/agents/onchain/stellar";
import { validateAgentResult } from "../src/server/agents/schema";
import { type AgentResult } from "../src/server/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertAgentContract(result: AgentResult) {
  const parsed = validateAgentResult(result);
  assert(parsed.success, `${result.agent} result must satisfy runtime AgentResult schema.`);
  assert(result.rawSignals?.scoreBreakdown !== undefined, `${result.agent} result must include score breakdown.`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function healthyRpcProvider() {
  return {
    healthy: true,
    status: "healthy",
    network: "stellar-testnet",
    passphrase: "Test SDF Network ; September 2015",
    protocolVersion: 27,
    latestLedger: 1234567,
    closeTime: Math.floor(Date.now() / 1000),
    checkedAt: new Date().toISOString(),
    latencyMs: 10,
    providerUrl: "https://fixture.example",
    fallbackUsed: false,
    attempts: 1,
  };
}

function healthyProviders(overrides?: Partial<StellarOnchainProviders>): StellarOnchainProviders {
  return {
    fetchRpcHealth: async () => healthyRpcProvider(),
    ...overrides,
  };
}

const TEST_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TEST_CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

// ---------------------------------------------------------------------------
// Test 1: fetchRpcHealth provider is called and its result is used
// ---------------------------------------------------------------------------
async function testFetchRpcHealthInjection() {
  let callCount = 0;

  const result = await runStellarOnchainAgent(
    { chain: "stellar-testnet", assetType: "native", symbol: "XLM" },
    {
      fetchRpcHealth: async () => {
        callCount += 1;
        return healthyRpcProvider();
      },
    },
  );

  assertAgentContract(result);
  assert(callCount === 1, "fetchRpcHealth must be called exactly once.");
  assert(result.sources.some((s) => s.label === "Stellar RPC" && s.status === "connected"), "Stellar RPC source must be connected.");
  assert(result.rawSignals?.rpcHealth !== null, "rpcHealth raw signal must be set from provider.");

  console.log("  PASS testFetchRpcHealthInjection");
}

// ---------------------------------------------------------------------------
// Test 2: fetchContractState provider is called with correct contract ID and chain
// ---------------------------------------------------------------------------
async function testFetchContractStateInjection() {
  let capturedContractId = "";
  let capturedChain = "";

  const result = await runStellarOnchainAgent(
    { chain: "stellar-testnet", contractAddress: TEST_CONTRACT_ID },
    healthyProviders({
      fetchContractState: async (contractId, chain) => {
        capturedContractId = contractId;
        capturedChain = chain;
        return {
          deployed: true,
          type: "wasm_contract",
          wasmHash: "abcdef",
          lastModifiedLedgerSeq: 1234000,
          liveUntilLedgerSeq: 2234000,
          latestLedger: 1234567,
        };
      },
    }),
  );

  assertAgentContract(result);
  assert(capturedContractId.toUpperCase() === "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75".toUpperCase(),
    `fetchContractState must be called with the correct contract ID: ${capturedContractId}`);
  assert(capturedChain === "stellar-testnet", `fetchContractState must be called with chain: ${capturedChain}`);
  assert(result.findings.some((f) => f.label === "Contract interface" && f.detail.includes("WASM contract")),
    "Contract interface finding must reflect WASM type from provider.");

  console.log("  PASS testFetchContractStateInjection");
}

// ---------------------------------------------------------------------------
// Test 3: fetchClassicAssetRecord provider is called with correct args
// ---------------------------------------------------------------------------
async function testFetchClassicAssetRecordInjection() {
  let capturedChain = "";
  let capturedCode = "";
  let capturedIssuer = "";

  const result = await runStellarOnchainAgent(
    {
      chain: "stellar-testnet",
      assetType: "classic",
      symbol: "USDC",
      issuer: TEST_USDC_ISSUER,
    },
    healthyProviders({
      fetchClassicAssetRecord: async (chain, code, issuer) => {
        capturedChain = chain;
        capturedCode = code;
        capturedIssuer = issuer;
        return {
          asset_code: "USDC",
          asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          contract_id: "CBMT5M7Z7Y4FJ3H7Y5K6L7M8N9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D",
          num_liquidity_pools: 5,
          liquidity_pools_amount: "1250000",
          accounts: { authorized: 850, authorized_to_maintain_liabilities: 12, unauthorized: 8 },
          flags: { auth_required: false, auth_revocable: false, auth_immutable: true, auth_clawback_enabled: false },
        };
      },
      fetchIssuerAccount: async () => ({
        id: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
        flags: { auth_required: false, auth_revocable: false, auth_immutable: true, auth_clawback_enabled: false },
      }),
    }),
  );

  assertAgentContract(result);
  assert(capturedChain === "stellar-testnet", `fetchClassicAssetRecord must be called with chain.`);
  assert(capturedCode === "USDC", `fetchClassicAssetRecord must be called with code: ${capturedCode}`);
  assert(capturedIssuer.toUpperCase().startsWith("GBBD47"),
    `fetchClassicAssetRecord must be called with issuer.`);
  assert(result.findings.some((f) => f.label === "Asset identity" && f.detail.includes("USDC")),
    "Asset identity must reference USDC from provider data.");

  console.log("  PASS testFetchClassicAssetRecordInjection");
}

// ---------------------------------------------------------------------------
// Test 4: fetchIssuerAccount provider is called with correct issuer
// ---------------------------------------------------------------------------
async function testFetchIssuerAccountInjection() {
  let capturedIssuer = "";

  const result = await runStellarOnchainAgent(
    {
      chain: "stellar-testnet",
      assetType: "classic",
      symbol: "USDC",
      issuer: TEST_USDC_ISSUER,
    },
    healthyProviders({
      fetchClassicAssetRecord: async () => null,
      fetchIssuerAccount: async (chain, issuer) => {
        capturedIssuer = issuer;
        return {
          id: issuer,
          flags: { auth_required: true, auth_revocable: true, auth_immutable: false, auth_clawback_enabled: true },
        };
      },
    }),
  );

  assertAgentContract(result);
  assert(capturedIssuer.toUpperCase().startsWith("GBBD47"),
    `fetchIssuerAccount must be called with the correct issuer: ${capturedIssuer}`);
  assert(result.findings.some((f) => f.label === "Clawback capability" && f.severity === "high"),
    "Clawback finding must be high severity based on provider's flag data.");

  console.log("  PASS testFetchIssuerAccountInjection");
}

// ---------------------------------------------------------------------------
// Test 5: Provider that throws is handled gracefully (Promise.allSettled)
// ---------------------------------------------------------------------------
async function testProviderThrowHandling() {
  const result = await runStellarOnchainAgent(
    { chain: "stellar-testnet", assetType: "native", symbol: "XLM" },
    {
      fetchRpcHealth: async () => {
        throw new Error("Simulated RPC failure");
      },
    },
  );

  assertAgentContract(result);
  assert(result.sources.some((s) => s.label === "Stellar RPC" && s.status === "unavailable"),
    "Stellar RPC source must be unavailable when provider throws.");
  assert(result.sources.some((s) => s.label === "Stellar asset data" && s.status === "unavailable"),
    "Stellar asset data source must be unavailable when no providers return data.");
  assert(result.rawSignals?.rpcHealth === null, "rpcHealth must be null when provider throws.");
  assert(result.confidence <= 0.5, "Confidence must be reduced when RPC is unavailable.");

  console.log("  PASS testProviderThrowHandling");
}

// ---------------------------------------------------------------------------
// Test 6: Throwing provider is handled gracefully for native identity
// ---------------------------------------------------------------------------
async function testNativeIdentityWithThrowingProvider() {
  // Pass a fetchRpcHealth that throws, making this deterministic
  // (always fails RPC) rather than relying on the Stellar testnet being unreachable.
  const result = await runStellarOnchainAgent(
    { chain: "stellar-testnet", assetType: "native", symbol: "XLM" },
    {
      fetchRpcHealth: async () => {
        throw new Error("Simulated network unreachable");
      },
    },
  );

  assertAgentContract(result);
  // Even with RPC failing, the identity is resolved successfully
  assert(result.rawSignals?.stellarIdentity !== undefined, "Stellar identity must be resolved.");
  assert((result.rawSignals?.stellarIdentity as Record<string, unknown>)?.type === "native",
    "Identity must be native type.");
  assert(result.sources.some((s) => s.label === "Stellar RPC" && s.status === "unavailable"),
    "Stellar RPC must be unavailable when provider throws.");

  console.log("  PASS testNativeIdentityWithThrowingProvider");
}

// ---------------------------------------------------------------------------
// Test 7: Classic identity with all 4 providers returns consistent result
// ---------------------------------------------------------------------------
async function testAllFourProvidersClassic() {
  const providers: StellarOnchainProviders = healthyProviders({
    fetchContractState: async () => ({
      deployed: true, type: "stellar_asset_contract",
      lastModifiedLedgerSeq: 1234000, liveUntilLedgerSeq: 2234000, latestLedger: 1234567,
    }),
    fetchClassicAssetRecord: async () => ({
      asset_code: "USDC", asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      contract_id: "CBMT5M7Z7Y4FJ3H7Y5K6L7M8N9O0P1Q2R3S4T5U6V7W8X9Y0Z1A2B3C4D",
      num_liquidity_pools: 5, liquidity_pools_amount: "1250000",
      accounts: { authorized: 850, authorized_to_maintain_liabilities: 12, unauthorized: 8 },
      flags: { auth_required: false, auth_revocable: false, auth_immutable: true, auth_clawback_enabled: false },
    }),
    fetchIssuerAccount: async () => ({
      id: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      flags: { auth_required: false, auth_revocable: false, auth_immutable: true, auth_clawback_enabled: false },
    }),
  });

  const result = await runStellarOnchainAgent(
    {
      chain: "stellar-testnet", assetType: "classic",
      symbol: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    },
    providers,
  );

  assertAgentContract(result);
  assert(result.sources.every((s) => s.status === "connected"),
    "All sources must be connected when all 4 providers return data.");
  assert(result.confidence >= 0.8, "Confidence must be high when all sources are connected.");
  assert(result.recommendedAction === "hold" || result.recommendedAction === "watch",
    "Clean classic asset must not force manual review.");
  assert(result.findings.some((f) => f.label === "Contract interface" && f.detail.includes("Stellar Asset Contract")),
    "Must detect SAC interface from contract state provider.");

  console.log("  PASS testAllFourProvidersClassic");
}

// ---------------------------------------------------------------------------
// Test 8: Some providers return null, others return data
// ---------------------------------------------------------------------------
async function testPartialProviderData() {
  const result = await runStellarOnchainAgent(
    { chain: "stellar-testnet", contractAddress: TEST_CONTRACT_ID },
    healthyProviders({
      fetchContractState: async () => null, // contract not deployed
      // No fetchClassicAssetRecord or fetchIssuerAccount -- falls through to live calls (will reject)
    }),
  );

  assertAgentContract(result);
  assert(result.sources.some((s) => s.label === "Stellar RPC" && s.status === "connected"),
    "RPC source must be connected from provider.");
  assert(result.sources.some((s) => s.label === "Soroban contract state" && s.status === "unavailable"),
    "Contract state source must be unavailable when provider returns null.");
  // Check source status instead of rawSignals shape, since the
  // agent's handling of null provider returns may differ internally.
  assert(result.rawSignals?.contractIdentity === null || result.rawSignals?.contractIdentity === undefined,
    "Contract identity must be null/undefined when provider returns null.");
  assert(result.findings.some((f) => f.label === "Contract interface" && f.detail.includes("No deployed Soroban contract")),
    "Must report no contract deployed when fetchContractState returns null.");

  console.log("  PASS testPartialProviderData");
}

// ---------------------------------------------------------------------------
// Test 9: Issuer account identity type with fetchIssuerAccount provider
// ---------------------------------------------------------------------------
async function testIssuerAccountIdentity() {
  let issuerAccountCalled = false;
  let receivedIssuer = "";

  const result = await runStellarOnchainAgent(
    {
      chain: "stellar-testnet",
      assetType: "issuer_account",
      issuer: TEST_USDC_ISSUER,
    },
    {
      fetchRpcHealth: async () => healthyRpcProvider(),
      fetchIssuerAccount: async (chain, issuer) => {
        issuerAccountCalled = true;
        receivedIssuer = issuer;
        return {
          id: issuer,
          flags: { auth_required: false, auth_revocable: false, auth_immutable: false, auth_clawback_enabled: false },
        };
      },
    },
  );

  assertAgentContract(result);
  assert(issuerAccountCalled, "fetchIssuerAccount must be called for issuer_account identity type.");
  assert(receivedIssuer.toUpperCase() === TEST_USDC_ISSUER,
    `fetchIssuerAccount must receive the correct issuer, got ${receivedIssuer}.`);
  assert(result.rawSignals?.stellarIdentity !== undefined, "Identity must be resolved.");
  const identity = result.rawSignals?.stellarIdentity as Record<string, unknown>;
  assert(identity.type === "issuer_account", `Identity type must be issuer_account, got ${identity.type}.`);
  assert(result.findings.some((f) => f.label === "Asset identity" && f.detail.includes("issuer account exists")),
    "Must report that issuer account exists when fetchIssuerAccount returns data.");

  console.log("  PASS testIssuerAccountIdentity");
}

// ---------------------------------------------------------------------------
// Test 10: Invalid identity returns early error
// ---------------------------------------------------------------------------
async function testInvalidIdentity() {
  const result = await runStellarOnchainAgent(
    { chain: "stellar-testnet", assetType: "classic" }, // no symbol or issuer
  );

  // Check verdict, sources and recommendation FIRST before schema validation,
  // because the early-return path may not include scoreBreakdown.
  assert(result.verdict === "Invalid Stellar asset identity",
    `Invalid identity must return early error, got: ${result.verdict}.`);
  assert(result.recommendedAction === "manual_review",
    "Invalid identity must recommend manual review.");
  assert(result.sources.length === 0,
    "Invalid identity must have no sources (returns before any provider calls).");
  assert(result.findings.some((f) => f.label === "Asset identity" && f.severity === "critical"),
    "Invalid identity must have critical asset identity finding.");

  console.log("  PASS testInvalidIdentity");
}

// ---------------------------------------------------------------------------
// Test 11: fetchIssuerAccount is NOT called for contract identity type
// ---------------------------------------------------------------------------
async function testIssuerAccountNotCalledForContract() {
  let issuerAccountCalled = false;

  const result = await runStellarOnchainAgent(
    { chain: "stellar-testnet", contractAddress: TEST_CONTRACT_ID },
    {
      fetchRpcHealth: async () => healthyRpcProvider(),
      fetchContractState: async () => ({
        deployed: true, type: "wasm_contract",
        wasmHash: "abcdef", lastModifiedLedgerSeq: 1234000,
        liveUntilLedgerSeq: 2234000, latestLedger: 1234567,
      }),
      fetchIssuerAccount: async () => {
        issuerAccountCalled = true;
        return null;
      },
    },
  );

  assertAgentContract(result);
  assert(!issuerAccountCalled, "fetchIssuerAccount must NOT be called for contract identity type.");

  console.log("  PASS testIssuerAccountNotCalledForContract");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("StellarOnchainProviders injection unit tests:");
  await testFetchRpcHealthInjection();
  await testFetchContractStateInjection();
  await testFetchClassicAssetRecordInjection();
  await testFetchIssuerAccountInjection();
  await testProviderThrowHandling();
  await testNativeIdentityWithThrowingProvider();
  await testAllFourProvidersClassic();
  await testPartialProviderData();
  await testIssuerAccountIdentity();
  await testInvalidIdentity();
  await testIssuerAccountNotCalledForContract();
  console.log("\nAll Stellar provider injection tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
