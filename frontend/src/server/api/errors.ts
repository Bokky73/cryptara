import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { getCorrelationId } from "@/server/observability/logger/context";
import { getActiveTraceId } from "@/server/observability/tracing/spans";

export type ApiErrorCode =
  | "validation_error"
  | "auth_error"
  | "rate_limited"
  | "provider_timeout"
  | "stale_data"
  | "network_mismatch"
  | "wallet_rejection"
  | "payment_failure"
  | "simulation_failure"
  | "submission_failure"
  | "internal_error"
  // Legacy or provider-specific codes to preserve compatibility
  | "chain_family_mismatch"
  | "invalid_wallet"
  | "invalid_source"
  | "source_wallet_mismatch"
  | "approval_required"
  | "hash_chain_family_mismatch"
  | "network_chain_family_mismatch"
  | "transaction_not_found"
  | "submit_failed"
  | "stellar_disabled"
  | "invalid_payment_proof"
  | "payment_proof_rejected"
  | "duplicate_payment"
  | "expected_effects_mismatch"
  | "incident_mode"
  | "feature_disabled"
  | "not_found"
  | "wallet_session_disabled"
  | "receipt_not_found"
  | "receipt_mismatch"
  | "receipt_expired";

export type RecoveryAction =
  | "retry"
  | "reconnect"
  | "switch_network"
  | "refresh_data"
  | "stop";

export interface ApiErrorShape {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
  recoveryAction: RecoveryAction;
  requestId: string;
  traceId?: string;
  details?: unknown;
}

export const commonErrorCodes: Record<string, ApiErrorCode> = {
  validationError: "validation_error",
  authError: "auth_error",
  rateLimited: "rate_limited",
  providerTimeout: "provider_timeout",
  staleData: "stale_data",
  networkMismatch: "network_mismatch",
  walletRejection: "wallet_rejection",
  paymentFailure: "payment_failure",
  simulationFailure: "simulation_failure",
  submissionFailure: "submission_failure",
  internalError: "internal_error",
};

const RETRYABLE_CODES: ReadonlySet<ApiErrorCode> = new Set([
  "rate_limited",
  "provider_timeout",
  "stale_data",
  "internal_error",
]);

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly recoveryAction: RecoveryAction;
  readonly details?: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    options?: { retryable?: boolean; recoveryAction?: RecoveryAction; details?: unknown },
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = options?.retryable ?? RETRYABLE_CODES.has(code);
    this.recoveryAction = options?.recoveryAction ?? (this.retryable ? "retry" : "stop");
    this.details = options?.details;
    
    if (!this.retryable && this.recoveryAction === "retry") {
      this.recoveryAction = "stop";
    }
  }
}

let requestCounter = 0;

export function createRequestId(prefix = "req"): string {
  requestCounter = (requestCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}_${Date.now().toString(36)}_${requestCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function toErrorShape(error: ApiError, requestId: string = createRequestId()): ApiErrorShape {
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    recoveryAction: error.recoveryAction,
    requestId,
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}

export interface JsonErrorInput {
  code: ApiErrorCode;
  message: string;
  status: number;
  retryable?: boolean;
  recoveryAction?: RecoveryAction;
  details?: unknown;
}

export interface JsonErrorOptions {
  requestId?: string;
  legacy?: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface LegacyJsonErrorOptions extends JsonErrorOptions {
  status?: number;
  message?: string;
  details?: unknown;
}

export function jsonError(input: ApiError | JsonErrorInput, options?: JsonErrorOptions): NextResponse;
export function jsonError(
  code: string,
  messageOrOptions?: string | Record<string, unknown>,
  options?: LegacyJsonErrorOptions,
): NextResponse;
export function jsonError(
  input: ApiError | JsonErrorInput | string,
  messageOrOptions?: string | JsonErrorOptions | LegacyJsonErrorOptions | Record<string, unknown>,
  options?: LegacyJsonErrorOptions,
): NextResponse {
  let normalizedInput: ApiError | JsonErrorInput;
  let normalizedOptions: JsonErrorOptions | undefined = options;

  if (typeof input === "string") {
    const messageObject = typeof messageOrOptions === "string" ? undefined : (messageOrOptions as Record<string, unknown>);
    const details =
      options?.details ??
      messageObject?.details ??
      (messageObject && !("message" in messageObject) && !("status" in messageObject)
        ? messageObject
        : undefined);
    normalizedInput = {
      code: input as ApiErrorCode,
      message:
        typeof messageOrOptions === "string"
          ? messageOrOptions
          : typeof messageObject?.message === "string"
            ? messageObject.message
            : "Request failed",
      status: options?.status ?? (typeof messageObject?.status === "number" ? messageObject.status : 400),
      details,
    };
    normalizedOptions = {
      ...options,
      requestId: options?.requestId ?? (typeof messageObject?.requestId === "string" ? messageObject.requestId : undefined),
    };
  } else {
    normalizedInput = input;
  }

  const apiError =
    normalizedInput instanceof ApiError
      ? normalizedInput
      : new ApiError(normalizedInput.code, normalizedInput.message, normalizedInput.status, {
          retryable: normalizedInput.retryable,
          recoveryAction: normalizedInput.recoveryAction,
          details: normalizedInput.details,
        });
  const requestId = normalizedOptions?.requestId ?? getCorrelationId() ?? createRequestId();
  const traceId = getActiveTraceId();
  const body = { ...toErrorShape(apiError, requestId), ...(traceId ? { traceId } : {}), ...(normalizedOptions?.legacy ?? {}) };

  return NextResponse.json(body, {
    status: apiError.status,
    headers: { "Cache-Control": "no-store", ...(traceId ? { "X-Trace-Id": traceId } : {}), ...(normalizedOptions?.headers ?? {}) },
  });
}

// ---------------------------------------------------------------------------
// Centralized route handler wrapper
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_BODY_BYTES = 1_000_000; // 1 MB

export interface ApiHandlerContext<TBody = unknown, TQuery = unknown> {
  request: NextRequest;
  requestId: string;
  body: TBody;
  query: TQuery;
  params: Record<string, string>;
}

export interface ApiHandlerConfig<TBody = unknown, TQuery = unknown> {
  /** Zod schema for the JSON request body (POST/PUT/PATCH). */
  schema?: ZodType<TBody>;
  /** Zod schema for query string parameters. */
  querySchema?: ZodType<TQuery>;
  /** Auth hook. Throw an ApiError to reject; return value is passed through. */
  auth?: (request: NextRequest) => unknown | Promise<unknown>;
  /** Rate limit hook. Throw an ApiError to reject. */
  rateLimit?: (request: NextRequest) => unknown | Promise<unknown>;
  /** Maximum allowed body size in bytes (defaults to 1 MB). */
  maxBodyBytes?: number;
  /** HTTP methods that are allowed to carry a JSON body. */
  bodyMethods?: readonly string[];
}

export type ApiHandler<TBody = unknown, TQuery = unknown> = (
  ctx: ApiHandlerContext<TBody, TQuery>,
) => Response | Promise<Response>;

const DEFAULT_BODY_METHODS: readonly string[] = ["POST", "PUT", "PATCH", "DELETE"];

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json" || (mediaType?.endsWith("+json") ?? false);
}

function zodDetails(error: unknown): unknown {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      return issues.map((issue) => {
        const i = issue as { path?: (string | number)[]; message?: string; code?: string };
        return { path: i.path ?? [], message: i.message ?? "invalid", code: i.code };
      });
    }
  }
  return undefined;
}

function logInternalError(requestId: string, error: unknown): void {
  // Never surface stack traces to clients; log internally for diagnostics.
  try {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    // eslint-disable-next-line no-console
    console.error(`[api] internal_error requestId=${requestId} message=${message}`, stack ?? "");
  } catch {
    // Swallow logging failures to guarantee a response is still returned.
  }
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError("internal_error", "An unexpected error occurred.", 500);
}

async function readBodyWithLimit(
  request: NextRequest,
  maxBodyBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; error: ApiError }> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (Number.isFinite(parsed) && parsed > maxBodyBytes) {
      return {
        ok: false,
        error: new ApiError("validation_error", "Request body too large.", 413, {
          retryable: false,
          recoveryAction: "stop",
          details: { maxBodyBytes },
        }),
      };
    }
  }

  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBodyBytes) {
          await reader.cancel().catch(() => undefined);
          return {
            ok: false,
            error: new ApiError("validation_error", "Request body too large.", 413, {
              retryable: false,
              recoveryAction: "stop",
              details: { maxBodyBytes },
            }),
          };
        }
        chunks.push(value);
      }
    }
  } catch {
    return {
      ok: false,
      error: new ApiError("validation_error", "Failed to read request body.", 400, {
        retryable: false,
        recoveryAction: "stop",
      }),
    };
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

function parseQuery(request: NextRequest): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    const existing = result[key];
    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  });
  return result;
}

/**
 * Wraps a route handler with centralized validation, auth, rate limiting,
 * request-ID correlation, and canonical error envelopes.
 */
export function withApiHandler<TBody = unknown, TQuery = unknown>(
  config: ApiHandlerConfig<TBody, TQuery>,
  handler: ApiHandler<TBody, TQuery>,
): (request: NextRequest, context?: { params?: Record<string, string> }) => Promise<Response> {
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const bodyMethods = config.bodyMethods ?? DEFAULT_BODY_METHODS;

  return async (request, context) => {
    const requestId = getCorrelationId() ?? createRequestId();
    const params = context?.params ?? {};

    try {
      if (config.rateLimit) {
        await config.rateLimit(request);
      }
      if (config.auth) {
        await config.auth(request);
      }

      let body: TBody = undefined as unknown as TBody;
      const method = request.method.toUpperCase();
      const expectsBody = config.schema !== undefined && bodyMethods.includes(method);

      if (expectsBody) {
        if (!isJsonContentType(request.headers.get("content-type"))) {
          throw new ApiError("validation_error", "Content-Type must be application/json.", 415, {
            retryable: false,
            recoveryAction: "stop",
          });
        }

        const read = await readBodyWithLimit(request, maxBodyBytes);
        if (!read.ok) throw read.error;

        let parsedJson: unknown;
        try {
          parsedJson = read.text.length > 0 ? JSON.parse(read.text) : undefined;
        } catch {
          throw new ApiError("validation_error", "Malformed JSON body.", 400, {
            retryable: false,
            recoveryAction: "stop",
          });
        }

        const result = config.schema!.safeParse(parsedJson);
        if (!result.success) {
          throw new ApiError("validation_error", "Invalid request body.", 400, {
            retryable: false,
            recoveryAction: "stop",
            details: zodDetails(result.error),
          });
        }
        body = result.data as TBody;
      }

      let query: TQuery = undefined as unknown as TQuery;
      if (config.querySchema) {
        const result = config.querySchema.safeParse(parseQuery(request));
        if (!result.success) {
          throw new ApiError("validation_error", "Invalid query parameters.", 400, {
            retryable: false,
            recoveryAction: "stop",
            details: zodDetails(result.error),
          });
        }
        query = result.data as TQuery;
      }

      return await handler({ request, requestId, body, query, params });
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === "internal_error" && !(error instanceof ApiError)) {
        logInternalError(requestId, error);
      }
      return jsonError(apiError, { requestId });
    }
  };
}
