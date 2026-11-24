/**
 * Browser-facing wrapper around the shared `packages/read-client` contract.
 *
 * Read endpoints go through the typed SDK so the UI and the documented API use
 * one set of validators. Mutations stay on `apiRequest` because the SDK is
 * deliberately read-only; both paths normalise errors to the same envelope.
 */
import {
  CompatibilityError,
  ReadClientError,
  createReadClient,
  parseErrorEnvelope,
  type AlertStatus,
  type ReadClient,
  type ReadOptions,
  type RecoveryAction,
} from "../../../packages/read-client/dist/client.js";

export type {
  AgentRunDetail,
  AlertDeliveryChannel,
  AlertDeliveryStatus,
  AlertHistory,
  AlertRecord,
  AlertSeverity,
  AlertStatus,
  DeliveryAuditRow,
  ReadOptions,
  RecoveryAction,
  Snapshot,
  SourceSnapshot,
  Watchlist,
  WatchlistEntry,
  WatchlistScanRun,
} from "../../../packages/read-client/dist/client.js";

export interface ApiClientError {
  kind: "http" | "transport" | "compatibility" | "configuration" | "client";
  code: string;
  message: string;
  retryable: boolean;
  recoveryAction: RecoveryAction;
  status?: number;
  requestId?: string;
}

let cachedClient: ReadClient | undefined;

export function getReadClient(): ReadClient {
  if (!cachedClient) {
    const origin = typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_ORIGIN;
    if (!origin) throw new ReadClientError("configuration", "A browser origin is required for read requests.");
    cachedClient = createReadClient({ baseUrl: origin, retries: 1, maxRetryDelayMs: 2000 });
  }
  return cachedClient;
}

function reads(options: ReadOptions = {}): ReadOptions {
  return { credentials: "same-origin", ...options };
}

export function listWatchlist(query: { walletAddress?: string } = {}, options: ReadOptions = {}) {
  return getReadClient().watchlist.list(query, reads(options));
}

export function listAlertHistory(
  query: { walletAddress?: string; status?: AlertStatus; limit?: number } = {},
  options: ReadOptions = {},
) {
  return getReadClient().alerts.history(query, reads(options));
}

export function listAlertDeliveries(query: { alertId?: string } = {}, options: ReadOptions = {}) {
  return getReadClient().alerts.deliveries(query, reads(options));
}

export async function getAgentRunSourceSnapshots(runId: string, options: ReadOptions = {}) {
  const detail = await getReadClient().history.agentRun(runId, reads(options));
  return detail.sourceSnapshots ?? [];
}

export function getRiskSnapshot(id: string, options: ReadOptions = {}) {
  return getReadClient().snapshots.get(id, reads(options)).then((result) => result.snapshot);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function errorFromResponse(status: number, body: unknown): ApiClientError {
  const envelope = parseErrorEnvelope(body);
  const retryable = envelope.retryable ?? [429, 502, 503, 504].includes(status);
  const recoveryAction = envelope.recoveryAction ?? (
    status === 401 || status === 403 ? "reconnect"
      : status === 429 ? "retry_after_delay"
      : retryable ? "retry" : "stop"
  );
  return {
    kind: "http",
    code: envelope.code ?? `http_${status}`,
    message: envelope.message ?? `Request failed (HTTP ${status}).`,
    retryable,
    recoveryAction,
    status,
    requestId: envelope.requestId,
  };
}

/** Shared non-GET helper: the read SDK never issues writes, but errors stay uniform. */
export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw errorFromResponse(response.status, body);
  return body as T;
}

export function toApiClientError(error: unknown): ApiClientError {
  if (error instanceof CompatibilityError) {
    return {
      kind: "compatibility", code: "compatibility_error", message: error.message,
      retryable: false, recoveryAction: "refresh_data",
    };
  }
  if (error instanceof ReadClientError) {
    return {
      kind: error.kind,
      code: error.code ?? `${error.kind}_error`,
      message: error.message,
      retryable: error.retryable,
      recoveryAction: error.recoveryAction ?? "stop",
      status: error.status,
      requestId: error.requestId,
    };
  }
  if (isApiClientError(error)) return error;
  if (error instanceof Error) {
    return {
      kind: "client", code: "client_error", message: error.message,
      retryable: false, recoveryAction: "stop",
    };
  }
  return {
    kind: "client", code: "unknown_error", message: "The request could not be completed.",
    retryable: false, recoveryAction: "stop",
  };
}

function isApiClientError(value: unknown): value is ApiClientError {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ApiClientError>;
  return typeof candidate.code === "string" && typeof candidate.retryable === "boolean"
    && typeof candidate.recoveryAction === "string";
}
