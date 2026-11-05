import {
  AUTO_MODE_POLICY_SCHEMA_VERSION,
  detectPolicyExpansion,
  evaluateAutoModeReadiness,
  getMissingAutoModeLimits,
  hashAutoModePolicy,
  hashAutoModeAuthorizationPayload,
  type AutoModeAuthorization,
  type AutoModeAuthorizationStatus,
  type AutoModeContractVerification,
  type AutoModePolicy,
  type PolicyExpansion,
} from "@/server/autoMode/policy";
import {
  getAutoModeActivationPrerequisites,
  getAutoModeContractVerification,
  type AutoModeActivationPrerequisites,
} from "@/server/autoMode/runtime";

export type AutoModeLifecycleEvent = {
  id: string;
  walletAddress: string;
  event:
    | "policy_saved"
    | "expansion_confirmed"
    | "authorization_requested"
    | "authorized"
    | "cancelled"
    | "rejected"
    | "expired";
  policyHash?: string;
  detail: Record<string, unknown>;
  occurredAt: string;
};

export type AutoModeRecord = {
  walletAddress: string;
  policy?: AutoModePolicy;
  requestedEnabled: boolean;
  explanationAcceptedAt?: string;
  authorizationStatus: AutoModeAuthorizationStatus;
  authorization?: AutoModeAuthorization;
  createdAt: string;
  updatedAt: string;
};

export type AutoModeSnapshot = AutoModeRecord & {
  effectiveEnabled: boolean;
  policyHash?: string;
  contractVerification: AutoModeContractVerification;
  blockers: string[];
  missingLimits: string[];
  activationPrerequisites: AutoModeActivationPrerequisites;
  suggestedPolicy: AutoModePolicy;
  events: AutoModeLifecycleEvent[];
};

type AutoModeGlobal = typeof globalThis & {
  __cryptaraAutoModeRecords?: AutoModeRecord[];
  __cryptaraAutoModeEvents?: AutoModeLifecycleEvent[];
};

const autoModeGlobal = globalThis as AutoModeGlobal;

function records() {
  autoModeGlobal.__cryptaraAutoModeRecords ??= [];
  return autoModeGlobal.__cryptaraAutoModeRecords;
}

function events() {
  autoModeGlobal.__cryptaraAutoModeEvents ??= [];
  return autoModeGlobal.__cryptaraAutoModeEvents;
}

function normalizeWallet(walletAddress: string) {
  return walletAddress.trim().toLowerCase();
}

function createEventId() {
  return `auto_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function appendEvent(
  walletAddress: string,
  event: AutoModeLifecycleEvent["event"],
  detail: Record<string, unknown> = {},
  policyHash?: string,
) {
  events().unshift({
    id: createEventId(),
    walletAddress,
    event,
    policyHash,
    detail,
    occurredAt: new Date().toISOString(),
  });
}

export function getSuggestedAutoModePolicy(walletAddress: string): AutoModePolicy {
  return {
    schemaVersion: AUTO_MODE_POLICY_SCHEMA_VERSION,
    policyVersion: 1,
    walletAddress: normalizeWallet(walletAddress),
    maxDailyValueUsd: 500,
    maxRiskScore: 60,
    maxTradePercent: 10,
    maxSlippageBps: 100,
    maxPriceImpactBps: 150,
    allowedChains: ["Base"],
    allowedAssets: ["USDC"],
    minStableReservePercent: 20,
    stopConditions: {
      stopLossPercent: 12,
      takeProfitPercent: 25,
      pauseOnCriticalRisk: true,
      pauseOnSourceCoverageLoss: true,
    },
  };
}

export function getAutoModeRecord(walletAddress: string): AutoModeRecord {
  const wallet = normalizeWallet(walletAddress);
  const existing = records().find((record) => record.walletAddress === wallet);

  if (existing) return existing;

  const now = new Date().toISOString();
  const created: AutoModeRecord = {
    walletAddress: wallet,
    requestedEnabled: false,
    authorizationStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };
  records().push(created);
  return created;
}

function expireAuthorization(record: AutoModeRecord, now: Date) {
  if (
    record.authorization?.status === "authorized" &&
    Date.parse(record.authorization.expiresAt) <= now.getTime()
  ) {
    record.authorization = { ...record.authorization, status: "expired" };
    record.authorizationStatus = "expired";
    record.requestedEnabled = false;
    record.updatedAt = now.toISOString();
    appendEvent(record.walletAddress, "expired", {}, record.authorization.policyHash);
  }
}

export function getAutoModeSnapshot(
  walletAddress: string,
  options: {
    now?: Date;
    contractVerification?: AutoModeContractVerification;
    activationPrerequisites?: AutoModeActivationPrerequisites;
  } = {},
): AutoModeSnapshot {
  const record = getAutoModeRecord(walletAddress);
  const now = options.now ?? new Date();
  expireAuthorization(record, now);
  const contractVerification =
    options.contractVerification ?? getAutoModeContractVerification();
  const activationPrerequisites =
    options.activationPrerequisites ?? getAutoModeActivationPrerequisites();
  const readiness = evaluateAutoModeReadiness({
    policy: record.policy,
    contractVerification,
    authorization: record.authorization,
    now,
  });

  return {
    ...record,
    effectiveEnabled:
      activationPrerequisites.ready &&
      record.requestedEnabled &&
      readiness.enabled,
    policyHash: readiness.policyHash,
    contractVerification,
    blockers: [
      ...activationPrerequisites.blockers,
      ...readiness.blockers,
    ],
    missingLimits: getMissingAutoModeLimits(record.policy),
    activationPrerequisites,
    suggestedPolicy: getSuggestedAutoModePolicy(record.walletAddress),
    events: events()
      .filter((event) => event.walletAddress === record.walletAddress)
      .slice(0, 20),
  };
}

export function previewAutoModePolicyExpansion(
  walletAddress: string,
  policy: AutoModePolicy,
): PolicyExpansion {
  const record = getAutoModeRecord(walletAddress);
  return record.policy
    ? detectPolicyExpansion(record.policy, policy)
    : { expanded: false, reasons: [] };
}

export function saveAutoModePolicy(input: {
  walletAddress: string;
  policy: AutoModePolicy;
  requestedEnabled: boolean;
  explanationAccepted: boolean;
  expansionConfirmed: boolean;
}) {
  const wallet = normalizeWallet(input.walletAddress);
  if (normalizeWallet(input.policy.walletAddress) !== wallet) {
    throw new Error("policy_wallet_mismatch");
  }

  const missing = getMissingAutoModeLimits(input.policy);
  if (missing.length > 0) {
    throw new Error(`policy_incomplete:${missing.join(",")}`);
  }

  const record = getAutoModeRecord(wallet);
  const nextPolicy: AutoModePolicy = {
    ...input.policy,
    walletAddress: wallet,
    policyVersion: record.policy
      ? Math.max(record.policy.policyVersion + 1, input.policy.policyVersion)
      : 1,
  };
  const expansion = record.policy
    ? detectPolicyExpansion(record.policy, nextPolicy)
    : { expanded: false, reasons: [] };

  if (expansion.expanded && !input.expansionConfirmed) {
    return { saved: false as const, expansion };
  }

  const policyHash = hashAutoModePolicy(nextPolicy);
  const now = new Date();
  record.policy = nextPolicy;
  record.requestedEnabled = Boolean(input.requestedEnabled);
  record.explanationAcceptedAt = input.explanationAccepted
    ? now.toISOString()
    : undefined;
  record.authorizationStatus = "pending";
  record.authorization = undefined;
  record.updatedAt = now.toISOString();
  appendEvent(
    wallet,
    expansion.expanded ? "expansion_confirmed" : "policy_saved",
    {
      explanationAccepted: input.explanationAccepted,
      requestedEnabled: input.requestedEnabled,
      expansionReasons: expansion.reasons,
    },
    policyHash,
  );

  // Explanation acceptance is intentionally represented only by a
  // subsequent authorization bound to this exact hash. Saving a checkbox
  // cannot authorize funds by itself.
  return { saved: true as const, record, expansion, policyHash };
}

export function authorizeAutoMode(input: {
  walletAddress: string;
  confirmationPhrase: string;
  allowanceUsd: number;
  expiresAt: string;
  authorizationProofId: string;
  signedPayloadHash: string;
  contractVerification?: AutoModeContractVerification;
  now?: Date;
}) {
  const record = getAutoModeRecord(input.walletAddress);
  const now = input.now ?? new Date();
  const contractVerification =
    input.contractVerification ?? getAutoModeContractVerification();

  if (!record.policy) throw new Error("policy_missing");
  if (input.confirmationPhrase !== "AUTHORIZE AUTO MODE") {
    throw new Error("authorization_confirmation_required");
  }
  if (!record.explanationAcceptedAt) throw new Error("explanation_acknowledgement_missing");
  if (contractVerification.status !== "verified") throw new Error("contract_unverified");
  if (!Number.isFinite(input.allowanceUsd) || input.allowanceUsd <= 0) {
    throw new Error("authorization_allowance_missing");
  }
  if (input.allowanceUsd > record.policy.maxDailyValueUsd) {
    throw new Error("authorization_allowance_exceeds_daily_limit");
  }
  const expiry = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
    throw new Error("authorization_expiration_invalid");
  }

  const policyHash = hashAutoModePolicy(record.policy);
  const expectedSignedPayloadHash = hashAutoModeAuthorizationPayload({
    walletAddress: record.walletAddress,
    policyHash,
    contractAddress: contractVerification.expectedAddress,
    network: contractVerification.expectedNetwork,
    contractVersion: contractVerification.expectedVersion,
    allowanceUsd: input.allowanceUsd,
    expiresAt: new Date(expiry).toISOString(),
  });
  if (!input.authorizationProofId.trim()) throw new Error("authorization_proof_missing");
  if (input.signedPayloadHash !== expectedSignedPayloadHash) {
    throw new Error("authorization_signed_payload_mismatch");
  }
  const authorization: AutoModeAuthorization = {
    status: "authorized",
    walletAddress: record.walletAddress,
    policyVersion: record.policy.policyVersion,
    policyHash,
    contractAddress: contractVerification.expectedAddress,
    network: contractVerification.expectedNetwork,
    contractVersion: contractVerification.expectedVersion,
    allowanceUsd: input.allowanceUsd,
    expiresAt: new Date(expiry).toISOString(),
    authorizationProofId: input.authorizationProofId,
    signedPayloadHash: input.signedPayloadHash,
    explanationAcknowledgedAt: record.explanationAcceptedAt,
    walletAuthorizedAt: now.toISOString(),
  };
  record.authorization = authorization;
  record.authorizationStatus = "authorized";
  record.updatedAt = now.toISOString();
  appendEvent(record.walletAddress, "authorized", {
    allowanceUsd: authorization.allowanceUsd,
    expiresAt: authorization.expiresAt,
  }, policyHash);

  return record;
}

export function closeAutoModeAuthorization(
  walletAddress: string,
  status: Extract<AutoModeAuthorizationStatus, "cancelled" | "rejected">,
  now = new Date(),
) {
  const record = getAutoModeRecord(walletAddress);
  record.requestedEnabled = false;
  record.authorizationStatus = status;
  if (record.authorization) {
    record.authorization = {
      ...record.authorization,
      status,
      ...(status === "cancelled"
        ? { cancelledAt: now.toISOString() }
        : { rejectedAt: now.toISOString() }),
    };
  }
  record.updatedAt = now.toISOString();
  appendEvent(record.walletAddress, status, {}, record.authorization?.policyHash);
  return record;
}

export function resetAutoModeStorageForTests() {
  autoModeGlobal.__cryptaraAutoModeRecords = [];
  autoModeGlobal.__cryptaraAutoModeEvents = [];
}
