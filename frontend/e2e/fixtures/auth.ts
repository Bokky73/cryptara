import crypto from "node:crypto";
import type { BrowserContext } from "@playwright/test";

const WALLET_SESSION_COOKIE = "gr_wallet_session";
const DEFAULT_SESSION_SECRET = "cryptara-session-hmac-secret-key-32b";

export function walletSessionCookieValue(walletAddress: string): string {
  const normalized = walletAddress.trim().toLowerCase();
  const secret = process.env.SESSION_SECRET || DEFAULT_SESSION_SECRET;
  const sig = crypto.createHmac("sha256", secret).update(normalized).digest("hex").slice(0, 16);
  return `v2:${normalized}:${sig}`;
}

export async function setWalletSessionCookie(
  context: BrowserContext,
  baseURL: string,
  walletAddress: string,
): Promise<void> {
  const url = new URL(baseURL);
  await context.addCookies([
    {
      name: WALLET_SESSION_COOKIE,
      value: walletSessionCookieValue(walletAddress),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}
