import { runNewsAgent } from "../src/server/agents/news";
import { runOnchainAgent } from "../src/server/agents/onchain";
import { runStellarOnchainAgent, type StellarOnchainProviders } from "../src/server/agents/onchain/stellar";
import { runDecisionAgent } from "../src/server/agents/decision";
import { buildExecutionPreview, runExecutionAgent } from "../src/server/agents/execution";
import { buildAgentResult, scoreToRiskLevel } from "../src/server/agents/shared";
import { validateAgentResult } from "../src/server/agents/schema";
import { runSocialAgent } from "../src/server/agents/social";
import { resolveTokenIdentity } from "../src/server/identity/tokenIdentity";
import { createAgentRunRecord, createX402PaymentReceipt, getStorageHealth, getX402PaymentReceiptByHeaderHash } from "../src/server/storage";
import { getCachePolicyMetadata } from "../src/server/cache/strategy";
import { getProviderTimeoutBudget, resolveProviderConflict, runProviderFallbacks } from "../src/server/providers/adapter";
import { getRuntimeModeHealth } from "../src/server/env/runtimeMode";
import { assertExternalFetchAllowed, assertSep1FetchAllowed, evaluateUrlSafety, isPrivateOrLocalHost } from "../src/server/security/urlSafety";
import { parseStellarAssetInput, parseSep1Toml, deriveStellarSacContractId, type StellarAssetIdentity } from "../src/server/stellar/assetIdentity";
import { stellarNetworks } from "../src/lib/stellar/config";
import { getPortfolioHardeningReport } from "../src/server/portfolio/hardening";
import { getPortfolioRiskSignals } from "../src/server/portfolio/riskScoring";
import { createAgentRunId, getRunPartialStatus, markRunCancelled } from "../src/server/agents/orchestrationState";
import { createAgentLog, redactSecrets } from "../src/server/observability/logging";
import { evaluateAlertThresholds } from "../src/server/observability/alerts";
import { getResultMetrics } from "../src/server/observability/metrics";
import { goldenFixtureSuite, assertGoldenScore } from "../src/server/evaluation/goldenFixtures";
import { compareReplaySnapshot, createReplaySnapshot, createStellarReplaySnapshot, stellarReplaySnapshots } from "../src/server/evaluation/replay";
import { criticalFindingDoesNotLowerRisk, missingDataDoesNotIncreaseConfidence, noAgentResultRequiresManualReview, reliableSourcesDoNotLowerConfidence } from "../src/server/evaluation/properties";
import { hashSourceSnapshot } from "../src/server/storage";
import { rateLimitProfiles } from "../src/server/security/rateLimit";
import { contractAddressSchema, tokenSymbolSchema, walletAddressSchema } from "../src/server/security/inputValidation";
import { buildRiskReport, validateRiskReport } from "../src/server/scan/riskReport";
import { buildAnalysisChecks } from "../src/server/scan/tokenScan";
import { getX402RouteConfig, getX402RuntimeConfig, validateX402RuntimeConfig } from "../src/server/x402/config";
import {
  assertFreshX402Payment,
  hashPaymentHeader,
  signSettlementContext,
  X402_INTERNAL_CONTEXT_HEADER,
  X402_INTERNAL_SIGNATURE_HEADER,
  type VerifiedSettlementContext,
} from "../src/server/x402/guards";
import type { AgentResult, PortfolioSnapshot, TokenHolding } from "../src/server/types";
import { NextRequest } from "next/server";
import { POST as confirmExecution } from "../src/app/api/execute/confirm/route";
import { POST as submitExecution } from "../src/app/api/execute/submit/route";
import { POST as prepareExecution } from "../src/app/api/execute/prepare/route";
import { POST as rejectExecution } from "../src/app/api/execute/reject/route";
import { GET as getTransactionLifecycle } from "../src/app/api/execute/transactions/[hash]/route";
import { GET as listTransactionHistory } from "../src/app/api/history/transactions/route";
import { encodeWalletCookie, WALLET_SESSION_COOKIE } from "../src/server/security/walletSession";
import {
  configureEvmSimulator,
  clearEvmSimulator,
} from "../src/server/transactions/adapters/evm";
import {
  configureStellarSimulator,
  clearStellarSimulator,
} from "../src/server/transactions/adapters/stellar";
import {
  submitTransaction,
  pollTransaction,
  expireTransactionIfStale,
  prepareTransaction,
  recordUserRejection,
  TransactionLifecycleError,
} from "../src/server/transactions/lifecycleManager";
import {
  appendLifecycleEventByName,
  createTransactionRecord,
  getTransactionRecord,
  getTransactionRecordByIdempotencyKey,
  isImmutableTerminal,
  listTransactionLifecycleEvents,
  updateTransactionRecord,
} from "../src/server/storage";
import type { TransactionLifecycleStatus } from "../src/server/types";
import { runDiscoveryFixtures } from "../src/server/discovery/fixtures";

async function withWalletSession(request: NextRequest): Promise<NextRequest> {
  const text = await request.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  const walletAddress = String(body.walletAddress ?? body.decisionWalletAddress ?? "");
  const headers = new Headers(request.headers);
  if (walletAddress) {
    headers.set("cookie", `${WALLET_SESSION_COOKIE}=${encodeWalletCookie(walletAddress)}`);
  }
  return new NextRequest(request.url, {
    method: request.method,
    headers,
    body: text,
  });
}

async function prepareExecutionRequest(request: NextRequest) {
  return prepareExecution(await withWalletSession(request));
}

async function submitExecutionRequest(request: NextRequest) {
  return submitExecution(await withWalletSession(request));
}

async function confirmExecutionRequest(request: NextRequest) {
  return confirmExecution(await withWalletSession(request));
}

async function rejectExecutionRequest(request: NextRequest) {
  return rejectExecution(await withWalletSession(request));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function submitApiRequest(body: Record<string, unknown>) {
  const walletAddress = String(body.walletAddress ?? "");
  return new NextRequest("http://localhost/api/execute/submit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: `${WALLET_SESSION_COOKIE}=${encodeWalletCookie(walletAddress)}`,
    },
    body: JSON.stringify(body),
  });
}

function cleanSecurity(overrides: Record<string, unknown> = {}) {
  return {
    is_honeypot: "0",
    cannot_sell_all: "0",
    is_blacklisted: "0",
    trading_cooldown: "0",
    owner_change_balance: "0",
    is_mintable: "0",
    transfer_pausable: "0",
    is_proxy: "0",
    hidden_owner: "0",
    buy_tax: "0",
    sell_tax: "0",
    creator_address: "0x9999999999999999999999999999999999999999",
    owner_address: "0x9999999999999999999999999999999999999999",
    creator_percent: "0.10",
    owner_percent: "0.10",
    holders: [
      { address: "0x1000000000000000000000000000000000000001", percent: "0.08", is_contract: "0", is_locked: "0" },
      { address: "0x1000000000000000000000000000000000000002", percent: "0.06", is_contract: "0", is_locked: "0" },
      { address: "0x1000000000000000000000000000000000000003", percent: "0.04", is_contract: "0", is_locked: "0" },
    ],
    lp_holders: [{ address: "0x000000000000000000000000000000000000dEaD", percent: "0.95", is_contract: "1", is_locked: "1" }],
    ...overrides,
  };
}

function pair(overrides: Record<string, unknown> = {}) {
  return {
    chainId: "base",
    dexId: "uniswap",
    url: "https://dexscreener.com/base/fixture",
    pairAddress: "0x4444444444444444444444444444444444444444",
    liquidity: { usd: 1_250_000 },
    volume: { h24: 175_000 },
    priceChange: { h24: 2.4 },
    fdv: 12_000_000,
    marketCap: 10_000_000,
    pairCreatedAt: Date.now() - 120 * 86_400_000,
    ...overrides,
  };
}

async function runOnchainChecks() {
  const baseInput = {
    chain: "base",
    contractAddress: "0x3333333333333333333333333333333333333333",
  };
  const creatorOk = async () => ({
    creatorAddress: "0x9999999999999999999999999999999999999999",
    ownerAddress: "0x9999999999999999999999999999999999999999",
    creatorPercent: 10,
    ownerPercent: 10,
    dexTransferCount: 0,
    dexTransferValueUsd: 0,
    checked: true,
  });

  const honeypot = await runOnchainAgent(baseInput, {
    fetchSecurity: async () => cleanSecurity({ is_honeypot: "1", cannot_sell_all: "1" }),
    fetchPairs: async () => [pair()],
    fetchCreatorActivity: creatorOk,
  });
  assertAgentContract(honeypot);
  assert(honeypot.recommendedAction === "avoid", "Honeypot fixture must recommend avoid.");
  assert(honeypot.riskScore >= 75, "Honeypot fixture must produce critical risk.");
  assert(getRaw<{ simulationOverridesSecurityProvider?: boolean }>(honeypot, "simulationPrecedence").simulationOverridesSecurityProvider === true, "Simulation precedence must be exposed above security provider flags.");
  const honeypotDecision = runDecisionAgent({ results: [honeypot] });
  const honeypotReport = buildRiskReport({
    query: baseInput.contractAddress,
    requestedChain: "base",
    normalized: {
      chain: "base",
      contractAddress: baseInput.contractAddress,
      symbol: "HNY",
      name: "Honeypot Fixture",
      source: "contract_address",
    },
    results: [honeypot, honeypotDecision],
    decision: honeypotDecision,
    createdAt: now.toISOString(),
  });
  const honeypotCard = honeypotReport.agentCards.find((card) => card.agent === "onchain");
  assert(honeypotCard?.criticalFactors?.some((factor) => factor.category === "sellability"), "Critical honeypot/cannot-sell override must be exposed at the top of Contract Guard.");

  const nonContract = await runOnchainAgent(baseInput, {
    fetchContractCode: async () => ({ checked: true, deployed: false, bytecodeSize: 0, detail: "No deployed bytecode." }),
    fetchSecurity: async () => cleanSecurity(),
    fetchPairs: async () => [pair()],
    fetchCreatorActivity: creatorOk,
  });
  assert(nonContract.recommendedAction === "avoid", "An EOA or wrong-network address must recommend avoid.");
  assert(nonContract.riskScore >= 75, "An address without deployed bytecode must produce critical risk.");
  assert(getRaw<{ deployed?: boolean }>(nonContract, "contractIdentity").deployed === false, "RPC contract identity result must be exposed.");

  const lowLiquidity = await runOnchainAgent(baseInput, {
    fetchSecurity: async () => cleanSecurity({ lp_holders: [{ address: "0x5555555555555555555555555555555555555555", percent: "0.10", is_contract: "0", is_locked: "0" }] }),
    fetchPairs: async () => [pair({ liquidity: { usd: 12_000 }, volume: { h24: 8_000 }, fdv: 4_000_000, pairCreatedAt: Date.now() - 1 * 86_400_000 })],
    fetchCreatorActivity: creatorOk,
  });
  assert(lowLiquidity.riskScore >= 50, "Low liquidity fixture must produce high risk.");
  assert(lowLiquidity.recommendedAction === "manual_review" || lowLiquidity.recommendedAction === "avoid", "Low liquidity fixture must not recommend hold.");
  assert(getRaw<{ lockProvider?: { provider?: string } }>(lowLiquidity, "lp").lockProvider?.provider !== undefined, "Liquidity lock provider status must be exposed.");
  assert(getRaw<{ washVolumeSuspicion?: string }>(lowLiquidity, "marketManipulation").washVolumeSuspicion !== undefined, "Market manipulation flags must be exposed.");
  const lowLiquidityDecision = runDecisionAgent({ results: [lowLiquidity] });
  const lowLiquidityReport = buildRiskReport({
    query: baseInput.contractAddress,
    requestedChain: "base",
    normalized: {
      chain: "base",
      contractAddress: baseInput.contractAddress,
      symbol: "LOW",
      name: "Low Liquidity Fixture",
      source: "contract_address",
    },
    results: [lowLiquidity, lowLiquidityDecision],
    decision: lowLiquidityDecision,
    createdAt: now.toISOString(),
  });
  const lowLiquidityCard = lowLiquidityReport.agentCards.find((card) => card.agent === "onchain");
  assert(lowLiquidityCard?.secondaryScores?.some((score) => score.label === "Liquidity Risk"), "Contract Guard must expose liquidity subscore.");
  for (const category of ["liquidity", "taxes", "holder_concentration", "lp_lock", "market_anomaly"] as const) {
    assert(lowLiquidityCard?.factors.some((factor) => factor.category === category), `Contract Guard breakdown must expose ${category}.`);
  }
  assert(lowLiquidityCard?.factors.some((factor) => factor.label === "FDV/liquidity ratio" && typeof factor.meta?.fdvLiquidityRatio === "number"), "FDV/liquidity ratio must be visible with numeric metadata.");

  const blueChip = await runOnchainAgent(baseInput, {
    fetchSecurity: async () => cleanSecurity(),
    fetchPairs: async () => [pair()],
    fetchCreatorActivity: creatorOk,
  });
  assertAgentContract(blueChip);
  assert(blueChip.riskScore < 50, "Blue-chip/high-liquidity fixture must stay low/medium risk.");
  assert(blueChip.recommendedAction === "hold" || blueChip.recommendedAction === "watch", "Blue-chip/high-liquidity fixture must not force manual review.");
  assert(Array.isArray(getRaw<unknown[]>(blueChip, "privilegedFunctions")), "Privileged function detector must be exposed.");
  assert(getRaw<{ excludedCount?: number }>(blueChip, "holderExclusions").excludedCount !== undefined, "Holder exclusion report must be exposed.");
  const blueChipDecision = runDecisionAgent({ results: [blueChip], context: { mode: "token_scan", establishedAsset: true } });
  assert(blueChipDecision.recommendedAction !== "avoid", "Clean findings that mention checked blocker names must not create a critical blocker.");
  assert(blueChipDecision.riskScore < 50, "A clean established-asset scan must stay below high risk.");
  const emptyWalletPortfolio = agentResult({
    agent: "portfolio",
    riskScore: 75,
    verdict: "Manual review required",
    summary: "Wallet provider returned no usable holdings.",
    findings: [{ label: "Stablecoin reserve", severity: "critical", detail: "Verified stablecoin reserve is 0.0% of portfolio value." }],
    blockingReasons: ["Critical finding: Stablecoin reserve"],
    recommendedAction: "manual_review",
  });
  const connectedWalletDecision = runDecisionAgent({
    results: [blueChip, emptyWalletPortfolio],
    context: { mode: "token_scan", establishedAsset: true, userAlreadyOwnsToken: false, holdingAllocationPercent: 0 },
  });
  assert(connectedWalletDecision.riskScore === blueChipDecision.riskScore, "Empty wallet context must not change intrinsic token scan risk.");
  assert(!connectedWalletDecision.blockingReasons.some((reason) => reason.includes("portfolio")), "Portfolio blockers must not override token scan risk.");

  const ownedTokenPortfolio = agentResult({
    agent: "portfolio",
    riskScore: 68,
    verdict: "High target-token exposure",
    summary: "The scanned token represents 30% of the connected wallet.",
    findings: [{ label: "Target token exposure", severity: "high", detail: "Target token allocation is 30%." }],
    recommendedAction: "reduce_exposure",
  });
  const ownedTokenDecision = runDecisionAgent({
    results: [blueChip, ownedTokenPortfolio],
    context: { mode: "token_scan", establishedAsset: true, userAlreadyOwnsToken: true, holdingAllocationPercent: 30, stableReservePercent: 10 },
  });
  const ownedTokenWeights = getRaw<{ details?: Array<{ agent?: string; weight?: number }> }>(ownedTokenDecision, "weightedScore").details ?? [];
  assert(ownedTokenWeights.some((detail) => detail.agent === "portfolio" && (detail.weight ?? 0) > 0), "Owned-token scans must retain connected portfolio weight.");

  const partialOnchain = agentResult({
    agent: "onchain",
    riskScore: 42,
    verdict: "Partial onchain data",
    summary: "Some onchain providers were unavailable.",
    sources: [
      { label: "RPC bytecode", status: "connected", checkedAt: now.toISOString(), reliability: 0.96 },
      { label: "GoPlus token security", status: "connected", checkedAt: now.toISOString(), reliability: 0.8 },
      { label: "DexScreener token pairs", status: "unavailable", checkedAt: now.toISOString(), reliability: 0.1 },
    ],
    rawSignals: {
      contractIdentity: { checked: true, deployed: true, bytecodeSize: 128 },
      security: { honeypot: undefined, sellTax: "", hiddenOwner: undefined, ownerCanChangeBalance: undefined, mintable: undefined, pausable: undefined },
      holders: { holderCount: 0, top5Percent: 0 },
      lp: { lockProvider: { provider: "unavailable", protectedPercent: 0 } },
      market: { pairCount: 0 },
      scoreBreakdown: { holderConcentration: 42, liquidityExit: 68, marketAnomaly: 42 },
    },
    recommendedAction: "manual_review",
  });
  const partialChecks = buildAnalysisChecks(partialOnchain, false);
  for (const key of ["honeypot", "sell_tax", "ownership", "holders", "liquidity", "lp_lock", "market"]) {
    assert(partialChecks.find((check) => check.key === key)?.status === "unavailable", `Missing ${key} evidence must remain unavailable.`);
  }

  const dexOnly = await runOnchainAgent(baseInput, {
    fetchSecurity: async () => {
      throw new Error("security provider down");
    },
    fetchPairs: async () => [pair()],
    fetchCreatorActivity: async () => undefined,
  });
  assert(dexOnly.sources.some((source) => source.label === "DexScreener token pairs" && source.status === "connected"), "DEX source must work when security provider is down.");
  assert(dexOnly.sources.some((source) => source.label === "GoPlus token security" && source.status === "unavailable"), "Security provider outage must be visible.");
  const dexOnlyDecision = runDecisionAgent({ results: [dexOnly] });
  const dexOnlyReport = buildRiskReport({
    query: baseInput.contractAddress,
    requestedChain: "base",
    normalized: {
      chain: "base",
      contractAddress: baseInput.contractAddress,
      symbol: "DEX",
      name: "Dex Only Fixture",
      source: "contract_address",
    },
    results: [dexOnly, dexOnlyDecision],
    decision: dexOnlyDecision,
    createdAt: now.toISOString(),
  });
  const dexOnlyCard = dexOnlyReport.agentCards.find((card) => card.agent === "onchain");
  assert(dexOnlyCard?.factors.some((factor) => factor.label === "Security provider unavailable"), "Missing GoPlus provider must be visible in Contract Guard.");
}

const newsFeeds = [
  {
    label: "Fixture News",
    url: "https://news.example",
    rssUrl: "https://news.example/rss",
    reliability: 0.86,
    tier: 1 as const,
    kind: "major_news" as const,
  },
  {
    label: "Fixture Exchange",
    url: "https://exchange.example",
    rssUrl: "https://exchange.example/rss",
    reliability: 0.78,
    tier: 2 as const,
    kind: "exchange_announcement" as const,
  },
];

const now = new Date("2026-07-06T12:00:00.000Z");

function item(title: string, description: string, source = "Fixture News", link = `https://news.example/${encodeURIComponent(title)}`) {
  return {
    title,
    description,
    link,
    publishedAt: new Date("2026-07-05T12:00:00.000Z"),
    source,
    sourceTier: source === "Fixture Exchange" ? (2 as const) : (1 as const),
    sourceKind: source === "Fixture Exchange" ? ("exchange_announcement" as const) : ("major_news" as const),
    reliability: source === "Fixture Exchange" ? 0.78 : 0.86,
  };
}

function getRaw<T>(result: AgentResult, key: string): T {
  return result.rawSignals?.[key] as T;
}

function assertAgentContract(result: AgentResult) {
  const parsed = validateAgentResult(result);

  assert(parsed.success, `${result.agent} result must satisfy runtime AgentResult schema.`);
  assert(result.rawSignals?.scoreBreakdown !== undefined, `${result.agent} result must include score breakdown.`);
}

async function runNewsChecks() {
  const symbolOnly = await runNewsAgent(
    { symbol: "GOAT" },
    {
      feeds: newsFeeds,
      now,
      fetchFeed: async () => [item("GOAT announces new integration", "$GOAT integration update")],
    },
  );
  assert(getRaw<number>(symbolOnly, "identityMatchConfidence") < 0.35, "Symbol-only news match must stay low confidence.");
  assert(symbolOnly.recommendedAction === "manual_review", "Symbol-only news match must require manual review.");

  const exploit = await runNewsAgent(
    { symbol: "EXPL", tokenName: "Exploit Token" },
    {
      feeds: newsFeeds,
      now,
      fetchFeed: async () => [item("Exploit Token suffers major exploit", "Security warning: funds drained after exploit.")],
    },
  );
  assert(exploit.findings.some((finding) => finding.label === "Negative catalysts" && (finding.severity === "high" || finding.severity === "critical")), "Hack/exploit news must create high or critical impact.");

  const listing = await runNewsAgent(
    { symbol: "LIST", tokenName: "Listing Token" },
    {
      feeds: newsFeeds,
      now,
      fetchFeed: async () => [item("Fixture Exchange will list Listing Token", "Official listing support for LIST.", "Fixture Exchange")],
    },
  );
  assert(getRaw<unknown[]>(listing, "positiveCatalysts").length > 0, "Official listing must be classified as a positive catalyst.");
  assert(getRaw<Array<{ confirmationStatus?: string }>>(listing, "confirmationStatus").some((item) => item.confirmationStatus === "exchange_confirmed"), "Exchange listing must be exchange-confirmed.");
  assert(getRaw<unknown[]>(listing, "sourceCredibility").length > 0, "News source credibility registry must be exposed.");
  assert(getRaw<{ lowConfidenceTranslationRequiresManualReview?: boolean }>(listing, "regionalSupport").lowConfidenceTranslationRequiresManualReview === true, "News regional/multilingual support plan must be exposed.");
  assert(getRaw<{ independentSourceCount?: number }>(listing, "eventTimeline").independentSourceCount !== undefined, "News event timeline must be exposed.");

  const duplicate = await runNewsAgent(
    { symbol: "DUPE", tokenName: "Duplicate Token" },
    {
      feeds: newsFeeds,
      now,
      fetchFeed: async () => [
        item("Duplicate Token announces partnership", "DUPE partnership", "Fixture News", "https://news.example/dupe"),
        item("Duplicate Token announces partnership", "DUPE partnership copied", "Fixture News", "https://news.example/dupe"),
      ],
    },
  );
  assert(getRaw<unknown[]>(duplicate, "matchedArticles").length === 1, "Duplicate articles must count as one matched signal.");
  assert(getRaw<unknown[]>(duplicate, "entityExtraction").length === 1, "News entity extraction must be exposed for matched articles.");

  const unavailable = await runNewsAgent(
    { symbol: "DOWN", tokenName: "Down Token" },
    {
      feeds: newsFeeds,
      now,
      fetchFeed: async () => {
        throw new Error("source down");
      },
    },
  );
  assertAgentContract(unavailable);
  assert(unavailable.recommendedAction === "manual_review", "Unavailable news sources must not recommend hold.");
  assert(unavailable.status === "unavailable", "Unavailable news sources must be visible in agent status.");
}

function socialMetadata(url: string, text: string, links: string[] = []) {
  return {
    url,
    title: text,
    description: text,
    reachable: true,
    links,
    text,
  };
}

function socialPost(text: string, links: string[] = []) {
  return {
    text,
    links,
    createdAt: "2026-07-05T12:00:00.000Z",
    likeCount: 10,
    replyCount: 2,
    repostCount: 1,
    viewCount: 1000,
  };
}

async function runSocialChecks() {
  const directX = await runSocialAgent(
    {
      symbol: "GOAT",
      tokenName: "Goat Token",
      websiteUrl: "https://goat.example",
      twitterUrl: "https://x.com/official_goat",
    },
    {
      now,
      fetchMetadata: async (url) => socialMetadata(url, "Goat docs audit github roadmap", ["https://x.com/official_goat"]),
      fetchSocialData: async () => ({
        providerLabel: "Fixture Social",
        account: {
          handle: "official_goat",
          bio: "Official Goat Token. Website https://goat.example. Docs and audit available.",
          createdAt: "2024-01-01T00:00:00.000Z",
          followers: 12000,
          following: 120,
          postCount: 520,
          profileUrl: "https://x.com/official_goat",
          websiteUrl: "https://goat.example",
        },
        officialPosts: [socialPost("Goat Token roadmap update docs audit github https://goat.example")],
      }),
    },
  );
  assert(getRaw<{ handle?: string }>(directX, "identity").handle === "official_goat", "User X link must be analyzed directly.");
  assert(getRaw<number>(directX, "officialAccountConfidence") >= 0.75, "Direct official X link with website match must produce high identity confidence.");
  assert(getRaw<{ mutualVerificationScore?: number }>(directX, "mandatorySocialResolver").mutualVerificationScore !== undefined, "Mandatory social resolver report must be exposed.");
  assert(getRaw<{ fakeMetricsGenerated?: boolean }>(directX, "limitations").fakeMetricsGenerated === false, "Social source limitations must state fake metrics are not generated.");
  const directXDecision = runDecisionAgent({ results: [blueChipLikeResult(), directX] });
  const directXReport = buildRiskReport({
    query: "GOAT",
    requestedChain: "base",
    normalized: null,
    results: [blueChipLikeResult(), directX, directXDecision],
    decision: directXDecision,
    createdAt: now.toISOString(),
  });
  const directXCard = directXReport.agentCards.find((card) => card.agent === "social");
  assert(directXCard?.secondaryScores?.some((score) => score.label === "Social Trust"), "Social Scout must expose Social Trust subscore.");
  assert(directXCard?.secondaryScores?.some((score) => score.label === "Hype Risk"), "Social Scout must expose Hype Risk subscore.");
  for (const label of ["Official account match", "Website/social mutual verification", "Engagement quality", "Bot/shill risk", "Phishing/drainer links", "Account age and followers"]) {
    assert(directXCard?.factors.some((factor) => factor.label === label), `Social Scout breakdown must expose ${label}.`);
  }

  const symbolOnly = await runSocialAgent(
    { symbol: "GOAT" },
    {
      now,
      fetchMetadata: async (url) => socialMetadata(url, "unused"),
      fetchSocialData: async () => ({
        providerLabel: "Fixture Social",
        searchPosts: [socialPost("$GOAT community update")],
      }),
    },
  );
  assert(getRaw<number>(symbolOnly, "officialAccountConfidence") < 0.35, "Symbol-only social input must keep identity confidence low.");

  const fakeOfficial = await runSocialAgent(
    {
      symbol: "GOAT",
      tokenName: "Goat Token",
      websiteUrl: "https://goat.example",
      twitterUrl: "https://x.com/goat_airdrop_claim",
    },
    {
      now,
      fetchMetadata: async (url) => socialMetadata(url, "Goat community", ["https://x.com/goat_airdrop_claim"]),
      fetchSocialData: async () => ({
        providerLabel: "Fixture Social",
        account: {
          handle: "goat_airdrop_claim",
          bio: "Official GOAT airdrop. Claim free tokens now.",
          createdAt: "2026-06-25T00:00:00.000Z",
          followers: 80,
          following: 5,
          postCount: 6,
          profileUrl: "https://x.com/goat_airdrop_claim",
          websiteUrl: "https://claim-goat.example",
        },
        officialPosts: [socialPost("Claim free GOAT airdrop, connect wallet now", ["https://claim-goat.example/connect"])],
        replies: [
          { text: "scam fake airdrop", authorCreatedAt: "2026-07-01T00:00:00.000Z" },
          { text: "scam fake airdrop", authorCreatedAt: "2026-07-01T00:00:00.000Z" },
          { text: "scam fake airdrop", authorCreatedAt: "2026-07-01T00:00:00.000Z" },
        ],
      }),
    },
  );
  assert(fakeOfficial.riskScore >= 50, "Fake official account fixture must return high social risk.");
  assert(fakeOfficial.recommendedAction === "manual_review" || fakeOfficial.recommendedAction === "avoid", "Fake official account fixture must not recommend hold.");
  assert(getRaw<{ riskScore?: number }>(fakeOfficial, "impersonation").riskScore !== undefined, "Impersonation detector must be exposed.");

  const phishing = await runSocialAgent(
    {
      symbol: "PHISH",
      tokenName: "Phish Token",
      websiteUrl: "https://phish.example",
      twitterUrl: "https://x.com/phish_official",
    },
    {
      now,
      fetchMetadata: async (url) => socialMetadata(url, "Phish docs", ["https://x.com/phish_official"]),
      fetchSocialData: async () => ({
        providerLabel: "Fixture Social",
        account: {
          handle: "phish_official",
          bio: "Official Phish Token https://phish.example",
          createdAt: "2024-01-01T00:00:00.000Z",
          followers: 5000,
          following: 80,
          postCount: 300,
          profileUrl: "https://x.com/phish_official",
          websiteUrl: "https://phish.example",
        },
        officialPosts: [socialPost("Claim migration, connect wallet", ["https://phish-drainer.example/claim"])],
      }),
    },
  );
  assert(phishing.findings.some((finding) => finding.label === "Phishing and giveaway language" && (finding.severity === "critical" || finding.severity === "high")), "Phishing claim link fixture must be critical/high.");
  assert(getRaw<{ riskyLinks?: unknown[] }>(phishing, "phishingScanner").riskyLinks !== undefined, "Phishing link scanner must be exposed.");

  const noProvider = await runSocialAgent(
    {
      symbol: "NOP",
      tokenName: "No Provider Token",
      websiteUrl: "https://nop.example",
    },
    {
      now,
      fetchMetadata: async (url) => socialMetadata(url, "No Provider docs audit", []),
      fetchSocialData: async () => undefined,
    },
  );
  assert(getRaw<{ available?: boolean }>(noProvider, "engagement").available === false, "Provider-unavailable fixture must not invent engagement metrics.");
  assert(getRaw<boolean>(noProvider, "providerDataAvailable") === false, "Provider-unavailable fixture must expose missing provider data.");
  assert(getRaw<{ botScoreStatus?: string }>(noProvider, "limitations").botScoreStatus === "unavailable", "Missing comments/replies must make bot score unavailable.");
  const noProviderDecision = runDecisionAgent({ results: [blueChipLikeResult(), noProvider] });
  const noProviderReport = buildRiskReport({
    query: "NOP",
    requestedChain: "base",
    normalized: null,
    results: [blueChipLikeResult(), noProvider, noProviderDecision],
    decision: noProviderDecision,
    createdAt: now.toISOString(),
  });
  const noProviderCard = noProviderReport.agentCards.find((card) => card.agent === "social");
  assert(noProviderCard?.factors.some((factor) => factor.label === "Social metrics unavailable" && factor.meta?.fakeMetricsGenerated === false), "Social provider outage must show unavailable metrics without fake bot/follower scores.");

  const decision = runDecisionAgent({ results: [blueChipLikeResult(), fakeOfficial] });
  assert(decision.recommendedAction === "watch" || decision.recommendedAction === "manual_review" || decision.recommendedAction === "avoid", "Decision Agent must include Social Agent as a supporting weighted signal.");
}

function blueChipLikeResult(): AgentResult {
  return agentResult({
    agent: "onchain",
    riskScore: 18,
    verdict: "No major onchain flags",
    summary: "Fixture low-risk onchain result.",
    findings: [{ label: "Fixture onchain clean", severity: "low", detail: "No blocker." }],
    recommendedAction: "hold",
    confidence: 0.78,
  });
}

function agentResult(input: Partial<AgentResult> & Pick<AgentResult, "agent" | "riskScore" | "verdict" | "summary">): AgentResult {
  const riskScore = input.riskScore;

  return buildAgentResult({
    agent: input.agent,
    score: input.score ?? riskScore,
    verdict: input.verdict,
    summary: input.summary,
    findings: input.findings ?? [],
    sources: input.sources ?? [{ label: `${input.agent} fixture source`, status: "connected", checkedAt: now.toISOString(), reliability: 0.8 }],
    confidence: input.confidence ?? 0.72,
    recommendedAction: input.recommendedAction ?? (riskScore >= 75 ? "avoid" : riskScore >= 50 ? "manual_review" : "hold"),
    blockingReasons: input.blockingReasons,
    missingData: input.missingData,
    rawSignals: input.rawSignals,
  });
}

function unavailableAgentResult(agent: AgentResult["agent"]): AgentResult {
  return agentResult({
    agent,
    status: "unavailable",
    riskScore: 42,
    verdict: `${agent} unavailable`,
    summary: "Fixture unavailable source.",
    findings: [{ label: "Missing source", severity: "medium", detail: "Provider unavailable." }],
    sources: [{ label: `${agent} fixture source`, status: "unavailable", checkedAt: now.toISOString(), reliability: 0.1 }],
    confidence: 0.18,
    recommendedAction: "manual_review",
    missingData: [{ field: "fixture source", reason: "Provider unavailable.", impact: "medium", requiredFor: "fixture coverage" }],
  });
}

async function runDecisionChecks() {
  const noResults = runDecisionAgent({ results: [] });
  assert(noResults.recommendedAction === "manual_review", "Decision with no agent results must return manual_review.");

  const onchainCritical = runDecisionAgent({
    results: [
      agentResult({
        agent: "onchain",
        riskScore: 92,
        verdict: "Critical onchain risk",
        summary: "Honeypot cannot sell fixture.",
        findings: [{ label: "Critical contract flags", severity: "critical", detail: "Honeypot and cannot sell." }],
        blockingReasons: ["Critical finding: Honeypot"],
        recommendedAction: "avoid",
      }),
      agentResult({ agent: "news", riskScore: 12, verdict: "Positive news", summary: "Listing catalyst.", rawSignals: { positiveCatalysts: [{ title: "Listing" }] } }),
      agentResult({ agent: "social", riskScore: 14, verdict: "Positive community", summary: "Community active." }),
    ],
  });
  assert(onchainCritical.recommendedAction === "avoid" || onchainCritical.recommendedAction === "manual_review", "Onchain critical must force avoid/manual_review.");
  assert(getRaw<{ deterministicCore?: boolean }>(onchainCritical, "deterministicCore").deterministicCore === true, "Decision Agent must expose deterministic core audit.");
  assert(Array.isArray(getRaw<unknown[]>(onchainCritical, "criticalBlockerMatrix")), "Decision Agent must expose critical blocker matrix.");
  assert(getRaw<{ conflictPenalty?: number }>(onchainCritical, "confidenceFormula").conflictPenalty !== undefined, "Decision confidence formula must expose conflict penalty.");

  const lowCoverage = runDecisionAgent({
    results: [unavailableAgentResult("onchain"), unavailableAgentResult("news"), unavailableAgentResult("social")],
  });
  assert(lowCoverage.recommendedAction !== "hold", "Low/no data coverage must not return hold.");

  const highExposure = runDecisionAgent({
    context: {
      mode: "holding_review",
      userAlreadyOwnsToken: true,
      holdingAllocationPercent: 48,
      stableReservePercent: 4,
    },
    results: [
      agentResult({
        agent: "portfolio",
        riskScore: 68,
        verdict: "High portfolio exposure",
        summary: "Wallet has high allocation to one risky token.",
        findings: [{ label: "Largest holding", severity: "high", detail: "Risky token is 48% of wallet." }],
        rawSignals: { portfolioRisk: { largestHoldingPercent: 48, stableReservePercent: 4 } },
        recommendedAction: "reduce_exposure",
      }),
      agentResult({
        agent: "onchain",
        riskScore: 64,
        verdict: "High onchain risk",
        summary: "Liquidity exit risk elevated.",
        findings: [{ label: "Liquidity", severity: "high", detail: "Low liquidity." }],
        recommendedAction: "manual_review",
      }),
    ],
  });
  assert(highExposure.recommendedAction === "reduce_exposure" || highExposure.recommendedAction === "swap_to_stable", "High exposure plus high risk must recommend reduce/swap.");

  const explanation = getRaw<{ evidence?: string[]; missingData?: string[] }>(highExposure, "explanation");
  assert(Array.isArray(explanation.evidence) && explanation.evidence.length > 0, "Decision output must include top reasons/evidence.");

  const missingDataDecision = runDecisionAgent({ results: [blueChipLikeResult()] });
  const missingData = getRaw<{ missingData?: string[] }>(missingDataDecision, "explanation").missingData;
  assert(Array.isArray(missingData) && missingData.length > 0, "Decision output must include missing data when specialist agents are absent.");

  const invalidDecision = runDecisionAgent({
    results: [
      {
        ...blueChipLikeResult(),
        findings: [{ severity: "low", detail: "Missing normalized contract fields and required label." } as unknown as { label: string; severity: "low" | "medium" | "high" | "critical"; detail: string }],
      } as AgentResult,
    ],
  });
  assert(invalidDecision.recommendedAction === "manual_review", "Invalid specialist output must force manual review.");
  assert(getRaw<string[]>(invalidDecision, "invalidAgentOutput").length === 1, "Invalid specialist output must be exposed in raw signals.");
  assert(invalidDecision.sources.some((source) => source.errorCode === "invalid_agent_result"), "Invalid specialist output must be visible in sources.");
}

async function runExecutionChecks() {
  const defaultPreview = await buildExecutionPreview({
    action: "reduce_exposure",
    fromToken: "MEME",
    toToken: "USDC",
    percent: 10,
    riskScore: 40,
    estimatedValueUsd: 100,
    network: "GOAT Network",
    simulationStatus: "passed",
  });
  assert(defaultPreview.policy?.autoExecute === false, "Auto-execute must default to false.");
  assert(defaultPreview.requiresApproval === false, "Quote-missing trade action must not prepare wallet approval.");
  assert(defaultPreview.executionReady === false, "Quote-missing trade action must not be executable.");
  assert(defaultPreview.blockedReason?.includes("Live quote provider"), "Quote-missing trade action must expose blocked reason.");
  assert(defaultPreview.audit?.serverCanSign === false, "Server signing must remain disabled.");

  const quotedPreview = await buildExecutionPreview({
    action: "reduce_exposure",
    fromToken: "MEME",
    toToken: "USDC",
    percent: 10,
    riskScore: 40,
    estimatedValueUsd: 100,
    network: "GOAT Network",
    simulationStatus: "passed",
    quoteAvailable: true,
    expectedOutputAmount: 98,
  });
  assert(quotedPreview.requiresApproval === true && quotedPreview.executionReady === true, "Live quote plus passed policy must allow approval-only execution.");
  assert(quotedPreview.approvalRisk?.existingAllowanceCheck === "required", "Approval risk analysis must require allowance check for trade actions.");
  assert(quotedPreview.lifecycle?.status === "prepared", "Execution preview must expose prepared lifecycle status.");

  const policyBlocked = await buildExecutionPreview({
    action: "reduce_exposure",
    fromToken: "MEME",
    toToken: "USDC",
    percent: 90,
    riskScore: 40,
    estimatedValueUsd: 100,
    network: "GOAT Network",
  });
  assert(policyBlocked.requiresApproval === false, "Policy violation must not prepare a wallet approval.");
  assert(Boolean(policyBlocked.blockedReason), "Policy violation must expose blocked reason.");

  const manualReview = await buildExecutionPreview({
    action: "manual_review",
    fromToken: "MEME",
    toToken: "USDC",
    percent: 10,
    riskScore: 60,
  });
  assert(manualReview.requiresApproval === false && manualReview.action === "no_action", "Manual review action must not prepare a transaction.");

  const executionResult = await runExecutionAgent({
    action: "swap_to_stable",
    fromToken: "MEME",
    toToken: "USDC",
    percent: 10,
    riskScore: 40,
    estimatedValueUsd: 100,
    network: "GOAT Network",
    simulationStatus: "passed",
  });
  assert(getRaw<{ preview?: unknown }>(executionResult, "preview") !== undefined, "Execution Agent must expose preview raw signal.");

  const failedSimulationResponse = await confirmExecutionRequest(
    new NextRequest("http://localhost/api/execute/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: "0x1111111111111111111111111111111111111111",
        txHash: `0x${"a".repeat(64)}`,
        userApproved: true,
        simulationStatus: "failed",
      }),
    }),
  );
  assert(failedSimulationResponse.status === 403, "Simulation failure must block confirmation.");

  const highRiskMissingSimulationResponse = await confirmExecutionRequest(
    new NextRequest("http://localhost/api/execute/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: "0x1111111111111111111111111111111111111111",
        txHash: `0x${"c".repeat(64)}`,
        userApproved: true,
        action: "reduce_exposure",
        riskScore: 60,
        simulationStatus: "pending",
      }),
    }),
  );
  assert(highRiskMissingSimulationResponse.status === 403, "High-risk execution confirmation must require passed simulation.");

  const walletMismatchResponse = await confirmExecutionRequest(
    new NextRequest("http://localhost/api/execute/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decisionWalletAddress: "0x1111111111111111111111111111111111111111",
        walletAddress: "0x2222222222222222222222222222222222222222",
        txHash: `0x${"d".repeat(64)}`,
        userApproved: true,
      }),
    }),
  );
  assert(walletMismatchResponse.status === 403, "Confirm must reject wallet mismatch.");

  const invalidConfirmResponse = await confirmExecutionRequest(
    new NextRequest("http://localhost/api/execute/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: "0x1111111111111111111111111111111111111111",
        txHash: "not-a-tx",
        userApproved: true,
      }),
    }),
  );
  assert(invalidConfirmResponse.status === 400, "Confirm must reject invalid tx hash.");

  const validConfirmResponse = await confirmExecutionRequest(
    new NextRequest("http://localhost/api/execute/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decisionId: "decision_fixture",
        walletAddress: "0x1111111111111111111111111111111111111111",
        txHash: `0x${"b".repeat(64)}`,
        userApproved: true,
        network: "GOAT Network",
        action: "reduce_exposure",
        asset: "MEME",
        valueUsd: 25,
        simulationStatus: "passed",
        policyAllowed: true,
      }),
    }),
  );
  assert(validConfirmResponse.status === 200, "Confirm must accept valid hash plus explicit user approval.");

  const duplicateConfirmResponse = await confirmExecutionRequest(
    new NextRequest("http://localhost/api/execute/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        decisionId: "decision_fixture",
        walletAddress: "0x1111111111111111111111111111111111111111",
        txHash: `0x${"b".repeat(64)}`,
        userApproved: true,
        network: "GOAT Network",
      }),
    }),
  );
  assert(duplicateConfirmResponse.status === 200, "Confirm must remain idempotent for re-verification of an externally-broadcast hash.");
  const duplicateConfirmJson = await duplicateConfirmResponse.json();
  assert(duplicateConfirmJson.pendingVerification === true, "Re-confirming an externally-broadcast hash must report pendingVerification until on-chain verification succeeds.");

  const runRecord = await createAgentRunRecord({
    walletAddress: "0x1111111111111111111111111111111111111111",
    mode: "token_scan",
    inputSnapshot: { symbol: "MEME", chain: "base" },
    targetToken: { symbol: "MEME", chain: "base", riskScore: 60 },
    results: [blueChipLikeResult(), executionResult],
  });
  assert(runRecord.mode === "token_scan", "Agent run history must store run mode.");
  assert(runRecord.inputSnapshot?.symbol === "MEME", "Agent run history must store input snapshot.");
  assert(Array.isArray(runRecord.sourceStatuses) && runRecord.sourceStatuses.length > 0, "Agent run history must store source status snapshots.");
  assert(Array.isArray(runRecord.inputSnapshot?.resultSnapshots), "Agent run history must store result raw/source snapshots.");
  assert(
    Array.isArray(runRecord.inputSnapshot?.resultSnapshots) && typeof runRecord.inputSnapshot.resultSnapshots[0]?.sourceSnapshotHash === "string",
    "Agent run history must store immutable source snapshot hash.",
  );
}

async function runReadinessChecks() {
  assert(scoreToRiskLevel(12) === "low", "Scoring helper must map low risk consistently.");
  assert(scoreToRiskLevel(52) === "high", "Scoring helper must map high risk consistently.");
  assert(validateAgentResult(blueChipLikeResult()).success, "Fixture AgentResult must pass runtime schema.");
  assert(getRuntimeModeHealth().liveModeUsesMockData === false, "Runtime mode health must state live mode does not use mock data.");

  const unsafeUrl = evaluateUrlSafety("http://127.0.0.1/admin");
  assert(unsafeUrl.safe === false && unsafeUrl.issues.includes("private or localhost target blocked"), "URL safety guard must block localhost/private targets.");
  assert(assertExternalFetchAllowed("file:///etc/passwd").allowed === false, "External fetch sandbox must reject file protocol.");
  assert(assertExternalFetchAllowed("https://example.com/feed", "application/octet-stream", 12).allowed === false, "External fetch sandbox must reject unsupported content type.");
  assert(walletAddressSchema.safeParse("0x0000000000000000000000000000000000000001").success, "Wallet validation must accept EVM addresses.");
  assert(contractAddressSchema.safeParse("not-a-contract").success === false, "Contract validation must reject invalid addresses.");
  assert(tokenSymbolSchema.safeParse("A".repeat(40)).success === false, "Symbol validation must enforce length.");
  assert(rateLimitProfiles.tokenScan.namespace !== rateLimitProfiles.executionPrepare.namespace, "Rate limit profiles must be separated by run type.");

  const symbolOnlyIdentity = resolveTokenIdentity({ symbol: "GOAT" });
  assert(symbolOnlyIdentity.confidenceLabel === "low", "Symbol-only identity must remain low confidence.");
  assert(Boolean(symbolOnlyIdentity.identityGraph), "Resolved identity must expose an identity graph.");
  assert((symbolOnlyIdentity.symbolCollision as { risk?: string }).risk === "high", "Collision-prone symbol-only identity must expose high collision risk.");

  const linkedIdentity = resolveTokenIdentity({
    symbol: "SAFE",
    tokenName: "Safe Token",
    chain: "base",
    contractAddress: "0x3333333333333333333333333333333333333333",
    websiteUrl: "https://safe.example",
    twitterUrl: "https://x.com/safe",
    dexScreenerPairUrl: "https://dexscreener.com/base/fixture",
  });
  assert(linkedIdentity.confidenceLabel === "high", "Contract plus chain and official links must produce high identity confidence.");

  const spamHolding: TokenHolding = {
    tokenAddress: "0x9999999999999999999999999999999999999999",
    symbol: "CLAIM",
    name: "Claim Airdrop",
    chainId: "base",
    isVerified: false,
    balance: 1,
    priceUsd: 0.01,
    valueUsd: 0.01,
    allocationPercent: 0.01,
    riskScore: 70,
    riskLevel: "high",
    signals: {
      scamRisk: 80,
      websiteTrustRisk: 70,
      contractRisk: 70,
      whaleSellRisk: 40,
      liquidityRisk: 80,
      xSentimentRisk: 70,
      holderConcentrationRisk: 70,
      priceVolatilityRisk: 50,
      portfolioExposureRisk: 1,
    },
  };
  const stableHolding: TokenHolding = {
    tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    symbol: "USDC",
    name: "USD Coin",
    chainId: "base",
    isVerified: true,
    balance: 100,
    priceUsd: 1,
    valueUsd: 100,
    allocationPercent: 99.99,
    riskScore: 8,
    riskLevel: "low",
    signals: {
      scamRisk: 5,
      websiteTrustRisk: 5,
      contractRisk: 5,
      whaleSellRisk: 5,
      liquidityRisk: 5,
      xSentimentRisk: 5,
      holderConcentrationRisk: 5,
      priceVolatilityRisk: 2,
      portfolioExposureRisk: 5,
    },
  };
  const portfolio: PortfolioSnapshot = {
    walletAddress: "0xabc",
    nativeBalance: 0,
    nativeSymbol: "ETH",
    dayChangePercent: 0,
    dayChangeUsd: 0,
    totalValueUsd: 100.01,
    riskScore: 12,
    createdAt: now.toISOString(),
    holdings: [spamHolding, stableHolding],
  };
  const portfolioSignals = getPortfolioRiskSignals(portfolio.holdings);
  const hardening = getPortfolioHardeningReport(portfolio, portfolioSignals, "connected");
  assert(hardening.dustFilter.spamHoldingCount === 1, "Portfolio hardening must detect dust/spam holdings.");
  assert(hardening.fakeStablecoins.length === 0, "Verified chain-specific stablecoin must not be flagged fake.");
  assert(hardening.chainReadiness.executionReadiness === "gas_missing", "Portfolio hardening must expose native gas readiness.");
  assert(hardening.riskDriverBreakdown.some((item) => item.key === "chain_readiness"), "Portfolio hardening must expose deterministic risk driver breakdown.");

  const storageHealth = await getStorageHealth();
  for (const table of ["wallets", "agent_runs", "agent_results", "recommendations", "user_rules", "approvals", "transactions", "x402_payment_receipts", "token_identities", "source_snapshots"]) {
    assert(storageHealth.schema?.tables.includes(table), `Storage schema contract must include ${table}.`);
  }

  const unresolvedScan = await (await import("../src/server/scan/tokenScan")).runTokenScan("not-a-contract", "base");
  assert(unresolvedScan.dataQuality?.mockSources === 0, "Unresolved token scan must not use mock data.");
  assert(unresolvedScan.dataQuality?.mode === "unavailable", "Unresolved token scan must report unavailable data.");
  assert(unresolvedScan.riskReport?.verdict === "manual_review", "Unresolved token scan must produce a conservative manual-review risk report.");
  assert(unresolvedScan.riskReport && validateRiskReport(unresolvedScan.riskReport).success, "Unresolved token scan risk report must satisfy runtime schema.");

  const onchainFixture = blueChipLikeResult();
  const newsFixture = unavailableAgentResult("news");
  const socialFixture = unavailableAgentResult("social");
  const decisionFixture = runDecisionAgent({ results: [onchainFixture, newsFixture, socialFixture] });
  const riskReport = buildRiskReport({
    query: "0x3333333333333333333333333333333333333333",
    requestedChain: "base",
    normalized: {
      chain: "base",
      contractAddress: "0x3333333333333333333333333333333333333333",
      symbol: "FIX",
      name: "Fixture Token",
      source: "contract_address",
    },
    results: [onchainFixture, newsFixture, socialFixture, decisionFixture],
    decision: decisionFixture,
    createdAt: now.toISOString(),
  });
  assert(validateRiskReport(riskReport).success, "Risk report mapper must satisfy runtime schema.");
  assert(riskReport.agentCards.some((card) => card.displayName === "Contract Guard"), "Risk report must expose UI-ready Contract Guard card.");
  assert(riskReport.agentCards.some((card) => card.factors.length > 0), "Risk report must expose score factors.");

  const newsCardFixture = agentResult({
    agent: "news",
    riskScore: 34,
    verdict: "News review needed",
    summary: "Fixture news result with catalysts and source credibility.",
    findings: [{ label: "Positive catalysts", severity: "low", detail: "One listing catalyst." }],
    rawSignals: {
      matchedArticles: [{ title: "Fixture Token listing", source: "Fixture Exchange", identityMatchConfidence: 0.82 }],
      positiveCatalysts: [{ type: "positive_catalyst", severity: "low", source: "Fixture Exchange" }],
      negativeCatalysts: [],
      sourceCredibility: [{ source: "Fixture Exchange", historicalReliability: 0.78 }],
      eventTimeline: { independentSourceCount: 1, lastSeen: now.toISOString() },
      sourceReliability: 0.78,
      identityMatchConfidence: 0.82,
    },
  });
  const portfolioCardFixture = agentResult({
    agent: "portfolio",
    riskScore: 46,
    verdict: "Portfolio exposure watch",
    summary: "Target token exposure is visible.",
    findings: [{ label: "Target token exposure", severity: "medium", detail: "Target is 18% of wallet." }],
    rawSignals: {
      targetTokenExposurePercent: 18,
      portfolioRisk: {
        concentrationRisk: 38,
        liquidityExitRisk: 44,
        stableReserveRisk: 42,
        assetQualityRisk: 34,
        chainExecutionRisk: 28,
        largestHoldingPercent: 32,
        top3HoldingPercent: 72,
        stableReservePercent: 24,
        lowLiquidityExposurePercent: 18,
        unknownPriceExposurePercent: 4,
        unverifiedExposurePercent: 9,
        hasNativeGasToken: true,
        dominantChainPercent: 58,
      },
    },
  });
  const richDecision = runDecisionAgent({ results: [onchainFixture, newsCardFixture, socialFixture, portfolioCardFixture] });
  const richRiskReport = buildRiskReport({
    query: "0x3333333333333333333333333333333333333333",
    requestedChain: "base",
    normalized: {
      chain: "base",
      contractAddress: "0x3333333333333333333333333333333333333333",
      symbol: "FIX",
      name: "Fixture Token",
      source: "contract_address",
    },
    results: [onchainFixture, newsCardFixture, socialFixture, portfolioCardFixture, richDecision],
    decision: richDecision,
    createdAt: now.toISOString(),
  });
  const newsCard = richRiskReport.agentCards.find((card) => card.agent === "news");
  assert(newsCard?.secondaryScores?.some((score) => score.label === "News Signal"), "News Oracle must expose News Signal subscore.");
  assert(newsCard?.factors.some((factor) => factor.label === "Positive catalyst score"), "News Oracle must expose positive catalyst percentage factor.");
  assert(newsCard?.factors.some((factor) => factor.label === "Source reliability"), "News Oracle must expose source reliability factor.");
  assert(newsCard?.factors.some((factor) => factor.label === "Matched article list"), "News Oracle must expose simplified article list factor.");
  const portfolioCard = richRiskReport.agentCards.find((card) => card.agent === "portfolio");
  assert(portfolioCard?.secondaryScores?.some((score) => score.label === "Token Exposure"), "Portfolio Keeper must expose token exposure subscore.");
  assert(portfolioCard?.factors.some((factor) => factor.label === "Stable reserve"), "Portfolio Keeper must expose stable reserve factor.");
  assert(portfolioCard?.factors.some((factor) => factor.label === "Native gas readiness"), "Portfolio Keeper must expose native gas readiness factor.");
  const decisionCard = richRiskReport.agentCards.find((card) => card.agent === "decision");
  assert(decisionCard?.secondaryScores?.some((score) => score.label === "Final Buy Risk"), "Decision Core must expose final buy risk subscore.");
  assert(decisionCard?.factors.some((factor) => factor.label === "Critical blocker matrix"), "Decision Core must expose critical blocker matrix factor.");
  assert(decisionCard?.factors.some((factor) => factor.label === "What would change this decision"), "Decision Core must expose what-would-change factor.");

  const runId = createAgentRunId("fixture_run");
  assert(runId.startsWith("fixture_run_"), "Agent run id helper must create stable-prefixed run ids.");
  const partialStatus = getRunPartialStatus([unavailableAgentResult("news"), blueChipLikeResult()]);
  assert(partialStatus.partial === true && partialStatus.userVisible === true, "Orchestration partial status must be user-visible when an agent is unavailable.");
  assert(markRunCancelled(runId).status === "cancelled", "Run cancellation contract must expose cancelled status.");

  const log = createAgentLog(blueChipLikeResult(), "Bearer sk-test API_KEY=secret");
  assert(log.agent === "onchain" && log.sourceCount > 0, "Structured logging must include agent and source count.");
  assert(!redactSecrets("Bearer sk-abc123456789012345 api_key=secret").includes("abc123456789012345"), "Secret sanitizer must redact bearer/API key values.");

  const metrics = await getResultMetrics([blueChipLikeResult(), unavailableAgentResult("news")]);
  assert(metrics.providerFailureRate > 0 && metrics.agentSuccessRate > 0, "Metrics must expose provider failure and success rates.");
  assert(evaluateAlertThresholds({ providerFailureRate: 50, manualReviewRate: 10 }).providerFailureSpike === true, "Alert threshold must flag provider failure spikes.");

  assert(goldenFixtureSuite.includes("honeypot"), "Golden fixture suite must include honeypot case.");
  assert(assertGoldenScore("honeypot", 88), "Regression snapshot must accept expected honeypot score range.");
  assert(goldenFixtureSuite.includes("stellar_xlm"), "Golden fixture suite must include stellar XLM case.");
  assert(goldenFixtureSuite.includes("stellar_known_classic"), "Golden fixture suite must include stellar known classic case.");
  assert(goldenFixtureSuite.includes("stellar_restricted_asset"), "Golden fixture suite must include stellar restricted asset case.");
  assert(goldenFixtureSuite.includes("stellar_sac"), "Golden fixture suite must include stellar SAC case.");
  assert(goldenFixtureSuite.includes("stellar_sep41"), "Golden fixture suite must include stellar SEP-41 case.");
  assert(goldenFixtureSuite.includes("stellar_invalid_issuer"), "Golden fixture suite must include stellar invalid issuer case.");
  assert(goldenFixtureSuite.includes("stellar_unknown_contract"), "Golden fixture suite must include stellar unknown contract case.");
  assert(goldenFixtureSuite.includes("stellar_unavailable_provider"), "Golden fixture suite must include stellar unavailable provider case.");
  assert(noAgentResultRequiresManualReview(), "Property test must enforce no result -> manual_review.");
  assert(criticalFindingDoesNotLowerRisk(blueChipLikeResult(), agentResult({
    agent: "onchain",
    riskScore: 82,
    verdict: "Critical",
    summary: "Critical fixture.",
    findings: [{ label: "Critical fixture", severity: "critical", detail: "Critical blocker." }],
    recommendedAction: "avoid",
  })), "Critical finding property must not lower risk.");
  assert(missingDataDoesNotIncreaseConfidence(blueChipLikeResult(), unavailableAgentResult("news")), "Missing data property must not increase confidence.");
  assert(reliableSourcesDoNotLowerConfidence(unavailableAgentResult("news"), blueChipLikeResult()), "Reliable source property must not lower confidence when conflict-free.");

  const snapshotHash = hashSourceSnapshot({ sources: blueChipLikeResult().sources, rawSignals: blueChipLikeResult().rawSignals });
  const replaySnapshot = createReplaySnapshot(blueChipLikeResult(), snapshotHash);
  assert(compareReplaySnapshot(replaySnapshot, blueChipLikeResult()).compatible, "Replay snapshot must compare compatible deterministic results.");

  // Verify Stellar replay snapshot registry has entries for all Stellar golden fixtures
  const stellarGoldenFixtures = ["stellar_xlm", "stellar_known_classic", "stellar_restricted_asset", "stellar_sac", "stellar_sep41", "stellar_invalid_issuer", "stellar_unknown_contract", "stellar_unavailable_provider"];
  for (const fixtureName of stellarGoldenFixtures) {
    assert(stellarReplaySnapshots[fixtureName] !== undefined, `Stellar replay snapshot registry must include ${fixtureName}.`);
    assert(stellarReplaySnapshots[fixtureName].chainFamily === "stellar", `Stellar replay snapshot ${fixtureName} must have chainFamily stellar.`);
    assert(stellarReplaySnapshots[fixtureName].agent === "onchain", `Stellar replay snapshot ${fixtureName} must be for onchain agent.`);
  }
}

async function runTransactionLifecycleChecks() {
  clearEvmSimulator();
  clearStellarSimulator();

  const evmHash = `0x${"1".repeat(64)}`;
  const stellarHash = `${"a".repeat(64)}`;
  const stellarWallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "submitted", pollOutcome: "confirmed" });
  const evmSubmitted = await submitTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    decisionId: "decision_lifecycle",
    decisionAction: "reduce_exposure",
    asset: "MEME",
    valueUsd: 25,
    simulationStatus: "passed",
    policyStatus: { allowed: true, violations: [] },
    expectedEffects: [{ kind: "swap", fromToken: "MEME", toToken: "USDC" }],
    userApproved: true,
    signedPayload: evmHash,
    idempotencyKey: "idem_evm_success",
  });
  assert(evmSubmitted.outcome === "submitted" && evmSubmitted.transaction.lifecycleStatus === "submitted", "EVM submit must persist a submitted lifecycle.");
  assert(evmSubmitted.transaction.explorerUrl?.includes("tx"), "EVM submit must attach an explorer URL.");
  assert(evmSubmitted.result.idempotent === false, "Fresh EVM submit must not be flagged as idempotent.");
  assert(evmSubmitted.transaction.submittedAt !== undefined, "EVM submit must record a submittedAt timestamp.");
  const evmEvents = await listTransactionLifecycleEvents(evmSubmitted.transaction.hash);
  assert(evmEvents.some((event) => event.event === "prepared") && evmEvents.some((event) => event.event === "submitted"), "EVM submit must append prepared and submitted lifecycle events.");

  const evmPoll = await pollTransaction(evmSubmitted.transaction.hash);
  assert(evmPoll.transaction.lifecycleStatus === "confirmed" && evmPoll.terminalReached === true, "EVM poll-to-confirmed must mark the transaction confirmed.");
  assert((await listTransactionLifecycleEvents(evmPoll.transaction.hash)).some((event) => event.event === "confirmed"), "EVM poll-to-confirmed must append a confirmed event.");
  assert(evmPoll.transaction.terminalAt !== undefined, "EVM confirmed transactions must record a terminalAt timestamp.");

  assert(isImmutableTerminal("confirmed"), "Confirmed lifecycle must be considered immutable terminal.");
  assert(isImmutableTerminal("failed") && isImmutableTerminal("replaced") && isImmutableTerminal("expired") && isImmutableTerminal("user_rejected"), "All terminal lifecycle states must be flagged immutable.");

  const evmIdempotent = await submitTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    decisionId: "decision_lifecycle",
    decisionAction: "reduce_exposure",
    asset: "MEME",
    valueUsd: 25,
    simulationStatus: "passed",
    policyStatus: { allowed: true, violations: [] },
    userApproved: true,
    signedPayload: evmHash,
    idempotencyKey: "idem_evm_success",
  });
  assert(evmIdempotent.outcome === "ignored_duplicate" && evmIdempotent.result.idempotent === true && evmIdempotent.result.reuseReason === "idempotency_key", "Duplicate EVM submit with same idempotency key must short-circuit without overwriting history.");

  const evmDuplicateHash = await submitTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    decisionId: "decision_lifecycle_other",
    asset: "MEME",
    userApproved: true,
    signedPayload: evmHash,
  });
  assert(evmDuplicateHash.outcome === "ignored_duplicate" && evmDuplicateHash.result.reuseReason === "duplicate_hash", "Duplicate EVM submit with same hash and different key must reject without overwriting.");
  assert((await listTransactionLifecycleEvents(evmHash)).some((event) => event.event === "duplicate_rejected"), "Duplicate hash submit must append a duplicate_rejected lifecycle event.");

  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "submitted", pollOutcome: "failed" });
  const evmFailedHash = `0x${"2".repeat(64)}`;
  const evmFailed = await submitTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    decisionId: "decision_lifecycle_failed",
    asset: "MEME",
    userApproved: true,
    signedPayload: evmFailedHash,
    idempotencyKey: "idem_evm_failed",
  });
  const evmFailedPoll = await pollTransaction(evmFailed.transaction.hash);
  assert(evmFailedPoll.transaction.lifecycleStatus === "failed", "EVM poll-to-failed must mark the transaction failed.");
  assert(evmFailedPoll.transaction.failureReason !== undefined, "Failed EVM transactions must record a failureReason.");

  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "submitted", pollOutcome: "replaced" });
  const evmReplacedHash = `0x${"3".repeat(64)}`;
  const evmReplaced = await submitTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    decisionId: "decision_lifecycle_replaced",
    asset: "MEME",
    userApproved: true,
    signedPayload: evmReplacedHash,
    idempotencyKey: "idem_evm_replaced",
  });
  const evmReplacedPoll = await pollTransaction(evmReplaced.transaction.hash);
  assert(evmReplacedPoll.transaction.lifecycleStatus === "replaced", "EVM poll-to-replaced must mark the transaction replaced.");

  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "submitted", pollOutcome: "expired" });
  const evmExpiredHash = `0x${"4".repeat(64)}`;
  const evmExpired = await submitTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    decisionId: "decision_lifecycle_expired",
    asset: "MEME",
    userApproved: true,
    signedPayload: evmExpiredHash,
    idempotencyKey: "idem_evm_expired",
  });
  const evmExpiredPoll = await pollTransaction(evmExpired.transaction.hash);
  assert(evmExpiredPoll.transaction.lifecycleStatus === "expired", "EVM poll-to-expired must mark the transaction expired.");

  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "submitted", pollOutcome: "pending" });
  const evmPendingHash = `0x${"5".repeat(64)}`;
  const evmPending = await submitTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    decisionId: "decision_lifecycle_pending",
    asset: "MEME",
    userApproved: true,
    signedPayload: evmPendingHash,
    idempotencyKey: "idem_evm_pending",
  });
  const evmPendingPoll = await pollTransaction(evmPending.transaction.hash);
  assert(evmPendingPoll.transaction.lifecycleStatus === "pending" && evmPendingPoll.terminalReached === false, "EVM poll-to-pending must remain non-terminal.");
  const expiry = await expireTransactionIfStale(evmPendingPoll.transaction.hash, { ttlMs: 1, now: () => new Date(Date.now() + 60_000) });
  assert(expiry.expired === true && expiry.transaction?.lifecycleStatus === "expired", "Stale pending transactions must transition to expired when TTL elapses.");

  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "rejected" });
  const evmRejected = await submitTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    asset: "MEME",
    userApproved: true,
    signedPayload: `0x${"6".repeat(64)}`,
    idempotencyKey: "idem_evm_rejected",
  });
  assert(evmRejected.outcome === "terminally_recorded", "EVM rejected submit must be persisted as a terminally_recorded submission_failed.");
  assert(evmRejected.transaction.lifecycleStatus === "failed", "EVM rejected submit must persist the failed lifecycle, not leave the record at prepared.");
  assert(evmRejected.transaction.failureReason?.includes("rejected") ?? false, "EVM rejected submit must record the rejected reason on the failed record.");
  assert((await listTransactionLifecycleEvents(evmRejected.transaction.hash)).some((event) => event.event === "submission_failed"), "EVM rejected submit must append a submission_failed lifecycle event.");
  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "submitted", pollOutcome: "confirmed" });

  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "submitted", pollOutcome: "confirmed" });

  // ---- Stellar lifecycle ----
  configureStellarSimulator("stellar", "stellar-testnet", { submitOutcome: "submitted", pollOutcome: "confirmed" });
  const stellarSubmitted = await submitTransaction({
    chainFamily: "stellar",
    network: "stellar-testnet",
    walletAddress: stellarWallet,
    sourceAccount: stellarWallet,
    decisionId: "decision_stellar_success",
    asset: "GOAT",
    expectedEffects: [{ kind: "publish_risk", method: "publish_risk", contractAddress: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA" }],
    userApproved: true,
    signedPayload: stellarHash,
    idempotencyKey: "idem_stellar_success",
  });
  assert(stellarSubmitted.outcome === "submitted", "Stellar submit must persist submitted lifecycle.");
  assert(stellarSubmitted.transaction.explorerUrl?.includes("stellar.expert"), "Stellar submit must attach a stellar.expert explorer URL.");
  const stellarConfirmed = await pollTransaction(stellarSubmitted.transaction.hash);
  assert(stellarConfirmed.transaction.lifecycleStatus === "confirmed", "Stellar poll-to-confirmed must mark the transaction confirmed.");

  configureStellarSimulator("stellar", "stellar-testnet", { submitOutcome: "submitted", pollOutcome: "failed" });
  const stellarFailedHash = `${"b".repeat(64)}`;
  const stellarFailed = await submitTransaction({
    chainFamily: "stellar",
    network: "stellar-testnet",
    walletAddress: stellarWallet,
    sourceAccount: stellarWallet,
    asset: "GOAT",
    userApproved: true,
    signedPayload: stellarFailedHash,
    idempotencyKey: "idem_stellar_failed",
  });
  const stellarFailedPoll = await pollTransaction(stellarFailed.transaction.hash);
  assert(stellarFailedPoll.transaction.lifecycleStatus === "failed", "Stellar poll-to-failed must mark the transaction failed.");

  configureStellarSimulator("stellar", "stellar-testnet", { submitOutcome: "submitted", pollOutcome: "replaced" });
  const stellarReplacedHash = `${"c".repeat(64)}`;
  const stellarReplaced = await submitTransaction({
    chainFamily: "stellar",
    network: "stellar-testnet",
    walletAddress: stellarWallet,
    sourceAccount: stellarWallet,
    asset: "GOAT",
    userApproved: true,
    signedPayload: stellarReplacedHash,
    idempotencyKey: "idem_stellar_replaced",
  });
  const stellarReplacedPoll = await pollTransaction(stellarReplaced.transaction.hash);
  assert(stellarReplacedPoll.transaction.lifecycleStatus === "replaced", "Stellar poll-to-replaced must mark the transaction replaced.");

  configureStellarSimulator("stellar", "stellar-testnet", { submitOutcome: "submitted", pollOutcome: "expired" });
  const stellarExpiredHash = `${"d".repeat(64)}`;
  const stellarExpired = await submitTransaction({
    chainFamily: "stellar",
    network: "stellar-testnet",
    walletAddress: stellarWallet,
    sourceAccount: stellarWallet,
    asset: "GOAT",
    userApproved: true,
    signedPayload: stellarExpiredHash,
    idempotencyKey: "idem_stellar_expired",
  });
  const stellarExpiredPoll = await pollTransaction(stellarExpired.transaction.hash);
  assert(stellarExpiredPoll.transaction.lifecycleStatus === "expired", "Stellar poll-to-expired must mark the transaction expired.");

  configureStellarSimulator("stellar", "stellar-testnet", { submitOutcome: "rejected" });
  const stellarRejected = await submitTransaction({
    chainFamily: "stellar",
    network: "stellar-testnet",
    walletAddress: stellarWallet,
    sourceAccount: stellarWallet,
    asset: "GOAT",
    userApproved: true,
    signedPayload: `${"e".repeat(64)}`,
    idempotencyKey: "idem_stellar_rejected",
  });
  assert(stellarRejected.outcome === "terminally_recorded", "Stellar rejected submit must be persisted as a terminally_recorded submission_failed.");
  assert(stellarRejected.transaction.lifecycleStatus === "failed", "Stellar rejected submit must persist the failed lifecycle, not leave the record at prepared.");
  assert(stellarRejected.transaction.failureReason?.includes("rejected") ?? false, "Stellar rejected submit must record the rejected reason on the failed record.");
  assert((await listTransactionLifecycleEvents(stellarRejected.transaction.hash)).some((event) => event.event === "submission_failed"), "Stellar rejected submit must append a submission_failed lifecycle event.");

  configureStellarSimulator("stellar", "stellar-testnet", { submitOutcome: "submitted", pollOutcome: "confirmed" });
  clearStellarSimulator();

  try {
    await submitTransaction({
      chainFamily: "evm",
      network: "stellar-testnet",
      walletAddress: stellarWallet,
      sourceAccount: stellarWallet,
      asset: "GOAT",
      userApproved: true,
      signedPayload: stellarWallet,
    });
    throw new Error("family/network mismatch should have thrown");
  } catch (error) {
    assert(error instanceof TransactionLifecycleError && error.code === "network_chain_family_mismatch", "Submit must reject network/family mismatches.");
  }

  // ---- submission_failed is a terminal persisted state, not a thrown error ----
  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "rejected" });
  const submissionFailedHash = `0x${"7".repeat(64)}`;
  const submissionFailed = await submitTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    asset: "MEME",
    userApproved: true,
    signedPayload: submissionFailedHash,
    idempotencyKey: "idem_evm_submission_failed",
  });
  assert(submissionFailed.outcome === "terminally_recorded", "Rejected RPC submit must persist as terminally_recorded outcome.");
  assert(submissionFailed.transaction.lifecycleStatus === "failed", "Submission rejection must persist the failed lifecycle, not leave the record at prepared.");
  assert(submissionFailed.result.status === "failed", "Submission report must surface failed status to callers.");
  assert(Boolean(submissionFailed.transaction.failureReason), "Failed submission must record a failureReason tied to the RPC rejection.");
  assert((await listTransactionLifecycleEvents(submissionFailed.transaction.hash)).some((event) => event.event === "submission_failed"), "Failed submissions must append a submission_failed lifecycle event.");
  assert((await listTransactionLifecycleEvents(submissionFailed.transaction.hash)).some((event) => event.event === "prepared"), "Failed submissions must still retain the prepared lifecycle event for audit.");
  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "submitted", pollOutcome: "confirmed" });

  // ---- user_rejected is a real lifecycle path, not an orphan event ----
  const userRejectedHash = `0x${"8".repeat(64)}`;
  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "submitted", pollOutcome: "confirmed" });
  const userRejectedPrep = await submitTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    asset: "MEME",
    userApproved: true,
    signedPayload: userRejectedHash,
    idempotencyKey: "idem_evm_user_rejected",
  });
  assert(userRejectedPrep.transaction.lifecycleStatus === "submitted", "User-rejected fixture requires a fresh submitted record.");
  const userRejected = await recordUserRejection(userRejectedHash, { walletAddress: "0xabc", reason: "User clicked reject in wallet." });
  assert(userRejected.lifecycleStatus === "user_rejected", "recordUserRejection must mark the transaction as user_rejected.");
  assert(isImmutableTerminal(userRejected.lifecycleStatus as TransactionLifecycleStatus), "user_rejected must be flagged as immutable terminal.");
  assert(Boolean(userRejected.failureReason), "user_rejected must record a human-readable failureReason.");
  assert((await listTransactionLifecycleEvents(userRejectedHash)).some((event) => event.event === "user_rejected"), "user_rejected transactions must append a user_rejected lifecycle event.");

  // Re-rejecting an already terminal transaction is a no-op
  const reRejected = await recordUserRejection(userRejectedHash, { walletAddress: "0xabc" });
  assert(reRejected.lifecycleStatus === "user_rejected", "Re-rejecting a terminal user_rejected transaction must remain terminal.");

  // ---- prepareTransaction is idempotent across repeated POSTs with the same key ----
  const prepared = await prepareTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    asset: "MEME",
    decisionId: "decision_prepare_idempotent",
    idempotencyKey: "idem_prepare_idempotent",
  });
  assert(!prepared.idempotent && prepared.created === true, "First prepare must create a new prepared record.");

  const preparedAgain = await prepareTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    asset: "MEME",
    decisionId: "decision_prepare_idempotent",
    idempotencyKey: "idem_prepare_idempotent",
  });
  assert(preparedAgain.idempotent && preparedAgain.created === false, "Second prepare with the same idempotency key must be idempotent.");
  assert(preparedAgain.transaction.hash === prepared.transaction.hash, "Idempotent prepare must return the same transaction record.");
  assert(prepared.transaction.lifecycleStatus === "prepared", "Prepare must persist the prepared lifecycle.");
  assert((await listTransactionLifecycleEvents(prepared.transaction.hash)).some((event) => event.event === "prepared"), "Prepared transactions must append a prepared lifecycle event.");

  const prepareResponse = await prepareExecutionRequest(
    new NextRequest("http://localhost/api/execute/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: "0xabc",
        chainFamily: "evm",
        network: "GOAT Network",
        decisionId: "decision_prepare_route",
        asset: "MEME",
        estimatedValueUsd: 50,
        simulationStatus: "passed",
        fromToken: "MEME",
        toToken: "USDC",
        percent: 10,
        riskScore: 40,
        idemKey: "idem_prepare_route",
        idempotencyKey: "idem_prepare_route",
      }),
    }),
  );
  assert(prepareResponse.status === 200, "Prepare API must accept a valid input.");
  const prepareJson = await prepareResponse.json();
  assert(prepareJson.prepare?.created === true, "First prepare API call must create a new prepared record.");
  assert(typeof prepareJson.prepare?.transaction?.hash === "string", "Prepare API must expose the prepared transaction hash.");
  assert(prepareJson.lifecycle?.status === "prepared", "Prepare API lifecycle status must be prepared.");
  assert(typeof prepareJson.lifecycle?.idempotencyKey === "string", "Prepare API response must include the idempotency key.");

  const duplicatePrepareResponse = await prepareExecutionRequest(
    new NextRequest("http://localhost/api/execute/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: "0xabc",
        chainFamily: "evm",
        network: "GOAT Network",
        decisionId: "decision_prepare_route",
        asset: "MEME",
        estimatedValueUsd: 50,
        simulationStatus: "passed",
        fromToken: "MEME",
        toToken: "USDC",
        percent: 10,
        riskScore: 40,
        idempotencyKey: "idem_prepare_route",
      }),
    }),
  );
  const duplicatePrepareJson = await duplicatePrepareResponse.json();
  assert(duplicatePrepareResponse.status === 200, "Duplicate prepare must respond 200 (idempotent).");
  assert(duplicatePrepareJson.prepare?.idempotent === true && duplicatePrepareJson.prepare?.created === false, "Duplicate prepare API call must be idempotent.");
  assert(duplicatePrepareJson.prepare?.transaction?.hash === prepareJson.prepare?.transaction?.hash, "Duplicate prepare API call must reuse the prepared record.");

  // ---- reject API persists user_rejected terminal state ----
  const rejectHash = `0x${"a".repeat(63)}1`;
  const rejectCreated = await createTransactionRecord({
    hash: rejectHash,
    type: "approval",
    asset: "MEME",
    valueUsd: 0,
    status: "submitted",
    lifecycleStatus: "submitted",
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    userApproved: true,
  });
  assert(rejectCreated.lifecycleStatus === "submitted", "Rejected fixture requires an existing submitted record.");

  const rejectResponse = await rejectExecutionRequest(
    new NextRequest("http://localhost/api/execute/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        txHash: rejectHash,
        walletAddress: "0xabc",
        reason: "User clicked reject in wallet.",
        source: "wallet",
      }),
    }),
  );
  assert(rejectResponse.status === 200, "Reject API must record user_rejected for known hashes.");
  const rejectJson = await rejectResponse.json();
  assert(rejectJson.status === "user_rejected", "Reject API must expose user_rejected status.");
  assert((await getTransactionRecord(rejectHash))?.lifecycleStatus === "user_rejected", "Reject API must persist user_rejected terminal state in storage.");

  const unknownRejectResponse = await rejectExecutionRequest(
    new NextRequest("http://localhost/api/execute/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        txHash: `0x${"b".repeat(63)}2`,
        walletAddress: "0xabc",
      }),
    }),
  );
  assert(unknownRejectResponse.status === 404, "Reject API must reject unknown transaction hashes.");

  const mismatchedRejectResponse = await rejectExecutionRequest(
    new NextRequest("http://localhost/api/execute/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        txHash: rejectHash,
        walletAddress: "0xdef",
        reason: "Mismatched wallet cannot reject.",
      }),
    }),
  );
  assert(mismatchedRejectResponse.status === 403, "Reject API must reject mismatched wallet addresses.");

  // ---- confirm endpoint route surfaces pending verification when on-chain verifier has no terminal answer ----
  // Use a fresh network with an explicit pending simulator so the test is deterministic.
  configureEvmSimulator("evm", "ethereum", { pollOutcome: "pending" });
  const confirmPendingHash = `0x${"c".repeat(63)}3`;
  const confirmPending = await confirmExecutionRequest(
    new NextRequest("http://localhost/api/execute/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: "0xabc",
        txHash: confirmPendingHash,
        network: "ethereum",
        userApproved: true,
        action: "reduce_exposure",
        asset: "MEME",
        valueUsd: 25,
        simulationStatus: "passed",
        policyAllowed: true,
      }),
    }),
  );
  assert(confirmPending.status === 200, "Confirm API must record the externally broadcast hash and verify on-chain.");
  const confirmPendingJson = await confirmPending.json();
  assert(confirmPendingJson.pendingVerification === true, "Confirm must report pendingVerification when the on-chain verifier cannot confirm yet.");
  assert(confirmPendingJson.transaction?.lifecycleStatus === "pending" || confirmPendingJson.transaction?.lifecycleStatus === "submitted", "Confirm must record a non-terminal lifecycle when verification is still pending.");
  clearEvmSimulator();

  // Append a manual user_rejected event and ensure new hash is flagged
  appendLifecycleEventByName(`0x${"f".repeat(64)}`, "user_rejected", { reason: "User clicked reject in wallet." });
  assert((await listTransactionLifecycleEvents(`0x${"f".repeat(64)}`)).some((event) => event.event === "user_rejected"), "Lifecycle event store must keep manual user_rejected events.");

  // ---- EVM signed-payload submit exercises real payload path, not pre-hash shortcut ----
  const evmSignedPayload = `0x${"f".repeat(300)}`;
  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "submitted", pollOutcome: "confirmed" });
  const evmSignedResult = await submitTransaction({
    chainFamily: "evm",
    network: "GOAT Network",
    walletAddress: "0xabc",
    sourceAccount: "0xabc",
    asset: "MEME",
    userApproved: true,
    signedPayload: evmSignedPayload,
    idempotencyKey: "idem_evm_signed_payload",
  });
  assert(evmSignedResult.outcome === "submitted", "EVM signed-payload submit must produce a submitted lifecycle.");
  assert(evmSignedResult.transaction.lifecycleStatus === "submitted", "EVM signed-payload submit must reach submitted status.");
  const evmSignedHash = evmSignedResult.transaction.hash;
  assert((await listTransactionLifecycleEvents(evmSignedHash)).some((event) => event.event === "prepared"), "EVM signed-payload submit must append a prepared lifecycle event.");
  const evmSignedPoll = await pollTransaction(evmSignedHash);
  assert(evmSignedPoll.transaction.lifecycleStatus === "confirmed", "EVM signed-payload transaction must confirm via poll.");
  configureEvmSimulator("evm", "GOAT Network", { submitOutcome: "submitted", pollOutcome: "confirmed" });

  // ---- Stellar signed-payload submit exercises real payload path, not pre-hash shortcut ----
  configureStellarSimulator("stellar", "stellar-testnet", { submitOutcome: "submitted", pollOutcome: "confirmed" });
  const stellarSignedPayload = "AAAAAgAAAABh" + `${"a".repeat(100)}`;
  const stellarSignedResult = await submitTransaction({
    chainFamily: "stellar",
    network: "stellar-testnet",
    walletAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    sourceAccount: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    asset: "GOAT",
    userApproved: true,
    signedPayload: stellarSignedPayload,
    idempotencyKey: "idem_stellar_signed_payload",
  });
  assert(stellarSignedResult.outcome === "submitted", "Stellar signed-payload submit must produce a submitted lifecycle.");
  assert(stellarSignedResult.transaction.lifecycleStatus === "submitted", "Stellar signed-payload submit must reach submitted status.");
  const stellarSignedHash = stellarSignedResult.transaction.hash;
  const stellarSignedPoll = await pollTransaction(stellarSignedHash);
  assert(stellarSignedPoll.transaction.lifecycleStatus === "confirmed", "Stellar signed-payload transaction must confirm via poll.");
  configureStellarSimulator("stellar", "stellar-testnet", { submitOutcome: "submitted", pollOutcome: "confirmed" });

  // ---- Stellar terminal user_rejected E2E integration coverage ----
  const stellarRejectedPayload = `${"a".repeat(63)}b`;
  const stellarRejectedWallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  configureStellarSimulator("stellar", "stellar-testnet", { submitOutcome: "submitted", pollOutcome: "confirmed" });
  const stellarRejectedPrep = await submitTransaction({
    chainFamily: "stellar",
    network: "stellar-testnet",
    walletAddress: stellarRejectedWallet,
    sourceAccount: stellarRejectedWallet,
    asset: "GOAT",
    userApproved: true,
    signedPayload: stellarRejectedPayload,
    idempotencyKey: "idem_stellar_user_rejected_e2e",
  });
  assert(stellarRejectedPrep.transaction.lifecycleStatus === "submitted", "Stellar user_rejected fixture requires a fresh submitted record.");
  const stellarRejectedHash = stellarRejectedPrep.transaction.hash;
  const stellarRejectedLifecycle = await recordUserRejection(stellarRejectedHash, { walletAddress: stellarRejectedWallet, reason: "User clicked reject in Stellar wallet." });
  assert(stellarRejectedLifecycle.lifecycleStatus === "user_rejected", "Stellar recordUserRejection must mark the transaction as user_rejected.");
  assert(isImmutableTerminal(stellarRejectedLifecycle.lifecycleStatus as TransactionLifecycleStatus), "Stellar user_rejected must be flagged as immutable terminal.");
  assert((await listTransactionLifecycleEvents(stellarRejectedHash)).some((event) => event.event === "user_rejected"), "Stellar user_rejected transactions must append a user_rejected lifecycle event.");

  const stellarRejectApi = await rejectExecutionRequest(
    new NextRequest("http://localhost/api/execute/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        txHash: stellarRejectedHash,
        walletAddress: stellarRejectedWallet,
        reason: "Stellar wallet UI cancelled.",
        source: "wallet",
        chainFamily: "stellar",
        network: "stellar-testnet",
      }),
    }),
  );
  assert(stellarRejectApi.status === 200, "Reject API must accept Stellar user_rejected for known hashes.");
  const stellarRejectJson = await stellarRejectApi.json();
  assert(stellarRejectJson.status === "user_rejected", "Reject API response must surface user_rejected for Stellar hashes.");
  assert((await getTransactionRecord(stellarRejectedHash))?.lifecycleStatus === "user_rejected", "Reject API must persist user_rejected terminal state for Stellar hashes in storage.");
  clearStellarSimulator();

  let txMissing: Awaited<ReturnType<typeof getTransactionRecord>>;
  try {
    txMissing = await getTransactionRecord(`0x${"9".repeat(64)}`);
  } catch {
    txMissing = undefined;
  }
  assert(txMissing === undefined, "Unknown hash must return no transaction record.");

  // ---- API route level coverage ----
  const submitResponse = await submitExecution(
    submitApiRequest({
      chainFamily: "stellar",
      network: "stellar-testnet",
      walletAddress: stellarWallet,
      signedPayload: `${"7".repeat(64)}`,
      asset: "GOAT",
      decisionId: "decision_route_stellar",
      userApproved: true,
      idempotencyKey: "idem_route_stellar",
    }),
  );
  assert(submitResponse.status === 200, "Stellar submit API must accept valid Stellar payloads.");
  const submitJson = await submitResponse.json();
  assert(submitJson.transaction.chainFamily === "stellar", "Submit API must persist chain family.");

  const stellarHash2 = `${"7".repeat(64)}`;
  const stellarHash2Lower = stellarHash2.toLowerCase();
  const wrongFamilyResponse = await submitExecution(
    submitApiRequest({
      chainFamily: "evm",
      network: "stellar-testnet",
      walletAddress: stellarWallet,
      signedPayload: stellarHash2Lower,
      asset: "GOAT",
      userApproved: true,
      idempotencyKey: "idem_route_wrong_family",
    }),
  );
  assert(wrongFamilyResponse.status === 400, "Submit must reject when chain family does not match network.");

  const wrongWalletFormat = await submitExecution(
    submitApiRequest({
      chainFamily: "evm",
      network: "GOAT Network",
      walletAddress: "not-an-address",
      signedPayload: `0x${"a".repeat(64)}`,
      asset: "MEME",
      userApproved: true,
    }),
  );
  assert(wrongWalletFormat.status === 400, "Submit must reject invalid wallets.");

  const evmMismatchedSourceWallet = `0x${"a".repeat(40)}`;
  const evmMismatchedSourceOther = `0x${"d".repeat(40)}`;
  const evmMismatchedSource = await submitExecution(
    submitApiRequest({
      chainFamily: "evm",
      network: "GOAT Network",
      walletAddress: evmMismatchedSourceWallet,
      sourceAccount: evmMismatchedSourceOther,
      signedPayload: `0x${"b".repeat(64)}`,
      asset: "MEME",
      userApproved: true,
    }),
  );
  assert(evmMismatchedSource.status === 403, "Submit must reject EVM source/wallet mismatches.");

  // Confirm API chain-family validation
  configureStellarSimulator("stellar", "stellar-testnet", { submitOutcome: "submitted", pollOutcome: "confirmed" });
  const stellarConfirmCollision = await confirmExecutionRequest(
    new NextRequest("http://localhost/api/execute/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: stellarWallet,
        chainFamily: "stellar",
        network: "stellar-testnet",
        txHash: stellarHash2,
        userApproved: true,
      }),
    }),
  );
  assert(stellarConfirmCollision.status === 200, "Confirm must accept a Stellar hash when chainFamily=stellar.");

  const evmConfirmCollision = await confirmExecutionRequest(
    new NextRequest("http://localhost/api/execute/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: stellarWallet,
        chainFamily: "evm",
        txHash: stellarHash2,
        userApproved: true,
      }),
    }),
  );
  assert(evmConfirmCollision.status === 400, "Confirm must reject a Stellar hash when chainFamily=evm.");

  // Poll endpoint
  const pollRoute = await getTransactionLifecycle(
    new NextRequest(`http://localhost/api/execute/transactions/${evmSubmitted.transaction.hash}`, { method: "GET" }),
    { params: Promise.resolve({ hash: evmSubmitted.transaction.hash }) },
  );
  assert(pollRoute.status === 200, "Status endpoint must accept known hashes.");
  const pollJson = await pollRoute.json();
  assert(Array.isArray(pollJson.events) && pollJson.events.length > 0, "Status endpoint must include lifecycle events.");
  assert(pollJson.transaction.lifecycleStatus === "confirmed", "Status endpoint must reflect the latest lifecycle state.");

  const missingRoute = await getTransactionLifecycle(
    new NextRequest(`http://localhost/api/execute/transactions/${"9".repeat(64)}`, { method: "GET" }),
    { params: Promise.resolve({ hash: "9".repeat(64) }) },
  );
  assert(missingRoute.status === 404, "Status endpoint must return 404 for unknown hashes.");

  const richHistory = await listTransactionHistory(new NextRequest(`http://localhost/api/history/transactions?walletAddress=0xabc`, { method: "GET" }));
  assert(richHistory.status === 200, "History endpoint must respond 200.");
  const historyJson = await richHistory.json() as { items?: Array<{ events?: unknown[]; explorerUrl?: string }> };
  assert(Array.isArray(historyJson.items) && historyJson.items.length > 0, "History endpoint must return enriched records.");
  assert(historyJson.items.every((record) => Array.isArray(record.events)), "History records must include their lifecycle events.");
  assert(historyJson.items.every((record) => typeof record.explorerUrl === "string"), "History records must include an explorer URL.");

  // Storage invariants
  const lookupByHash = await getTransactionRecord(evmSubmitted.transaction.hash);
  assert(lookupByHash?.hash === evmSubmitted.transaction.hash, "Storage must retrieve transaction records by hash.");
  const lookupByKey = await getTransactionRecordByIdempotencyKey("0xabc", "idem_evm_success");
  assert(lookupByKey?.idempotencyKey === "idem_evm_success", "Storage must look up records by idempotency key.");
  assert((await updateTransactionRecord(evmSubmitted.transaction.hash, { valueUsd: 999 }))?.valueUsd === 999, "Update should mutate tracking fields without touching status.");

  clearEvmSimulator();
}

async function runProviderReliabilityChecks() {
  assert(getProviderTimeoutBudget("portfolio") === 8_000, "Portfolio provider timeout budget must be 8s.");
  assert(getProviderTimeoutBudget("onchain") === 12_000, "Onchain provider timeout budget must be 12s.");
  assert(getProviderTimeoutBudget("news") === 8_000, "News provider timeout budget must be 8s.");
  assert(getProviderTimeoutBudget("social") === 12_000, "Social provider timeout budget must be 12s.");
  assert(getProviderTimeoutBudget("decision") === 3_000, "Decision timeout budget must be 3s.");
  assert(getProviderTimeoutBudget("execution") === 20_000, "Execution prepare timeout budget must be 20s.");

  const fallback = await runProviderFallbacks([
    {
      kind: "news",
      provider: "primary",
      label: "Primary fixture provider",
      fallbackRank: 0,
      retries: 0,
      run: async () => {
        throw new Error("provider 429 rate limit");
      },
    },
    {
      kind: "news",
      provider: "fallback",
      label: "Fallback fixture provider",
      fallbackRank: 1,
      retries: 0,
      run: async () => ({ ok: true }),
    },
  ]);
  assert(fallback.ok === true, "Provider fallback chain must return fallback result when primary fails.");
  assert(fallback.fallbackRank === 1, "Provider fallback result must expose fallback rank.");
  assert(fallback.confidenceCap < 0.9, "Fallback provider result must cap confidence.");
  assert(fallback.source.provider === "fallback", "Fallback provider must be visible in source metadata.");

  const sellabilityConflict = resolveProviderConflict({
    kind: "sellability",
    primaryRisk: 10,
    secondaryRisk: 96,
    primaryLabel: "GoPlus",
    secondaryLabel: "Tenderly simulation",
  });
  assert(sellabilityConflict.riskScore === 96 && sellabilityConflict.winner === "Tenderly simulation", "Simulation cannot-sell must override clean security flags.");

  const liquidityConflict = resolveProviderConflict({
    kind: "liquidity",
    primaryRisk: 25,
    secondaryRisk: 70,
    primaryLabel: "DexScreener liquidity",
    secondaryLabel: "Aggregator quote liquidity",
  });
  assert(liquidityConflict.riskScore === 70, "Liquidity conflicts must use the conservative risk.");
}

function runCachePolicyChecks() {
  const portfolio = getCachePolicyMetadata("portfolio");
  const onchain = getCachePolicyMetadata("onchain");
  const news = getCachePolicyMetadata("news");
  const social = getCachePolicyMetadata("social");
  const execution = getCachePolicyMetadata("execution");

  assert(portfolio.ttlClass === "short" && portfolio.seconds <= 60, "Portfolio balances must use short TTL.");
  assert(onchain.ttlClass === "medium" && onchain.criticalFreshnessVisible, "Security flags must use medium TTL with freshness visible.");
  assert(news.ttlClass === "long" && social.ttlClass === "long", "News/social cache policy must use longer TTL.");
  assert(execution.scope === "no-store", "Execution planning must not be shared-cacheable.");
}

function stellarRpcHealthConnected() {
  return Promise.resolve({
    healthy: true,
    status: "healthy",
    network: "stellar-testnet",
    passphrase: "Test SDF Network ; September 2015",
    protocolVersion: 27,
    latestLedger: 1234567,
    closeTime: Math.floor(Date.now() / 1000),
    checkedAt: now.toISOString(),
    latencyMs: 42,
    providerUrl: "https://soroban-testnet.stellar.org",
    fallbackUsed: false,
    attempts: 1,
  });
}

const classicAssetRecordFactory = (overrides: Record<string, unknown> = {}) => ({
  asset_code: "USDC",
  asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  contract_id: "CBTW63DEMVXC24TBMNRW633OFVZWCYZNMZUXQ5DVOJSSCIIAAAAABCDZ",
  num_liquidity_pools: 5,
  liquidity_pools_amount: "1250000",
  accounts: {
    authorized: 850,
    authorized_to_maintain_liabilities: 12,
    unauthorized: 8,
  },
  flags: {
    auth_required: false,
    auth_revocable: false,
    auth_immutable: true,
    auth_clawback_enabled: false,
  },
  ...overrides,
});

const issuerAccountFactory = (overrides: Record<string, unknown> = {}) => ({
  id: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  accountId: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  sequence: "123456789",
  subentryCount: 3,
  flags: {
    auth_required: false,
    auth_revocable: false,
    auth_immutable: true,
    auth_clawback_enabled: false,
  },
  balances: [],
  ...overrides,
});

const sacContractState = {
  deployed: true,
  type: "stellar_asset_contract",
  lastModifiedLedgerSeq: 1234000,
  liveUntilLedgerSeq: 2234000,
  latestLedger: 1234567,
};

const wasmContractState = {
  deployed: true,
  type: "wasm_contract",
  wasmHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  lastModifiedLedgerSeq: 1234000,
  liveUntilLedgerSeq: 2234000,
  latestLedger: 1234567,
};

function assertStellarReplay(fixtureName: string, result: AgentResult) {
  const expected = stellarReplaySnapshots[fixtureName];
  assert(expected !== undefined, `Stellar replay snapshot must exist for ${fixtureName}.`);
  assert(expected.chainFamily === "stellar", `Stellar replay snapshot ${fixtureName} must have chainFamily stellar.`);
  assert(result.agent === "onchain", `Stellar ${fixtureName} must be an onchain agent result.`);
  assert(result.agent === expected.agent, `Stellar ${fixtureName} agent mismatch: expected ${expected.agent}, got ${result.agent}.`);
  assert(result.recommendedAction === expected.recommendedAction, `Stellar ${fixtureName} recommendedAction drift: expected ${expected.recommendedAction}, got ${result.recommendedAction}.${expected.migrationNote ? ` Note: ${expected.migrationNote}` : ""}`);
  assert(Math.abs(result.riskScore - expected.riskScore) <= 3, `Stellar ${fixtureName} riskScore drift: expected ${expected.riskScore}, got ${result.riskScore}.${expected.migrationNote ? ` Note: ${expected.migrationNote}` : ""}`);
  // Also verify deterministic snapshot creation
  const snapshotHash = hashSourceSnapshot({ sources: result.sources, rawSignals: result.rawSignals });
  const replaySnapshot = createStellarReplaySnapshot(result, snapshotHash, fixtureName);
  assert(replaySnapshot.chainFamily === "stellar", `Stellar replay snapshot must set chainFamily to stellar for ${fixtureName}.`);
  const selfComparison = compareReplaySnapshot(replaySnapshot, result);
  assert(selfComparison.compatible, `Stellar replay snapshot ${fixtureName} self-comparison failed: ${selfComparison.migrationNote}`);
}

async function runStellarOnchainChecks() {
  // 1. XLM (native)
  const xlmResult = await runStellarOnchainAgent(
    { chain: "stellar-testnet", assetType: "native", symbol: "XLM" },
    { fetchRpcHealth: stellarRpcHealthConnected },
  );
  assertAgentContract(xlmResult);
  assert(xlmResult.riskScore < 50, "XLM native fixture must produce low/medium risk.");
  assert(xlmResult.recommendedAction === "hold" || xlmResult.recommendedAction === "watch", "XLM native fixture must not force manual review.");
  assert(xlmResult.findings.some((f) => f.label === "Asset identity" && f.detail.includes("Native XLM identity")), "XLM report must reference native identity.");
  assert(xlmResult.findings.some((f) => f.label === "Issuer controls" && f.detail.includes("XLM has no asset issuer")), "XLM report must state no issuer.");
  assert(xlmResult.findings.some((f) => f.label === "Clawback capability" && f.detail.includes("cannot be clawed back")), "XLM report must state no clawback possible.");
  assert(xlmResult.findings.some((f) => f.label === "Trustline state" && f.detail.includes("XLM does not require a trustline")), "XLM report must state no trustline needed.");
  assert(!xlmResult.findings.some((f) => f.label.toLowerCase().includes("honeypot") || f.label.toLowerCase().includes("bytecode") || f.label.toLowerCase().includes("evm")), "XLM report must not contain EVM-only checks.");
  assert(xlmResult.sources.some((s) => s.label === "Soroban contract state" && s.status === "unavailable"), "XLM report must show contract state as unavailable.");
  assert(assertGoldenScore("stellar_xlm", xlmResult.riskScore), "XLM fixture must satisfy golden score range.");
  assertStellarReplay("stellar_xlm", xlmResult);

  // 2. Known classic asset (USDC on Stellar, clean)
  const classicProviders: StellarOnchainProviders = {
    fetchRpcHealth: stellarRpcHealthConnected,
    fetchClassicAssetRecord: async () => classicAssetRecordFactory(),
    fetchIssuerAccount: async () => issuerAccountFactory(),
    fetchContractState: async () => sacContractState,
  };
  const classicResult = await runStellarOnchainAgent(
    { chain: "stellar-testnet", assetType: "classic", symbol: "USDC", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    classicProviders,
  );
  assertAgentContract(classicResult);
  assert(classicResult.riskScore < 50, "Known classic fixture must produce low/medium risk.");
  assert(classicResult.recommendedAction === "hold" || classicResult.recommendedAction === "watch", "Known classic fixture must not force manual review.");
  assert(classicResult.findings.some((f) => f.label === "Asset identity" && f.detail.includes("USDC")), "Classic report must reference asset code.");
  assert(classicResult.findings.some((f) => f.label === "Contract interface" && f.detail.includes("Stellar Asset Contract")), "Classic SAC report must mention SAC.");
  assert(!classicResult.findings.some((f) => f.label.toLowerCase().includes("honeypot") || f.label.toLowerCase().includes("bytecode") || f.label.toLowerCase().includes("evm")), "Classic report must not contain EVM-only checks.");
  assert(assertGoldenScore("stellar_known_classic", classicResult.riskScore), "Known classic fixture must satisfy golden score range.");
  assertStellarReplay("stellar_known_classic", classicResult);

  // 3. Restricted asset (auth_required + auth_revocable + clawback enabled)
  const restrictedProviders: StellarOnchainProviders = {
    fetchRpcHealth: stellarRpcHealthConnected,
    fetchClassicAssetRecord: async () => classicAssetRecordFactory({
      num_liquidity_pools: 1,
      liquidity_pools_amount: "25000",
      accounts: { authorized: 50, authorized_to_maintain_liabilities: 200, unauthorized: 100 },
      flags: {
        auth_required: true,
        auth_revocable: true,
        auth_immutable: false,
        auth_clawback_enabled: true,
      },
    }),
    fetchIssuerAccount: async () => issuerAccountFactory({
      flags: {
        auth_required: true,
        auth_revocable: true,
        auth_immutable: false,
        auth_clawback_enabled: true,
      },
    }),
    fetchContractState: async () => sacContractState,
  };
  const restrictedResult = await runStellarOnchainAgent(
    { chain: "stellar-testnet", assetType: "classic", symbol: "REST", issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    restrictedProviders,
  );
  assertAgentContract(restrictedResult);
  assert(restrictedResult.riskScore >= 25, "Restricted asset fixture must produce at least medium risk.");
  assert(restrictedResult.findings.some((f) => f.label === "Clawback capability" && f.severity === "high"), "Restricted asset report must flag clawback as high severity.");
  assert(restrictedResult.findings.some((f) => f.label === "Trustline state" && f.detail.includes("unauthorized")), "Restricted asset report must mention unauthorized accounts.");
  assert(restrictedResult.findings.some((f) => f.label === "Issuer controls" && f.detail.includes("Authorization required: yes")), "Restricted asset report must show auth_required.");
  assert(!restrictedResult.findings.some((f) => f.label.toLowerCase().includes("honeypot") || f.label.toLowerCase().includes("bytecode") || f.label.toLowerCase().includes("evm")), "Restricted asset report must not contain EVM-only checks.");
  assert(assertGoldenScore("stellar_restricted_asset", restrictedResult.riskScore), "Restricted asset fixture must satisfy golden score range.");
  assertStellarReplay("stellar_restricted_asset", restrictedResult);

  // 4. SAC (Stellar Asset Contract, via contract address)
  const sacProviders: StellarOnchainProviders = {
    fetchRpcHealth: stellarRpcHealthConnected,
    fetchContractState: async () => sacContractState,
  };
  const sacResult = await runStellarOnchainAgent(
    { chain: "stellar-testnet", contractAddress: "CBTW63DEMVXC24TBMNRW633OFVZWCYZNMZUXQ5DVOJSSCIIAAAAABCDZ", assetType: "contract" },
    sacProviders,
  );
  assertAgentContract(sacResult);
  assert(sacResult.riskScore < 50, "SAC fixture must produce low/medium risk.");
  assert(sacResult.findings.some((f) => f.label === "Contract interface" && f.detail.includes("Stellar Asset Contract")), "SAC report must state SAC interface.");
  assert(sacResult.findings.some((f) => f.label === "Contract storage" && f.detail.includes("live until ledger")), "SAC report must show contract storage TTL.");
  assert(!sacResult.findings.some((f) => f.label.toLowerCase().includes("honeypot") || f.label.toLowerCase().includes("bytecode") || f.label.toLowerCase().includes("evm")), "SAC report must not contain EVM-only checks.");
  assert(assertGoldenScore("stellar_sac", sacResult.riskScore), "SAC fixture must satisfy golden score range.");
  assertStellarReplay("stellar_sac", sacResult);

  // 5. SEP-41 (generic Soroban WASM contract)
  const sep41Providers: StellarOnchainProviders = {
    fetchRpcHealth: stellarRpcHealthConnected,
    fetchContractState: async () => wasmContractState,
  };
  const sep41Result = await runStellarOnchainAgent(
    { chain: "stellar-testnet", contractAddress: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75", assetType: "contract" },
    sep41Providers,
  );
  assertAgentContract(sep41Result);
  assert(sep41Result.riskScore >= 25, "SEP-41 WASM fixture must produce at least medium risk (unknown issuer, no classic backing).");
  assert(sep41Result.findings.some((f) => f.label === "Contract interface" && f.detail.includes("WASM contract")), "SEP-41 report must state WASM contract.");
  assert(sep41Result.findings.some((f) => f.label === "Contract interface" && f.detail.includes("SEP-41")), "SEP-41 report must mention SEP-41 simulation requirement.");
  assert(sep41Result.confidence < 0.84, "SEP-41 WASM contract (no issuer) must have reduced confidence.");
  assert(!sep41Result.findings.some((f) => f.label.toLowerCase().includes("honeypot") || f.label.toLowerCase().includes("bytecode") || f.label.toLowerCase().includes("evm")), "SEP-41 report must not contain EVM-only checks.");
  assert(assertGoldenScore("stellar_sep41", sep41Result.riskScore), "SEP-41 fixture must satisfy golden score range.");
  assertStellarReplay("stellar_sep41", sep41Result);

  // 6. Invalid issuer (CODE:ISSUER where issuer doesn't exist)
  const invalidIssuerProviders: StellarOnchainProviders = {
    fetchRpcHealth: stellarRpcHealthConnected,
    fetchClassicAssetRecord: async () => null,
    fetchIssuerAccount: async () => null,
  };
  const invalidIssuerResult = await runStellarOnchainAgent(
    { chain: "stellar-testnet", assetType: "classic", symbol: "FAKE", issuer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" },
    invalidIssuerProviders,
  );
  assertAgentContract(invalidIssuerResult);
  assert(invalidIssuerResult.riskScore >= 60, "Invalid issuer fixture must produce high/critical risk.");
  assert(invalidIssuerResult.recommendedAction === "manual_review" || invalidIssuerResult.recommendedAction === "avoid", "Invalid issuer fixture must not recommend hold.");
  assert(invalidIssuerResult.findings.some((f) => f.label === "Issuer controls" && f.severity === "critical"), "Invalid issuer report must flag missing issuer as critical.");
  assert(invalidIssuerResult.findings.some((f) => f.label === "Asset identity" && f.detail.includes("could not be confirmed")), "Invalid issuer report must state identity not confirmed.");
  assert(!invalidIssuerResult.findings.some((f) => f.label.toLowerCase().includes("honeypot") || f.label.toLowerCase().includes("bytecode") || f.label.toLowerCase().includes("evm")), "Invalid issuer report must not contain EVM-only checks.");
  assert(assertGoldenScore("stellar_invalid_issuer", invalidIssuerResult.riskScore), "Invalid issuer fixture must satisfy golden score range.");
  assertStellarReplay("stellar_invalid_issuer", invalidIssuerResult);

  // 7. Unknown contract (contract address with no deployed code)
  const unknownContractProviders: StellarOnchainProviders = {
    fetchRpcHealth: stellarRpcHealthConnected,
    fetchContractState: async () => null,
  };
  const unknownContractResult = await runStellarOnchainAgent(
    { chain: "stellar-testnet", contractAddress: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75", assetType: "contract" },
    unknownContractProviders,
  );
  assertAgentContract(unknownContractResult);
  assert(unknownContractResult.riskScore >= 55, "Unknown contract fixture must produce high/critical risk.");
  assert(unknownContractResult.recommendedAction === "manual_review" || unknownContractResult.recommendedAction === "avoid", "Unknown contract fixture must not recommend hold.");
  assert(unknownContractResult.findings.some((f) => f.label === "Contract interface" && f.detail.includes("No deployed Soroban contract")), "Unknown contract report must state no contract deployed.");
  assert(unknownContractResult.findings.some((f) => f.label === "Contract storage" && f.detail.includes("was unavailable")), "Unknown contract report must state storage unavailable.");
  assert(!unknownContractResult.findings.some((f) => f.label.toLowerCase().includes("honeypot") || f.label.toLowerCase().includes("bytecode") || f.label.toLowerCase().includes("evm")), "Unknown contract report must not contain EVM-only checks.");
  assert(assertGoldenScore("stellar_unknown_contract", unknownContractResult.riskScore), "Unknown contract fixture must satisfy golden score range.");
  assertStellarReplay("stellar_unknown_contract", unknownContractResult);

  // 8. Unavailable provider (all RPC calls fail)
  const unavailableProviders: StellarOnchainProviders = {
    fetchRpcHealth: async () => {
      throw new Error("RPC unavailable");
    },
  };
  const unavailableResult = await runStellarOnchainAgent(
    { chain: "stellar-testnet", contractAddress: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75", assetType: "contract" },
    unavailableProviders,
  );
  assertAgentContract(unavailableResult);
  assert(unavailableResult.riskScore >= 60, "Unavailable provider fixture must produce high/critical risk.");
  assert(unavailableResult.recommendedAction === "manual_review" || unavailableResult.recommendedAction === "avoid", "Unavailable provider fixture must not recommend hold.");
  assert(unavailableResult.sources.some((s) => s.status === "unavailable"), "Unavailable provider report must show unavailable sources.");
  assert(unavailableResult.confidence < 0.5, "Unavailable provider fixture must have reduced confidence.");
  assert(!unavailableResult.findings.some((f) => f.label.toLowerCase().includes("honeypot") || f.label.toLowerCase().includes("bytecode") || f.label.toLowerCase().includes("evm")), "Unavailable provider report must not contain EVM-only checks.");
  assert(assertGoldenScore("stellar_unavailable_provider", unavailableResult.riskScore), "Unavailable provider fixture must satisfy golden score range.");
  assertStellarReplay("stellar_unavailable_provider", unavailableResult);
}

function signedPaymentHeaders(
  paymentSignature: string,
  config: Parameters<typeof assertFreshX402Payment>[0]["config"],
  overrides: Partial<VerifiedSettlementContext> = {},
): Record<string, string> {
  const context: VerifiedSettlementContext = {
    amount: config.priceUsd,
    recipient: config.payTo,
    network: config.network,
    asset: config.asset,
    payer: "",
    transactionHash: "",
    settlementTimestamp: new Date().toISOString(),
    chainFamily: config.chainFamily,
    ...overrides,
  };
  const signed = signSettlementContext(context);
  return {
    "PAYMENT-SIGNATURE": paymentSignature,
    [X402_INTERNAL_CONTEXT_HEADER]: signed.contextHeader,
    [X402_INTERNAL_SIGNATURE_HEADER]: signed.signatureHeader,
  };
}

async function runX402Checks() {
  const previous = {
    X402_PAY_TO: process.env.X402_PAY_TO,
    X402_PRICE_USD: process.env.X402_PRICE_USD,
    X402_NETWORK: process.env.X402_NETWORK,
    X402_FACILITATOR_URL: process.env.X402_FACILITATOR_URL,
    X402_STELLAR_ENABLED: process.env.X402_STELLAR_ENABLED,
    X402_PAYMENT_EXPIRY_SECONDS: process.env.X402_PAYMENT_EXPIRY_SECONDS,
    CDP_API_KEY_ID: process.env.CDP_API_KEY_ID,
    CDP_API_KEY_SECRET: process.env.CDP_API_KEY_SECRET,
  };

  process.env.X402_PAY_TO = "0x0000000000000000000000000000000000000001";
  process.env.X402_PRICE_USD = "$0.01";
  process.env.X402_NETWORK = "eip155:84532";
  process.env.X402_FACILITATOR_URL = "https://x402.org/facilitator";
  delete process.env.X402_STELLAR_ENABLED;
  delete process.env.X402_PAYMENT_EXPIRY_SECONDS;

  const config = getX402RuntimeConfig();
  const validation = validateX402RuntimeConfig(config);
  const routeConfig = getX402RouteConfig(config);

  assert(validation.ok, `x402 config should validate in fixture: ${validation.issues.join(", ")}`);
  assert(config.protectedResource === "/api/x402/deep-scan", "x402 protected resource must be the premium deep scan endpoint.");
  assert(config.chainFamily === "evm", "EVM network config must detect evm chain family.");
  assert(config.paymentExpirySeconds === 300, "Payment expiry must default to 300 seconds.");
  assert(config.supportedSchemes.includes("exact"), "EVM config must support exact scheme.");
  assert(Array.isArray(routeConfig.accepts), "x402 route config must expose payment requirements.");
  assert(routeConfig.accepts[0]?.payTo === config.payTo, "x402 route config must bind the expected recipient.");
  assert(routeConfig.accepts[0]?.network === config.network, "x402 route config must bind the expected network.");

  // Test: fresh payment passes guard
  const request = new NextRequest("http://localhost/api/x402/deep-scan?query=GOAT&chain=base", {
    headers: signedPaymentHeaders("fixture-payment-signature", config),
  });
  const guard = await assertFreshX402Payment({
    request,
    requestBody: { query: "GOAT", chain: "base" },
    config,
  });

  assert(guard.ok, "Fresh x402 payment signature must pass idempotency guard.");
  assert(guard.paymentDetails.chainFamily === "evm", "Payment details must expose evm chain family.");
  assert(typeof guard.requestBodyHash === "string" && guard.requestBodyHash.length === 64, "Payment must bind to exact request body hash.");

  // Test: receipt with chain family
  const receipt = await createX402PaymentReceipt({
    requestId: guard.requestId,
    paymentHeaderHash: guard.paymentHeaderHash,
    network: config.network,
    asset: config.asset,
    amount: config.priceUsd,
    priceUsd: config.priceUsd,
    payTo: config.payTo,
    facilitatorUrl: config.facilitatorUrl,
    protectedResource: config.protectedResource,
    requestBodyHash: guard.requestBodyHash,
    verificationStatus: "verified",
    chainFamily: "evm",
  });

  assert(receipt.id.startsWith("x402_"), "x402 payment receipts must use x402 ids.");
  assert(receipt.chainFamily === "evm", "x402 receipt must store evm chain family.");
  assert((await getX402PaymentReceiptByHeaderHash(hashPaymentHeader("fixture-payment-signature")))?.id === receipt.id, "x402 receipts must be retrievable by payment header hash.");

  // Test: duplicate payment rejected
  const duplicate = await assertFreshX402Payment({
    request,
    requestBody: { query: "GOAT", chain: "base" },
    config,
  });

  assert(!duplicate.ok && duplicate.status === 409, "Duplicate x402 payment signature must be rejected before premium work runs.");

  // Test: amount mismatch with x402 middleware headers
  const amountMismatch = await assertFreshX402Payment({
    request: new NextRequest("http://localhost/api/x402/deep-scan?query=GOAT&chain=base", {
      headers: signedPaymentHeaders("fixture-amount-mismatch", config, { amount: "$0.001" }),
    }),
    requestBody: { query: "GOAT", chain: "base" },
    config,
  });

  assert(!amountMismatch.ok && amountMismatch.error === "payment_amount_mismatch", "Payment amount mismatch must be rejected before premium work runs.");

  // Test: recipient mismatch
  const recipientMismatch = await assertFreshX402Payment({
    request: new NextRequest("http://localhost/api/x402/deep-scan?query=GOAT&chain=base", {
      headers: signedPaymentHeaders("fixture-recipient-mismatch", config, { recipient: "0x0000000000000000000000000000000000000099" }),
    }),
    requestBody: { query: "GOAT", chain: "base" },
    config,
  });

  assert(!recipientMismatch.ok && recipientMismatch.error === "payment_recipient_mismatch", "Payment recipient mismatch must be rejected before premium work runs.");

  // Test: network mismatch
  const networkMismatch = await assertFreshX402Payment({
    request: new NextRequest("http://localhost/api/x402/deep-scan?query=GOAT&chain=base", {
      headers: signedPaymentHeaders("fixture-network-mismatch", config, { network: "eip155:1" }),
    }),
    requestBody: { query: "GOAT", chain: "base" },
    config,
  });

  assert(!networkMismatch.ok && networkMismatch.error === "payment_network_mismatch", "Payment network mismatch must be rejected before premium work runs.");

  // Test: expired payment
  const expired = await assertFreshX402Payment({
    request: new NextRequest("http://localhost/api/x402/deep-scan?query=GOAT&chain=base", {
      headers: signedPaymentHeaders("fixture-expired", config, {
        settlementTimestamp: new Date(Date.now() - 600_000).toISOString(),
      }),
    }),
    requestBody: { query: "GOAT", chain: "base" },
    config,
  });

  assert(!expired.ok && expired.error === "payment_expired", "Expired x402 payment must be rejected before premium work runs.");

  // Test: payment with payer identity on headers
  const withPayer = await assertFreshX402Payment({
    request: new NextRequest("http://localhost/api/x402/deep-scan?query=GOAT&chain=base", {
      headers: signedPaymentHeaders("fixture-with-payer", config, {
        payer: "0x0000000000000000000000000000000000000001",
        transactionHash: "0x" + "a".repeat(64),
      }),
    }),
    requestBody: { query: "GOAT", chain: "base" },
    config,
  });

  assert(withPayer.ok, "Valid EVM payer identity must pass payment guard.");
  assert(withPayer.paymentDetails.payer === "0x0000000000000000000000000000000000000001", "EVM payer must be exposed in payment details.");
  assert(withPayer.paymentDetails.transactionHash === "0x" + "a".repeat(64), "EVM transaction hash must be exposed in payment details.");

  // Test: price format validation
  process.env.X402_PRICE_USD = "0.01";
  const invalid = validateX402RuntimeConfig(getX402RuntimeConfig());
  assert(!invalid.ok && invalid.issues.some((issue) => issue.includes("X402_PRICE_USD")), "x402 price must keep dollar-prefixed format.");

  // Test: Base mainnet requires CDP facilitator
  process.env.X402_PRICE_USD = "$0.01";
  process.env.X402_NETWORK = "eip155:8453";
  const invalidMainnetFacilitator = validateX402RuntimeConfig(getX402RuntimeConfig());
  assert(
    !invalidMainnetFacilitator.ok && invalidMainnetFacilitator.issues.some((issue) => issue.includes("Base mainnet")),
    "Base mainnet must reject the testnet-only facilitator.",
  );

  // Test: CDP facilitator requires credentials
  process.env.X402_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  const invalidCdpAuth = validateX402RuntimeConfig(getX402RuntimeConfig());
  assert(!invalidCdpAuth.ok && invalidCdpAuth.issues.some((issue) => issue.includes("CDP_API_KEY_ID")), "CDP facilitator must require both API credentials.");

  // Test: Stellar network config validation
  process.env.X402_NETWORK = "stellar:testnet";
  process.env.X402_PAY_TO = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
  process.env.X402_FACILITATOR_URL = "https://x402.org/facilitator";
  process.env.X402_STELLAR_ENABLED = "1";
  const stellarConfig = getX402RuntimeConfig();
  assert(stellarConfig.chainFamily === "stellar", "Stellar network must detect stellar chain family.");
  assert(stellarConfig.supportedSchemes.includes("exact-stellar"), "Stellar-enabled config must support exact-stellar scheme.");
  assert(stellarConfig.asset === "USDC:stellar", "Stellar config must default to USDC:stellar asset.");

  // Test: Stellar payment with valid payer
  const stellarGuard = await assertFreshX402Payment({
    request: new NextRequest("http://localhost/api/x402/deep-scan?query=GOAT&chain=stellar", {
      headers: signedPaymentHeaders("fixture-stellar-payer", stellarConfig, {
        payer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
        transactionHash: "a".repeat(64),
      }),
    }),
    requestBody: { query: "GOAT", chain: "stellar" },
    config: stellarConfig,
  });

  assert(stellarGuard.ok, "Valid Stellar payer identity must pass payment guard.");
  assert(stellarGuard.paymentDetails.chainFamily === "stellar", "Stellar payment must expose stellar chain family.");
  assert(stellarGuard.paymentDetails.payer === "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H", "Stellar payer must be exposed in payment details.");

  // Test: invalid payer address format
  const invalidPayer = await assertFreshX402Payment({
    request: new NextRequest("http://localhost/api/x402/deep-scan?query=GOAT&chain=base", {
      headers: signedPaymentHeaders("fixture-invalid-payer", config, { payer: "not-a-valid-address" }),
    }),
    requestBody: { query: "GOAT", chain: "base" },
    config,
  });

  assert(!invalidPayer.ok && invalidPayer.error === "invalid_payer_identity", "Invalid payer address format must be rejected.");

  // Test: payer chain family mismatch (Stellar payer on EVM network)
  const chainMismatch = await assertFreshX402Payment({
    request: new NextRequest("http://localhost/api/x402/deep-scan?query=GOAT&chain=base", {
      headers: signedPaymentHeaders("fixture-chain-mismatch", config, {
        payer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      }),
    }),
    requestBody: { query: "GOAT", chain: "base" },
    config,
  });

  assert(!chainMismatch.ok && chainMismatch.error === "payer_chain_family_mismatch", "Stellar payer on EVM network must be rejected.");

  // Test: invalid EVM transaction hash format
  const invalidTxHash = await assertFreshX402Payment({
    request: new NextRequest("http://localhost/api/x402/deep-scan?query=GOAT&chain=base", {
      headers: signedPaymentHeaders("fixture-invalid-tx", config, {
        payer: "0x0000000000000000000000000000000000000001",
        transactionHash: "not-a-tx-hash",
      }),
    }),
    requestBody: { query: "GOAT", chain: "base" },
    config,
  });

  assert(!invalidTxHash.ok && invalidTxHash.error === "invalid_transaction_hash", "Invalid EVM transaction hash format must be rejected.");

  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function runStellarAssetIdentityChecks() {
  const testnetPassphrase = stellarNetworks["stellar-testnet"].networkPassphrase;
  const networkId = "stellar-testnet";

  // 1. Native XLM resolution
  const nativeXlm = parseStellarAssetInput("xlm", networkId);
  assert(nativeXlm !== null, "XLM must resolve.");
  assert(nativeXlm!.type === "native", "XLM must resolve as native type.");
  assert(nativeXlm!.assetKey === "native", "XLM asset key must be 'native'.");
  assert((nativeXlm as { symbol: string }).symbol === "XLM", "XLM symbol must be XLM.");
  assert((nativeXlm as { contractId: string }).contractId.startsWith("C"), "Native XLM must derive a SAC contract ID.");

  const nativeAlt = parseStellarAssetInput("native", networkId);
  assert(nativeAlt !== null && nativeAlt.type === "native", "'native' string must resolve as native.");

  const nativeStellarPrefix = parseStellarAssetInput("stellar:xlm", networkId);
  assert(nativeStellarPrefix !== null && nativeStellarPrefix.type === "native", "'stellar:xlm' must resolve as native.");

  // 2. Classic asset (CODE:ISSUER) resolution and deterministic SAC
  const fakeIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const classicInput = `USDC:${fakeIssuer}`;
  const classic = parseStellarAssetInput(classicInput, networkId);
  assert(classic !== null, "Classic CODE:ISSUER must resolve.");
  assert(classic!.type === "classic", "CODE:ISSUER must resolve as classic type.");
  assert((classic as { symbol: string }).symbol === "USDC", "Classic symbol must be USDC.");
  assert((classic as { issuer: string }).issuer === fakeIssuer, "Classic issuer must match.");
  assert((classic as { contractId: string }).contractId.startsWith("C"), "Classic must derive a deterministic SAC contract ID.");

  // Verify deterministic SAC derivation helper matches
  const sacIdFromHelper = deriveStellarSacContractId({ code: "USDC", issuer: fakeIssuer }, testnetPassphrase);
  assert(sacIdFromHelper === (classic as { contractId: string }).contractId, "deriveStellarSacContractId must match parseStellarAssetInput SAC.");

  // Native SAC derivation
  const nativeSacId = deriveStellarSacContractId("native", testnetPassphrase);
  assert(nativeSacId === (nativeXlm as { contractId: string }).contractId, "Native SAC derivation must match XLM identity contractId.");

  // 3. Symbol-only identity is NEVER accepted for classic assets
  const symbolOnly = parseStellarAssetInput("USDC", networkId);
  assert(symbolOnly === null, "Symbol-only identity must NEVER be accepted for classic assets.");

  const symbolOnlyLower = parseStellarAssetInput("usdc", networkId);
  assert(symbolOnlyLower === null, "Symbol-only identity (lowercase) must not resolve.");

  // 4. Contract (C...) address resolution
  const fakeContract = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
  const contractIdentity = parseStellarAssetInput(fakeContract, networkId);
  assert(contractIdentity !== null, "C-contract must resolve.");
  assert(contractIdentity!.type === "contract" || contractIdentity!.type === "deterministic_sac", "C-contract must resolve as contract or deterministic_sac.");
  assert((contractIdentity as { contractId: string }).contractId === fakeContract, "Contract identity must have matching contractId.");

  // If a C-address matches the native SAC, it should resolve as deterministic_sac
  const nativeSac = parseStellarAssetInput(nativeSacId, networkId);
  assert(nativeSac !== null, "Native SAC contract ID must resolve.");
  assert(nativeSac!.type === "deterministic_sac", "Native SAC contract ID must resolve as deterministic_sac.");
  assert((nativeSac as { underlyingType: string }).underlyingType === "native", "Native SAC must have underlyingType 'native'.");
  assert((nativeSac as { symbol: string }).symbol === "XLM", "Native SAC must have symbol XLM.");

  // 5. Issuer account (G...) resolution
  const issuerIdentity = parseStellarAssetInput(fakeIssuer, networkId);
  assert(issuerIdentity !== null, "G-account must resolve.");
  assert(issuerIdentity!.type === "issuer_account", "G-account must resolve as issuer_account.");
  assert((issuerIdentity as { issuer: string }).issuer === fakeIssuer, "Issuer must match.");

  // 6. Explorer URL parsing
  const expertUrl = `https://stellar.expert/explorer/testnet/asset/USDC-${fakeIssuer}`;
  const expertParsed = parseStellarAssetInput(expertUrl, networkId);
  assert(expertParsed !== null, "Stellar Expert asset URL must resolve.");
  assert(expertParsed!.type === "classic", "Stellar Expert asset URL must resolve as classic.");
  assert((expertParsed as { symbol: string }).symbol === "USDC", "Stellar Expert URL symbol must be USDC.");
  assert((expertParsed as { source?: string }).source === "explorer_url", "Explorer URL must have source 'explorer_url'.");

  const expertContractUrl = `https://stellar.expert/explorer/testnet/contract/${fakeContract}`;
  const expertContractParsed = parseStellarAssetInput(expertContractUrl, networkId);
  assert(expertContractParsed !== null, "Stellar Expert contract URL must resolve.");
  assert((expertContractParsed as { contractId: string }).contractId === fakeContract, "Stellar Expert contract URL contractId must match.");

  const expertAccountUrl = `https://stellar.expert/explorer/testnet/account/${fakeIssuer}`;
  const expertAccountParsed = parseStellarAssetInput(expertAccountUrl, networkId);
  assert(expertAccountParsed !== null, "Stellar Expert account URL must resolve.");
  assert(expertAccountParsed!.type === "issuer_account", "Stellar Expert account URL must resolve as issuer_account.");

  const lumenscanUrl = `https://lumenscan.io/assets/USDC-${fakeIssuer}`;
  const lumenscanParsed = parseStellarAssetInput(lumenscanUrl, networkId);
  assert(lumenscanParsed !== null, "Lumenscan asset URL must resolve.");
  assert(lumenscanParsed!.type === "classic", "Lumenscan URL must resolve as classic.");

  // DexScreener stellar URL with contract
  const dexUrl = `https://dexscreener.com/stellar/${fakeContract}`;
  const dexParsed = parseStellarAssetInput(dexUrl, networkId);
  assert(dexParsed !== null, "DexScreener Stellar URL must resolve.");
  assert((dexParsed as { contractId: string }).contractId === fakeContract, "DexScreener Stellar URL contract must match.");

  // 7. SSRF / private network metadata URL blocking
  assert(isPrivateOrLocalHost("localhost"), "isPrivateOrLocalHost must block localhost.");
  assert(isPrivateOrLocalHost("127.0.0.1"), "isPrivateOrLocalHost must block 127.0.0.1.");
  assert(isPrivateOrLocalHost("10.0.0.1"), "isPrivateOrLocalHost must block 10.x.x.x.");
  assert(isPrivateOrLocalHost("192.168.1.1"), "isPrivateOrLocalHost must block 192.168.x.x.");
  assert(isPrivateOrLocalHost("169.254.1.1"), "isPrivateOrLocalHost must block 169.254.x.x (link-local).");
  assert(isPrivateOrLocalHost("0.0.0.0"), "isPrivateOrLocalHost must block 0.0.0.0.");
  assert(isPrivateOrLocalHost("::1"), "isPrivateOrLocalHost must block ::1.");
  assert(!isPrivateOrLocalHost("example.com"), "isPrivateOrLocalHost must not block public hostnames.");

  const sep1Blocked = assertSep1FetchAllowed("http://localhost/.well-known/stellar.toml");
  assert(!sep1Blocked.allowed, "SEP-1 fetch must block localhost.");
  assert(sep1Blocked.issues.some((i: string) => i.includes("private or localhost")), "SEP-1 fetch block must mention private target.");
  assert(sep1Blocked.issues.some((i: string) => i.includes("HTTPS")), "SEP-1 fetch must require HTTPS.");

  const sep1PrivateIp = assertSep1FetchAllowed("https://10.0.0.1/.well-known/stellar.toml");
  assert(!sep1PrivateIp.allowed, "SEP-1 fetch must block private IP addresses.");

  const sep1ValidHttps = assertSep1FetchAllowed("https://example.com/.well-known/stellar.toml");
  assert(sep1ValidHttps.allowed, "SEP-1 fetch must allow valid HTTPS URLs.");

  const sep1OversizedContent = assertSep1FetchAllowed("https://example.com/.well-known/stellar.toml", "text/plain", 300_000);
  assert(!sep1OversizedContent.allowed, "SEP-1 fetch must block oversized responses.");

  // 8. SEP-1 TOML parsing and issuer conflict detection
  const sampleToml = [
    "[DOCUMENTATION]",
    'ORG_NAME = "Test Org"',
    'ORG_URL = "https://example.com"',
    'ORG_TWITTER = "test_org"',
    "",
    "[[CURRENCIES]]",
    'code = "USDC"',
    `issuer = "${fakeIssuer}"`,
    'name = "Test USDC"',
    "display_decimals = 7",
  ].join("\n");

  const parsed = parseSep1Toml(sampleToml);
  assert(parsed.documentation?.orgName === "Test Org", "SEP-1 TOML must parse ORG_NAME.");
  assert(parsed.documentation?.orgUrl === "https://example.com", "SEP-1 TOML must parse ORG_URL.");
  assert(parsed.documentation?.orgTwitter === "test_org", "SEP-1 TOML must parse ORG_TWITTER.");
  assert(parsed.currencies?.length === 1, "SEP-1 TOML must parse one currency.");
  assert(parsed.currencies?.[0]?.code === "USDC", "SEP-1 currency code must be USDC.");
  assert(parsed.currencies?.[0]?.issuer === fakeIssuer, "SEP-1 currency issuer must match.");
  assert(parsed.currencies?.[0]?.displayDecimals === 7, "SEP-1 currency display_decimals must be 7.");

  // Empty/comment-only TOML
  const emptyToml = parseSep1Toml("# just a comment\n");
  assert(emptyToml.documentation === undefined, "Empty TOML must have no documentation.");
  assert(emptyToml.currencies === undefined, "Empty TOML must have no currencies.");

  // 9. Invalid inputs return null
  assert(parseStellarAssetInput("", networkId) === null, "Empty string must not resolve.");
  assert(parseStellarAssetInput("not-a-valid-input", networkId) === null, "Random text must not resolve.");
  assert(parseStellarAssetInput("0x3333333333333333333333333333333333333333", networkId) === null, "EVM address must not resolve as Stellar.");

  console.log("  Stellar asset identity checks passed.");
}

async function main() {
  await runDiscoveryFixtures();
  await runOnchainChecks();
  await runStellarOnchainChecks();
  await runNewsChecks();
  await runSocialChecks();
  await runDecisionChecks();
  await runExecutionChecks();
  await runTransactionLifecycleChecks();
  await runReadinessChecks();
  await runProviderReliabilityChecks();
  runCachePolicyChecks();
  await runX402Checks();
  runStellarAssetIdentityChecks();

  const discoveryFixtureResults = await runDiscoveryFixtures();
  for (const fixture of discoveryFixtureResults) {
    if (!fixture.passed) {
      console.error(`Discovery fixture failed: ${fixture.fixture} -> ${fixture.detail}`);
      process.exit(1);
    }
    console.log(`Discovery fixture passed: ${fixture.fixture} (${fixture.classification})`);
  }

  console.log("Agent fixture checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
