import { createHash } from "node:crypto";

import {
  featureFlagRegistry,
  isFeatureFlagKey,
  getFeatureFlagDef,
} from "./registry";
import type {
  FeatureDecisionReason,
  FeatureEnvironment,
  FeatureEvaluationContext,
  FeatureFlagDecision,
  FeatureFlagKey,
} from "./types";
import { getRuntimeMode } from "@/server/env/runtimeMode";
import { recordFeatureFlagEvaluation } from "./audit";

// ── Env parsing ────────────────────────────────────────────────────

type ParsedFlag =
  | { kind: "unset" }
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "rollout"; rolloutPercent: number }
  | { kind: "invalid"; raw: string };

export interface FeatureConfigIssue {
  key: string;
  detail: string;
}

function envVarFor(key: FeatureFlagKey): string {
  return `FEATURE_${key.toUpperCase()}`;
}

function parseFlagValue(raw: string | undefined): ParsedFlag {
  if (raw === undefined || raw.trim() === "") return { kind: "unset" };
  const value = raw.trim().toLowerCase();
  if (value === "on" || value === "1" || value === "true") return { kind: "on" };
  if (value === "off" || value === "0" || value === "false") return { kind: "off" };

  const rolloutMatch = /^rollout:(\d{1,3})$/.exec(value);
  if (rolloutMatch) {
    const percent = Number(rolloutMatch[1]);
    if (Number.isInteger(percent) && percent >= 0 && percent <= 100) {
      return { kind: "rollout", rolloutPercent: percent };
    }
    return { kind: "invalid", raw };
  }

  return { kind: "invalid", raw };
}

/**
 * Parse and validate every known flag from the environment. Unknown env vars
 * that look like feature flags, and invalid values, are reported as issues so
 * production configuration can fail closed. This is the startup validation
 * gate — call it early and surface the issues (never silently ignore them).
 */
export function validateFeatureConfig(env: NodeJS.ProcessEnv = process.env): {
  parsed: Record<FeatureFlagKey, ParsedFlag>;
  issues: FeatureConfigIssue[];
  unknownKeys: string[];
} {
  const parsed = {} as Record<FeatureFlagKey, ParsedFlag>;
  const issues: FeatureConfigIssue[] = [];
  const unknownKeys: string[] = [];

  for (const key of Object.keys(featureFlagRegistry) as FeatureFlagKey[]) {
    const envKey = envVarFor(key);
    const value = env[envKey];
    const result = parseFlagValue(value);
    if (result.kind === "invalid") {
      issues.push({
        key: envKey,
        detail: `Invalid value "${value}". Expected "on", "off", or "rollout:<0-100>".`,
      });
    }
    parsed[key] = result;
  }

  // Detect feature-looking env vars that are not in the registry (typos).
  for (const envKey of Object.keys(env)) {
    if (!envKey.startsWith("FEATURE_")) continue;
    const flagKey = envKey.slice("FEATURE_".length).toLowerCase();
    if (!isFeatureFlagKey(flagKey)) {
      unknownKeys.push(envKey);
    }
  }

  return { parsed, issues, unknownKeys };
}

// ── Rollout bucketing ──────────────────────────────────────────────

/**
 * Deterministic, anonymous rollout bucket (0-99) from a one-way identifier.
 * Uses SHA-256 so the raw identifier can never be recovered from the bucket.
 * Callers must pass an already-hashed/opaque identifier — never a raw wallet.
 */
export function stableRolloutBucket(identifier: string): number {
  const digest = createHash("sha256").update(identifier).digest();
  return digest.readUInt32BE(0) % 100;
}

// ── Expiry ─────────────────────────────────────────────────────────

function isExpired(key: FeatureFlagKey, now: Date = new Date()): boolean {
  const def = getFeatureFlagDef(key);
  const removal = new Date(`${def.removalDate}T00:00:00Z`);
  return now >= removal;
}

// ── Evaluation ─────────────────────────────────────────────────────

/**
 * Evaluate a flag to a decision. Fails closed: expired flags, unknown flags,
 * disabled dependencies, and invalid configuration all resolve to
 * `enabled: false`. Rollout bucketing is stable and anonymous.
 */
export function evaluateFeature(
  key: FeatureFlagKey,
  context: FeatureEvaluationContext,
  parsed: Record<FeatureFlagKey, ParsedFlag> = validateFeatureConfig().parsed,
): FeatureFlagDecision {
  const def = getFeatureFlagDef(key);

  if (isExpired(key)) {
    return {
      key,
      enabled: false,
      reason: "expired",
      detail: `Flag removed after ${def.removalDate}.`,
    };
  }

  // Environment scope: only allow flags whose environment list includes ours.
  if (!def.environments.includes(context.environment)) {
    return {
      key,
      enabled: false,
      reason: "configured",
      detail: `Flag not enabled for environment "${context.environment}".`,
    };
  }

  // Dependencies must all be enabled first.
  for (const dependency of def.dependencies) {
    const dependencyDecision = evaluateFeature(dependency, context, parsed);
    if (!dependencyDecision.enabled) {
      return {
        key,
        enabled: false,
        reason: "dependency",
        detail: `Dependency "${dependency}" is not enabled.`,
      };
    }
  }

  const configured = parsed[key] ?? { kind: "unset" } as ParsedFlag;

  switch (configured.kind) {
    case "on":
      return { key, enabled: true, reason: "configured", detail: "Explicitly enabled." };
    case "off":
      return { key, enabled: false, reason: "configured", detail: "Explicitly disabled." };
    case "rollout": {
      const bucket = stableRolloutBucket(context.identifier);
      const enabled = bucket < configured.rolloutPercent;
      return {
        key,
        enabled,
        reason: "rollout",
        rolloutBucket: bucket,
        detail: enabled
          ? `Rollout bucket ${bucket} within ${configured.rolloutPercent}% rollout.`
          : `Rollout bucket ${bucket} outside ${configured.rolloutPercent}% rollout.`,
      };
    }
    case "invalid":
      return {
        key,
        enabled: false,
        reason: "unknown",
        detail: "Invalid configuration; failing closed.",
      };
    case "unset":
    default: {
      const reason: FeatureDecisionReason = "default";
      return {
        key,
        enabled: def.safeDefault,
        reason,
        detail: def.safeDefault
          ? "Using safe default (enabled)."
          : "Using safe default (disabled).",
      };
    }
  }
}

/** Convenience boolean gate for route handlers. */
export function isFeatureEnabled(
  key: FeatureFlagKey,
  context: FeatureEvaluationContext,
): boolean {
  return evaluateFeature(key, context).enabled;
}

/**
 * Fail-closed production validation. Returns a list of human-readable issues;
 * an empty list means the flag configuration is valid. Unknown keys and
 * invalid values are always reported so callers can hard-fail at startup.
 */
export function getFeatureConfigIssues(): FeatureConfigIssue[] {
  const { issues, unknownKeys } = validateFeatureConfig();
  const all: FeatureConfigIssue[] = [...issues];
  for (const key of unknownKeys) {
    all.push({
      key,
      detail: "Unknown feature flag env var; remove or add it to the registry.",
    });
  }
  return all;
}

/** Map the app runtime mode to a feature environment. */
export function getFeatureEnvironment(): FeatureEnvironment {
  const mode = getRuntimeMode();
  if (mode === "live") return "production";
  if (mode === "test") return "test";
  return "development";
}

/**
 * Sanitized snapshot of active flag states for health/ops endpoints. Never
 * exposes raw env values or identifiers — only the resolved decision shape.
 */
export function getActiveFeatureStates(): Array<{
  key: FeatureFlagKey;
  enabled: boolean;
  reason: FeatureDecisionReason;
}> {
  const environment = getFeatureEnvironment();
  const parsed = validateFeatureConfig().parsed;
  const identifier = createHash("sha256").update("ops-health").digest("hex");
  return (Object.keys(featureFlagRegistry) as FeatureFlagKey[]).map((key) => {
    const decision = evaluateFeature(key, { identifier, environment }, parsed);
    return { key, enabled: decision.enabled, reason: decision.reason };
  });
}

/**
 * Route-facing gate. Evaluates the flag against a hashed identifier (never the
 * raw value), records an audit event, and returns the decision. Routes use the
 * returned `enabled` boolean to fail closed with a disabled response.
 */
export function gateFeature(
  key: FeatureFlagKey,
  rawIdentifier: string,
  options?: { network?: string; correlationId?: string },
): FeatureFlagDecision {
  const environment = getFeatureEnvironment();
  const identifier = createHash("sha256")
    .update(rawIdentifier || "anonymous")
    .digest("hex");
  const decision = evaluateFeature(key, {
    identifier,
    environment,
    network: options?.network,
  });
  recordFeatureFlagEvaluation({
    key,
    enabled: decision.enabled,
    reason: decision.reason,
    environment,
    network: options?.network,
    correlationId: options?.correlationId,
    rolloutBucket: decision.rolloutBucket,
  });
  return decision;
}
