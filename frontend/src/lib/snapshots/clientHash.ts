/**
 * Client-side verification helpers for risk snapshots.
 *
 * Uses the Web Crypto API (`crypto.subtle.digest`) so a viewer can recompute the
 * canonical SHA-256 hash of the document rendered on the snapshot page and
 * compare it with the hash stored server-side (and published to the registry)
 * without sending the document anywhere else.
 */

import type { RiskSnapshotDocument } from "@/server/snapshots/schema";
import { canonicalizeJson } from "./canonicalJson";
import { normalizeRiskSnapshotShape } from "./normalizeRiskSnapshot";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex digest of UTF-8 text using Web Crypto. */
export async function sha256Text(value: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle === "undefined") {
    throw new Error("Web Crypto is unavailable in this browser context.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Recompute the `sha256:<hex>` canonical hash of an already-normalized risk
 * snapshot document. Parity with `hashRiskSnapshot` is covered by
 * `scripts/risk-snapshot-check.ts`.
 */
export async function hashRiskSnapshotInBrowser(document: unknown): Promise<string> {
  let preimage: string;
  try {
    preimage = canonicalizeJson(normalizeRiskSnapshotShape(document as RiskSnapshotDocument));
  } catch {
    // A malformed document still gets a digest so the UI can report a mismatch.
    preimage = canonicalizeJson(document);
  }
  return `sha256:${await sha256Text(preimage)}`;
}
