import "server-only";

import { MemoryStorageAdapter } from "./memory";
import { getPostgresStorageAdapter, resolveConnectionString } from "../postgresAdapter";
import type { IStorageAdapter } from "./types";

type StorageMode = "memory" | "postgres";

const persistentStorageModes = new Set(["postgres", "supabase", "supabase_postgres"]);

type StorageGlobal = typeof globalThis & {
  __cryptaraStorageAdapter?: IStorageAdapter;
  __cryptaraStorageMode?: StorageMode;
};

const storageGlobal = globalThis as StorageGlobal;

export function isLiveStorageRequired(): boolean {
  const appMode = process.env.APP_MODE?.trim().toLowerCase();
  return (
    process.env.NODE_ENV === "production" ||
    appMode === "live" ||
    appMode === "production"
  );
}

function resolveStorageMode(): StorageMode {
  const requested = process.env.CRYPTARA_STORAGE_ADAPTER?.trim().toLowerCase();
  const requiresPersistentStorage = isLiveStorageRequired();

  if (requested === "memory") {
    if (requiresPersistentStorage) {
      throw new Error("In-memory storage is not allowed in live mode. Configure a Postgres connection or unset CRYPTARA_STORAGE_ADAPTER=memory.");
    }
    return "memory";
  }
  if (requested && persistentStorageModes.has(requested)) {
    if (!resolveConnectionString()) {
      throw new Error(`CRYPTARA_STORAGE_ADAPTER=${requested} requires SUPABASE_DB_URL, POSTGRES_URL, or DATABASE_URL.`);
    }
    return "postgres";
  }
  if (requested && requested !== "auto") {
    throw new Error(`Unsupported CRYPTARA_STORAGE_ADAPTER value: ${requested}`);
  }
  if (resolveConnectionString()) return "postgres";
  if (requiresPersistentStorage) {
    throw new Error("Persistent storage is required in live mode. Set SUPABASE_DB_URL, POSTGRES_URL, or DATABASE_URL.");
  }
  return "memory";
}

export function getStorageMode(): StorageMode {
  if (!storageGlobal.__cryptaraStorageMode) {
    getStorageAdapter();
  }
  return storageGlobal.__cryptaraStorageMode ?? "memory";
}

export function getStorageAdapter(): IStorageAdapter {
  if (!storageGlobal.__cryptaraStorageAdapter) {
    storageGlobal.__cryptaraStorageMode = resolveStorageMode();
    storageGlobal.__cryptaraStorageAdapter =
      storageGlobal.__cryptaraStorageMode === "postgres"
        ? getPostgresStorageAdapter()
        : new MemoryStorageAdapter();
  }
  return storageGlobal.__cryptaraStorageAdapter;
}

export function isPersistentStorage(): boolean {
  return getStorageAdapter().persistent;
}

export async function assertStorageReady(): Promise<void> {
  const adapter = getStorageAdapter();
  const health = await adapter.getStorageHealth();
  if ((adapter.persistent || isLiveStorageRequired()) && !health.persistent) {
    throw new Error(`Persistent storage is required but unavailable: ${health.detail}`);
  }
}

export function resetStorageAdapterForTests(): void {
  delete storageGlobal.__cryptaraStorageAdapter;
  delete storageGlobal.__cryptaraStorageMode;
}
