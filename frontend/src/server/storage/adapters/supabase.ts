import "server-only";

import { PostgresStorageAdapter } from "@/server/storage/postgresAdapter";
import { wrapStorageAdapter } from "@/server/observability/tracing/spans";

export class StorageInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageInitError";
  }
}

export class StorageError extends Error {
  constructor(
    public readonly operation: string,
    public readonly cause: unknown,
  ) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Supabase storage error [${operation}]: ${message}`);
    this.name = "StorageError";
  }
}

export class SupabaseStorageAdapter extends PostgresStorageAdapter {}

export function createTracedSupabaseStorageAdapter() {
  return wrapStorageAdapter(new SupabaseStorageAdapter());
}
