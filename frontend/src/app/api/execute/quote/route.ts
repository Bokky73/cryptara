import { NextResponse } from "next/server";
import { jsonError } from "@/server/api/errors";
import { withApiHandler } from "@/server/api/handler";
import { z } from "zod";
import { withCacheHeaders } from "@/server/cache/strategy";
import { getStellarSwapQuote } from "@/server/stellar/swap";
import type { StellarSwapQuote } from "@/server/types";

const bodySchema = z.object({
  chain: z.string().min(1).max(64),
  walletAddress: z.string().min(1),
  fromAsset: z.string().min(1),
  toAsset: z.string().min(1),
  fromIssuer: z.string().optional(),
  toIssuer: z.string().optional(),
  amount: z.number().min(0),
  slippageBps: z.number().min(0).max(10_000).optional(),
});

/**
 * POST /api/execute/quote
 *
 * Fetch a fresh quote that ALWAYS invalidates previous calldata/operation data.
 * Each request produces a brand-new quote with its own fetchedAt/expiresAt window.
 * Clients MUST discard any previously cached quote, calldata, or operation payload.
 *
 * Returns:
 * - 200 with fresh StellarSwapQuote on success
 * - 404 when no route is available (recommendation-only mode)
 * - 400 for invalid input
 * - 429 when rate limited
 */
export const POST = withApiHandler(
  {
    schema: bodySchema,
    rateLimit: "executePrepare",
    maxBodyBytes: 16 * 1024,
  },
  async ({ body }) => {
  const { chain, walletAddress, fromAsset, toAsset, fromIssuer, toIssuer, amount, slippageBps } = body;

  // Fetch a brand-new quote — every call invalidates prior calldata
  const result = await getStellarSwapQuote({
    chain,
    walletAddress,
    fromAsset,
    toAsset,
    fromIssuer,
    toIssuer,
    amount,
    slippageBps,
  });

  if (!result.quote) {
    // No route available: recommendation-only mode, no executable payload
    return jsonError({ code: "not_found" as any, message: result.error ?? "No swap route available.", status: 404, legacy: { quote: null, unsupported: true, detail: "This pair has no available route. Approval is disabled; only a recommendation can be shown.", } });
  }

  // ALWAYS return a fresh quote with current timestamp — never reuse stale data
  const freshQuote: StellarSwapQuote = {
    ...result.quote,
    status: "fresh",
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30_000).toISOString(), // 30s TTL
  };

  return withCacheHeaders(NextResponse.json({
    quote: freshQuote,
    unsupported: false,
    _meta: {
      previousCalldataInvalidated: true,
      refreshRequiredAfter: freshQuote.expiresAt,
    },
  }), "execution");
  },
);
