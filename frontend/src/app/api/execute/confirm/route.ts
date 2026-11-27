import { NextResponse } from "next/server";
import { z } from "zod";
import { withCacheHeaders } from "@/server/cache/strategy";
import { assertApprovalOnly } from "@/server/security/policy";
import { checkRateLimit } from "@/server/security/rateLimit";
import {
  createApprovalRecord,
  createTransactionRecord,
  getTransactionRecord,
} from "@/server/storage";
import { isTransactionHashForChain, getChainFamily } from "@/lib/chainIdentity";
import { attachExplorerUrl } from "@/server/transactions/explorer";
import { confirmTransaction } from "@/server/transactions/lifecycleManager";
import { createStellarRpcServer } from "@/server/stellar/client";
import { checkSimulationFreshness, checkCalldataMatch, checkParamsMatch, isHighRiskExecution, hashCalldata } from "@/server/simulation/freshness";
import type { SimulationResultDetail } from "@/server/types";

/**
 * Confirm a Stellar transaction exists on-chain via RPC before persisting.
 */
async function confirmStellarTransactionOnChain(hash: string, network: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const { server } = createStellarRpcServer(network);
    const txResponse = await server.getTransaction(hash);

    if (!txResponse) {
      return { ok: false, detail: "Transaction not found on Stellar network." };
    }

    if (txResponse.status === "NOT_FOUND") {
      return { ok: false, detail: "Transaction has not yet been included in a Stellar ledger." };
    }

    if (txResponse.status === "FAILED") {
      return { ok: false, detail: "Transaction failed on the Stellar network." };
    }

    return {
      ok: true,
      detail: `Transaction confirmed on Stellar ledger ${txResponse.ledger}.`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "Stellar RPC confirmation check failed.",
    };
  }
}

const bodySchema = z.object({
  decisionId: z.string().optional(),
  walletAddress: z.string().min(1),
  decisionWalletAddress: z.string().optional(),
  chainFamily: z.enum(["evm", "stellar"]).optional(),
  txHash: z.string().min(1),
  userApproved: z.literal(true),
  network: z.string().optional(),
  action: z.enum(["hold", "watch", "reduce_exposure", "swap_to_stable", "avoid", "manual_review", "prepare_transaction", "create_trustline", "no_action"]).optional(),
  asset: z.string().optional(),
  valueUsd: z.number().min(0).optional(),
  riskScore: z.number().min(0).max(100).optional(),
  sourceAccount: z.string().optional(),
  simulationStatus: z.enum(["not_required", "pending", "passed", "failed", "unavailable", "unsupported"]).optional(),
  policyAllowed: z.boolean().optional(),
  policyViolations: z.array(z.string()).optional(),
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
  idempotencyKey: z.string().optional(),
  stellarSequenceNumber: z.string().optional(),
  stellarFeeCharged: z.number().optional(),
  stellarOperationCount: z.number().optional(),
  stellarLedger: z.number().optional(),
  stellarEnvelopeXdr: z.string().optional(),
  stellarResultXdr: z.string().optional(),
  stellarTrustlineAsset: z.string().optional(),
  simulation: z
    .object({
      simulatedTxHash: z.string(),
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
      simulatedXdrHash: z.string().optional(),
      resourceUsage: z
        .object({
          gasUnits: z.string().optional(),
          gasPrice: z.string().optional(),
          networkFee: z.string().optional(),
          operationsCount: z.number().optional(),
          ledgerFee: z.string().optional(),
        })
        .optional(),
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
    .optional(),

  currentBlockNumber: z.number().optional(),
  currentLedgerSeq: z.number().optional(),

  currentCalldata: z.string().optional(),
  currentFromAmount: z.string().optional(),
  currentRoute: z.array(z.string()).optional(),
  currentSlippageBps: z.number().optional(),
  currentSequenceNumber: z.union([z.number(), z.string()]).optional(),
  currentFee: z.string().optional(),
});

export async function POST(request: Request) {
  const rateLimited = checkRateLimit(request, { namespace: "execute:confirm", limit: 20, windowMs: 60_000 });

  if (rateLimited) {
    return rateLimited;
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!isTransactionHashForChain(parsed.data.txHash, getChainFamily(parsed.data.network))) {
    return NextResponse.json({
      error: "invalid_tx_hash",
      detail: `Transaction hash does not match expected format for ${getChainFamily(parsed.data.network)} chain. Stellar hashes are 64 hex chars; EVM hashes are 0x-prefixed 64 hex chars.`,
    }, { status: 400 });
  }

  try {
    assertApprovalOnly({ userApproved: parsed.data.userApproved, autoExecute: false });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Execution policy failed" }, { status: 403 });
  }

  if (parsed.data.simulationStatus === "failed") {
    return NextResponse.json({ error: "simulation_failed", detail: "Simulation failed. Confirmation is blocked." }, { status: 403 });
  }

  if (parsed.data.simulationStatus === "unsupported") {
    return NextResponse.json({ error: "simulation_unsupported", detail: "Simulation is not supported for this transaction type or chain. Approval is blocked." }, { status: 403 });
  }

  if (parsed.data.policyAllowed === false) {
    return NextResponse.json({ error: "policy_violation", detail: parsed.data.policyViolations ?? [] }, { status: 403 });
  }

  // Verify signing account matches decision account for Stellar
  const isStellar = getChainFamily(parsed.data.network) === "stellar";
  if (isStellar && parsed.data.decisionWalletAddress && parsed.data.decisionWalletAddress.toUpperCase() !== parsed.data.walletAddress.toUpperCase()) {
    return NextResponse.json({ error: "wallet_mismatch", detail: "Connected Stellar wallet does not match the decision wallet." }, { status: 403 });
  }

  if (parsed.data.decisionWalletAddress && !isStellar && parsed.data.decisionWalletAddress.toLowerCase() !== parsed.data.walletAddress.toLowerCase()) {
    return NextResponse.json({ error: "wallet_mismatch", detail: "Connected wallet does not match the decision wallet." }, { status: 403 });
  }

  const highRiskTrade = isHighRiskExecution(parsed.data.action, parsed.data.riskScore);

  if (highRiskTrade && parsed.data.simulationStatus !== "passed") {
    return NextResponse.json({ error: "simulation_required", detail: "High-risk execution confirmation requires a fresh passed simulation." }, { status: 403 });
  }

  const chainFamily = parsed.data.chainFamily ?? (parsed.data.network ? getChainFamily(parsed.data.network) : "evm");
  const network = parsed.data.network ?? "Connected wallet";

  if (!isTransactionHashForChain(parsed.data.txHash, chainFamily)) {
    return NextResponse.json({
      error: "hash_chain_family_mismatch",
      detail: `txHash does not match chain family ${chainFamily} for network ${network}.`,
    }, { status: 400 });
  }

  // First, record the externally-broadcast hash so a duplicate confirm is rejected.
  // The previous behaviour marked the record as confirmed without verification; we now
  // persist at most a submitted record and rely on confirmTransaction() below to verify
  // on-chain before transitioning to confirmed.
  const policyStatus = {
    allowed: parsed.data.policyAllowed ?? true,
    violations: parsed.data.policyViolations ?? [],
  };
  const existing = await getTransactionRecord(parsed.data.txHash);
  if (existing) {
    if (parsed.data.walletAddress.toLowerCase() !== (existing.walletAddress ?? "").toLowerCase()) {
      return NextResponse.json({
        error: "wallet_mismatch",
        detail: "Connected wallet does not own the recorded transaction.",
      }, { status: 403 });
    }
    if (parsed.data.sourceAccount && chainFamily === "evm" && parsed.data.sourceAccount.toLowerCase() !== parsed.data.walletAddress.toLowerCase()) {
      return NextResponse.json({ error: "source_wallet_mismatch", detail: "EVM source account must equal the connected wallet." }, { status: 403 });
    }
    if (existing.lifecycleStatus === "confirmed") {
      return NextResponse.json({ error: "duplicate_tx_hash", detail: "This transaction hash is already confirmed." }, { status: 409 });
    }
  } else {
    await createTransactionRecord({
      hash: parsed.data.txHash,
      type: "approval",
      decisionAction: parsed.data.action,
      asset: parsed.data.asset ?? "Wallet approval",
      valueUsd: parsed.data.valueUsd ?? 0,
      status: "submitted",
      lifecycleStatus: "submitted",
      chainFamily,
      network,
      walletAddress: parsed.data.walletAddress,
      sourceAccount: parsed.data.sourceAccount,
      userApproved: true,
      decisionId: parsed.data.decisionId,
      simulationStatus: parsed.data.simulationStatus,
      policyStatus,
      expectedEffects: parsed.data.expectedEffects,
      idempotencyKey: parsed.data.idempotencyKey,
      submittedAt: new Date().toISOString(),
    });
  }

  let transaction;
  try {
    transaction = await confirmTransaction(parsed.data.txHash, {
      walletAddress: parsed.data.walletAddress,
      decisionWalletAddress: parsed.data.decisionWalletAddress,
      sourceAccount: parsed.data.sourceAccount,
      expectedEffects: parsed.data.expectedEffects ?? existing?.expectedEffects,
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "confirm_failed";
    return NextResponse.json({
      error: code,
      detail: error instanceof Error ? error.message : "Could not confirm transaction.",
    }, { status: code === "transaction_not_found" ? 404 : 502 });
  }

  if (transaction.lifecycleStatus === "failed" || transaction.lifecycleStatus === "replaced") {
    return NextResponse.json({
      error: "verification_failed",
      detail: transaction.failureReason ?? `On-chain verification returned ${transaction.lifecycleStatus}.`,
      transaction,
    }, { status: 422 });
  }

  // Confirm through RPC before persistence (Stellar)
  // NOT_FOUND means the transaction exists on the network but hasn't
  // been included in a ledger yet — treat it as pending, not fatal.
  if (isStellar && parsed.data.network) {
    const onChainConfirmation = await confirmStellarTransactionOnChain(parsed.data.txHash, parsed.data.network);

    if (!onChainConfirmation.ok && onChainConfirmation.detail !== "Transaction not found on Stellar network." && onChainConfirmation.detail !== "Transaction has not yet been included in a Stellar ledger.") {
      return NextResponse.json({
        error: "stellar_rpc_confirmation_failed",
        detail: onChainConfirmation.detail,
      }, { status: 422 });
    }
  }

  const approval = await createApprovalRecord({
    walletAddress: parsed.data.walletAddress,
    decisionId: parsed.data.decisionId,
    txHash: transaction.hash,
    network: transaction.network,
    action: parsed.data.action,
    asset: parsed.data.asset ?? "Wallet approval",
    valueUsd: parsed.data.valueUsd ?? 0,
  });
  // Override the hard-coded "confirmed" status with the actual lifecycle
  approval.status = transaction.lifecycleStatus === "confirmed" ? "confirmed" : "pending";

  return withCacheHeaders(NextResponse.json({
    ...parsed.data,
    status: transaction.lifecycleStatus === "confirmed" ? "confirmed" : "submitted",
    autoExecuted: false,
    approval,
    transaction: {
      ...transaction,
      explorerUrl: transaction.explorerUrl ?? attachExplorerUrl({ hash: transaction.hash, network: transaction.network, chainFamily: transaction.chainFamily }),
    },
    confirmedAt: transaction.lifecycleStatus === "confirmed" ? (transaction.terminalAt ?? new Date().toISOString()) : undefined,
    pendingVerification: transaction.lifecycleStatus !== "confirmed",
  }), "execution");
}
