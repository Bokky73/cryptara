import { recordAuditEvent } from "@/server/observability/executionAudit";

import type { FeatureFlagDecision, FeatureFlagKey } from "./types";

// Audit logging for feature-flag evaluation. Reuses the shared execution audit
// sink so flag decisions live alongside the rest of the audit trail. Events
// carry the flag, decision, reason, environment, and a correlation id — never
// the raw rollout identifier or any secret.

export interface FeatureFlagAuditInput {
  key: FeatureFlagKey;
  decision: FeatureFlagDecision;
  environment: string;
  network?: string;
  correlationId: string;
}

/**
 * Flags whose evaluation gates a high-risk execution path (Pubnet publishing,
 * execution preparation, auto-mode authorization). Transitions and gating
 * decisions for these flags are always recorded as structured audit events.
 */
export const SENSITIVE_FEATURE_FLAGS: readonly FeatureFlagKey[] = [
  "scan_token",
  "execute_prepare",
  "execute_submit",
  "auto_mode_authorization",
] as const;

export function isSensitiveFeatureFlag(key: FeatureFlagKey): boolean {
  return SENSITIVE_FEATURE_FLAGS.includes(key);
}

/**
 * Immutable, structured audit record for a single feature-flag evaluation.
 * Frozen so downstream consumers cannot mutate the recorded decision.
 */
export interface FeatureFlagAuditEvent {
  readonly id: string;
  readonly correlationId: string;
  readonly flag: FeatureFlagKey;
  readonly enabled: boolean;
  readonly reason: string;
  readonly environment: string;
  readonly network: string | null;
  readonly sensitive: boolean;
  readonly occurredAt: string;
}

function buildFeatureFlagAuditEvent(input: FeatureFlagAuditInput): FeatureFlagAuditEvent {
  return Object.freeze({
    id: `feature_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    correlationId: input.correlationId,
    flag: input.decision.key,
    enabled: input.decision.enabled,
    reason: input.decision.reason,
    environment: input.environment,
    network: input.network ?? null,
    sensitive: isSensitiveFeatureFlag(input.decision.key),
    occurredAt: new Date().toISOString(),
  });
}

export function recordFeatureFlagEvaluation(input: FeatureFlagAuditInput): FeatureFlagAuditEvent {
  const event = buildFeatureFlagAuditEvent(input);

  recordAuditEvent({
    id: event.id,
    correlationId: event.correlationId,
    kind: event.enabled ? "policy_evaluated" : "policy_blocked",
    occurredAt: event.occurredAt,
    outcome: event.enabled ? "ok" : "blocked",
    network: input.network,
    detail: JSON.stringify({
      flag: event.flag,
      enabled: event.enabled,
      reason: event.reason,
      environment: event.environment,
      network: event.network,
      sensitive: event.sensitive,
    }),
  });

  return event;
}

/**
 * Record a sensitive flag transition (previous -> next) as an immutable audit
 * event. Non-sensitive flags are ignored so the trail stays focused on the
 * high-risk rollout surface.
 */
export function recordFeatureFlagTransition(input: {
  key: FeatureFlagKey;
  previous: boolean;
  next: boolean;
  environment: string;
  network?: string;
  correlationId: string;
}): FeatureFlagAuditEvent | null {
  if (!isSensitiveFeatureFlag(input.key) || input.previous === input.next) {
    return null;
  }

  const event = Object.freeze({
    id: `feature_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    correlationId: input.correlationId,
    flag: input.key,
    enabled: input.next,
    reason: `transition:${input.previous ? "enabled" : "disabled"}->${input.next ? "enabled" : "disabled"}`,
    environment: input.environment,
    network: input.network ?? null,
    sensitive: true,
    occurredAt: new Date().toISOString(),
  }) satisfies FeatureFlagAuditEvent;

  recordAuditEvent({
    id: event.id,
    correlationId: event.correlationId,
    kind: "policy_evaluated",
    occurredAt: event.occurredAt,
    outcome: "ok",
    network: input.network,
    detail: JSON.stringify({
      flag: event.flag,
      enabled: event.enabled,
      reason: event.reason,
      environment: event.environment,
      network: event.network,
      sensitive: event.sensitive,
      transition: { previous: input.previous, next: input.next },
    }),
  });

  return event;
}

/**
 * Build a non-sensitive summary context for a feature evaluation. Intended for
 * health/operations surfaces — it exposes the flag key, decision, and reason
 * but never the raw rollout identifier.
 */
export function summarizeFeatureDecision(decision: FeatureFlagDecision): {
  key: FeatureFlagKey;
  enabled: boolean;
  reason: string;
} {
  return {
    key: decision.key,
    enabled: decision.enabled,
    reason: decision.reason,
  };
}
