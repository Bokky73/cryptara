import { NextResponse } from "next/server";
import { jsonError } from "@/server/api/errors";
import { withApiHandler } from "@/server/api/withApiHandler";
import { gateFeature } from "@/server/features/evaluator";
import { isWalletAddressForChain, isStellarAccountAddress, canonicalizeAddress, getChainFamily } from "@/lib/chainIdentity";
import { withCacheHeaders } from "@/server/cache/strategy";
import { resolveWalletSession } from "@/server/security/walletSession";
import { submitTransaction } from "@/server/transactions/lifecycleManager";
import { evaluateCapability } from "@/server/security/authz";
import { executeSubmitSchema } from "@/server/api/schemas/execute";

export const AUTHZ_CAPABILITY = "execution:submit" as const;

export const POST = withApiHandler(
  {
    schema: executeSubmitSchema,
    rateLimit: "executePrepare",
    maxBodyBytes: 256_000,
    span: "execute.submit",
  },
  async ({ request, body }) => {
    const session = resolveWalletSession(request, { suppliedWallet: body.walletAddress });
    if (session.response) {
      return session.response;
    }

    const authz = evaluateCapability(
      { kind: "wallet", walletAddress: session.wallet, walletHash: "route", chainFamily: body.chainFamily, network: body.network.toLowerCase() },
      AUTHZ_CAPABILITY,
      { walletAddress: body.walletAddress, chainFamily: body.chainFamily, network: body.network },
    );
    if (!authz.allowed) {
      return jsonError({ code: "auth_error", message: "Not authorized to submit transactions.", status: 403, details: { reason: authz.reason } });
    }

    const submitGate = gateFeature("execute_submit", body.walletAddress ?? "");
    if (!submitGate.enabled) {
      return jsonError({ code: "feature_disabled", message: "Execution submit is disabled.", status: 403, details: { feature: "execute_submit", detail: submitGate.detail } });
    }

    const walletFamily = getChainFamily(body.network);
    if (body.chainFamily !== walletFamily) {
      return jsonError({ code: "chain_family_mismatch", message: `Network ${body.network} belongs to ${walletFamily} but family ${body.chainFamily} was supplied.`, status: 400 });
    }

    const walletValid = body.chainFamily === "stellar" ? isStellarAccountAddress(body.walletAddress) : isWalletAddressForChain(body.walletAddress, "evm");
    if (!walletValid) {
      return jsonError({ code: "invalid_wallet", message: `Wallet address does not match ${body.chainFamily} format.`, status: 400 });
    }

    if (body.sourceAccount && body.chainFamily === "stellar" && !isStellarAccountAddress(body.sourceAccount)) {
      return jsonError({ code: "invalid_source", message: "Stellar source account must be a valid G-address.", status: 400 });
    }

    if (body.sourceAccount && body.chainFamily === "evm" && canonicalizeAddress(body.sourceAccount, "evm") !== canonicalizeAddress(body.walletAddress, "evm")) {
      return jsonError({ code: "source_wallet_mismatch", message: "EVM source account must equal the connected wallet.", status: 403 });
    }

    try {
      const report = await submitTransaction({
        chainFamily: body.chainFamily,
        network: body.network,
        walletAddress: body.walletAddress,
        sourceAccount: body.sourceAccount,
        decisionId: body.decisionId,
        decisionAction: body.decisionAction,
        asset: body.asset,
        valueUsd: body.valueUsd,
        simulationStatus: body.simulationStatus,
        policyStatus: body.policyStatus,
        expectedEffects: body.expectedEffects,
        userApproved: true,
        signedPayload: body.signedPayload,
        idempotencyKey: body.idempotencyKey,
      });

      return withCacheHeaders(NextResponse.json({
        success: true,
        outcome: report.outcome,
        ...report.result,
        transaction: report.transaction,
      }), "execution");
    } catch (error) {
      const code = (error as { code?: string }).code ?? "submit_failed";
      const status = code === "approval_required" ? 403
        : code === "hash_chain_family_mismatch" || code === "network_chain_family_mismatch" ? 400
        : code === "transaction_not_found" ? 404
        : 502;
      return jsonError({ code: code as any, message: error instanceof Error ? error.message : "Could not submit transaction.", status, legacy: (error && typeof error === "object" && "detail" in error ? { extra: (error as { detail?: unknown }).detail } : {}) });
    }
  },
);
