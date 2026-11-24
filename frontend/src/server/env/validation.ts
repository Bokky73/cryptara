import { stellarNetworks, validateStellarNetworkConfig } from "@/lib/stellar/config";
import { getApprovedPubnetConfig, isPubnetRequested, missingApprovedValues } from "@/server/stellar/config";
import { featureFlagRegistry } from "@/server/features/registry";
import { evaluateFeature, getFeatureConfigIssues, getFeatureEnvironment } from "@/server/features/evaluator";
import { getCacheConfig } from "@/server/cache/config";
import type { FeatureFlagKey } from "@/server/features/types";

type EnvCheck = {
  key: string;
  configured: boolean;
  visibility: "server" | "public";
  detail: string;
};

export function assertDevelopmentMode() {
  if (process.env.APP_MODE === "production") {
    throw new Error("Safety check failed: Environment is configured for production. Cannot perform destructive actions.");
  }
}

const serverEnvKeys = [
  "GOLDRUSH_API_KEY",
  "COVALENT_API_KEY",
  "GOPLUS_API_KEY",
  "GOPLUS_APP_KEY",
  "GOPLUS_APP_SECRET",
  "ALCHEMY_API_KEY",
  "ALCHEMY_SIMULATION_RPC_URL",
  "EVM_SIMULATION_PROVIDER",
  "TENDERLY_ACCOUNT_SLUG",
  "TENDERLY_PROJECT_SLUG",
  "TENDERLY_ACCESS_KEY",
  "GOAT_RPC_URL",
  "X402_PAY_TO",
  "X402_PRICE_USD",
  "X402_NETWORK",
  "X402_FACILITATOR_URL",
  "X402_ASSET",
  "X402_STELLAR_ENABLED",
  "X402_PAYMENT_EXPIRY_SECONDS",
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STELLAR_RPC_URL",
  "STELLAR_RPC_FALLBACK_URLS",
  "STELLAR_DATA_API_URL",
  "STELLAR_TESTNET_RPC_URL",
  "STELLAR_TESTNET_RPC_FALLBACK_URLS",
  "STELLAR_PUBNET_RPC_URL",
  "STELLAR_PUBNET_RPC_FALLBACK_URLS",
  "STELLAR_TESTNET_RISK_REGISTRY_ID",
  "STELLAR_PUBNET_RISK_REGISTRY_ID",
  "ALERT_EMAIL_WEBHOOK_URL",
  "ALERT_EMAIL_WEBHOOK_SECRET",
  "ALERT_TELEGRAM_BOT_TOKEN",
  "ALERT_TELEGRAM_CHAT_ID",
  "ALERT_DISCORD_WEBHOOK_URL",
  "PROVIDER_CIRCUIT_FAILURE_THRESHOLD",
  "PROVIDER_CIRCUIT_OPEN_MS",
  "PROVIDER_MAX_RETRIES",
  "PROVIDER_RETRY_BUDGET_MS",
  "OTEL_TRACING_ENABLED",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_SERVICE_NAME",
  "OTEL_LOG_LEVEL",
  "TRUSTED_PROXY_HOPS",
  "RATE_LIMIT_STORE",
  "RATE_LIMIT_MAX_KEYS",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "REDIS_URL",
  "RATE_LIMIT_POSTGRES_URL",
  "CACHE_STORE",
  "CACHE_L1_MAX_ENTRIES",
  "CACHE_INVALIDATION_POLL_MS",
  "CACHE_UPSTASH_REST_URL",
  "CACHE_UPSTASH_REST_TOKEN",
  "CACHE_REDIS_URL",
  "CACHE_POSTGRES_URL",
] as const;

const publicEnvKeys = [
  "NEXT_PUBLIC_GOAT_RPC_URL",
  "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
  "NEXT_PUBLIC_STELLAR_NETWORK",
  "NEXT_PUBLIC_STELLAR_TESTNET_RPC_URL",
  "NEXT_PUBLIC_STELLAR_TESTNET_RPC_FALLBACK_URLS",
  "NEXT_PUBLIC_STELLAR_PUBNET_RPC_URL",
  "NEXT_PUBLIC_STELLAR_PUBNET_RPC_FALLBACK_URLS",
] as const;

function isX402Ready() {
  const baseConfigReady = Boolean(process.env.X402_PAY_TO && process.env.X402_PRICE_USD && process.env.X402_NETWORK && process.env.X402_FACILITATOR_URL);
  const usesCdpFacilitator = process.env.X402_FACILITATOR_URL?.includes("api.cdp.coinbase.com");
  const stellarEnabled = process.env.X402_STELLAR_ENABLED === "1";
  const network = process.env.X402_NETWORK ?? "";
  const chainFamily = network.startsWith("stellar:") ? "stellar" : "evm";

  if (stellarEnabled && chainFamily === "stellar") {
    return (
      baseConfigReady &&
      /^G[A-Z2-7]{55}$/.test(process.env.X402_PAY_TO ?? "")
    );
  }

  return baseConfigReady && (!usesCdpFacilitator || Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET));
}

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export type RateLimitStoreKind = "memory" | "upstash" | "redis" | "postgres";

const rateLimitStoreKinds: readonly RateLimitStoreKind[] = ["memory", "upstash", "redis", "postgres"];

/**
 * Rate-limit configuration derived from the environment.
 *
 * `distributed` is only true when the selected store kind is a distributed
 * adapter *and* its connection settings are present. When it is false the
 * limiter must fall back to the bounded in-memory store, and `detail` explains
 * why so the fallback is observable from the health surface.
 */
export function getRateLimitConfig() {
  const rawStore = (process.env.RATE_LIMIT_STORE ?? "").trim().toLowerCase();
  const requestedStore: RateLimitStoreKind = (rateLimitStoreKinds as readonly string[]).includes(rawStore)
    ? (rawStore as RateLimitStoreKind)
    : "memory";
  const storeValid = rawStore === "" || requestedStore === rawStore;

  const trustedProxyHops = boundedInteger("TRUSTED_PROXY_HOPS", 0, 0, 10);
  const maxKeys = boundedInteger("RATE_LIMIT_MAX_KEYS", 10_000, 100, 1_000_000);

  const upstashReady = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  const redisReady = Boolean(process.env.REDIS_URL);
  const postgresReady = Boolean(process.env.RATE_LIMIT_POSTGRES_URL);

  const storeReady =
    requestedStore === "memory"
      ? true
      : requestedStore === "upstash"
        ? upstashReady
        : requestedStore === "redis"
          ? redisReady
          : postgresReady;

  const distributed = requestedStore !== "memory" && storeReady;

  const detail = !storeValid
    ? `RATE_LIMIT_STORE="${rawStore}" is not one of ${rateLimitStoreKinds.join(", ")}; falling back to the in-memory store.`
    : requestedStore === "memory"
      ? "In-memory rate-limit store is active; counters are process-local and reset on cold starts."
      : storeReady
        ? `Distributed ${requestedStore} rate-limit store is configured.`
        : `RATE_LIMIT_STORE=${requestedStore} is selected but its connection settings are missing; falling back to the in-memory store.`;

  return {
    store: requestedStore,
    storeValid,
    distributed,
    trustedProxyHops,
    maxKeys,
    upstashReady,
    redisReady,
    postgresReady,
    detail,
  };
}

export function getProviderResilienceConfig() {
  return {
    circuitFailureThreshold: boundedInteger("PROVIDER_CIRCUIT_FAILURE_THRESHOLD", 3, 1, 10),
    circuitOpenMs: boundedInteger("PROVIDER_CIRCUIT_OPEN_MS", 30_000, 1_000, 300_000),
    maxRetries: boundedInteger("PROVIDER_MAX_RETRIES", 2, 0, 3),
    retryBudgetMs: boundedInteger("PROVIDER_RETRY_BUDGET_MS", 20_000, 1_000, 120_000),
  };
}

/**
 * The approved pubnet values a reviewed deployment must declare.
 *
 * Reported as an env condition so a misconfigured pubnet deployment is visible
 * before the runtime gate refuses an action, not only afterwards.
 */
export function getPubnetApprovalHealth() {
  const requested = isPubnetRequested();
  const missing = requested ? missingApprovedValues(getApprovedPubnetConfig()) : [];

  return {
    requested,
    ready: requested ? missing.length === 0 : true,
    missing,
    detail: !requested
      ? "Pubnet is not requested; testnet behaviour is unaffected."
      : missing.length === 0
        ? "Every governance-approved pubnet value is configured."
        : `Pubnet is requested but ${missing.length} approved value(s) are missing, so the gate stays closed.`,
  };
}

export function getEnvHealth() {
  const goPlusReady = Boolean(process.env.GOPLUS_API_KEY || (process.env.GOPLUS_APP_KEY && process.env.GOPLUS_APP_SECRET));
  const portfolioReady = Boolean(process.env.GOAT_RPC_URL || process.env.GOLDRUSH_API_KEY || process.env.COVALENT_API_KEY || process.env.ALCHEMY_API_KEY);
  const x402Ready = isX402Ready();
  const stellarConfig = Object.values(stellarNetworks).map((network) => ({ network: network.id, ...validateStellarNetworkConfig(network) }));
  const stellarReady = stellarConfig.every((network) => network.ok);
  const pubnetApproval = getPubnetApprovalHealth();
  const checks: EnvCheck[] = [
    ...serverEnvKeys.map((key) => ({
      key,
      configured: Boolean(process.env[key]),
      visibility: "server" as const,
      detail: process.env[key] ? "Configured server-side." : "Missing; dependent source should report unavailable.",
    })),
    ...publicEnvKeys.map((key) => ({
      key,
      configured: Boolean(process.env[key]),
      visibility: "public" as const,
      detail: process.env[key] ? "Configured as public client config." : "Missing public fallback config.",
    })),
  ];

  const configuredLiveSources = [
    Boolean(process.env.GOAT_RPC_URL),
    Boolean(process.env.GOLDRUSH_API_KEY),
    Boolean(process.env.COVALENT_API_KEY),
    Boolean(process.env.ALCHEMY_API_KEY),
    goPlusReady,
  ].filter(Boolean);

  return {
    checks,
    liveSourceCount: configuredLiveSources.length,
    status: configuredLiveSources.length > 0 ? "partial" : "unavailable",
    mockFallbacksEnabled: false,
    realDataReadiness: {
      portfolio: portfolioReady,
      onchain: goPlusReady,
      news: true,
      social: true,
      execution: true,
      x402: x402Ready,
      stellar: stellarReady,
      stellarPubnetApproval: pubnetApproval.ready,
    },
    stellarConfig,
    pubnetApproval,
    providerResilience: getProviderResilienceConfig(),
    rateLimit: getRateLimitConfig(),
    cache: getCacheConfig(),
    detail:
      configuredLiveSources.length > 0
        ? "At least one live data source is configured. Missing sources must stay transparent in UI."
        : "No live API source is configured. App returns unavailable states instead of mock confidence.",
  };
}

export function getAgentReadiness() {
  const portfolioReady = Boolean(process.env.GOAT_RPC_URL || process.env.GOLDRUSH_API_KEY || process.env.COVALENT_API_KEY || process.env.ALCHEMY_API_KEY);
  const onchainReady = Boolean(process.env.GOPLUS_API_KEY || (process.env.GOPLUS_APP_KEY && process.env.GOPLUS_APP_SECRET));
  const x402Ready = isX402Ready();
  const newsReady = true;
  const socialProviderReady = Boolean(
    process.env.SOCIAL_DATA_PROVIDER_URL ||
      process.env.APIFY_TOKEN ||
      process.env.TAVILY_API_KEY ||
      process.env.X_BEARER_TOKEN,
  );

  return {
    portfolio: {
      status: portfolioReady ? "partial" : "unavailable",
      detail: portfolioReady ? "GOAT RPC or at least one live portfolio provider is configured." : "No live portfolio balance provider is configured.",
    },
    onchain: {
      status: onchainReady ? "partial" : "unavailable",
      detail: onchainReady
        ? "DexScreener is public and GoPlus credentials are configured for token security checks."
        : "DexScreener is public; GoPlus security checks remain unavailable until credentials are configured.",
    },
    news: {
      status: newsReady ? "live" : "unavailable",
      detail: "RSS-based news sources are available without API keys.",
    },
    social: {
      status: "partial",
      detail: socialProviderReady
        ? "A social data provider is configured for account, post, reply, engagement or search-based ingestion."
        : "V1 metadata-only mode is active: website and public social links are checked, but follower, reply, engagement and bot scores are marked unavailable instead of fabricated.",
    },
    decision: {
      status: "live",
      detail: "Decision Agent is deterministic and uses submitted agent results plus source coverage.",
    },
    execution: {
      status: "live",
      detail: "Execution Agent uses local user rules and approval-only transaction planning.",
    },
    x402: {
      status: x402Ready ? "live" : "unavailable",
      detail: x402Ready
        ? "GOAT premium deep scan is protected by x402 payment configuration."
        : "x402 payment env is incomplete; premium deep scan remains locked for production.",
    },
  };
}

/** Non-sensitive feature-flag status for health and operations surfaces. */
export function getFeatureFlagHealth() {
  const environment = getFeatureEnvironment();
  const issues = getFeatureConfigIssues();
  const flags = (Object.keys(featureFlagRegistry) as FeatureFlagKey[]).map((key) => {
    const decision = evaluateFeature(key, { identifier: "health_probe", environment });
    return {
      key,
      enabled: decision.enabled,
      reason: decision.reason,
      detail: decision.detail,
    };
  });
  return {
    environment,
    valid: issues.length === 0,
    issues,
    flags,
  };
}
