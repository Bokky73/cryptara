import type { AgentMissingData, AgentSource, RiskReport, TokenScanResult } from "@/server/types";
import {
  RISK_SNAPSHOT_SCHEMA_VERSION,
  parseRiskSnapshotDocument,
  type RiskSnapshotAsset,
  type RiskSnapshotDocument,
} from "./schema";

const SENSITIVE_KEY = /(wallet|balance|strategy|rule|transaction|plan|note|secret|authorization|payer|private|api.?key|user(?:id|name|email)?|internal(?:id|identifier))/i;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const STELLAR_KEY = /^[GC][A-Z2-7]{55}$/;

export class RiskSnapshotInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RiskSnapshotInputError";
  }
}

function validTimestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new RiskSnapshotInputError(`${label} must be an ISO-8601 timestamp.`);
  }
  return new Date(value).toISOString();
}

function safeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function collectSensitiveValues(value: unknown, parentKey = "", output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSensitiveValues(item, parentKey, output));
    return output;
  }
  if (!value || typeof value !== "object") {
    if (SENSITIVE_KEY.test(parentKey) && typeof value === "string" && value.length >= 4) output.add(value);
    return output;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    collectSensitiveValues(item, key, output);
  }
  return output;
}

function scrubText(value: string, sensitiveValues: Set<string>): string {
  let scrubbed = value;
  for (const secret of [...sensitiveValues].sort((a, b) => b.length - a.length)) {
    scrubbed = scrubbed.split(secret).join("[redacted]");
  }
  return scrubbed
    .replace(/0x[0-9a-fA-F]{40,64}/g, "[redacted address]")
    .replace(/\b[GMC][A-Z2-7]{55}\b/g, "[redacted address]")
    .trim();
}

function buildAsset(scan: TokenScanResult, report?: RiskReport): RiskSnapshotAsset {
  const input = report?.input ?? scan.normalizedInput;
  const network = (input?.chain ?? scan.chain).trim().toLowerCase();
  const symbol = (report?.symbol ?? scan.symbol).trim().toUpperCase();
  const contractAddress = input?.contractAddress ?? (scan.tokenAddress || undefined);
  const assetKey = input?.assetKey;
  const issuer = input?.issuer;
  const assetType = input?.assetType;
  const stellar = network.includes("stellar") || Boolean(issuer) || Boolean(assetKey) || STELLAR_KEY.test(contractAddress ?? "");

  if (stellar) {
    if (assetType === "native" || symbol === "XLM") {
      return { chainFamily: "stellar", network, symbol, name: report?.tokenName, identity: { kind: "stellar_native", canonicalId: "XLM", assetCode: "XLM" } };
    }
    if (assetType === "contract" || assetType === "sac" || assetType === "sep41" || contractAddress?.startsWith("C")) {
      const canonicalId = contractAddress ?? assetKey;
      if (!canonicalId) throw new RiskSnapshotInputError("Soroban snapshots require a contract identity.");
      return { chainFamily: "stellar", network, symbol, name: report?.tokenName, identity: { kind: "soroban_contract", canonicalId, contractAddress: canonicalId } };
    }
    if (issuer) {
      const assetCode = symbol;
      return { chainFamily: "stellar", network, symbol, name: report?.tokenName, identity: { kind: "stellar_classic", canonicalId: `${assetCode}:${issuer}`, assetCode, issuer } };
    }
  }

  if (contractAddress && EVM_ADDRESS.test(contractAddress)) {
    return { chainFamily: "evm", network, symbol, name: report?.tokenName, identity: { kind: "evm_contract", canonicalId: contractAddress, contractAddress } };
  }

  if (!symbol) throw new RiskSnapshotInputError("Snapshot asset identity is unresolved.");
  return { chainFamily: stellar ? "stellar" : "evm", network, symbol, name: report?.tokenName, identity: { kind: "symbol", canonicalId: symbol } };
}

function publicEvidence(sources: AgentSource[] | TokenScanResult["sources"] | undefined) {
  return (sources ?? []).map((source) => {
    const detailed = source as AgentSource;
    return {
      label: source.label,
      status: source.status === "connected" ? "connected" as const : "unavailable" as const,
      checkedAt: detailed.checkedAt && Number.isFinite(Date.parse(detailed.checkedAt)) ? new Date(detailed.checkedAt).toISOString() : undefined,
      freshnessSeconds: detailed.cache?.freshnessSeconds,
      reliability: detailed.reliability,
      url: safeUrl(detailed.url),
    };
  });
}

function publicMissingData(items: AgentMissingData[] | undefined) {
  return (items ?? []).map(({ field, impact }) => ({ field, impact }));
}

export function redactRiskReportSnapshot(
  value: unknown,
  options: { expiresAt: string; productVersion?: string },
): RiskSnapshotDocument {
  if (!value || typeof value !== "object") throw new RiskSnapshotInputError("Risk snapshot input must be an object.");
  const scan = value as TokenScanResult;
  if (typeof scan.symbol !== "string" || typeof scan.chain !== "string") {
    throw new RiskSnapshotInputError("Risk snapshot input is missing asset identity.");
  }
  const report = scan.riskReport;
  const generatedAt = validTimestamp(report?.createdAt ?? scan.scannedAt, "generatedAt");
  const expiresAt = validTimestamp(options.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) <= Date.parse(generatedAt)) {
    throw new RiskSnapshotInputError("expiresAt must be after the report generation time.");
  }

  const sensitiveValues = collectSensitiveValues(value);
  const evidence = publicEvidence(report?.sources ?? scan.sources);
  const checkedTimes = evidence.flatMap((item) => item.checkedAt ? [item.checkedAt] : []);
  const sourceStaleTimes = evidence.flatMap((item) => item.checkedAt
    ? [Date.parse(item.checkedAt) + Math.max(300, item.freshnessSeconds ?? 900) * 1_000]
    : []);
  const staleAt = new Date(sourceStaleTimes.length
    ? Math.min(...sourceStaleTimes)
    : Date.parse(generatedAt) + 15 * 60 * 1_000).toISOString();
  const summary = scrubText(report?.summary ?? scan.summary ?? "Risk report snapshot", sensitiveValues) || "Risk report snapshot";
  const reasons = (report?.topReasons ?? scan.reasons ?? []).map((reason) => scrubText(reason, sensitiveValues)).filter(Boolean);

  const document = parseRiskSnapshotDocument({
    schemaVersion: RISK_SNAPSHOT_SCHEMA_VERSION,
    asset: buildAsset(scan, report),
    scores: {
      buyRisk: report?.buyRisk ?? scan.overallRiskScore,
      confidence: report?.confidence ?? scan.dataQuality?.reliability ?? 0,
    },
    verdict: report?.verdict ?? (scan.verdict === "safe" ? "buy_small" : scan.verdict === "watch" ? "watch" : "avoid"),
    summary,
    topReasons: reasons,
    evidence,
    missingData: publicMissingData(report?.missingData),
    freshness: { generatedAt, sourceCheckedAt: checkedTimes, staleAt },
    expiresAt,
    product: { name: "Cryptara", version: options.productVersion?.trim() || "unknown" },
    notices: { informationOnly: true, providerCorrectnessNotProven: true },
  });

  assertPrivacySafeSnapshot(document, sensitiveValues);
  return document;
}

export function assertPrivacySafeSnapshot(value: unknown, forbiddenValues: Iterable<string> = []): void {
  const visit = (item: unknown, key = "") => {
    if (SENSITIVE_KEY.test(key)) throw new RiskSnapshotInputError(`Sensitive key reached public snapshot: ${key}`);
    if (Array.isArray(item)) return item.forEach((child) => visit(child, key));
    if (item && typeof item === "object") {
      return Object.entries(item as Record<string, unknown>).forEach(([childKey, child]) => visit(child, childKey));
    }
  };
  visit(value);
  const serialized = JSON.stringify(value);
  for (const forbidden of forbiddenValues) {
    if (forbidden.length >= 4 && serialized.includes(forbidden)) {
      throw new RiskSnapshotInputError("Sensitive source value reached the public snapshot.");
    }
  }
}
