import { NextRequest, NextResponse } from "next/server";
import {
  clearWalletCookie,
  isWalletSessionCookieAllowed,
  readRawSessionCookieValue,
  readWalletSessionCookie,
  revokeWalletSession,
} from "@/server/security/walletSession";
import { checkRateLimitProfile } from "@/server/security/rateLimit";
import { commonErrorCodes, jsonError } from "@/server/api/errors";

/**
 * Issue #36: this route is session-scoped (it revokes the caller's own
 * session) rather than data-capability scoped. The AUTHZ_CAPABILITY
 * constant below declares that scope for the authz coverage checker,
 * and `readWalletSessionCookie` is the enforcement boundary — an
 * unauthenticated caller receives 401 before any revocation runs.
 */
export const AUTHZ_CAPABILITY = "session:revoke" as const;

/**
 * POST /api/wallet-session/revoke
 *
 * Issue #36: Explicit server-side session revocation.
 *
 * Immediately blacklists the caller's active session token so that it
 * cannot be reused even if the cookie survives on the client. The
 * cookie is also cleared in the response so well-behaved browsers
 * drop it immediately.
 *
 * A redacted audit log entry is emitted inside `revokeWalletSession`.
 *
 * Rate-limited identically to other wallet-mutating routes.
 */
export async function POST(request: NextRequest) {
  const rateLimited = checkRateLimitProfile(request, "alertRuleWrite");
  if (rateLimited) return rateLimited;

  if (!isWalletSessionCookieAllowed()) {
    return jsonError(
      { code: "wallet_session_disabled", message: "Wallet sessions are not enabled on this deployment.", status: 503 },
      {},
    );
  }

  // Read wallet first so we can confirm a session actually exists before
  // attempting revocation. An unauthenticated revoke is a no-op 401.
  const wallet = readWalletSessionCookie(request);
  if (!wallet) {
    return jsonError(
      {
        code: commonErrorCodes.unauthorized,
        message: "No active wallet session to revoke.",
        status: 401,
      },
      { legacy: { error: "no_active_session" } },
    );
  }

  // Retrieve the raw cookie value AFTER confirming the session exists.
  const rawCookieValue = readRawSessionCookieValue(request) ?? "";

  // Parse an optional reason from the request body (non-fatal if absent).
  let reason = "explicit_revocation";
  try {
    const body = await request.json().catch(() => ({}));
    if (body && typeof (body as Record<string, unknown>).reason === "string") {
      // Sanitize: keep only safe printable ASCII, max 80 chars.
      reason = String((body as Record<string, unknown>).reason)
        .replace(/[^\x20-\x7E]/g, "")
        .slice(0, 80) || "explicit_revocation";
    }
  } catch {
    // ignore body parse errors — reason stays at default
  }

  revokeWalletSession(rawCookieValue, reason);

  const response = NextResponse.json(
    { revoked: true, walletAddress: wallet },
    { status: 200 },
  );
  clearWalletCookie(response);

  return response;
}
