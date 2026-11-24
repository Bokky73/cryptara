import type { AgentResult, AgentRunRecord } from "@/server/types";
import { getExecutionMetrics } from "@/server/observability/executionMetrics";
import { getCacheMetricsReport } from "@/server/cache";

function percent(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

export function getAgentRunMetrics(records: AgentRunRecord[]) {
  const results = records.flatMap((record) => record.results);
  const providerSources = results.flatMap((result) => result.sources);
  const manualReviews = results.filter((result) => result.recommendedAction === "manual_review").length;
  const criticalBlockers = results.filter((result) => result.blockingReasons.length > 0 || result.findings.some((finding) => finding.severity === "critical")).length;
  const executionBlocked = results.filter((result) => result.agent === "execution" && result.blockingReasons.length > 0).length;
  const latencies = providerSources.map((source) => source.latencyMs).filter((value): value is number => typeof value === "number");
  const executionMetrics = getExecutionMetrics(records);

  return {
    agentSuccessRate: percent(results.filter((result) => result.status !== "error" && result.status !== "unavailable").length, results.length),
    providerFailureRate: percent(providerSources.filter((source) => source.status === "unavailable").length, providerSources.length),
    averageLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length) : 0,
    manualReviewRate: percent(manualReviews, results.length),
    criticalBlockerRate: percent(criticalBlockers, results.length),
    executionBlockedRate: percent(executionBlocked, results.filter((result) => result.agent === "execution").length),
    execution: executionMetrics,
    cache: getCacheMetricsReport(),
    sampleSize: {
      runs: records.length,
      agentResults: results.length,
      providerSources: providerSources.length,
    },
  };
}

export function getResultMetrics(results: AgentResult[]) {
  return getAgentRunMetrics([
    {
      id: "inline",
      chainFamily: "evm",
      network: "legacy-evm",
      walletAddress: "inline",
      status: "completed",
      recommendation: "manual_review",
      decisionScore: 0,
      confidence: 0,
      summary: "Inline metrics sample.",
      results,
      createdAt: new Date(0).toISOString(),
    },
  ]);
}
