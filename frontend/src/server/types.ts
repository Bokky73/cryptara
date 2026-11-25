export type RiskLevel = "low" | "medium" | "high" | "critical";

export type AgentStatus =
  | "idle"
  | "running"
  | "complete"
  | "partial"
  | "warning"
  | "error"
  | "unavailable"
  | "blocked"
  | "manual_review_required";

export type AgentSource = {
  label: string;
  url?: string;
  status: "mock" | "connected" | "unavailable";
  detail?: string;
  checkedAt?: string;
  latencyMs?: number;
  error?: string;
  errorCode?: string;
  provider?: string;
  fallbackRank?: number;
  cache?: {
    policy: string;
    ttlSeconds: number;
    hit?: boolean;
    freshnessSeconds?: number;
  };
  reliability?: number;
};

export type SourceDataQuality = {
  mode: "live" | "partial" | "unavailable" | "stale" | "conflicting";
  connectedSources: number;
  unavailableSources: number;
  mockSources: number;
  sourceCount: number;
  reliability: number;
  lastCheckedAt?: string;
  freshnessSeconds?: number;
  averageLatencyMs?: number;
  conflictCount?: number;
  providerErrors?: Array<{
    label: string;
    code?: string;
    detail?: string;
  }>;
  cache?: {
    policy: string;
    hitCount: number;
    missCount: number;
    staleCount: number;
  };
  detail: string;
};

export type AgentFinding = {
  label: string;
  severity: RiskLevel;
  detail: string;
  scoreImpact?: number;
  weight?: number;
  sourceLabel?: string;
  raw?: string;
  interpretation?: string;
  confidence?: number;
};

export type AgentRecommendedAction =
  | "hold"
  | "watch"
  | "reduce_exposure"
  | "swap_to_stable"
  | "avoid"
  | "manual_review"
  | "prepare_transaction"
  | "create_trustline"
  | "no_action";

export type AgentResult = {
  agent: "portfolio" | "news" | "social" | "onchain" | "decision" | "execution";
  status: AgentStatus;
  riskScore: number;
  score: number;
  riskLevel: RiskLevel;
  verdict: string;
  summary: string;
  findings: AgentFinding[];
  sources: AgentSource[];
  dataQuality: SourceDataQuality;
  confidence: number;
  recommendedAction: AgentRecommendedAction;
  blockingReasons: string[];
  blockingReasonDetails?: AgentBlockingReason[];
  missingData: AgentMissingData[];
  rawSignals?: Record<string, unknown>;
  createdAt: string;
};

export type AgentMissingData = {
  field: string;
  reason: string;
  impact: "low" | "medium" | "high";
  requiredFor?: string;
  canRetry?: boolean;
  fallbackUsed?: boolean;
};

export type AgentBlockingReason = {
  category: "critical" | "policy" | "identity" | "provider_coverage" | "simulation";
  severity: RiskLevel;
  detail: string;
  sourceLabel?: string;
};

export type AgentInputIdentity = {
  walletAddress?: string;
  chain?: string;
  contractAddress?: string;
  symbol?: string;
  tokenName?: string;
  issuer?: string;
  assetKey?: string;
  assetType?: "native" | "classic" | "contract" | "issuer_account" | "sac" | "sep41";
  websiteUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
  discordUrl?: string;
  coingeckoId?: string;
  coinmarketcapId?: string;
  pairAddress?: string;
  dexScreenerPairUrl?: string;
};

export type DiscoveryAgentInputIdentity = AgentInputIdentity;

export type DiscoveryAgentContext = {
  candidateId: string;
  chain: string;
  source: DiscoverySourceKind;
  discoveryMode: "candidate" | "watchlist_rescan";
  identityKey: string;
  identityConfidence: number;
  identityConfidenceLabel: ResolvedTokenIdentity["confidenceLabel"];
  metrics: DiscoveryCandidate["metrics"];
  scanOriginLabel: string;
  tokenSymbol?: string;
  tokenName?: string;
};

export type DiscoveryScanInputIdentity = AgentInputIdentity & {
  discovery?: DiscoveryAgentContext;
};

export type DiscoveryWithAlerts = {
  alerts: DiscoveryAlert[];
};

export type ResolvedTokenIdentity = AgentInputIdentity & {
  identityKey: string;
  confidence: number;
  confidenceLabel: "low" | "medium" | "high";
  matchReasons: string[];
  warnings: string[];
  chainFamily?: string;
  identityGraph?: unknown;
  symbolCollision?: unknown;
  officialLinkVerification?: unknown;
};

export type TokenSignal = {
  scamRisk: number;
  websiteTrustRisk: number;
  contractRisk: number;
  whaleSellRisk: number;
  liquidityRisk: number;
  xSentimentRisk: number;
  holderConcentrationRisk: number;
  priceVolatilityRisk: number;
  portfolioExposureRisk: number;
};

export type TokenHolding = {
  tokenAddress: string;
  symbol: "GOAT" | "USDC" | "MEME" | string;
  name: string;
  assetKind?: "native" | "classic" | "sac" | "sep41";
  issuer?: string;
  contractId?: string;
  chainId?: string;
  chainName?: string;
  chainLogoUrl?: string;
  logoUrl?: string;
  isVerified?: boolean;
  balance: number;
  priceUsd: number | null;
  priceStatus?: "priced" | "unavailable";
  priceSource?: string;
  valueUsd: number;
  dayChangeUsd?: number;
  dayChangePercent?: number;
  allocationPercent: number;
  riskScore: number;
  riskLevel: RiskLevel;
  signals: TokenSignal;
  stellarRisk?: {
    authorized: boolean;
    authorizationRequired: boolean;
    revocable: boolean;
    clawbackEnabled: boolean;
    liquidity: "known" | "unknown";
    dataStatus: "complete" | "partial";
  };
};

export type StellarPortfolioActivity = {
  id: string;
  type: "payment" | "contract_call" | "trustline_change" | "swap";
  createdAt: string;
  transactionHash: string;
  asset?: string;
  amount?: string;
};

export type PortfolioSnapshot = {
  walletAddress: string;
  nativeBalance: number;
  nativeSymbol: string;
  dayChangePercent: number;
  dayChangeUsd?: number;
  totalValueUsd: number;
  riskScore: number;
  createdAt: string;
  holdings: TokenHolding[];
  valuationStatus?: "complete" | "partial" | "unavailable";
  unpricedAssetCount?: number;
  accountSubentryCount?: number;
  minimumReserveXlm?: number;
  nativeSellingLiabilities?: number;
  spendableNativeBalance?: number;
  reserveReady?: boolean;
  recentActivity?: StellarPortfolioActivity[];
  dataWarnings?: string[];
  providerMeta?: {
    provider: string;
    network: string;
    latencyMs: number;
    requestId?: string;
    reliability?: number;
    fallbackUsed?: boolean;
  };
};

export type AgentStep = {
  key: "observe" | "analyze" | "decide" | "plan" | "act";
  label: string;
  status: "complete" | "pending";
  detail: string;
};

export type SuggestedAction = {
  type: "swap_to_stablecoin" | "hold" | "reduce_exposure";
  fromToken: string;
  toToken: string;
  percent: number;
};

export type AgentDecision = {
  walletAddress: string;
  summary: string;
  riskScore: number;
  decision: string;
  reasoning: string[];
  suggestedAction: SuggestedAction;
  confidence: number;
  status: "pending" | "approved" | "rejected" | "executed";
  txHash?: string;
  createdAt: string;
};

export type StellarTransactionMeta = {
  sequence?: string;
  feeCharged?: number; // stroop fee actually paid
  feeBid?: number; // stroop fee bid
  operationCount?: number;
  ledger?: number;
  timeBounds?: {
    minTime?: number;
    maxTime?: number;
  };
  ledgerBounds?: {
    minLedger?: number;
    maxLedger?: number;
  };
  envelopeXdr?: string;
  resultXdr?: string;
  memo?: string;
  memoType?: "text" | "id" | "hash" | "return";
  signers?: string[];
  sourceAccount?: string;
};

export type StellarTrustlinePreview = {
  assetCode: string;
  issuer: string;
  contractId?: string;
  isNative: boolean;
  reserveRequiredXlm: number;
  currentXlmBalance: number;
  sufficientReserve: boolean;
  issuerFlags?: {
    authRequired?: boolean;
    authRevocable?: boolean;
    authClawbackEnabled?: boolean;
    authImmutable?: boolean;
  };
  existingTrustline: boolean;
  blockedReason?: "clawback_enabled" | "revocable_auth" | "insufficient_reserve" | "wrong_issuer" | "network_mismatch" | "issuer_unknown";
  /** Transaction metadata for preview, populated after simulation */
  transactionMeta?: StellarTransactionMeta;
};

export type StellarSwapQuote = {
  provider: "soroswap" | "stellar_aggregator";
  routeType: "classic_path_payment" | "soroban_swap" | "mixed";
  /** Human-readable route with asset code and issuer for classic assets (e.g. "USDC:GBB...") */
  route: string[];
  /** Exact input amount in atomic units from the quote */
  exactInputAmount: number;
  /** Exact output amount from the quote */
  exactOutputAmount: number;
  expectedOutputAmount: number;
  estimatedValueUsd: number;
  priceImpactBps: number;
  slippageBps: number;
  minReceiveAmount: number;
  /** Total estimated fees in XLM (stroops converted) */
  feesXlm: number;
  network: string;
  pathPaymentOps?: Array<{
    type: "path_payment_strict_send" | "path_payment_strict_receive";
    sendAsset: string;
    sendAmount: string;
    destAsset: string;
    destAmount: string;
    path: string[];
  }>;
  sorobanSimulation?: {
    contractId: string;
    method: string;
    args: string[];
    sourceAccount: string;
    footprint: string[];
    fee?: number;
  };
  status: "fresh" | "stale" | "simulated" | "unavailable";
  fetchedAt: string;
  expiresAt: string;
  detail: string;
};

export type TransactionPreview = {
  title: string;
  action?: "swap" | "reduce_exposure" | "watchlist" | "trustline" | "no_action";
  fromToken?: string;
  toToken?: string;
  percent?: number;
  estimatedValueUsd: number;
  currentRiskScore: number;
  projectedRiskScore: number;
  requiresApproval: boolean;
  network: string;
  /** Recipient/contract shown to the user before a wallet signature is requested. */
  targetContract?: string;
  contractVerified?: boolean;
  explorerUrl?: string;
  stroops?: string;
  slippageBps?: number;
  priceImpactBps?: number;
  gasEstimateUsd?: number;
  approvalSteps?: string[];
  executionReady?: boolean;
  lifecycle?: {
    status: "prepared" | "user_rejected" | "submitted" | "confirmed" | "failed" | "replaced" | "expired" | "pending";
    expiresAt?: string;
    idempotencyKey?: string;
  };
  stellarTrustline?: StellarTrustlinePreview;
  stellarQuote?: StellarSwapQuote;
  approvalRisk?: {
    infiniteApprovalWarning: boolean;
    existingAllowanceCheck: "required" | "not_required";
    revokeSuggestion?: string;
    permitSupport: "unsupported" | "planned";
    permit2Support: "unsupported" | "planned";
    /** V3 hint surfaced by recovery state when active recovery requests target the preview asset. */
    revivePlan?: string;
    /** V3 explicit surface for consequences (allowance reduce, trustline removal, incidents). */
    consequences?: string[];
  };
  blockedReason?: string;
  policy?: {
    maxTradePercent: number;
    maxRiskScore: number;
    maxMemeExposurePercent: number;
    maxDailyTransactionValueUsd?: number;
    maxSlippageBps?: number;
    allowedChains?: string[];
    blockedTokens?: string[];
    allowedActions?: AgentRecommendedAction[];
    autoExecute: false;
  };    policyStatus?: {
    allowed: boolean;
    violations: string[];
    decisions?: StrategyPolicyDecision[];
    ruleVersion?: number;
    ruleWalletAddress?: string;
  };
  quote?: {
    provider: "soroswap" | "stellar_aggregator" | "none";
    route: string[];
    /** Exact input token and amount from the quote */
    exactInput: { token: string; amount: number };
    /** Exact output token and amount from the quote */
    exactOutput: { token: string; amount: number };
    expectedOutputToken: string;
    expectedOutputAmount?: number;
    /** Minimum amount received after slippage (in output token units) */
    minReceiveAmount: number;
    estimatedValueUsd: number;
    priceImpactBps: number;
    slippageBps: number;
    /** Total fees (gas + protocol fees) in USD */
    feesUsd: number;
    gasEstimateUsd: number;
    network: string;
    /** ISO timestamp when the quote expires — approval must be disabled after this time */
    expiresAt: string;
    /** ISO timestamp when the quote was fetched */
    fetchedAt: string;
    /** When true, the quote's assets or network do not match the action request */
    quoteMismatch: boolean;
    status: "fresh" | "stale" | "unavailable" | "simulated";
    detail: string;
  };
simulation?: SimulationResultDetail;
  audit?: {
    approvalRequired: boolean;
    serverCanSign: false;
    userRuleWallet?: string;
    userApproved?: boolean;
    decisionId?: string;
  };
};

export type StrategyPolicyRuleCategory =
  | "risk_threshold"
  | "trade_size"
  | "daily_limit"
  | "liquidity"
  | "exposure"
  | "stable_reserve"
  | "allowed_chain"
  | "blocked_token"
  | "blocked_category"
  | "slippage"
  | "allowed_action"
  | "stellar_issuer"
  | "stellar_trustline"
  | "auto_execute";

/**
 * Structured policy decision returned by the shared strategy enforcer.
 * Each decision records the specific rule, observed value, threshold,
 * and a human-readable reason so the UI and audit log can show which
 * user rule changed or blocked the recommendation.
 */
export type StrategyPolicyDecision = {
  ruleId: string;
  ruleVersion: number;
  ruleLabel: string;
  ruleCategory: StrategyPolicyRuleCategory;
  /** The value observed from the agent input / portfolio context */
  observedValue: number | string;
  /** The threshold defined in the user rule */
  threshold: number | string;
  violated: boolean;
  reason: string;
  action: "blocked" | "warned" | "passed";
};

/**
 * Full strategy enforcement result combining legacy violations
 * with structured policy decisions for audit and UI.
 */
export type StrategyPolicyResult = {
  allowed: boolean;
  violations: StrategyPolicyDecision[];
  passed: StrategyPolicyDecision[];
  warnings: StrategyPolicyDecision[];
  ruleVersion: number;
  ruleWalletAddress: string;
  /** Legacy string[] for backward-compatible API responses */
  violationMessages: string[];
};

export type UserRule = {
  walletAddress: string;
  maxRiskScore: number;
  maxTradePercent: number;
  maxMemeExposurePercent: number;
  maxDailyTransactionValueUsd?: number;
  maxSlippageBps?: number;
  minStableReservePercent?: number;
  allowedChains?: string[];
  blockedTokens?: string[];
  blockedIssuers?: string[];
  blockedCategories?: string[];
  allowedActions?: AgentRecommendedAction[];
  autoExecute: boolean;
  version?: number;
  createdAt: string;
};

export type RiskBreakdownItem = {
  key:
    | "scam"
    | "website"
    | "contract"
    | "liquidity"
    | "whales"
    | "xSentiment"
    | "holders"
    | "volatility"
    | "portfolioExposure";
  label: string;
  score: number;
  severity: RiskLevel;
  finding: string;
};

export type ScanSource = {
  label: string;
  status: "mock" | "connected" | "unavailable";
  detail: string;
};

export type RiskReportVerdict = "buy_small" | "watch" | "avoid" | "hold" | "reduce_exposure" | "manual_review";

export type ScoreFactorCategory =
  | "sellability"
  | "owner_controls"
  | "taxes"
  | "liquidity"
  | "holder_concentration"
  | "lp_lock"
  | "market_anomaly"
  | "creator_behavior"
  | "social_identity"
  | "social_engagement"
  | "phishing"
  | "news_catalyst"
  | "news_risk"
  | "portfolio_exposure"
  | "source_coverage"
  | "decision_logic";

export type ScoreFactor = {
  label: string;
  category: ScoreFactorCategory;
  impact: number;
  weight?: number;
  severity: RiskLevel;
  detail: string;
  sourceLabel?: string;
  direction: "risk_increase" | "risk_decrease" | "neutral";
  raw?: unknown;
  meta?: Record<string, string | number | boolean | null | undefined>;
};

export type AgentScoreCard = {
  agent: AgentResult["agent"];
  displayName: string;
  score: number;
  scoreKind: "risk" | "trust" | "signal" | "exposure" | "decision";
  confidence: number;
  status: AgentStatus;
  summary: string;
  factors: ScoreFactor[];
  criticalFactors?: ScoreFactor[];
  secondaryScores?: Array<{
    label: string;
    score: number;
    detail: string;
  }>;
  sources: AgentSource[];
  missingData: AgentMissingData[];
};

export type RiskReportInput = {
  query: string;
  chain: string;
  contractAddress?: string;
  pairAddress?: string;
  pairUrl?: string;
  symbol?: string;
  tokenName?: string;
  assetKey?: string;
  assetType?: "native" | "classic" | "contract" | "issuer_account" | "sac" | "sep41";
  issuer?: string;
  source: "contract_address" | "dexscreener_pair_url" | "dexscreener_token_url" | "stellar_asset" | "stellar_issuer" | "unresolved";
};

export type DiscoverySourceKind = "dexscreener" | "stellar_market" | "manual";

export type DiscoveryCandidate = {
  id: string;
  chain: string;
  contractAddress?: string;
  pairAddress?: string;
  pairUrl?: string;
  symbol?: string;
  tokenName?: string;
  assetKey?: string;
  issuer?: string;
  assetType?: "native" | "classic" | "contract" | "issuer_account" | "sac" | "sep41";
  source: DiscoverySourceKind;
  sourceUrl?: string;
  discoveredAt: string;
  metrics: {
    liquidityUsd?: number;
    volume24hUsd?: number;
    fdvUsd?: number;
    fdvLiquidityRatio?: number;
    priceChange24hPercent?: number;
    pairAgeDays?: number;
    nativePair?: boolean;
  };
  raw: Record<string, unknown>;
};

export type DiscoveryClassification = "watch" | "risky" | "scam" | "early_opportunity";

export type DiscoveryScanResult = {
  candidate: DiscoveryCandidate;
  identity: ResolvedTokenIdentity;
  results: AgentResult[];
  decision: AgentResult;
  classification: DiscoveryClassification;
  classificationReasons: string[];
  confidence: number;
  sourceLineage: AgentSource[];
  missingData: AgentMissingData[];
  scannedAt: string;
};

export type WatchlistEntryInput = {
  walletAddress: string;
  chain: string;
  network?: string;
  contractAddress?: string;
  pairAddress?: string;
  symbol?: string;
  tokenName?: string;
  assetKey?: string;
  issuer?: string;
  assetType?: "native" | "classic" | "contract" | "issuer_account" | "sac" | "sep41";
  source: DiscoveryCandidate["source"] | "manual_watchlist";
  note?: string;
};

export type WatchlistEntry = {
  id: string;
  walletAddress: string;
  identityKey: string;
  chain: string;
  network?: string;
  contractAddress?: string;
  pairAddress?: string;
  symbol?: string;
  tokenName?: string;
  assetKey?: string;
  issuer?: string;
  assetType?: "native" | "classic" | "contract" | "issuer_account" | "sac" | "sep41";
  source: WatchlistEntryInput["source"];
  note?: string;
  createdAt: string;
  lastScannedAt?: string;
  latestScanRunId?: string;
  latestClassification?: DiscoveryClassification;
  latestScore?: number;
  latestStatus?: WatchlistScanRun["status"];
  successfulScanRunIds?: string[];
};

export type WatchlistScanRun = {
  id: string;
  entryId: string;
  walletAddress: string;
  identityKey: string;
  classification: DiscoveryClassification;
  classificationReasons: string[];
  confidence: number;
  score: number;
  riskReport?: RiskReport;
  agentRunId?: string;
  previousRunId?: string;
  sourceLineage: AgentSource[];
  missingData: AgentMissingData[];
  scannedAt: string;
  status: "completed" | "partial" | "failed" | "stale";
};

export type DiscoveryAlertKind =
  | "critical_risk"
  | "liquidity_drop"
  | "holder_concentration"
  | "social_phishing"
  | "news_incident"
  | "classification_change";

export type DiscoveryAlert = {
  id: string;
  walletAddress: string;
  entryId?: string;
  runId?: string;
  kind: DiscoveryAlertKind;
  title: string;
  detail: string;
  severity: RiskLevel;
  sourceLabel?: string;
  acknowledged: boolean;
  createdAt: string;
};

export type RiskReport = {
  id: string;
  chain: string;
  contractAddress?: string;
  symbol: string;
  tokenName?: string;
  buyRisk: number;
  confidence: number;
  verdict: RiskReportVerdict;
  summary: string;
  topReasons: string[];
  input: RiskReportInput;
  agentCards: AgentScoreCard[];
  sources: AgentSource[];
  missingData: AgentMissingData[];
  executionPreview?: TransactionPreview;
  createdAt: string;
};

export type TokenScanResult = {
  symbol: string;
  tokenAddress: string;
  chain: string;
  normalizedInput?: RiskReportInput;
  market?: {
    pairAddress?: string;
    dexId?: string;
    pairUrl?: string;
    priceUsd?: number;
    liquidityUsd?: number;
    volume24hUsd?: number;
    fdvUsd?: number;
    marketCapUsd?: number;
    priceChange24hPercent?: number;
    pairAgeDays?: number;
  };
  overallRiskScore: number;
  opportunityScore: number;
  verdict: "safe" | "watch" | "high_risk" | "critical";
  summary: string;
  reasons: string[];
  suggestedAction: SuggestedAction;
  riskBreakdown: RiskBreakdownItem[];
  analysisChecks?: Array<{
    key: string;
    label: string;
    status: "pass" | "warning" | "danger" | "unavailable";
    score: number | null;
    value?: string;
    reason: string;
  }>;
  riskReport?: RiskReport;
  sources: ScanSource[];
  dataQuality?: SourceDataQuality;
  scannedAt: string;
};

export type RiskSnapshotCreateResponse = {
  id: string;
  hash: string;
  schemaVersion: string;
  createdAt: string;
  expiresAt: string;
  revocationToken: string;
  shareUrl: string;
  downloadUrl: string;
};

export type TransactionLifecycleStatus =
  | "prepared"
  | "user_rejected"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed"
  | "replaced"
  | "reorged"
  | "dropped"
  | "manual_review"
  | "expired"
  | "pending";

export type TransactionLifecycleEventName =
  | "prepared"
  | "submitted"
  | "submission_failed"
  | "user_rejected"
  | "polled"
  | "observation_recorded"
  | "confirmation_progress"
  | "provider_disagreement"
  | "reorg_detected"
  | "replacement_detected"
  | "dropped_detected"
  | "manual_review_required"
  | "confirmed"
  | "failed"
  | "replaced"
  | "expired"
  | "duplicate_rejected";

export type TransactionLifecycleEvent = {
  id: string;
  hash: string;
  event: TransactionLifecycleEventName;
  detail?: Record<string, unknown>;
  occurredAt: string;
  provider?: string;
  providerUrl?: string;
};

export type TransactionObservationStatus =
  | "not_found"
  | "pending"
  | "included"
  | "confirmed"
  | "failed"
  | "replaced"
  | "expired"
  | "duplicate"
  | "provider_disagreement";

export type TransactionObservation = {
  id: string;
  hash: string;
  evidenceKey: string;
  chainFamily: ChainFamily;
  network: string;
  provider: string;
  providerUrl?: string;
  status: TransactionObservationStatus;
  blockNumber?: number;
  blockHash?: string;
  ledgerSequence?: number;
  confirmations: number;
  requiredConfirmations: number;
  replacementHash?: string;
  nonce?: number;
  detail?: string;
  observedAt: string;
};

export type ChainFamily = "evm" | "stellar";

export type TransactionExpectedEffect = {
  kind: "transfer" | "swap" | "approval" | "contract_call" | "publish_risk";
  fromToken?: string;
  toToken?: string;
  fromAddress?: string;
  toAddress?: string;
  amount?: string;
  amountBaseUnits?: string;
  contractAddress?: string;
  method?: string;
  assetKey?: string;
  decimals?: number;
};

export type TransactionRecord = {
  hash: string;
  type: "swap" | "approval" | "agent_log" | "transfer" | "trustline_create" | "trustline_change";
  decisionAction?: AgentRecommendedAction;
  asset: string;
  valueUsd: number;
  status: TransactionLifecycleStatus;
  lifecycleStatus: TransactionLifecycleStatus;
  chainFamily: ChainFamily;
  createdAt: string;
  submittedAt?: string;
  terminalAt?: string;
  lastPolledAt?: string;
  pollAttempts?: number;
  network: string;
  walletAddress?: string;
  sourceAccount?: string;
  userApproved?: boolean;
  decisionId?: string;
  simulationStatus?: SimulationResultDetail["status"];
  policyStatus?: TransactionPreview["policyStatus"];
  expectedEffects?: TransactionExpectedEffect[];
  idempotencyKey?: string;
  /** Pre-built EVM calldata (0x-prefixed hex) carried from prepare to approve */
  calldata?: string;
  explorerUrl?: string;
  failureReason?: string;
  confirmationCount?: number;
  requiredConfirmations?: number;
  finalityReached?: boolean;
  replacementHash?: string;
  lastObservedBlockHash?: string;
  missingObservationCount?: number;
  manualReviewReason?: string;
  observationCount?: number;
  stellarDetails?: {
    sequence?: string;
    feeCharged?: number;
    operationCount?: number;
    ledger?: number;
    envelopeXdr?: string;
    resultXdr?: string;
    trustlineAsset?: string;
  };
};

export type SubmitTransactionInput = {
  chainFamily: ChainFamily;
  network: string;
  walletAddress: string;
  sourceAccount?: string;
  decisionId?: string;
  decisionAction?: AgentRecommendedAction;
  asset: string;
  valueUsd?: number;
  simulationStatus?: NonNullable<TransactionPreview["simulation"]>["status"];
  policyStatus?: TransactionPreview["policyStatus"];
  expectedEffects?: TransactionExpectedEffect[];
  userApproved: true;
  signedPayload: string;
  idempotencyKey?: string;
};

export type SubmitTransactionResult = {
  hash: string;
  chainFamily: ChainFamily;
  network: string;
  submittedAt: string;
  status: TransactionLifecycleStatus;
  explorerUrl?: string;
  idempotent: boolean;
  reuseReason?: "idempotency_key" | "duplicate_hash";
  lifecycle: TransactionLifecycleEvent[];
};

export type PollTransactionResult = {
  transaction: TransactionRecord;
  polled: boolean;
  terminalReached: boolean;
  events: TransactionLifecycleEvent[];
  observations: TransactionObservation[];
};

export type AgentRunRecord = {
  id: string;
  walletAddress: string;
  mode?: "portfolio_review" | "token_scan" | "pre_buy_check" | "holding_review" | "execution_prepare" | "discovery_candidate";
  inputSnapshot?: Record<string, unknown>;
  targetToken?: {
    symbol?: string;
    name?: string;
    tokenAddress?: string;
    chain?: string;
    riskScore?: number;
    allocationPercent?: number;
  };
  status: "completed" | "partial" | "failed";
  recommendation: AgentRecommendedAction;
  decisionScore: number;
  confidence: number;
  summary: string;
  results: AgentResult[];
  sourceStatuses?: Array<{
    agent: AgentResult["agent"];
    connected: number;
    unavailable: number;
    mock: number;
  }>;
  userAction?: "pending" | "approved" | "rejected" | "adjusted" | "executed";
  createdAt: string;
};

export type StorageProvider = "memory" | "supabase_postgres";

export type StorageHealth = {
  provider: StorageProvider;
  persistent: boolean;
  detail: string;
  schema?: {
    tables: string[];
    adapterApi: string[];
    migration: string;
  };
};

export type X402ChainFamily = "evm" | "stellar";

export type X402PayerIdentity = {
  chainFamily: X402ChainFamily;
  payer?: string;
  transactionHash?: string;
};

export type X402PaymentReceipt = {
  id: string;
  requestId: string;
  paymentHeaderHash: string;
  walletAddress?: string;
  payer?: string;
  transactionHash?: string;
  chainFamily: X402ChainFamily;
  payerIdentity?: X402PayerIdentity;
  network: string;
  asset: string;
  amount: string;
  priceUsd: string;
  payTo: string;
  facilitatorUrl: string;
  protectedResource: string;
  requestBodyHash: string;
  paymentExpiry?: string;
  verificationStatus: "payment_required" | "verified" | "settled" | "failed" | "duplicate" | "expired";
  createdAt: string;
  updatedAt: string;
};

export type RecommendationRecord = {
  id: string;
  runId?: string;
  walletAddress: string;
  action: AgentRecommendedAction;
  decisionScore: number;
  confidence: number;
  summary: string;
  createdAt: string;
};

export type BalanceChange = {
  token: string;
  symbol: string;
  currentBalance: string;
  expectedChange: string;
  direction: "inflow" | "outflow";
};

export type AllowanceRiskDetail = {
  spender: string;
  spenderShort: string;
  token: string;
  currentAllowance: string;
  newAllowance: string;
  isInfinite: boolean;
};

export type StellarTrustlineRisk = {
  asset: string;
  assetShort: string;
  issuer: string;
  issuerShort: string;
  action: "add" | "remove" | "update" | "authorize" | "deauthorize";
  detail: string;
};

export type SimulationFreshnessConfig = {
  maxBlockAge: number;
  maxLedgerAge: number;
  maxElapsedMs: number;
};

export type SimulationFreshnessResult = {
  fresh: boolean;
  reason?: string;
  expiredAt?: string;
};

export type SimulationResultDetail = {
  provider: "not_required" | "soroban_rpc" | "eth_call" | "tenderly" | "alchemy" | "unsupported";
  status: "not_required" | "pending" | "passed" | "failed" | "unavailable" | "unsupported";
  checks: string[];
  revertReason?: string;
  revertReasonHuman?: string;
  detail: string;
  simulatedTxHash: string;
  simulatedAt?: string;
  blockNumber?: number;
  ledgerSeq?: number;
  quoteExpiry?: string;
  calldataHash?: string;
  fromAmount?: string;
  route?: string[];
  slippageBps?: number;
  sequenceNumber?: number | string;
  fee?: string;
  simulatedXdrHash?: string;
  transactionHashHex?: string;
  quoteHashHex?: string;
  binding?: {
    transactionHash: string;
    quoteHash: string;
  };
  restoreRequired?: boolean;
  diagnostics?: string[];
  resourceUsage?: {
    gasUnits?: string;
    gasPrice?: string;
    networkFee?: string;
    operationsCount?: number;
    ledgerFee?: string;
  };
  footprint?: {
    readOnly: string[];
    readWrite: string[];
  };
  authorizationRisk?: {
    entries: number;
    detected: boolean;
  };
  balanceChanges?: BalanceChange[];
  allowanceRisk?: AllowanceRiskDetail[];
  trustlineRisk?: StellarTrustlineRisk[];
  providerMeta?: {
    provider: string;
    network: string;
    checkedAt: string;
    latencyMs?: number;
  };
  chainFamily?: "evm" | "stellar";
};

export type UserApprovalRecord = {
  id: string;
  walletAddress: string;
  decisionId?: string;
  txHash: string;
  network?: string;
  action?: AgentRecommendedAction;
  asset?: string;
  valueUsd?: number;
  status: "confirmed" | "pending";
  autoExecuted: false;
  createdAt: string;
};

export type StorageCounts = {
  agentRuns: number;
  recommendations: number;
  transactions: number;
  approvals: number;
  userRules: number;
  x402PaymentReceipts: number;
  alertRules: number;
  alertObservations: number;
  alerts: number;
  alertDeliveries: number;
  notificationPreferences: number;
};

export type AlertTriggerType =
  | "critical_risk"
  | "liquidity_drop"
  | "holder_concentration_change"
  | "tax_control_change"
  | "phishing_detected"
  | "exploit_news"
  | "portfolio_concentration"
  | "stable_reserve_change"
  | "stellar_issuer_auth"
  | "stellar_clawback"
  | "stellar_trustline"
  | "stellar_contract_ttl"
  | "rpc_degradation";

export type AlertDeliveryChannel = "in_app" | "email" | "telegram" | "discord";

export type AlertDeliveryStatus = "pending" | "delivered" | "failed" | "skipped";

export type AlertStatus = "triggered" | "recovered" | "acknowledged";

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export type AlertObservationDirection = "high_is_bad" | "low_is_bad";

/**
 * A user-defined alert rule scoped to a wallet. Threshold semantics depend
 * on `direction` on the trigger type. Cooldown prevents re-triggering
 * immediately after recovery; hysteresis prevents flapping near the threshold.
 */
export type AlertRule = {
  id: string;
  walletAddress: string;
  triggerType: AlertTriggerType;
  observationKey?: string;
  threshold: number;
  hysteresis: number;
  cooldownMinutes: number;
  direction?: AlertObservationDirection;
  severity: AlertSeverity;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Immutable observation extracted from an AgentRunRecord. The evidence only
 * includes the minimum data the alert needs (no wallet secrets, no PII).
 */
export type AlertObservation = {
  id: string;
  walletAddress: string;
  triggerType: AlertTriggerType;
  observationKey: string;
  value: number;
  direction: AlertObservationDirection;
  evidence: {
    runId: string;
    agent: AgentResult["agent"];
    label: string;
    detail: string;
    sourceLabels: string[];
    sourceSnapshotHash?: string;
    beforeValue?: number;
    afterValue?: number;
    meta?: Record<string, string | number | boolean | null | undefined>;
  };
  createdAt: string;
  /**
   * True when the observation was extracted from an AgentResult that had at
   * least one unavailable source. Incomplete observations are intentionally
   * excluded from risk-change alerts at extraction time so a degraded
   * provider cannot generate phantom alerts.
   */
  incompleteData?: boolean;
};

export type Alert = {
  id: string;
  walletAddress: string;
  ruleId: string;
  triggerType: AlertTriggerType;
  observationKey: string;
  status: AlertStatus;
  severity: AlertSeverity;
  message: string;
  beforeValue: number;
  afterValue: number;
  /**
   * Immutable evidence captured at trigger time. NEVER overwritten once the
   * alert is created — subsequent deterioration events extend the chain in
   * `deteriorationObservationIds` and refresh only the latest-at-time field
   * (`evidenceAfter`) with a snapshot from the new observation.
   */
  evidenceBefore: AlertObservation["evidence"];
  evidenceAfter: AlertObservation["evidence"];
  evidenceData: {
    runId: string;
    observationId: string;
    sourceSnapshotHashAfter: string;
    sourceSnapshotHashBefore?: string;
    evidenceBeforeObservationId?: string;
    evidenceAfterObservationId: string;
    evidenceBeforeHash?: string;
    evidenceAfterHash: string;
    deteriorationObservationIds: string[];
  };
  triggeredAt: string;
  recoveredAt?: string;
  acknowledgedAt?: string;
  deliverySummary?: {
    delivered: AlertDeliveryChannel[];
    failed: Array<{ channel: AlertDeliveryChannel; error: string }>;
    skipped: Array<{ channel: AlertDeliveryChannel; reason: string }>;
  };
};

export type AlertDelivery = {
  id: string;
  alertId: string;
  walletAddress: string;
  channel: AlertDeliveryChannel;
  status: AlertDeliveryStatus;
  errorDetail?: string;
  sanitizedPayload: {
    triggerType: AlertTriggerType;
    severity: AlertSeverity;
    summary: string;
    beforeValue: number;
    afterValue: number;
    observationKey: string;
    evidenceLinks: string[];
    walletHint?: string;
    sourceLabels?: string[];
  };
  attemptCount: number;
  createdAt: string;
  sentAt?: string;
  idempotencyKey?: string;
  providerMessageId?: string;
  nextRetryAt?: string;
  lastAttemptAt?: string;
  terminal?: boolean;
};

// ──────────────────────────────────────────────
// Notification preferences & delivery routing (issue #152)
// ──────────────────────────────────────────────

/**
 * Coarse grouping for alert triggers. Preferences can opt out of an entire
 * category (e.g. "every network + all notification channels") without
 * listing individual triggers.
 */
export type AlertCategory =
  | "critical_risk"
  | "liquidity"
  | "ownership"
  | "security"
  | "market"
  | "portfolio"
  | "stellar"
  | "infrastructure";

export type DigestCadence = "off" | "hourly" | "daily" | "weekly";

/**
 * Quiet-hours window evaluated in `timeZone`. `start`/`end` are 24h
 * "HH:MM" strings in the configured time zone. A window that starts at
 * 22:00 and ends at 07:00 crosses midnight and its start is later than its
 * end — that is expected and handled by the quiet-hours evaluator.
 */
export type QuietHours = {
  enabled: boolean;
  start: string;
  end: string;
  timeZone: string;
};

/**
 * Per-channel routing configuration. Minimum severity is inclusive, so a
 * channel with `minimumSeverity: "high"` receives high and critical alerts.
 * The optional per-category opt-in map defaults to "opted in" for categories
 * that are absent (an empty/undefined map enables every category).
 */
export type ChannelPreference = {
  enabled: boolean;
  minimumSeverity: AlertSeverity;
  categories?: Partial<Record<AlertCategory, boolean>>;
};

/**
 * Typed, per-wallet notification preference model.
 *
 * GUARANTEE (documented in the model, enforced by the routing evaluator):
 * critical-severity alerts ALWAYS bypass quiet hours and digest batching and
 * are delivered immediately on their enabled channels. A wallet cannot
 * suppress a critical alert through routing rules; only disabling the channel
 * itself (or its category opt-out) can prevent critical delivery.
 */
export type NotificationPreferences = {
  /** Stable storage id. Minted by the storage layer; omit when constructing defaults. */
  id?: string;
  walletAddress: string;
  chainFamily: ChainFamily;
  network: string;
  channels: Record<AlertDeliveryChannel, ChannelPreference>;
  quietHours: QuietHours;
  digestCadence: DigestCadence;
  dedupeWindowMinutes: number;
  updatedAt: string;
};

/**
 * Concrete per-alert delivery decision produced by the routing evaluator.
 * `deliverNow` holds channels that receive the alert immediately; `toDigest`
 * holds alerts suppressed into the digest stream (never critical).
 */
export type DeliveryPlan = {
  alertId: string;
  walletAddress: string;
  chainFamily: ChainFamily;
  network: string;
  severity: AlertSeverity;
  category: AlertCategory;
  triggerType: AlertTriggerType;
  deliverNow: AlertDeliveryChannel[];
  toDigest: boolean;
  suppressedReasons: Record<AlertDeliveryChannel, string>;
};

export type DigestEntry = {
  alertId: string;
  walletAddress: string;
  chainFamily: ChainFamily;
  network: string;
  severity: AlertSeverity;
  category: AlertCategory;
  triggerType: AlertTriggerType;
  message: string;
  scheduledAt: string;
  observedAt: string;
};

export type DigestSchedule = {
  walletAddress: string;
  chainFamily: ChainFamily;
  network: string;
  cadence: DigestCadence;
  entries: DigestEntry[];
  nextSendAt: string;
};

// ──────────────────────────────────────────────
// Explicit wallet approval flow types (V2-051+)
// ──────────────────────────────────────────────

/**
 * Discriminated prepared-transaction payload for EVM calldata vs Stellar XDR.
 * The server rebuilds and validates the exact payload from the approved quote
 * and simulation before returning it to the client for wallet signing.
 */
export type EvmPreparedTransactionPayload = {
  chainFamily: "evm";
  /** Target contract address */
  to: string;
  /** Encoded calldata (0x-prefixed hex) */
  data: string;
  /** Value in wei as decimal string */
  value: string;
  /** EIP-155 chain id */
  chainId: number;
  /** Gas limit (optional — wallet estimates if absent) */
  gas?: string;
  /** Gas price in wei (optional — wallet estimates if absent) */
  gasPrice?: string;
  /** Human-readable method name for display */
  method?: string;
  /** Decoded human-readable parameters for display */
  displayParams?: Record<string, unknown>;
};

export type StellarPreparedTransactionPayload = {
  chainFamily: "stellar";
  /** Unsigned base64 XDR envelope to be signed by Stellar Wallets Kit */
  xdr: string;
  networkPassphrase: string;
  sourceAccount: string;
  /** Decoded operations for display */
  operations: Array<{
    type: string;
    asset?: string;
    amount?: string;
    destination?: string;
    contractId?: string;
    method?: string;
  }>;
  /** Fee in stroops (optional — wallet estimates if absent) */
  fee?: number;
  /** Sequence number for the transaction */
  sequence?: string;
  /** Time bounds for the transaction */
  timeBounds?: {
    minTime?: number;
    maxTime?: number;
  };
  /** Human-readable method name for display */
  method?: string;
  /** Decoded human-readable parameters for display */
  displayParams?: Record<string, unknown>;
};

export type PreparedTransactionPayload = EvmPreparedTransactionPayload | StellarPreparedTransactionPayload;

/**
 * Result of the approval validation step.
 * The server validates the prepared transaction and returns the payload
 * that the client should send to the user's wallet for signing.
 */
export type ApprovalValidationResult = {
  /** Whether the approval is allowed */
  allowed: boolean;
  /** Reason if blocked */
  blockedReason?: string;
  /** The typed payload for wallet signing */
  payload?: PreparedTransactionPayload;
  /** Wallet mismatch info */
  walletOk: boolean;
  /** Network mismatch info */
  networkOk: boolean;
  /** Whether the plan has expired */
  expired: boolean;
  /** Whether the action is safe to sign */
  actionSafe: boolean;
};

/**
 * Input for the approve API endpoint.
 */
export type ApproveTransactionInput = {
  idempotencyKey: string;
  walletAddress: string;
  chainFamily: ChainFamily;
  network: string;
  sourceAccount?: string;
};

// Watchlist Export/Import Types
export type WatchlistExportVersion = "1.0.0";

export type WatchlistExportRow = {
  version: WatchlistExportVersion;
  chain: string;
  network?: string;
  assetType?: string;
  contractAddress?: string;
  pairAddress?: string;
  symbol?: string;
  tokenName?: string;
  assetKey?: string;
  issuer?: string;
  source: string;
  note?: string;
  createdAt: string;
};

export type WatchlistExportFormat = {
  version: WatchlistExportVersion;
  walletAddress: string;
  exportedAt: string;
  entries: WatchlistExportRow[];
};

export type WatchlistImportDryRunRowResult = {
  index: number;
  row: Partial<WatchlistExportRow>;
  status: "valid" | "duplicate" | "collision" | "invalid";
  errors: string[];
  canonicalIdentityKey?: string;
};

export type WatchlistImportDryRunResult = {
  validCount: number;
  duplicateCount: number;
  collisionCount: number;
  invalidCount: number;
  totalRows: number;
  results: WatchlistImportDryRunRowResult[];
};

export type PortfolioStressDelta = {
  originalValueUsd: number;
  stressedValueUsd: number;
  valueDeltaUsd: number;
  percentageDelta: number;
  originalRiskScore: number;
  stressedRiskScore: number;
  riskScoreDelta: number;
};

export type StressPriceStatus = "priced" | "missing";
/** "estimated": only a modelled liquidity score exists, no measured depth. */
export type StressLiquidityStatus = "known" | "estimated" | "missing";

export type StressAssetImpact = {
  key: string;
  symbol: string;
  chain: string | null;
  tokenClass: string;
  riskScore: number;
  priceStatus: StressPriceStatus;
  liquidityStatus: StressLiquidityStatus;
  /** Null values mean "unknown"; they are never a substitute for zero. */
  baseValueUsd: number | null;
  stressedValueUsd: number | null;
  deltaUsd: number | null;
  deltaPercent: number | null;
  baseAllocationPercent: number | null;
  stressedAllocationPercent: number | null;
};

export type StressMissingInput = {
  key: string;
  symbol: string;
  input: "price" | "liquidity";
  detail: string;
};

export type PortfolioStressResult = {
  assetImpacts: StressAssetImpact[];
  missingInputs: StressMissingInput[];
  scenarioId: string;
  scenarioVersion: number;
  baseSnapshot: PortfolioSnapshot;
  stressedSnapshot: PortfolioSnapshot;
  delta: PortfolioStressDelta;
  assumptions: string[];
  affectedHoldings: string[];
};
export const RECOVERY_RULES_VERSION = "v1";
