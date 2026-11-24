import type {
  DiscoveryChainId,
  DiscoveryProviderKind,
  DiscoveryServiceConfig,
  PollResult,
  ProviderPollingConfig,
} from "@/server/discovery/types";
import type { DiscoveryProvider, ProviderRegistration } from "@/server/discovery/provider";
import { defaultPollingConfigs, getChainsForProvider } from "@/server/discovery/provider";
import logger from "@/server/observability/logger/logger";
import { getCursor, saveCursor } from "@/server/discovery/cursor";
import {
  storeObservations,
  pruneObservations,
  persistClassificationProvenance,
} from "@/server/discovery/store";
import { createDexScreenerProvider } from "@/server/discovery/providers/dexscreener";
import { createStellarMarketProvider } from "@/server/discovery/providers/stellar";
import { dedupeObservations } from "@/server/discovery/dedup";

// ─── Provider factory map ────────────────────────────────────────────────────

const providerFactories: Record<
  DiscoveryProviderKind,
  (chainId: DiscoveryChainId) => DiscoveryProvider
> = {
  dexscreener_new_pairs: createDexScreenerProvider,
  stellar_market: createStellarMarketProvider,
};

// ─── Scheduler state ─────────────────────────────────────────────────────────

type SchedulerState = {
  running: boolean;
  pollIntervalId: ReturnType<typeof setInterval> | null;
  registrations: ProviderRegistration[];
  config: DiscoveryServiceConfig;
};

const state: SchedulerState = {
  running: false,
  pollIntervalId: null,
  registrations: [],
  config: {},
};

// ─── Resolve polling config ──────────────────────────────────────────────────

function resolveConfig(
  kind: DiscoveryProviderKind,
  overrides?: DiscoveryServiceConfig["providerOverrides"],
): ProviderPollingConfig {
  const defaults = defaultPollingConfigs[kind];
  const override = overrides?.[kind];
  if (!override) return defaults;

  return {
    rateLimit: { ...defaults.rateLimit, ...override.rateLimit },
    backoff: { ...defaults.backoff, ...override.backoff },
    freshness: { ...defaults.freshness, ...override.freshness },
  };
}

// ─── Register providers ──────────────────────────────────────────────────────

export function registerProviders(config: DiscoveryServiceConfig = {}): ProviderRegistration[] {
  const enabledProviders = config.enabledProviders ?? Object.keys(providerFactories) as DiscoveryProviderKind[];
  const enabledChains = config.enabledChains;

  const registrations: ProviderRegistration[] = [];

  for (const kind of enabledProviders) {
    const chains = getChainsForProvider(kind);
    const factory = providerFactories[kind];

    if (!factory) continue;

    for (const chainId of chains) {
      if (enabledChains && !enabledChains.includes(chainId)) continue;

      const provider = factory(chainId);
      if (!provider.isAvailable()) continue;

      registrations.push({
        provider,
        config: resolveConfig(kind, config.providerOverrides),
      });
    }
  }

  state.registrations = registrations;
  return registrations;
}

import {
  isPollDue,
  createPollCoalescer,
  tryConsumeBudget,
  recordProviderOutcome,
  getAdaptiveBackoffMs,
} from "./pollingGuard";
const coalescePoll = createPollCoalescer<PollResult>();

// ─── Per-cycle candidate caps ────────────────────────────────────────────────

const DEFAULT_MAX_CANDIDATES_PER_CYCLE = 200;

function resolveMaxCandidatesPerCycle(): number {
  const configured = state.config.maxCandidatesPerCycle;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_MAX_CANDIDATES_PER_CYCLE;
}

function isRateLimitOrServerError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|5\d\d)\b/.test(message) || /rate.?limit|too many requests|server error/i.test(message);
}

// ─── Poll a single provider ──────────────────────────────────────────────────

export async function pollProvider(
  registration: ProviderRegistration,
): Promise<PollResult> {
  return coalescePoll(`${registration.provider.kind}::${registration.provider.chainId}`, () => pollProviderOnce(registration));
}

async function pollProviderOnce(registration: ProviderRegistration): Promise<PollResult> {
  const { provider, config } = registration;
  const cursor = getCursor(provider.kind, provider.chainId);

  if (cursor && !isPollDue(cursor, config)) {
    return {
      chainId: provider.chainId,
      providerKind: provider.kind,
      observations: [],
      cursor,
      ok: true,
      elapsedMs: 0,
    };
  }

  // Enforce token-bucket rate budget before issuing a provider request.
  if (!tryConsumeBudget(provider.kind, provider.chainId, config)) {
    logger.warn("discovery.scheduler", "Provider request budget exhausted; skipping poll", {
      providerKind: provider.kind,
      chainId: provider.chainId,
    });
    return {
      chainId: provider.chainId,
      providerKind: provider.kind,
      observations: [],
      cursor,
      ok: true,
      elapsedMs: 0,
    };
  }

  let result: PollResult;
  try {
    result = await provider.poll(cursor, config);
  } catch (error) {
    recordProviderOutcome(provider.kind, provider.chainId, false);
    throw error;
  }

  if (!result.ok) {
    // Adaptive backoff on 429/5xx (or any failure) via the polling guard.
    const backoffMs = getAdaptiveBackoffMs(provider.kind, provider.chainId, config);
    recordProviderOutcome(provider.kind, provider.chainId, false);
    if (result.cursor) {
      saveCursor({
        ...result.cursor,
        consecutiveFailures: (result.cursor.consecutiveFailures ?? 0) + 1,
        nextAllowedPollMs: Date.now() + backoffMs,
      });
    }
    return result;
  }

  recordProviderOutcome(provider.kind, provider.chainId, true);

  // Persist the cursor durably so restarts resume from the same position.
  if (result.cursor) {
    saveCursor({
      ...result.cursor,
      consecutiveFailures: 0,
      nextAllowedPollMs: Date.now() + config.freshness.pollIntervalMs,
    });
  }

  // Store observations if poll succeeded, bounded by the per-cycle cap and
  // deduplicated by canonical chain-aware identity before scoring/persisting.
  if (result.observations.length > 0) {
    const cap = resolveMaxCandidatesPerCycle();
    const bounded = result.observations.slice(0, cap);
    if (result.observations.length > cap) {
      logger.warn("discovery.scheduler", "Per-cycle candidate cap applied", {
        providerKind: provider.kind,
        chainId: provider.chainId,
        received: result.observations.length,
        cap,
      });
    }

    const deduped = dedupeObservations(bounded);

    const stored = storeObservations(
      deduped.map((obs) => ({
        identity: obs.identity,
        observedBy: obs.observedBy,
        observedAt: obs.observedAt,
        market: obs.market,
        evidence: obs.evidence,
        riskScore: obs.riskScore,
        riskLevel: obs.riskLevel,
      })),
    );

    // Persist classification provenance for each canonical candidate.
    persistClassificationProvenance(
      stored.map((obs) => ({
        canonicalKey: obs.identity.canonicalKey,
        chainId: obs.identity.chainId,
        classification: obs.riskLevel,
        riskScore: obs.riskScore,
        observedAt: obs.observedAt,
      })),
    );

    // Prune old observations per identity to limit memory use
    const maxPerIdentity = state.config.maxObservationsPerIdentity ?? 3;
    const prunedKeys = new Set<string>();
    for (const obs of stored) {
      if (!prunedKeys.has(obs.identity.canonicalKey)) {
        pruneObservations(obs.identity.canonicalKey, maxPerIdentity);
        prunedKeys.add(obs.identity.canonicalKey);
      }
    }
  }

  return result;
}

// ─── Poll all registered providers ───────────────────────────────────────────

export async function pollAll(): Promise<PollResult[]> {
  const results: PollResult[] = [];

  for (const registration of state.registrations) {
    try {
      const result = await pollProvider(registration);
      results.push(result);
    } catch (error) {
      const backoffMs = isRateLimitOrServerError(error)
        ? getAdaptiveBackoffMs(registration.provider.kind, registration.provider.chainId, registration.config)
        : 30_000;
      const existing = getCursor(registration.provider.kind, registration.provider.chainId);
      const failureCursor = {
        providerKind: registration.provider.kind,
        chainId: registration.provider.chainId,
        cursor: existing?.cursor ?? "",
        updatedAt: new Date().toISOString(),
        consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
        nextAllowedPollMs: Date.now() + backoffMs,
      };
      saveCursor(failureCursor);
      results.push({
        chainId: registration.provider.chainId,
        providerKind: registration.provider.kind,
        observations: [],
        cursor: failureCursor,
        ok: false,
        error: error instanceof Error ? error.message : "Poll failed unexpectedly",
        elapsedMs: 0,
      });
    }
  }

  return results;
}

// ─── Scheduler lifecycle ─────────────────────────────────────────────────────

export function startScheduler(config: DiscoveryServiceConfig = {}): void {
  if (state.running) return;

  state.config = config;
  registerProviders(config);
  state.running = true;

  // Run an initial poll cycle immediately
  pollAll().catch((error) => {
    logger.error("discovery.scheduler", "Initial poll failed", { error: error instanceof Error ? error.message : String(error) });
  });

  // Set up interval for subsequent polls
  const intervalMs = Math.min(
    ...state.registrations.map((r) => r.config.freshness.pollIntervalMs),
    60_000, // Cap at 60s
  );

  state.pollIntervalId = setInterval(() => {
    pollAll().catch((error) => {
      logger.error("discovery.scheduler", "Poll cycle failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }, intervalMs);

  logger.info("discovery.scheduler", `Started with ${state.registrations.length} provider(s), polling every ${intervalMs}ms`, { providerCount: state.registrations.length, intervalMs });
}

export function stopScheduler(): void {
  if (!state.running) return;

  if (state.pollIntervalId !== null) {
    clearInterval(state.pollIntervalId);
    state.pollIntervalId = null;
  }

  state.running = false;
  logger.info("discovery.scheduler", "Stopped");
}

export function isSchedulerRunning(): boolean {
  return state.running;
}

export function getSchedulerRegistrations(): ProviderRegistration[] {
  return [...state.registrations];
}

export function getSchedulerConfig(): DiscoveryServiceConfig {
  return { ...state.config };
}
