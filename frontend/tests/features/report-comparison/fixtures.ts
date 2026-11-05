/**
 * Fixtures for snapshot comparison.
 *
 * Snapshot records are built through the real canonical hashing helpers, so a
 * fixture is only readable if it would also be readable in production. The
 * tampered fixture is produced by mutating a document *after* its hash was
 * computed, which is exactly what the integrity check exists to catch.
 *
 * No fixture touches a network, a wallet, or a paid provider.
 */
import { canonicalAssetIdentity, hashRiskSnapshot } from "@/server/snapshots/canonical";
import type { RiskSnapshotDocument, RiskSnapshotRecord } from "@/server/snapshots/schema";
import type { IStorageAdapter } from "@/server/storage/adapters/types";

const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

type DocumentOverrides = {
  network?: string;
  symbol?: string;
  canonicalId?: string;
  buyRisk?: number;
  confidence?: number;
  verdict?: RiskSnapshotDocument["verdict"];
  topReasons?: string[];
  evidence?: RiskSnapshotDocument["evidence"];
  missingData?: RiskSnapshotDocument["missingData"];
  generatedAt?: string;
  expiresAt?: string;
  productVersion?: string;
};

export function buildDocument(overrides: DocumentOverrides = {}): RiskSnapshotDocument {
  const generatedAt = overrides.generatedAt ?? "2026-01-01T00:00:00.000Z";

  return {
    schemaVersion: "1",
    asset: {
      chainFamily: "evm",
      network: overrides.network ?? "ethereum",
      identity: {
        kind: "evm_contract",
        canonicalId: overrides.canonicalId ?? "0x1111111111111111111111111111111111111111",
        contractAddress: overrides.canonicalId ?? "0x1111111111111111111111111111111111111111",
      },
      symbol: overrides.symbol ?? "ACME",
    },
    scores: {
      buyRisk: overrides.buyRisk ?? 60,
      confidence: overrides.confidence ?? 0.7,
    },
    verdict: overrides.verdict ?? "watch",
    summary: "Fixture snapshot summary.",
    topReasons: overrides.topReasons ?? ["Liquidity is thin", "Owner can mint new supply"],
    evidence: overrides.evidence ?? [
      { label: "GoPlus", status: "connected", checkedAt: generatedAt, freshnessSeconds: 30, reliability: 0.9 },
      { label: "DexScreener", status: "connected", checkedAt: generatedAt, freshnessSeconds: 60, reliability: 0.8 },
    ],
    missingData: overrides.missingData ?? [],
    freshness: {
      generatedAt,
      sourceCheckedAt: [generatedAt],
      staleAt: FUTURE,
    },
    expiresAt: overrides.expiresAt ?? FUTURE,
    product: { name: "Cryptara", version: overrides.productVersion ?? "0.1.0" },
    notices: { informationOnly: true, providerCorrectnessNotProven: true },
  };
}

export function buildRecord(
  id: string,
  document: RiskSnapshotDocument,
  options: { revokedAt?: string; tamperSummary?: string; schemaVersion?: string } = {},
): RiskSnapshotRecord {
  const record: RiskSnapshotRecord = {
    id,
    schemaVersion: options.schemaVersion ?? "1",
    snapshot: document,
    canonicalHash: hashRiskSnapshot(document),
    identityKey: canonicalAssetIdentity(document.asset),
    revocationTokenHash: "0".repeat(64),
    createdAt: document.freshness.generatedAt,
    expiresAt: document.expiresAt,
    revokedAt: options.revokedAt,
  };

  if (options.tamperSummary !== undefined) {
    // Mutate after hashing: the stored hash now describes content that no
    // longer exists, which is what a real tamper looks like.
    record.snapshot = { ...document, summary: options.tamperSummary };
  }

  return record;
}

/** Minimal adapter exposing only what the snapshot read path uses. */
export function stubAdapter(records: RiskSnapshotRecord[]): IStorageAdapter {
  const byId = new Map(records.map((record) => [record.id, record]));

  return {
    async getRiskSnapshot(id: string) {
      return byId.get(id) ?? null;
    },
  } as unknown as IStorageAdapter;
}

const EARLIER = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-08T00:00:00.000Z";

/** Two snapshots whose content is equivalent but whose arrays are reordered. */
export const reorderedEquivalentPair = {
  left: buildRecord("snapshot_reorder-left", buildDocument({ generatedAt: EARLIER })),
  right: buildRecord(
    "snapshot_reorder-right",
    buildDocument({
      generatedAt: LATER,
      topReasons: ["Owner can mint new supply", "Liquidity is thin"],
      evidence: [
        { label: "DexScreener", status: "connected", checkedAt: LATER, freshnessSeconds: 60, reliability: 0.8 },
        { label: "GoPlus", status: "connected", checkedAt: LATER, freshnessSeconds: 30, reliability: 0.9 },
      ],
    }),
  ),
};

/** Added, removed and ambiguous narrative items plus a lost evidence source. */
export const addedRemovedAmbiguousPair = {
  left: buildRecord(
    "snapshot_narrative-left",
    buildDocument({
      generatedAt: EARLIER,
      topReasons: ["Liquidity is thin", "Holder concentration is high"],
      missingData: [{ field: "lp_lock", impact: "medium" }],
      evidence: [
        { label: "GoPlus", status: "connected", checkedAt: EARLIER, freshnessSeconds: 30, reliability: 0.9 },
        { label: "DexScreener", status: "connected", checkedAt: EARLIER, freshnessSeconds: 60, reliability: 0.8 },
      ],
    }),
  ),
  right: buildRecord(
    "snapshot_narrative-right",
    buildDocument({
      generatedAt: LATER,
      buyRisk: 74,
      verdict: "avoid",
      // "Liquidity is thin" and "Thin liquidity" reduce to the same
      // fingerprint, so the left side's single reason cannot be matched to
      // exactly one of them. That pair must surface as ambiguous.
      topReasons: ["Liquidity is thin", "Thin liquidity", "Owner can mint new supply"],
      missingData: [{ field: "lp_lock", impact: "high" }, { field: "holder_list", impact: "high" }],
      evidence: [{ label: "GoPlus", status: "unavailable", checkedAt: LATER, reliability: 0.2 }],
    }),
  ),
};

/** A snapshot on a different network, for the cross-network guard. */
export const crossNetworkRecord = buildRecord(
  "snapshot_cross-network",
  buildDocument({ generatedAt: LATER, network: "base" }),
);

/** A snapshot of a different asset on the same network. */
export const crossAssetRecord = buildRecord(
  "snapshot_cross-asset",
  buildDocument({
    generatedAt: LATER,
    symbol: "OTHER",
    canonicalId: "0x2222222222222222222222222222222222222222",
  }),
);

/** Already past its expiry, so the integrity gate must refuse it. */
export const expiredRecord = buildRecord(
  "snapshot_expired",
  buildDocument({ generatedAt: PAST, expiresAt: "2021-01-01T00:00:00.000Z" }),
);

/** Content mutated after hashing. */
export const tamperedRecord = buildRecord(
  "snapshot_tampered",
  buildDocument({ generatedAt: LATER }),
  { tamperSummary: "Rewritten after the hash was taken." },
);

/** Revoked by its creator. */
export const revokedRecord = buildRecord(
  "snapshot_revoked",
  buildDocument({ generatedAt: LATER }),
  { revokedAt: "2026-01-09T00:00:00.000Z" },
);

/** Valid, but carrying no evidence and no narrative items. */
export const emptyPair = {
  left: buildRecord("snapshot_empty-left", buildDocument({ generatedAt: EARLIER, topReasons: [], evidence: [], missingData: [] })),
  right: buildRecord("snapshot_empty-right", buildDocument({ generatedAt: LATER, topReasons: [], evidence: [], missingData: [] })),
};

export const ALL_RECORDS = [
  reorderedEquivalentPair.left,
  reorderedEquivalentPair.right,
  addedRemovedAmbiguousPair.left,
  addedRemovedAmbiguousPair.right,
  crossNetworkRecord,
  crossAssetRecord,
  expiredRecord,
  tamperedRecord,
  revokedRecord,
  emptyPair.left,
  emptyPair.right,
];
