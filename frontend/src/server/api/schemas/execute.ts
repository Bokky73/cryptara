import { z } from "zod";
import type { StrategyPolicyDecision } from "@/server/types";

export const executeSubmitSchema = z.object({
  chainFamily: z.enum(["evm", "stellar"]),
  network: z.string().min(1),
  walletAddress: z.string().min(1),
  sourceAccount: z.string().min(1).optional(),
  signedPayload: z.string().min(1),
  asset: z.string().min(1),
  decisionId: z.string().min(1).optional(),
  decisionAction: z
    .enum([
      "hold",
      "watch",
      "reduce_exposure",
      "swap_to_stable",
      "avoid",
      "manual_review",
      "prepare_transaction",
      "create_trustline",
      "no_action",
    ])
    .optional(),
  valueUsd: z.number().nonnegative().optional(),
  simulationStatus: z
    .enum(["not_required", "pending", "passed", "failed", "unavailable", "unsupported"])
    .optional(),
  policyStatus: z
    .object({
      allowed: z.boolean(),
      violations: z.array(z.string()),
      decisions: z.array(z.custom<StrategyPolicyDecision>()).optional(),
      ruleVersion: z.number().optional(),
      ruleWalletAddress: z.string().optional(),
    })
    .optional(),
  expectedEffects: z
    .array(
      z.object({
        kind: z.enum(["transfer", "swap", "approval", "contract_call", "publish_risk"]),
        fromToken: z.string().optional(),
        toToken: z.string().optional(),
        fromAddress: z.string().optional(),
        toAddress: z.string().optional(),
        amount: z.string().optional(),
        amountBaseUnits: z.string().optional(),
        contractAddress: z.string().optional(),
        method: z.string().optional(),
        assetKey: z.string().optional(),
        decimals: z.number().optional(),
      }),
    )
    .optional(),
  userApproved: z.literal(true),
  idempotencyKey: z.string().min(1).optional(),
});
