import { apiCacheStrategy } from "@/server/cache/strategy";
import { getAgentReadiness, getEnvHealth } from "@/server/env/validation";
import { getReleaseReadinessHealth } from "@/server/operations/releaseReadiness";
import { getPortfolioProviderHealth } from "@/server/portfolio/getPortfolio";
import { getStorageHealth, listAgentRunRecords } from "@/server/storage";
import { getConfiguredProviderHealth, getExecutionDisableFlags, getProviderCircuitHealth } from "@/server/observability/providerHealth";

async function getLastSuccessfulProviderCall() {
  const records = await listAgentRunRecords();
  const connectedSources = records
    .flatMap((record) => record.results)
    .flatMap((result) => result.sources.map((source) => ({ agent: result.agent, source })))
    .filter((item) => item.source.status === "connected" && item.source.checkedAt)
    .sort((left, right) => new Date(right.source.checkedAt ?? 0).getTime() - new Date(left.source.checkedAt ?? 0).getTime());

  return connectedSources[0]
    ? {
        agent: connectedSources[0].agent,
        provider: connectedSources[0].source.provider ?? connectedSources[0].source.label,
        checkedAt: connectedSources[0].source.checkedAt,
      }
    : undefined;
}

export async function getProductionHealth() {
  return {
    envConfig: getEnvHealth(),
    agentReadiness: getAgentReadiness(),
    providerConnectivity: {
      portfolio: getPortfolioProviderHealth(),
    },
    providerHealth: getConfiguredProviderHealth(),
    databaseConnectivity: await getStorageHealth(),
    cacheStatus: apiCacheStrategy,
    releaseReadiness: getReleaseReadinessHealth(),
    lastSuccessfulProviderCall: await getLastSuccessfulProviderCall(),
    executionDisableFlags: getExecutionDisableFlags(),
    providerResilience: {
      circuits: getProviderCircuitHealth(),
      boundedRetries: true,
      crossNetworkFailover: false,
    },
  };
}

export function getPerformanceHealth() {
  const memory = process.memoryUsage();
  return {
    status: memory.heapUsed / Math.max(memory.heapTotal, 1) > 0.9 ? "degraded" : "healthy",
    uptimeSeconds: Math.round(process.uptime()),
    heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
  };
}
