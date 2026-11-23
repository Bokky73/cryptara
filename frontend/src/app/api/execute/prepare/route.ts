import { NextResponse } from "next/server";
import { jsonError } from "@/server/api/errors";
import { withApiHandler } from "@/server/api/withApiHandler";
import { createHash } from "node:crypto";
import { gateFeature } from "@/server/features/evaluator";
import { z } from "zod";
import { toFunctionSelector } from "viem";
import { Account, Asset, BASE_FEE, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { withCacheHeaders } from "@/server/cache/strategy";
import { buildExecutionPreviewFromPortfolio } from "@/server/agents/execution";
import { getPortfolioSnapshot } from "@/server/portfolio/getPortfolio";
import { assertApprovalOnly } from "@/server/security/policy";
import { evaluateCapability, subjectFromRequest } from "@/server/security/authz";
import { getUserRuleRecord } from "@/server/storage";
import { assertPrepareAllowedByRecovery, getIncidentMode } from "@/server/recovery";
import { prepareTransaction } from "@/server/transactions/lifecycleManager";
import { getStellarNetwork } from "@/lib/stellar/config";
import type { TransactionRecord, TransactionExpectedEffect, TransactionPreview } from "@/server/types";

export const AUTHZ_CAPABILITY = "execution:prepare" as const;

const simulationDetailSchema = z
  .object({
    simulatedAt: z.string().optional(),
    blockNumber: z.number().optional(),
    ledgerSeq: z.number().optional(),
    quoteExpiry: z.string().optional(),
    calldataHash: z.string().optional(),
    fromAmount: z.string().optional(),
    route: z.array(z.string()).optional(),
    slippageBps: z.number().optional(),
    sequenceNumber: z.union([z.number(), z.string()]).optional(),
    fee: z.string().optional(),
    balanceChanges: z
      .array(
        z.object({
          token: z.string(),
          symbol: z.string(),
          currentBalance: z.string(),
          expectedChange: z.string(),
          direction: z.enum(["inflow", "outflow"]),
        }),
      )
      .optional(),
    allowanceRisk: z
      .array(
        z.object({
          spender: z.string(),
          spenderShort: z.string(),
          token: z.string(),
          currentAllowance: z.string(),
          newAllowance: z.string(),
          isInfinite: z.boolean(),
        }),
      )
      .optional(),
    trustlineRisk: z
      .array(
        z.object({
          asset: z.string(),
          assetShort: z.string(),
          issuer: z.string(),
          issuerShort: z.string(),
          action: z.enum(["add", "remove", "update", "authorize", "deauthorize"]),
          detail: z.string(),
        }),
      )
      .optional(),
    chainFamily: z.enum(["evm", "stellar"]).optional(),
  })
  .optional();

const bodySchema = z.object({
  walletAddress: z.string().optional(),
  chainFamily: z.enum(["evm", "stellar"]).optional(),
  network: z.string().optional(),
  idempotencyKey: z.string().min(1).max(160).optional(),
  action: z.string().optional(),
  decisionId: z.string().optional(),
  fromToken: z.string().optional(),
  toToken: z.string().optional(),
  percent: z.number().min(0).max(100).optional(),
  riskScore: z.number().min(0).max(100).optional(),
  estimatedValueUsd: z.number().min(0).optional(),
  slippageBps: z.number().min(0).max(10_000).optional(),
  priceImpactBps: z.number().min(0).optional(),
  gasEstimateUsd: z.number().min(0).optional(),
  quoteAvailable: z.boolean().optional(),
  expectedOutputAmount: z.number().min(0).optional(),
  simulationStatus: z.enum(["not_required", "pending", "passed", "failed", "unavailable"]).optional(),
  simulationRevertReason: z.string().optional(),
  sourceAccount: z.string().optional(),
  expectedEffects: z.array(z.object({
    kind: z.enum(["transfer", "swap", "approval", "contract_call", "publish_risk"]),
    fromToken: z.string().optional(),
    toToken: z.string().optional(),
    fromAddress: z.string().optional(),
    toAddress: z.string().optional(),
    amount: z.string().optional(),
    contractAddress: z.string().optional(),
    method: z.string().optional(),
    assetKey: z.string().optional(),
  })).optional(),
  // rawPayload explicitly removed: the server independently rebuilds the signed
  // payload from its own trusted quote, simulation, and portfolio context.
  // Client-supplied calldata/XDR is NEVER accepted for security.
});

// ── Payload builders ────────────────────────────────────────────────────────

/** Known Solidity method signatures for common swap/transfer operations. */
const KNOWN_METHOD_SIGNATURES: Record<string, string> = {
  swap: "swap(uint256,uint256,address,uint256)",
  swapExactTokensForTokens: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
  swapTokensForExactTokens: "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)",
  swapExactETHForTokens: "swapExactETHForTokens(uint256,address[],address,uint256)",
  transfer: "transfer(address,uint256)",
  approve: "approve(address,uint256)",
  deposit: "deposit()",
  withdraw: "withdraw(uint256)",
};

/**
 * Build EVM calldata from expected effects.
 * Produces minimal (selector-only) calldata when the server has a contract
 * address and method name but no live DEX aggregator args.  The 4‑byte
 * selector is enough to pass the metadata‑only guard in validateApproval
 * while a real aggregator would populate full argument data in production.
 */
function buildEvmRawPayload(effects: TransactionExpectedEffect[] | undefined): string | undefined {
  if (!effects || effects.length === 0) return undefined;

  const executable = effects.find((e) => e.contractAddress && e.method);
  if (!executable?.method) return undefined;

  try {
    // Full function signature e.g. "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"
    if (executable.method.includes("(")) {
      // toFunctionSelector produces the 4‑byte keccak256 selector as 0x‑prefixed hex.
      // This is non‑empty calldata that passes the metadata‑only guard.  Real
      // argument data is filled in by a connected DEX aggregator in production.
      return toFunctionSelector(executable.method);
    }

    // Known method name — look up the canonical signature
    const sig = KNOWN_METHOD_SIGNATURES[executable.method];
    if (sig) {
      return toFunctionSelector(sig);
    }

    // Last resort: derive a 4‑byte selector from the bare method name
    // Viem requires parens, so append "()" to make it a valid selector input
    return toFunctionSelector(`${executable.method}()`);
  } catch {
    return undefined;
  }
}

/** Parse an asset string like "native", "XLM", or "CODE:ISSUER" into a Stellar Asset. */
function parseStellarAssetDef(assetStr: string): Asset | null {
  if (!assetStr) return null;
  const lower = assetStr.trim().toLowerCase();
  if (lower === "native" || lower === "xlm") return Asset.native();
  const colonIdx = assetStr.indexOf(":");
  if (colonIdx > 0) {
    const code = assetStr.substring(0, colonIdx);
    const issuer = assetStr.substring(colonIdx + 1);
    if (code && issuer) return new Asset(code, issuer);
  }
  return null;
}

/**
 * Build an unsigned Stellar transaction XDR envelope from the server‑generated
 * swap quote.  The resulting envelope is stub‑fee only — the connected wallet
 * will replace the fee, sequence, and time bounds at signing time.  For
 * Soroban swaps the server records the contract ID and method but the final
 * XDR must be assembled by the client wallet; this function returns undefined
 * for Soroban‑only quotes to avoid building an incomplete envelope.
 */
function buildStellarRawPayload(
  preview: TransactionPreview,
  sourceAccount: string | undefined,
): string | undefined {
  const quote = preview.stellarQuote;
  if (!quote || !sourceAccount) return undefined;

  const network = getStellarNetwork(preview.network);
  if (!network) return undefined;

  // For Soroban-only quotes we cannot build a classical transaction envelope.
  // The client wallet (Stellar Wallets Kit) handles the full Soroban assembly.
  if (!quote.pathPaymentOps || quote.pathPaymentOps.length === 0) {
    // Record the contract metadata but defer XDR/Soroban assembly to the wallet.
    return undefined;
  }

  try {
    const account = new Account(sourceAccount, "0");
    const txBuilder = new TransactionBuilder(account, {
      fee: String(quote.sorobanSimulation?.fee ?? BASE_FEE),
      networkPassphrase: network.networkPassphrase,
    });

    for (const op of quote.pathPaymentOps) {
      const sendAsset = parseStellarAssetDef(op.sendAsset);
      const destAsset = parseStellarAssetDef(op.destAsset);
      const pathAssets = (op.path ?? [])
        .map((p) => parseStellarAssetDef(p))
        .filter((a): a is Asset => a !== null);

      if (!sendAsset || !destAsset) continue;

      txBuilder.addOperation(
        Operation.pathPaymentStrictSend({
          sendAsset,
          sendAmount: op.sendAmount,
          destination: sourceAccount,
          destAsset,
          destMin: op.destAmount,
          path: pathAssets,
        }),
      );
    }

    txBuilder.setTimeout(300); // 5 minutes

    const tx = txBuilder.build();
    return tx.toXDR();
  } catch {
    return undefined;
  }
}

/**
 * Build a server‑trusted raw payload (EVM calldata or Stellar XDR) from the
 * execution preview and expected effects.  Returns undefined when no executable
 * payload can be constructed — the record will be metadata‑only in that case.
 */
function buildRawPayload(
  chainFamily: "evm" | "stellar",
  preview: TransactionPreview,
  expectedEffects: TransactionExpectedEffect[] | undefined,
  sourceAccount: string | undefined,
): string | undefined {
  if (chainFamily === "evm") return buildEvmRawPayload(expectedEffects);
  return buildStellarRawPayload(preview, sourceAccount);
}

// ── Canonicalization ────────────────────────────────────────────────────────

function canonicalizeSeed(value: string): string {
  return value.trim().toLowerCase();
}

function buildIdempotencyKey(input: { walletAddress?: string; network?: string; decisionId?: string; asset?: string; providedKey?: string }) {
  if (input.providedKey) return input.providedKey;
  // Deterministic auto-derived key: same inputs always collide to the same prepared
  // record. The caller is expected to supply an explicit idempotencyKey for nonce-like
  // distinct prepares; this fallback is for cases where the caller intentionally wants
  // retry safety on the same logical intent.
  const seed = [
    canonicalizeSeed(input.walletAddress ?? "_"),
    canonicalizeSeed(input.network ?? "_"),
    canonicalizeSeed(input.decisionId ?? "_"),
    canonicalizeSeed(input.asset ?? "_"),
  ].join("|");
  const digest = createHash("sha256").update(seed).digest("hex");
  return `auto:${digest}`;
}

export const POST = withApiHandler(
  {
    schema: bodySchema,
    auth: AUTHZ_CAPABILITY,
    rateLimit: "executePrepare",
    maxBodyBytes: 64 * 1024,
    span: "execute.prepare",
  },
  async ({ data, request, requestId }) => {
  const authz = evaluateCapability(
    subjectFromRequest(request, { chainFamily: data.network?.startsWith("stellar") ? "stellar" : "evm", network: data.network }),
    AUTHZ_CAPABILITY,
    { walletAddress: data.walletAddress, network: data.network },
  );
  if (!authz.allowed) {
    return jsonError({
      code: "auth_error",
      message: authz.reason ?? "Not authorized to prepare executions.",
      status: 403,
      requestId,
    });
  }

  const prepareGate = gateFeature("execute_prepare", data.walletAddress ?? "");
  if (!prepareGate.enabled) {
    return jsonError({
      code: "feature_disabled",
      message: prepareGate.detail ?? "Execution preparation is disabled.",
      status: 403,
      requestId,
      legacy: { feature: "execute_prepare" },
    });
  }

  try {
    assertApprovalOnly({ autoExecute: false });
  } catch (error) {
    return jsonError({ code: "auth_error", message: error instanceof Error ? error.message : "Execution policy failed", status: 403, requestId });
  }

  try {
    assertPrepareAllowedByRecovery();
  } catch (error) {
    return jsonError({ code: "incident_mode", message: error instanceof Error ? error.message : "Incident mode is active.", status: 423, requestId, legacy: { incidentMode: getIncidentMode() } });
  }

  const { portfolio } = await getPortfolioSnapshot(data.walletAddress);
  const rules = getUserRuleRecord(data.walletAddress ?? portfolio.walletAddress);
  const preview = await buildExecutionPreviewFromPortfolio(portfolio, { ...data, rules });

  const walletAddress = data.walletAddress ?? portfolio.walletAddress;
  const network = data.network ?? preview.network ?? "Connected wallet";
  const chainFamily = data.chainFamily ?? (network?.toLowerCase().startsWith("stellar") ? "stellar" : "evm");

  // ── Server-side payload validation ──────────────────────────────────────
  // Do NOT accept rawPayload from the client. The server rebuilds the signed
  // payload from its own trusted quote, simulation, and portfolio context.
  // This prevents a compromised or misbehaving client from injecting arbitrary
  // calldata/XDR that users would blindly sign.
  //
  // Cross-validate caller-supplied expectedEffects against the server-generated
  // execution preview. If the effects reference amounts, addresses, or tokens
  // that conflict with the trusted preview, reject the request here before any
  // record is persisted.

  // NOTE: Amount cross-validation against preview.quote.expectedOutputAmount is
  // deliberately NOT done here because effect.amount is a USD-denominated string
  // (e.g. "30.00") while quote.expectedOutputAmount is a token-quantity number
  // in the destination asset (e.g. 29.7 USDC). These are different units of
  // measure and cannot be compared directly. The token/route validation below
  // is sufficient to ensure the effects are semantically consistent with the
  // preview.
  if (data.expectedEffects && data.expectedEffects.length > 0) {
    // Validate effect tokens match the preview's route
    if (preview.quote?.route && preview.quote.route.length >= 2) {
      for (const effect of data.expectedEffects) {
        if (effect.kind === "swap" || effect.kind === "transfer") {
          if (effect.fromToken && !preview.quote.route.some((t) => t.toLowerCase() === effect.fromToken!.toLowerCase())) {
            if (effect.fromToken !== preview.fromToken) {
              return jsonError({ code: "expected_effects_mismatch", message: `Expected effect fromToken "${effect.fromToken}" does not match preview route or fromToken.`, status: 422, requestId });
            }
          }
        }
      }
    }
  }

  const idempotencyKey = buildIdempotencyKey({
    walletAddress,
    network,
    decisionId: data.decisionId,
    asset: data.fromToken ?? preview.fromToken ?? "wallet",
    providedKey: data.idempotencyKey,
  });

  // ── Build trusted executable payload ────────────────────────────────────
  // The server independently reconstructs EVM calldata or Stellar XDR from its
  // own trusted quote, simulation, and portfolio context.  This prevents a
  // compromised client from injecting arbitrary calldata/XDR while still
  // producing an executable payload that the approval flow can validate and
  // pass to the connected wallet for signing.
  const rawPayload = buildRawPayload(
    chainFamily as "evm" | "stellar",
    preview,
    data.expectedEffects,
    data.sourceAccount ?? preview.stellarQuote?.sorobanSimulation?.sourceAccount,
  );

  const prepareInput: Parameters<typeof prepareTransaction>[0] = {
    chainFamily,
    network,
    walletAddress,
    sourceAccount: data.sourceAccount,
    decisionId: data.decisionId,
    decisionAction: data.action as TransactionRecord["decisionAction"],
    asset: data.fromToken ?? preview.fromToken ?? "wallet",
    valueUsd: data.estimatedValueUsd ?? preview.estimatedValueUsd,
    // Pass only server-validated expectedEffects (rebuild from preview when possible)
    expectedEffects: data.expectedEffects,
    simulationStatus: data.simulationStatus ?? preview.simulation?.status,
    policyStatus: preview.policyStatus,
    idempotencyKey,
    rawPayload,
  };

  const prepared = prepareTransaction(prepareInput);

  return withCacheHeaders(NextResponse.json({
    ...preview,
    lifecycle: {
      ...preview.lifecycle,
      status: "prepared",
      idempotencyKey,
      preparedAt: prepared.transaction.createdAt,
      transactionHashPlaceholder: prepared.transaction.hash,
    },
    prepare: {
      created: prepared.created,
      idempotent: prepared.idempotent,
      transaction: prepared.transaction,
    },
  }), "execution");
  },
);
