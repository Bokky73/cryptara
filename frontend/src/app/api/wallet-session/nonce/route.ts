import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  applyChallengeCookie,
  isWalletSessionCookieAllowed,
  mintWalletChallenge,
} from "@/server/security/walletSession";
import { checkRateLimitProfile } from "@/server/security/rateLimit";

const challengeSchema = z.object({
  walletAddress: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^0x[0-9a-fA-F]{6,}$|^G[A-Z2-7]{20,}$/, "Wallet does not match a known format."),
  family: z.enum(["evm", "stellar"]),
  network: z.string().trim().min(1).max(120).optional(),
});

export async function POST(request: NextRequest) {
  const rateLimited = checkRateLimitProfile(request, "alertRuleWrite");
  if (rateLimited) return rateLimited;

  if (!isWalletSessionCookieAllowed()) {
    return NextResponse.json(
      {
        error: "wallet_session_disabled",
        detail: "Set ALLOW_WALLET_SESSION_COOKIE=1 and a random WALLET_SESSION_COOKIE_SECRET of at least 32 characters to enable signed wallet authorization.",
      },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const parsed = challengeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    // Issue #36: capture the request Origin so it is embedded in the
    // challenge and enforced during claim verification, preventing
    // cross-site replay of a captured EVM signature.
    const origin = request.headers.get("origin") ?? "";
    const challenge = mintWalletChallenge({ ...parsed.data, origin });
    const response = NextResponse.json({
      nonce: challenge.nonce,
      family: challenge.family,
      walletAddress: challenge.walletAddress,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      network: challenge.network || null,
      ...(challenge.family === "evm"
        ? { challenge: challenge.challengeBody }
        : { challengeXdr: challenge.challengeBody }),
    });
    return applyChallengeCookie(response, challenge);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "challenge_issue_failed" },
      { status: 400 },
    );
  }
}
