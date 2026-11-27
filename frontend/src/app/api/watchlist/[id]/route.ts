import { NextResponse } from "next/server";
import { getWatchlistEntry, removeWatchlistEntry } from "@/server/storage";
import { resolveWalletSession } from "@/server/security/walletSession";
import { evaluateCapability } from "@/server/security/authz";

export const AUTHZ_CAPABILITY = "watchlist:write" as const;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = resolveWalletSession(request);
  if (session.response) return session.response;
  const { id } = await params;
  const entry = await getWatchlistEntry(id);
  if (!entry || entry.walletAddress.toLowerCase() !== session.wallet!.toLowerCase()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const authz = evaluateCapability(
    { kind: "wallet", walletAddress: session.wallet, walletHash: "route" },
    AUTHZ_CAPABILITY,
    { walletAddress: entry.walletAddress, id },
  );
  if (!authz.allowed) return NextResponse.json({ error: "auth_error", reason: authz.reason }, { status: 403 });
  return NextResponse.json({ ok: await removeWatchlistEntry(id) });
}
