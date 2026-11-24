/**
 * Browser-safe canonical JSON serialization for risk snapshots.
 *
 * This module is shared by `server/snapshots/canonical.ts` (Node hashing) and
 * the client-side Web Crypto verifier so both sides serialize identical bytes.
 * It must never import server-only APIs.
 */

export function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeJson(value: unknown): unknown {
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Snapshot numbers must be finite.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, item]) => [key.normalize("NFC"), normalizeJson(item)]),
    );
  }
  throw new TypeError(`Unsupported snapshot value: ${typeof value}`);
}

/** Deterministic UTF-8 JSON text used as the preimage of the canonical hash. */
export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}
