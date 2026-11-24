// Audit-bundle export verification.
//
// Proves the privacy invariants hold at the module level:
//   1. Redaction removes raw wallet/balance/strategy/payload/secret/XDR values.
//   2. The canonical hash is stable and any material change fails verification.
//   3. Unknown versions fail closed.
//   4. No raw wallet identifier appears anywhere in the serialized bundle.
//
// Exits non-zero on any violation so CI can block a privacy regression.

import {
  buildAuditBundle,
  buildAuditBundleHash,
  type AuditBundle,
} from "@/server/privacy/auditBundle";
import { redactApproval, redactDecision, redactTransaction } from "@/server/privacy/auditRedaction";
import { verifyAuditBundle } from "@/server/privacy/auditVerify";
import type { RecommendationRecord, TransactionRecord, UserApprovalRecord } from "@/server/types";
import { AUDIT_CSV_HEADERS, auditBundleToCsv, escapeCsvValue } from "@/lib/audit/auditCsv";

function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

const WALLET = "0x1111111111111111111111111111111111111111";

function sampleRecords() {
  const decision: RecommendationRecord = {
    id: "rec_1",
    walletAddress: WALLET,
    action: "reduce_exposure",
    decisionScore: 82,
    confidence: 0.9,
    summary: "Reduce exposure to volatile asset.",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  const approval: UserApprovalRecord = {
    id: "approval_1",
    walletAddress: WALLET,
    decisionId: "rec_1",
    txHash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    network: "goat",
    action: "reduce_exposure",
    status: "confirmed",
    autoExecuted: false,
    createdAt: "2026-08-01T00:01:00.000Z",
  };
  const transaction: TransactionRecord = {
    hash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    type: "swap",
    asset: "ETH",
    valueUsd: 100,
    status: "confirmed",
    lifecycleStatus: "confirmed",
    chainFamily: "evm",
    createdAt: "2026-08-01T00:01:00.000Z",
    network: "goat",
    walletAddress: WALLET,
    sourceAccount: WALLET,
    calldata: "0x0000000000000000000000000000000000000000000000000000000000000000",
    stellarDetails: { envelopeXdr: "AAAAAg==", resultXdr: "AAAAAw==" },
  };
  return { decision, approval, transaction };
}

function main(): void {
  const { decision, approval, transaction } = sampleRecords();

  const bundle = buildAuditBundle({
    walletAddress: WALLET,
    chainFamily: "evm",
    network: "goat",
    productVersion: "0.1.0",
    decisions: [decision],
    approvals: [approval],
    transactions: [transaction],
    redact: { decision: redactDecision, approval: redactApproval, transaction: redactTransaction },
  });

  const hash = buildAuditBundleHash(bundle);
  const serialized = JSON.stringify(bundle);

  const failures: string[] = [];

  // 1. No raw identifier or sensitive value leaks into the bundle.
  const forbidden = [WALLET, transaction.calldata!, transaction.stellarDetails!.envelopeXdr!, transaction.stellarDetails!.resultXdr!];
  for (const value of forbidden) {
    if (value && serialized.includes(value)) {
      failures.push(`raw sensitive value leaked into bundle: ${value.slice(0, 24)}…`);
    }
  }

  // 2. Stable hash: rebuilding yields the same hash.
  if (buildAuditBundleHash(bundle) !== hash) {
    failures.push("canonical hash is not stable across rebuilds");
  }

  // 3. Verification passes on an intact bundle.
  const verified = verifyAuditBundle(bundle, hash);
  if (!verified.valid) {
    failures.push(`intact bundle failed verification: ${JSON.stringify(verified.issues)}`);
  }

  // 4. Tampering fails verification.
  const tampered: AuditBundle = JSON.parse(serialized);
  tampered.transactions[0].valueUsd = 999;
  const tamperResult = verifyAuditBundle(tampered, hash);
  if (tamperResult.valid) {
    failures.push("tampered bundle incorrectly verified as valid");
  }

  // 5. Unknown version fails closed.
  const unknownVersion = { ...bundle, version: 999 } as AuditBundle;
  const versionResult = verifyAuditBundle(unknownVersion);
  if (versionResult.valid) {
    failures.push("unknown bundle version did not fail closed");
  }

  // 6. CSV export format: stable header, one row per redacted record, integrity anchor.
  const csv = auditBundleToCsv(bundle, hash);
  const csvLines = csv.trimEnd().split("\r\n");
  const expectedRows = bundle.decisions.length + bundle.approvals.length + bundle.transactions.length;
  if (csvLines[0] !== AUDIT_CSV_HEADERS.join(",")) {
    failures.push("CSV header does not match the documented format");
  }
  if (csvLines.length !== expectedRows + 1) {
    failures.push(`CSV row count ${csvLines.length - 1} does not match ${expectedRows}`);
  }
  for (const [index, line] of csvLines.slice(1).entries()) {
    const fields = parseCsvRow(line);
    if (fields.length !== AUDIT_CSV_HEADERS.length) {
      failures.push(`CSV row ${index + 1} has ${fields.length} fields, expected ${AUDIT_CSV_HEADERS.length}`);
    }
    if (fields[13] !== hash) failures.push(`CSV row ${index + 1} is missing the bundle hash`);
    if (fields[14] !== "redacted") failures.push(`CSV row ${index + 1} is not marked redacted`);
  }
  for (const value of forbidden) {
    if (value && csv.includes(value)) {
      failures.push(`raw sensitive value leaked into CSV: ${value.slice(0, 24)}…`);
    }
  }

  // 7. CSV field escaping must survive commas and quotes verbatim.
  const special = 'summary, with "quotes"';
  if (escapeCsvValue(special) !== '"summary, with ""quotes"""') {
    failures.push("CSV field escaping is not RFC 4180 compliant");
  }
  const escapedBundle: AuditBundle = {
    ...bundle,
    decisions: [{ ...bundle.decisions[0], summary: special }],
  };
  if (!auditBundleToCsv(escapedBundle, hash).includes('"summary, with ""quotes"""')) {
    failures.push("CSV export did not preserve an escaped summary field");
  }

  if (failures.length > 0) {
    console.error("\nAudit-bundle export verification failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Audit-bundle export verification passed (hash ${hash.slice(0, 12)}…).`);
  console.log(`  decisions=${bundle.decisions.length} approvals=${bundle.approvals.length} transactions=${bundle.transactions.length} csvRows=${expectedRows}`);
}

main();
