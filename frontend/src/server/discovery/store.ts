import type {
  CandidateObservation,
  CanonicalIdentity,
  DiscoveryCandidate,
  DiscoveryClassification,
  DiscoveryProviderKind,
} from "@/server/discovery/types";
import { createHash } from "node:crypto";

// ─── In-memory observation store ─────────────────────────────────────────────
// Observations are immutable: once written they are never mutated.
// A new observation for the same canonicalKey is appended; callers always
// read the latest (by observedAt).

type ObservationBucket = {
  identity: CanonicalIdentity;
  observations: CandidateObservation[];
};

const store = new Map<string, ObservationBucket>();

// ─── Durable classification provenance ───────────────────────────────────────
// Provenance is keyed by canonical identity and survives observation pruning.
// Each entry records the latest classification plus the full transition history
// so downstream consumers can audit how a candidate was classified.

export type ProvenanceEntry = {
  canonicalKey: string;
  classification: DiscoveryClassification;
  updatedAt: string;
  history: { classification: DiscoveryClassification; at: string }[];
};

const provenance = new Map<string, ProvenanceEntry>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function observationId(canonicalKey: string, observedAt: string): string {
  const hash = createHash("sha256")
    .update(`${canonicalKey}::${observedAt}`)
    .digest("hex")
    .slice(0, 16);
  return `obs_${hash}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Store a new observation. If the canonical key already exists, the observation
 * is appended to its bucket. Returns the observation with its generated ID.
 */
export function storeObservation(observation: Omit<CandidateObservation, "id">): CandidateObservation {
  const id = observationId(observation.identity.canonicalKey, observation.observedAt);
  const record: CandidateObservation = { ...observation, id };

  const existing = store.get(observation.identity.canonicalKey);
  if (existing) {
    existing.observations.push(record);
  } else {
    store.set(observation.identity.canonicalKey, {
      identity: observation.identity,
      observations: [record],
    });
  }

  return record;
}

/**
 * Store multiple observations atomically.
 */
export function storeObservations(observations: Omit<CandidateObservation, "id">[]): CandidateObservation[] {
  return observations.map(storeObservation);
}

/**
 * Get the latest observation for a canonical key, or null if none exist.
 */
export function getLatestObservation(canonicalKey: string): CandidateObservation | null {
  const bucket = store.get(canonicalKey);
  if (!bucket || bucket.observations.length === 0) return null;

  return bucket.observations.sort(
    (a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
  )[0];
}

/**
 * Get all observations for a canonical key, sorted newest-first.
 */
export function getObservations(canonicalKey: string, limit = 10): CandidateObservation[] {
  const bucket = store.get(canonicalKey);
  if (!bucket) return [];

  return bucket.observations
    .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime())
    .slice(0, limit);
}

/**
 * Prune observations for a canonical key, keeping only the N most recent.
 * Returns the number of observations removed.
 */
export function pruneObservations(canonicalKey: string, keep: number): number {
  const bucket = store.get(canonicalKey);
  if (!bucket) return 0;

  const sorted = bucket.observations.sort(
    (a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
  );

  if (sorted.length <= keep) return 0;

  const removed = sorted.length - keep;
  bucket.observations = sorted.slice(0, keep);
  return removed;
}

/**
 * Persist classification provenance for a canonical key. The latest
 * classification is stored and the transition is appended to history.
 */
export function storeProvenance(
  canonicalKey: string,
  classification: DiscoveryClassification,
  at: string = new Date().toISOString(),
): ProvenanceEntry {
  const existing = provenance.get(canonicalKey);
  if (existing) {
    existing.classification = classification;
    existing.updatedAt = at;
    existing.history.push({ classification, at });
    return existing;
  }

  const entry: ProvenanceEntry = {
    canonicalKey,
    classification,
    updatedAt: at,
    history: [{ classification, at }],
  };
  provenance.set(canonicalKey, entry);
  return entry;
}

/**
 * Get the persisted provenance for a canonical key, or null if none.
 */
export function getProvenance(canonicalKey: string): ProvenanceEntry | null {
  return provenance.get(canonicalKey) ?? null;
}

/**
 * Get the latest classification for a canonical key, or null if none.
 */
export function getClassification(canonicalKey: string): DiscoveryClassification | null {
  return provenance.get(canonicalKey)?.classification ?? null;
}

/**
 * Get all discovery candidates (latest observation per canonical key),
 * ordered deterministically by canonical key.
 * This is the primary output of the discovery service.
 */
export function listCandidates(): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];

  for (const [, bucket] of store) {
    const latest = getLatestObservation(bucket.identity.canonicalKey);
    if (!latest) continue;

    candidates.push({
      canonicalKey: bucket.identity.canonicalKey,
      chainFamily: bucket.identity.chainFamily,
      chainId: bucket.identity.chainId,
      address: bucket.identity.address,
      symbol: bucket.identity.symbol,
      tokenName: bucket.identity.tokenName,
      market: latest.market,
      evidence: latest.evidence,
      lastObservedBy: latest.observedBy,
      lastObservedAt: latest.observedAt,
      observationCount: bucket.observations.length,
      riskScore: latest.riskScore,
      riskLevel: latest.riskLevel,
      classification: provenance.get(bucket.identity.canonicalKey)?.classification ?? null,
    });
  }

  return candidates.sort((a, b) => (a.canonicalKey < b.canonicalKey ? -1 : a.canonicalKey > b.canonicalKey ? 1 : 0));
}

/**
 * Deterministically ordered listing of candidates for cursor pagination.
 * Ordering is by canonical key (ascending), which is stable across calls.
 * `afterKey` is an exclusive lower bound (the last key of the previous page).
 */
export function listCandidatesPage(options: {
  afterKey?: string | null;
  limit: number;
}): { items: DiscoveryCandidate[]; nextCursor: string | null } {
  const limit = Math.max(0, Math.floor(options.limit));
  const afterKey = options.afterKey ?? null;

  const ordered = listCandidates().filter((c) => (afterKey === null ? true : c.canonicalKey > afterKey));

  const items = ordered.slice(0, limit);
  const hasMore = ordered.length > items.length;
  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].canonicalKey : null;

  return { items, nextCursor };
}

/**
 * Get candidates filtered by provider kind.
 */
export function listCandidatesByProvider(kind: DiscoveryProviderKind): DiscoveryCandidate[] {
  return listCandidates().filter((c) => c.lastObservedBy === kind);
}

/**
 * Get candidates filtered by chain ID.
 */
export function listCandidatesByChain(chainId: string): DiscoveryCandidate[] {
  return listCandidates().filter((c) => c.chainId === chainId);
}

/**
 * Get total number of stored observations.
 */
export function getObservationCount(): number {
  let count = 0;
  for (const [, bucket] of store) {
    count += bucket.observations.length;
  }
  return count;
}

/**
 * Get the number of unique canonical identities tracked.
 */
export function getUniqueIdentityCount(): number {
  return store.size;
}

/**
 * Reset the store (for testing / fixture replay).
 */
export function resetStore(): void {
  store.clear();
  provenance.clear();
}

/**
 * Dump all store contents (for serialisation / inspection).
 */
export function dumpStore(): Record<string, unknown>[] {
  const dumped: Record<string, unknown>[] = [];
  for (const [, bucket] of store) {
    for (const obs of bucket.observations) {
      dumped.push({
        id: obs.id,
        canonicalKey: obs.identity.canonicalKey,
        chainFamily: obs.identity.chainFamily,
        chainId: obs.identity.chainId,
        observedBy: obs.observedBy,
        observedAt: obs.observedAt,
        symbol: obs.identity.symbol,
        tokenName: obs.identity.tokenName,
        market: obs.market,
        evidenceCount: obs.evidence.length,
        riskScore: obs.riskScore,
      });
    }
  }
  return dumped;
}

/**
 * Dump all persisted provenance (for serialisation / inspection).
 */
export function dumpProvenance(): ProvenanceEntry[] {
  return [...provenance.values()].sort((a, b) =>
    a.canonicalKey < b.canonicalKey ? -1 : a.canonicalKey > b.canonicalKey ? 1 : 0,
  );
}
