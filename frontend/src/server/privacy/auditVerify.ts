/**
 * Local verification for the audit bundle. Recomputes the canonical hash and
 * checks structural invariants so a downloaded bundle can be independently
 * validated (e.g. by a reviewer) without trusting the exporter.
 */

import { createHmac, createPublicKey, verify as verifySignature } from "node:crypto";

import {
  AUDIT_BUNDLE_VERSION,
  buildAuditBundleHash,
  type AuditBundle,
  type AuditBundleSignature,
} from "./auditBundle";

export interface AuditVerificationIssue {
  code:
    | "unsupported_version"
    | "hash_mismatch"
    | "invalid_scope"
    | "invalid_section"
    | "manifest_mismatch"
    | "signature_missing"
    | "signature_invalid"
    | "signature_unsupported";
  detail: string;
}

export interface AuditVerificationResult {
  valid: boolean;
  issues: AuditVerificationIssue[];
  computedHash: string;
}

export interface AuditVerificationOptions {
  /** Expected canonical bundle hash (from the manifest or an out-of-band source). */
  expectedHash?: string;
  /** Shared secret used to verify a detached HMAC-SHA256 signature. */
  hmacSecret?: string;
  /** PEM-encoded Ed25519 public key used to verify a detached signature. */
  ed25519PublicKey?: string;
}

const HEX64 = /^[0-9a-f]{64}$/;

function verifyDetachedSignature(
  signature: AuditBundleSignature,
  payload: string,
  options: AuditVerificationOptions,
): AuditVerificationIssue | null {
  if (signature.algorithm === "hmac-sha256") {
    if (!options.hmacSecret) {
      return {
        code: "signature_missing",
        detail: "Bundle is HMAC-signed but no hmacSecret was provided for verification.",
      };
    }
    const expected = createHmac("sha256", options.hmacSecret).update(payload).digest("hex");
    if (expected !== signature.value) {
      return {
        code: "signature_invalid",
        detail: "HMAC signature does not match the bundle manifest — content was tampered with.",
      };
    }
    return null;
  }

  if (signature.algorithm === "ed25519") {
    if (!options.ed25519PublicKey) {
      return {
        code: "signature_missing",
        detail: "Bundle is Ed25519-signed but no ed25519PublicKey was provided for verification.",
      };
    }
    try {
      const key = createPublicKey(options.ed25519PublicKey);
      const ok = verifySignature(
        null,
        Buffer.from(payload, "utf8"),
        key,
        Buffer.from(signature.value, "base64"),
      );
      if (!ok) {
        return {
          code: "signature_invalid",
          detail: "Ed25519 signature does not match the bundle manifest — content was tampered with.",
        };
      }
      return null;
    } catch {
      return {
        code: "signature_invalid",
        detail: "Ed25519 signature could not be verified with the provided public key.",
      };
    }
  }

  return {
    code: "signature_unsupported",
    detail: `Unsupported signature algorithm ${String((signature as { algorithm?: unknown }).algorithm)}.`,
  };
}

/** Verify a bundle against an expected hash. Unknown versions fail closed. */
export function verifyAuditBundle(
  bundle: AuditBundle,
  expectedHashOrOptions?: string | AuditVerificationOptions,
): AuditVerificationResult {
  const options: AuditVerificationOptions =
    typeof expectedHashOrOptions === "string"
      ? { expectedHash: expectedHashOrOptions }
      : expectedHashOrOptions ?? {};

  const issues: AuditVerificationIssue[] = [];

  if (bundle.version !== AUDIT_BUNDLE_VERSION) {
    issues.push({
      code: "unsupported_version",
      detail: `Unsupported bundle version ${String(bundle.version)} (expected ${AUDIT_BUNDLE_VERSION}).`,
    });
  }

  const walletHash = bundle.scope?.walletHash ?? "";
  if (!HEX64.test(walletHash)) {
    issues.push({
      code: "invalid_scope",
      detail: "Bundle scope must contain a 64-char hex wallet hash.",
    });
  }

  if (!Array.isArray(bundle.decisions) || !Array.isArray(bundle.approvals) || !Array.isArray(bundle.transactions)) {
    issues.push({
      code: "invalid_section",
      detail: "Bundle must contain decisions, approvals, and transactions arrays.",
    });
  }

  const computedHash = buildAuditBundleHash(bundle);

  const manifest = bundle.manifest;
  if (manifest) {
    if (!HEX64.test(manifest.hash) || manifest.hash !== computedHash) {
      issues.push({
        code: "manifest_mismatch",
        detail: "Bundle manifest hash does not match the recomputed content hash — content changed or was tampered with.",
      });
    }
  }

  const expectedHash = options.expectedHash ?? manifest?.hash;
  if (expectedHash && expectedHash !== computedHash) {
    issues.push({
      code: "hash_mismatch",
      detail: "Bundle hash does not match the expected value — content changed or was tampered with.",
    });
  }

  if (bundle.signature) {
    const signatureIssue = verifyDetachedSignature(bundle.signature, computedHash, options);
    if (signatureIssue) {
      issues.push(signatureIssue);
    }
  }

  return { valid: issues.length === 0, issues, computedHash };
}
