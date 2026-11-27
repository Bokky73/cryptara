import type { AgentResult } from "@/server/types";

import { currentTraceparent } from "./tracing";

export type StructuredAgentLog = {
  runId?: string;
  agent: AgentResult["agent"];
  provider?: string;
  latencyMs?: number;
  status: AgentResult["status"];
  errorCode?: string;
  sourceCount: number;
  message: string;
  traceparent?: string;
};

export function redactWalletAddress(value: string): string {
  if (!value) return value;
  if (value.length <= 10) return "…";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function redactSensitiveObject<T>(value: T, seen = new WeakSet<object>()): T {
  if (Array.isArray(value)) {
    if (seen.has(value)) return [] as T;
    seen.add(value);
    return value.map((entry) => redactSensitiveObject(entry, seen)) as T;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return {} as T;
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/secret|password|passwd|token|private|authorization|api[_-]?key|credential/i.test(key)) {
        result[key] = "[REDACTED_PAYLOAD]";
      } else {
        result[key] = redactSensitiveObject(entry, seen);
      }
    }
    return result as T;
  }
  if (typeof value === "string") return redactSecrets(value) as T;
  return value;
}

export function redactSecrets(value: unknown): string {
  let serialized = typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  serialized = serialized
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replace(/cqt_[A-Za-z0-9._-]+/g, "[REDACTED]")
    .replace(/(api[_-]?key=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization["']?\s*:\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2")
    .replace(/AAAAA[gG].{20,}/g, "[REDACTED]")
    .replace(/0x02[fF][0-9a-fA-F]{20,}/g, "[REDACTED]")
    .replace(/(x-payment-header:\s*)([^,\n]+)/gi, "$1[REDACTED]")
    .replace(/S[A-Z0-9]{55}/g, "[REDACTED]")
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@")
    .replace(/([?&](?:token|key|api[_-]?key|secret|authorization)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\bG[A-Z2-7]{55}\b/g, "[WALLET_REDACTED]")
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, "[WALLET_REDACTED]");
  return serialized;
}

export function createAgentLog(result: AgentResult, message = "agent_result"): StructuredAgentLog {
  const firstSource = result.sources[0];
  const orchestration = result.rawSignals?.orchestration as { runId?: string } | undefined;

  return {
    runId: orchestration?.runId,
    agent: result.agent,
    provider: firstSource?.provider ?? firstSource?.label,
    latencyMs: firstSource?.latencyMs,
    status: result.status,
    errorCode: firstSource?.errorCode,
    sourceCount: result.sources.length,
    message: redactSecrets(message),
    traceparent: currentTraceparent(),
  };
}
