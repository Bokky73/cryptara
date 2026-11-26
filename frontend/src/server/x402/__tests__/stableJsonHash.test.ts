/**
 * Tests for issue #28 — stableJsonHash recursive canonical key sorting.
 *
 * Before the fix, `stableJsonHash` used `JSON.stringify(value, sortedTopLevelKeys)`
 * which silently stripped every nested property whose key was not present at the
 * top level, allowing two completely different nested payloads to hash identically.
 *
 * After the fix, the function delegates to `canonicalizeJson` from
 * `@/lib/snapshots/canonicalJson`, which sorts keys at every nesting depth
 * while preserving array order and handling primitives/nulls safely.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { stableJsonHash } from "@/server/x402/guards";

function sha256(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

describe("stableJsonHash — issue #28 regression suite", () => {
  // -------------------------------------------------------------------------
  // Core invariant: nested key reordering must NOT change the hash
  // -------------------------------------------------------------------------
  it("produces the same hash regardless of top-level key insertion order", () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { a: 2, m: 3, z: 1 };
    expect(stableJsonHash(a)).toBe(stableJsonHash(b));
  });

  it("produces the same hash regardless of nested key insertion order", () => {
    const a = { target: { chain: "evm", address: "0xABC" }, options: { depth: 2, verbose: false } };
    const b = { options: { verbose: false, depth: 2 }, target: { address: "0xABC", chain: "evm" } };
    expect(stableJsonHash(a)).toBe(stableJsonHash(b));
  });

  it("produces the same hash for deeply nested objects with reordered keys", () => {
    const a = { level1: { level2: { level3: { z: "last", a: "first" } } } };
    const b = { level1: { level2: { level3: { a: "first", z: "last" } } } };
    expect(stableJsonHash(a)).toBe(stableJsonHash(b));
  });

  // -------------------------------------------------------------------------
  // Mutation sensitivity: any value change must produce a different hash
  // -------------------------------------------------------------------------
  it("produces different hashes when a top-level value changes", () => {
    const a = { amount: "1.00", recipient: "0xAAA" };
    const b = { amount: "2.00", recipient: "0xAAA" };
    expect(stableJsonHash(a)).not.toBe(stableJsonHash(b));
  });

  it("produces different hashes when a nested value changes", () => {
    const a = { target: { address: "0xAAA", chain: "evm" }, options: { depth: 1 } };
    const b = { target: { address: "0xBBB", chain: "evm" }, options: { depth: 1 } };
    expect(stableJsonHash(a)).not.toBe(stableJsonHash(b));
  });

  it("produces different hashes when a deeply nested value changes", () => {
    const a = { x: { y: { z: 42 } } };
    const b = { x: { y: { z: 43 } } };
    expect(stableJsonHash(a)).not.toBe(stableJsonHash(b));
  });

  // -------------------------------------------------------------------------
  // Regression: the old whitelist-replacer bug
  //
  // With the broken implementation:
  //   JSON.stringify({a:1}, ["a"])  => '{"a":1}'         (top-level key kept)
  //   JSON.stringify({nested:{b:2}}, ["nested"]) => '{"nested":{}}'
  //     — `b` is stripped because it's not in the top-level key list
  //
  // These two assertions directly demonstrate the old bug was present and
  // that the fix closes it.
  // -------------------------------------------------------------------------
  it("does not strip nested object properties (old whitelist-replacer regression)", () => {
    const payload = { target: { address: "0xDEAD", chain: "base" }, options: { depth: 3 } };
    const h = stableJsonHash(payload);

    // Modify only the nested `address` — hash must differ.
    const mutated = { target: { address: "0xBEEF", chain: "base" }, options: { depth: 3 } };
    expect(stableJsonHash(mutated)).not.toBe(h);
  });

  it("two payloads where the ONLY difference is a nested value must hash differently", () => {
    // Before the fix both hashed to the same digest because the nested
    // `options` object was serialized as `{}` after the whitelist stripping.
    const a = { scan: { type: "full" }, options: { maxAge: 60 } };
    const b = { scan: { type: "full" }, options: { maxAge: 999 } };
    expect(stableJsonHash(a)).not.toBe(stableJsonHash(b));
  });

  // -------------------------------------------------------------------------
  // Array order preservation
  // -------------------------------------------------------------------------
  it("preserves array element order (different order → different hash)", () => {
    const a = { tokens: ["USDC", "ETH", "DAI"] };
    const b = { tokens: ["DAI", "ETH", "USDC"] };
    expect(stableJsonHash(a)).not.toBe(stableJsonHash(b));
  });

  it("produces the same hash for identical arrays regardless of surrounding key order", () => {
    const a = { z: [1, 2, 3], a: "x" };
    const b = { a: "x", z: [1, 2, 3] };
    expect(stableJsonHash(a)).toBe(stableJsonHash(b));
  });

  it("handles arrays of objects, sorting nested object keys", () => {
    const a = { items: [{ z: 1, a: 2 }, { m: 3, b: 4 }] };
    const b = { items: [{ a: 2, z: 1 }, { b: 4, m: 3 }] };
    expect(stableJsonHash(a)).toBe(stableJsonHash(b));
  });

  // -------------------------------------------------------------------------
  // Null, boolean, number, and string primitives
  // -------------------------------------------------------------------------
  it("handles null values", () => {
    expect(stableJsonHash(null)).toBe(stableJsonHash(null));
    expect(stableJsonHash({ a: null })).toBe(stableJsonHash({ a: null }));
    expect(stableJsonHash({ a: null })).not.toBe(stableJsonHash({ a: 0 }));
  });

  it("handles boolean values", () => {
    expect(stableJsonHash(true)).toBe(stableJsonHash(true));
    expect(stableJsonHash(false)).not.toBe(stableJsonHash(true));
    expect(stableJsonHash({ flag: true })).toBe(stableJsonHash({ flag: true }));
    expect(stableJsonHash({ flag: true })).not.toBe(stableJsonHash({ flag: false }));
  });

  it("handles number values", () => {
    expect(stableJsonHash(42)).toBe(stableJsonHash(42));
    expect(stableJsonHash(42)).not.toBe(stableJsonHash(43));
  });

  it("handles string primitives", () => {
    expect(stableJsonHash("hello")).toBe(stableJsonHash("hello"));
    expect(stableJsonHash("hello")).not.toBe(stableJsonHash("world"));
  });

  // -------------------------------------------------------------------------
  // Stability: same input always produces the same hash
  // -------------------------------------------------------------------------
  it("is deterministic across multiple calls with the same input", () => {
    const payload = {
      target: { address: "0x1234567890abcdef1234567890abcdef12345678", chain: "eip155:1" },
      options: { depth: 5, maxResults: 100, includeMetadata: true },
    };
    const h1 = stableJsonHash(payload);
    const h2 = stableJsonHash(payload);
    const h3 = stableJsonHash(payload);
    expect(h1).toBe(h2);
    expect(h2).toBe(h3);
  });

  // -------------------------------------------------------------------------
  // Output format: 64-hex-char SHA-256
  // -------------------------------------------------------------------------
  it("returns a 64-character lowercase hex string", () => {
    const h = stableJsonHash({ test: true });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the SHA-256 of the canonical JSON serialization", () => {
    // Canonical form: keys sorted, no extra whitespace.
    const canonical = '{"a":1,"z":2}';
    const expected = sha256(canonical);
    // Both insertion orders must produce a hash equal to sha256 of sorted JSON.
    expect(stableJsonHash({ a: 1, z: 2 })).toBe(expected);
    expect(stableJsonHash({ z: 2, a: 1 })).toBe(expected);
  });
});
