import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  applyWalletCookie,
  clearChallengeCookie,
  clearWalletCookie,
  isWalletSessionCookieAllowed,
  readChallengeCookie,
  readWalletSessionCookie,
  verifyWalletChallenge,
} from "@/server/security/walletSession";
import { checkRateLimitProfile } from "@/server/security/rateLimit";
import { commonErrorCodes, jsonError } from "@/server/api/errors";

const claimSchema = z.object({
  walletAddress: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^0x[0-9a-fA-F]{6,}$|^G[A-Z2-7]{20,}$/, "Wallet does not match a known format."),
  family: z.enum(["evm", "stellar"]),
  nonce: z.string().trim().min(1).max(96),
  signature: z.string().trim().min(1).max(4096).optional(),
  signedTxXdr: z.string().trim().min(1).max(8192).optional(),
  network: z.string().trim().min(1).max(120).optional(),
});

function notConfigured() {
  const detail =
    "Set ALLOW_WALLET_SESSION_COOKIE=1 and a random WALLET_SESSION_COOKIE_SECRET of at least 32 characters to enable signed wallet sessions.";

  // The `error`/`detail` fields are kept for existing clients; `code`/`message`/
  // `retryable`/`requestId` are the stable fields new clients should read.
  return jsonError(
    { code: "wallet_session_disabled", message: detail, status: 503 },
    { legacy: { error: "wallet_session_disabled", detail } },
  );
}

export async function POST(request: NextRequest) {
  const rateLimited = checkRateLimitProfile(request, "alertRuleWrite");
  if (rateLimited) return rateLimited;

  if (!isWalletSessionCookieAllowed()) return notConfigured();

  const challenge = readChallengeCookie(request);
  if (!challenge) {
    const detail = "Request /api/wallet-session/nonce first to receive a wallet-ownership challenge.";

    return jsonError(
      { code: commonErrorCodes.unauthorized, message: detail, status: 401 },
      { legacy: { error: "challenge_required", detail } },
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      { code: commonErrorCodes.validationError, message: "Request validation failed.", status: 400, details: parsed.error.flatten() },
      { legacy: { error: parsed.error.flatten() } },
    );
  }

  const wallet = parsed.data.walletAddress.trim().toLowerCase();
  if (parsed.data.nonce !== challenge.nonce) {
    const response = jsonError(
      { code: commonErrorCodes.unauthorized, message: "Challenge nonce does not match.", status: 401 },
      { legacy: { error: "nonce_mismatch" } },
    );

    return clearChallengeCookie(response);
  }

  const result = await verifyWalletChallenge({
    challenge,
    walletAddress: wallet,
    family: parsed.data.family,
    signature: parsed.data.signature,
    signedTxXdr: parsed.data.signedTxXdr,
    network: parsed.data.network,
    // Issue #36: forward the request origin so origin binding is enforced.
    origin: request.headers.get("origin") ?? "",
  });

  if (!result.ok) {
    const response = jsonError(
      { code: commonErrorCodes.unauthorized, message: result.error ?? "Signature verification failed.", status: 401, details: { reason: result.error } },
      { legacy: { error: "signature_invalid", detail: result.error } },
    );

    return clearChallengeCookie(response);
  }

  const response = NextResponse.json({ walletAddress: wallet, ttlSeconds: 60 * 60 * 12 });
  applyWalletCookie(response, wallet);
  clearChallengeCookie(response);

  return response;
}

export function GET(request: NextRequest) {
  const wallet = readWalletSessionCookie(request);

  if (!wallet) {
    return NextResponse.json({ walletAddress: null }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(
    { walletAddress: wallet },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE(request: NextRequest) {
  const rateLimited = checkRateLimitProfile(request, "alertRuleWrite");
  if (rateLimited) return rateLimited;

  const response = NextResponse.json({ walletAddress: null });
  clearWalletCookie(response);
  clearChallengeCookie(response);

  return response;
}
