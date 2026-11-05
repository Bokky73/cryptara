import { createHash } from "node:crypto";

/** A clock and seed are injected so replay never depends on wall time or randomness. */
export type DeterministicContext = {
  now: () => number;
  seed: string;
};

export function createDeterministicContext(seed: string, now = 0): DeterministicContext {
  const normalizedSeed = seed.trim() || "cryptara";
  return { now: () => now, seed: normalizedSeed };
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function deterministicHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function stableSort<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => key(left).localeCompare(key(right)));
}
