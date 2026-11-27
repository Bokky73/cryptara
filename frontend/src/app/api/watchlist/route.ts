import { NextResponse } from "next/server";
import { z } from "zod";
import { addToWatchlist, listWatchlist, removeFromWatchlist } from "@/server/discovery/watchlist";
import { ensureStorageReady } from "@/server/storage";
import { resolveWalletSession } from "@/server/security/walletSession";
import { evaluateCapability } from "@/server/security/authz";
import { withApiHandler } from "@/server/api/withApiHandler";
import { jsonError } from "@/server/api/errors";

export const AUTHZ_CAPABILITY = "watchlist:write" as const;

const addBodySchema = z.object({
  action: z.enum(["add"]).default("add"),
  walletAddress: z.string().min(1).max(80).optional(),
  chain: z.string().min(1).max(40),
  network: z.string().max(40).optional(),
  contractAddress: z.string().max(80).optional(),
  pairAddress: z.string().max(120).optional(),
  symbol: z.string().max(32).optional(),
  tokenName: z.string().max(120).optional(),
  assetKey: z.string().max(180).optional(),
  issuer: z.string().max(64).optional(),
  assetType: z.enum(["native", "classic", "contract", "issuer_account", "sac", "sep41"]).optional(),
  source: z.enum(["dexscreener", "stellar_market", "manual"]).default("manual"),
  note: z.string().max(280).optional(),
});

const removeBodySchema = z.object({
  action: z.literal("remove"),
  entryId: z.string().min(1).max(120),
  walletAddress: z.string().min(1).max(80).optional(),
});

const listQuerySchema = z.object({
  walletAddress: z.string().min(1).max(80).optional(),
});

export const GET = withApiHandler(
  {
    schema: { query: listQuerySchema },
    rateLimit: { namespace: "watchlist:list", limit: 60, windowMs: 60_000 },
  },
  async ({ query, request }) => {
    await ensureStorageReady();

    // Wallet isolation: the session cookie is authoritative
    const session = resolveWalletSession(request, { suppliedWallet: query.walletAddress });
    if (session.response) return session.response;

    const authz = evaluateCapability(
      { kind: "wallet", walletAddress: session.wallet, walletHash: "route" },
      "portfolio:read",
      { walletAddress: session.wallet },
    );
    if (!authz.allowed) {
      return jsonError("auth_error", { reason: authz.reason, status: 403 });
    }

    return NextResponse.json({ entries: await listWatchlist(session.wallet!) });
  },
);

export const POST = withApiHandler(
  {
    schema: { body: z.union([addBodySchema, removeBodySchema]) },
    rateLimit: { namespace: "watchlist:add", limit: 20, windowMs: 60_000 },
  },
  async ({ body, request }) => {
    await ensureStorageReady();

    if (body.action === "add") {
      // Wallet isolation: the session cookie is authoritative
      const session = resolveWalletSession(request, { suppliedWallet: body.walletAddress });
      if (session.response) return session.response;
      const wallet = session.wallet!;
      const authz = evaluateCapability(
        {
          kind: "wallet",
          walletAddress: wallet,
          walletHash: "route",
          chainFamily: body.chain?.startsWith("stellar") ? "stellar" : "evm",
          network: body.network?.toLowerCase(),
        },
        AUTHZ_CAPABILITY,
        { walletAddress: wallet, network: body.network },
      );
      if (!authz.allowed) {
        return jsonError("auth_error", { reason: authz.reason, status: 403 });
      }

      const result = await addToWatchlist({
        walletAddress: wallet,
        chain: body.chain,
        network: body.network,
        contractAddress: body.contractAddress,
        pairAddress: body.pairAddress,
        symbol: body.symbol,
        tokenName: body.tokenName,
        assetKey: body.assetKey,
        issuer: body.issuer,
        assetType: body.assetType,
        source: body.source === "manual" ? "manual_watchlist" : body.source,
        note: body.note,
      });

      return result.ok
        ? NextResponse.json({ entry: result.entry, alreadyExisted: result.alreadyExisted })
        : jsonError("validation_error", { message: result.error, status: 422 });
    }

    // Wallet isolation: the session cookie is authoritative
    const session = resolveWalletSession(request, { suppliedWallet: body.walletAddress });
    if (session.response) return session.response;

    const entries = await listWatchlist(session.wallet!);
    const owned = entries.find((entry) => entry.id === body.entryId);

    if (!owned) {
      return jsonError("not_found", {
        message: "Entry not found or does not belong to this wallet.",
        status: 404,
      });
    }

    const authz = evaluateCapability(
      { kind: "wallet", walletAddress: session.wallet, walletHash: "route" },
      AUTHZ_CAPABILITY,
      { walletAddress: session.wallet, id: body.entryId },
    );
    if (!authz.allowed) {
      return jsonError("auth_error", { reason: authz.reason, status: 403 });
    }

    const ok = await removeFromWatchlist(body.entryId);

    return NextResponse.json({ ok });
  },
);
// Bulk import/export handles versions up to 1.0.0
