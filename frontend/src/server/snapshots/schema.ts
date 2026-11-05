import { z } from "zod";

export const RISK_SNAPSHOT_SCHEMA_VERSION = "1" as const;
export const SUPPORTED_RISK_SNAPSHOT_VERSIONS = new Set<string>([
  RISK_SNAPSHOT_SCHEMA_VERSION,
]);

const isoTimestampSchema = z.string().datetime({ offset: true });
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const riskSnapshotAssetSchema = z.object({
  chainFamily: z.enum(["evm", "stellar"]),
  network: boundedText(80),
  identity: z.object({
    kind: z.enum([
      "evm_contract",
      "stellar_native",
      "stellar_classic",
      "soroban_contract",
      "symbol",
    ]),
    canonicalId: boundedText(180),
    contractAddress: boundedText(100).optional(),
    assetCode: boundedText(32).optional(),
    issuer: boundedText(80).optional(),
  }),
  symbol: boundedText(32),
  name: boundedText(160).optional(),
});

export const riskSnapshotDocumentSchema = z.object({
  schemaVersion: z.literal(RISK_SNAPSHOT_SCHEMA_VERSION),
  asset: riskSnapshotAssetSchema,
  scores: z.object({
    buyRisk: z.number().finite().min(0).max(100),
    confidence: z.number().finite().min(0).max(1),
  }),
  verdict: z.enum([
    "buy_small",
    "watch",
    "avoid",
    "hold",
    "reduce_exposure",
    "manual_review",
  ]),
  summary: boundedText(2_000),
  topReasons: z.array(boundedText(500)).max(20),
  evidence: z.array(z.object({
    label: boundedText(120),
    status: z.enum(["connected", "unavailable"]),
    checkedAt: isoTimestampSchema.optional(),
    freshnessSeconds: z.number().finite().nonnegative().optional(),
    reliability: z.number().finite().min(0).max(1).optional(),
    url: z.string().url().max(500).optional(),
  })).max(100),
  missingData: z.array(z.object({
    field: boundedText(160),
    impact: z.enum(["low", "medium", "high"]),
  })).max(100),
  freshness: z.object({
    generatedAt: isoTimestampSchema,
    sourceCheckedAt: z.array(isoTimestampSchema).max(100),
    staleAt: isoTimestampSchema,
  }),
  expiresAt: isoTimestampSchema,
  product: z.object({
    name: z.literal("Cryptara"),
    version: boundedText(80),
  }),
  notices: z.object({
    informationOnly: z.literal(true),
    providerCorrectnessNotProven: z.literal(true),
  }),
}).strict();

export type RiskSnapshotDocument = z.infer<typeof riskSnapshotDocumentSchema>;
export type RiskSnapshotAsset = z.infer<typeof riskSnapshotAssetSchema>;

export type RiskSnapshotRecord = {
  id: string;
  schemaVersion: string;
  snapshot: RiskSnapshotDocument;
  canonicalHash: string;
  identityKey: string;
  revocationTokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
};

export type PublicRiskSnapshot = Omit<RiskSnapshotRecord, "revocationTokenHash" | "identityKey" | "snapshot"> & {
  document: RiskSnapshotDocument;
};

export function parseRiskSnapshotDocument(value: unknown): RiskSnapshotDocument {
  return riskSnapshotDocumentSchema.parse(value);
}
