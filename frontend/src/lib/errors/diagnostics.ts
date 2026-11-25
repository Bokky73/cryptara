/**
 * Redacted diagnostics for client error boundaries.
 *
 * Everything here may be pasted into a public bug report or shipped to a log
 * sink, so the payload is an allowlist of fields and every string in it is
 * redacted as well.
 */

export type ErrorDiagnostics = {
  reference: string | null;
  requestId: string | null;
  name: string;
  code: string | null;
  message: string;
  boundary: string;
  path: string | null;
  occurredAt: string;
};

const MAX_MESSAGE_LENGTH = 300;

const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // Headers run to the end of the line: cookie values may contain anything.
  [/\b(set-cookie|cookie|(?:proxy-)?authorization|x-payment|payment-signature)(["']?\s*[:=]\s*).*/gi, "$1$2[REDACTED]"],
  [/\bBearer\s+\S+/gi, "Bearer [REDACTED]"],
  // Credentials and queries are dropped whole; parameter names leak less than values but are not needed.
  [/\b([a-z][a-z\d+.-]*:\/\/)[^\s/@]+@/gi, "$1[REDACTED]@"],
  [/\?[^\s"'<>)]*/g, "?[REDACTED]"],
  [/((?:token|secret|password|passphrase|signature|session|mnemonic|seed|nonce|api[_-]?key|key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi, "$1[REDACTED]"],
  [/\beyJ[\w-]+\.[\w-]+(?:\.[\w-]*)?/g, "[REDACTED]"],
  [/\b(?:sk|pk|cqt|ghp|gho)[-_][\w.-]{8,}/g, "[REDACTED]"],
  [/[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi, "[EMAIL_REDACTED]"],
  // EVM addresses, hashes, calldata, and signatures.
  [/\b0x[a-f\d]{16,}/gi, "[WALLET_REDACTED]"],
  // Stellar public keys, secrets, contracts, and muxed accounts in any case.
  [/\b[GSCM][A-Z2-7]{55,68}\b/gi, "[WALLET_REDACTED]"],
  // Unlabelled hex and base64 blobs, such as XDR envelopes.
  [/[A-Za-z\d+_-][A-Za-z\d+/_-]{39,}={0,2}/g, "[REDACTED]"],
];

export function redactDiagnosticText(value: string): string {
  return REDACTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

/** Identifiers are shown verbatim, so anything that is not plainly one is dropped. */
function safeIdentifier(value: unknown): string | null {
  if (typeof value !== "string" || !/^[\w.:@-]{1,80}$/.test(value)) return null;
  return redactDiagnosticText(value) === value ? value : null;
}

function field(error: unknown, key: string): unknown {
  return error && typeof error === "object" ? (error as Record<string, unknown>)[key] : undefined;
}

export function getErrorReference(error: unknown) {
  return {
    reference: safeIdentifier(field(error, "digest")),
    requestId: safeIdentifier(field(error, "requestId")),
  };
}

export function buildErrorDiagnostics(error: unknown, boundary: string): ErrorDiagnostics {
  const rawMessage = typeof error === "string" ? error : field(error, "message");
  const message = typeof rawMessage === "string" ? redactDiagnosticText(rawMessage) : "";
  return {
    ...getErrorReference(error),
    name: safeIdentifier(field(error, "name")) ?? "UnknownError",
    code: safeIdentifier(field(error, "code")),
    message: message.slice(0, MAX_MESSAGE_LENGTH),
    boundary,
    // The pathname only: query strings and fragments carry wallet addresses.
    path: typeof window === "undefined"
      ? null
      : window.location.pathname.split("/").map(redactDiagnosticText).join("/"),
    occurredAt: new Date().toISOString(),
  };
}

export function formatErrorDiagnostics(diagnostics: ErrorDiagnostics): string {
  return Object.entries(diagnostics)
    .filter(([, value]) => value !== null && value !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

/** Structured client log. The raw error is never attached. */
export function logClientError(diagnostics: ErrorDiagnostics) {
  console.error(JSON.stringify({ event: "client_error_boundary", ...diagnostics }));
}
