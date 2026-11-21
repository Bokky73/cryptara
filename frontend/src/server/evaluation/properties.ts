import type { AgentResult } from "@/server/types";
import { runDecisionAgent } from "@/server/agents/decision";
import { canonicalJson } from "./harness/determinism";
import { replayTranscript } from "./harness/replayRunner";
import type { AgentRunTranscript } from "./harness/transcript";

export function missingDataDoesNotIncreaseConfidence(before: AgentResult, after: AgentResult) {
  return after.missingData.length > before.missingData.length ? after.confidence <= before.confidence : true;
}

export function criticalFindingDoesNotLowerRisk(before: AgentResult, after: AgentResult) {
  const hasNewCritical = after.findings.some((finding) => finding.severity === "critical") && !before.findings.some((finding) => finding.severity === "critical");

  return hasNewCritical ? after.riskScore >= before.riskScore : true;
}

export function reliableSourcesDoNotLowerConfidence(before: AgentResult, after: AgentResult) {
  const beforeConnected = before.sources.filter((source) => source.status === "connected").length;
  const afterConnected = after.sources.filter((source) => source.status === "connected").length;
  const conflicting = after.dataQuality.mode === "conflicting";

  return afterConnected > beforeConnected && !conflicting ? after.confidence >= before.confidence : true;
}

export function noAgentResultRequiresManualReview() {
  return runDecisionAgent({ results: [] }).recommendedAction === "manual_review";
}

export function replayIsByteStable(transcript: AgentRunTranscript) {
  const first = replayTranscript(transcript).serialized;
  const second = replayTranscript(transcript).serialized;
  return first === second && first === canonicalJson(transcript.finalResult);
}

export function scoreWithinBounds(result: AgentResult) {
  return result.riskScore >= 0 && result.riskScore <= 100;
}

export function confidenceWithinBounds(result: AgentResult) {
  return result.confidence >= 0 && result.confidence <= 100;
}

export function liquidityDropDoesNotLowerRisk(before: AgentResult, after: AgentResult) {
  const beforeLiquidity = before.metrics?.liquidityUsd;
  const afterLiquidity = after.metrics?.liquidityUsd;

  if (typeof beforeLiquidity !== "number" || typeof afterLiquidity !== "number") {
    return true;
  }

  return afterLiquidity < beforeLiquidity ? after.riskScore >= before.riskScore : true;
}

export function honeypotFlipDoesNotLowerRisk(before: AgentResult, after: AgentResult) {
  const beforeHoneypot = before.metrics?.honeypot === true;
  const afterHoneypot = after.metrics?.honeypot === true;

  return !beforeHoneypot && afterHoneypot ? after.riskScore >= before.riskScore : true;
}

export function tieBreakingIsDeterministic(results: AgentResult[]) {
  const first = runDecisionAgent({ results }).recommendedAction;
  const second = runDecisionAgent({ results: [...results].reverse() }).recommendedAction;

  return first === second;
}
