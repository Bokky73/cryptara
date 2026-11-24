/**
 * Machine-readable guidance surfaced by the structured API error envelope.
 */
export type RecoveryAction =
  | "retry"
  | "retry_after_delay"
  | "reconnect"
  | "switch_network"
  | "refresh_data"
  | "stop";

const RECOVERY_ACTIONS: readonly string[] = [
  "retry", "retry_after_delay", "reconnect", "switch_network", "refresh_data", "stop",
];

function recoverFor(kind: ReadClientError["kind"], status: number | undefined, retryable: boolean): RecoveryAction {
  if (status === 401 || status === 403) return "reconnect";
  if (status === 429) return "retry_after_delay";
  if (kind === "compatibility") return "refresh_data";
  if (kind === "transport") return "retry";
  if (kind === "configuration") return "stop";
  return retryable ? "retry" : "stop";
}

/**
 * Base error representing failures encountered during read operations.
 */
export class ReadClientError extends Error {
  constructor(
    public readonly kind: "http" | "transport" | "compatibility" | "configuration",
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly retryable = false,
    public readonly requestId?: string,
    public readonly recoveryAction?: RecoveryAction,
  ) {
    super(message);
    this.name = "ReadClientError";
    this.recoveryAction = recoveryAction ?? recoverFor(kind, status, retryable);
  }
}

/**
 * Error raised when an API response shape violates the expected schema contract.
 */
export class CompatibilityError extends ReadClientError {
  constructor(public readonly path: string) {
    super("compatibility", `Unexpected API response shape at ${path}.`);
    this.name = "CompatibilityError";
  }
}

export type ErrorEnvelope = {
  code?: string;
  message?: string;
  retryable?: boolean;
  recoveryAction?: RecoveryAction;
  requestId?: string;
};

/**
 * Reads both the flat and legacy nested error envelopes. Only bounded,
 * machine-readable fields are retained; arbitrary payloads are discarded.
 */
export function parseErrorEnvelope(body: unknown): ErrorEnvelope {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const root = body as Record<string, unknown>;
  const nested = root.error && typeof root.error === "object" && !Array.isArray(root.error)
    ? root.error as Record<string, unknown> : root;
  const message = typeof nested.message === "string" ? nested.message
    : typeof root.message === "string" ? root.message : undefined;
  const action = typeof nested.recoveryAction === "string" && RECOVERY_ACTIONS.includes(nested.recoveryAction)
    ? nested.recoveryAction as RecoveryAction : undefined;
  return {
    code: typeof nested.code === "string" ? nested.code
      : typeof root.code === "string" ? root.code
      : typeof nested.error === "string" ? nested.error
      : typeof root.error === "string" ? root.error : undefined,
    message: message?.slice(0, 200),
    retryable: typeof nested.retryable === "boolean" ? nested.retryable : undefined,
    recoveryAction: action,
    requestId: typeof nested.requestId === "string" ? nested.requestId
      : typeof root.requestId === "string" ? root.requestId : undefined,
  };
}

/**
 * Constructs a structured ReadClientError from an HTTP status and parsed body without retaining sensitive data.
 */
export function httpError(status: number, body: unknown): ReadClientError {
  const shape = parseErrorEnvelope(body);
  const retryable = shape.retryable ?? (status === 429 || status === 503);
  return new ReadClientError(
    "http",
    shape.message ?? `Read API request failed (HTTP ${status}).`,
    status,
    shape.code ?? `http_${status}`,
    retryable,
    shape.requestId,
    shape.recoveryAction,
  );
}
