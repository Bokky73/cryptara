import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withCacheHeaders } from "@/server/cache/strategy";
import { assertApprovalOnly } from "@/server/security/policy";
import { checkRateLimit } from "@/server/security/rateLimit";
import { getUserRuleRecord, upsertUserRuleRecord } from "@/server/storage";
import {
  chainFamilySchema,
  networkSchema,
  validateChainScopedWallet,
} from "@/server/security/inputValidation";
import { evaluateCapability } from "@/server/security/authz";
import { withApiHandler } from "@/server/api/withApiHandler";
import { jsonError } from "@/server/api/errors";

export const AUTHZ_CAPABILITY = "rules:write" as const;

const ruleSchema = z.object({
  chainFamily: chainFamilySchema.optional(),
  network: networkSchema.optional(),
  walletAddress: z.string().min(1),
  maxRiskScore: z.number().min(0).max(100),
  maxTradePercent: z.number().min(0).max(100),
  maxMemeExposurePercent: z.number().min(0).max(100),
  maxDailyTransactionValueUsd: z.number().min(0).optional(),
  maxSlippageBps: z.number().min(0).max(10_000).optional(),
  minStableReservePercent: z.number().min(0).max(100).optional(),
  allowedChains: z.array(z.string().min(1)).optional(),
  blockedTokens: z.array(z.string().min(1)).optional(),
  blockedIssuers: z.array(z.string().min(1)).optional(),
  blockedCategories: z.array(z.string().min(1)).optional(),
  allowedActions: z
    .array(z.enum(["hold", "watch", "reduce_exposure", "swap_to_stable", "avoid", "manual_review", "prepare_transaction", "no_action"]))
    .optional(),
  autoExecute: z.boolean(),
  version: z.number().int().min(1).optional(),
  createdAt: z.string().optional(),
}).superRefine((value, context) => {
  if (!validateChainScopedWallet(value)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["walletAddress"],
      message: "Wallet address does not match chainFamily/network.",
    });
  }
});

export function GET(request: NextRequest) {
  const rateLimited = checkRateLimit(request, { namespace: "rules", limit: 60, windowMs: 60_000 });

  if (rateLimited) {
    return rateLimited;
  }

  const walletAddress = request.nextUrl.searchParams.get("walletAddress") ?? undefined;
  const chainFamily = chainFamilySchema.safeParse(
    request.nextUrl.searchParams.get("chainFamily") ?? undefined,
  );
  const network = request.nextUrl.searchParams.get("network") ?? undefined;

  return withCacheHeaders(
    NextResponse.json(
      getUserRuleRecord(walletAddress, {
        chainFamily: chainFamily.success ? chainFamily.data : undefined,
        network,
      }),
    ),
    "rules",
  );
}

export const POST = withApiHandler(
  {
    schema: ruleSchema,
    rateLimit: { namespace: "rules:update", limit: 20, windowMs: 60_000 },
    maxBodyBytes: 64 * 1024,
  },
  async ({ data, requestId }) => {
    try {
      const authz = evaluateCapability(
        { kind: "wallet", walletAddress: data.walletAddress, walletHash: "route", chainFamily: data.chainFamily, network: data.network?.toLowerCase() },
        AUTHZ_CAPABILITY,
        { walletAddress: data.walletAddress, chainFamily: data.chainFamily, network: data.network },
      );
      if (!authz.allowed) {
        return jsonError("auth_error", "Not authorized to update rules.", {
          status: 403,
          requestId,
          details: { reason: authz.reason },
        });
      }
      assertApprovalOnly({ autoExecute: data.autoExecute });
    } catch (error) {
      return jsonError("auth_error", "Execution policy failed.", {
        status: 403,
        requestId,
        details: { reason: error instanceof Error ? error.message : "Execution policy failed" },
      });
    }

    return withCacheHeaders(NextResponse.json(upsertUserRuleRecord({
      ...data,
      autoExecute: false,
      // Only pass version if the client explicitly provided one; otherwise
      // upsertUserRuleRecord auto-increments from the current stored version.
      ...(data.version !== undefined ? { version: data.version } : {}),
      createdAt: data.createdAt ?? new Date().toISOString(),
    })), "rules");
  },
);
