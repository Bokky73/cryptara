/**
 * Explicit wallet approval flow for EVM calldata and Stellar transaction XDR.
 *
 * This module validates that a prepared transaction is safe to approve given:
 *   - The prepared record exists and is in "prepared" lifecycle status
 *   - The connected wallet address matches the prepared transaction's owner
 *   - The connected network matches the prepared transaction's network
 *   - The plan has not expired (10 min TTL from preparation)
 *   - The recommended action is not avoid / manual_review / no_action
 *
 * On success it returns a discriminated `PreparedTransactionPayload` that the
 * client sends to the user's wallet (wagmi or Stellar Wallets Kit) for signing.
 * The server never sees the private key or seed phrase – the signed payload
 * goes to POST /api/execute/submit for broadcast.
 */
import { toFunctionSelector } from "viem";
import type {
  ApprovalValidationResult,
  ApproveTransactionInput,
  ChainFamily,
  EvmPreparedTransactionPayload,
  PreparedTransactionPayload,
  StellarPreparedTransactionPayload,
  TransactionRecord,
} from "@/server/types";
import {
  getTransactionRecordByIdempotencyKey,
  updateTransactionRecord,
  appendLifecycleEventByName,
  isImmutableTerminal,
} from "@/server/storage";

const PREPARATION_TTL_MS = 10 * 60_000; // 10 minutes

/** Actions for which the server will NEVER allow a wallet signing prompt. */
const UNSAFE_ACTIONS = new Set([
  "avoid",
  "manual_review",
  "no_action",
  "hold",
  "watch",
  "prepare_transaction",
]);

function normalizeWallet(value?: string): string | undefined {
  return value?.trim().toLowerCase();
}

/**
 * Validate that a prepared transaction is safe for the user's wallet to sign.
 * Returns a detailed result with the typed payload when all checks pass.
 */
export async function validateApproval(
  input: ApproveTransactionInput,
  connectedWallet?: string,
  connectedNetwork?: string,
): Promise<ApprovalValidationResult> {
  const normalizedConnected = normalizeWallet(connectedWallet);
  const normalizedInputWallet = normalizeWallet(input.walletAddress);

  // 1. Look up the prepared transaction
  const record = getTransactionRecordByIdempotencyKey(input.walletAddress, input.idempotencyKey);

  if (!record) {
    return {
      allowed: false,
      blockedReason: "No prepared transaction found for this idempotency key. Call POST /api/execute/prepare first.",
      walletOk: true,
      networkOk: true,
      expired: false,
      actionSafe: true,
    };
  }

  // 2. Check lifecycle — only "prepared" can be approved
  if (isImmutableTerminal(record.lifecycleStatus)) {
    return {
      allowed: false,
      blockedReason: `Transaction is already in terminal state: ${record.lifecycleStatus}. A new prepare is required.`,
      walletOk: true,
      networkOk: true,
      expired: record.lifecycleStatus === "expired",
      actionSafe: true,
    };
  }

  if (record.lifecycleStatus !== "prepared") {
    return {
      allowed: false,
      blockedReason: `Transaction lifecycle is "${record.lifecycleStatus}". Only "prepared" transactions can be approved.`,
      walletOk: true,
      networkOk: true,
      expired: false,
      actionSafe: true,
    };
  }

  // 3. Check expiry (10 min TTL from creation)
  const createdAt = new Date(record.createdAt).getTime();
  const elapsed = Date.now() - createdAt;
  const expired = elapsed > PREPARATION_TTL_MS;

  if (expired) {
    // Mark as expired in storage
    updateTransactionRecord(record.hash, {
      lifecycleStatus: "expired",
      status: "expired",
      terminalAt: new Date().toISOString(),
      failureReason: "Preparation TTL expired before approval.",
    });
    appendLifecycleEventByName(record.hash, "expired", {
      reason: "Preparation TTL expired before wallet approval.",
      ttlMs: PREPARATION_TTL_MS,
      elapsedMs: elapsed,
    });

    return {
      allowed: false,
      blockedReason: `The prepared transaction expired after ${Math.round(PREPARATION_TTL_MS / 60_000)} minutes. Please prepare a new plan.`,
      walletOk: true,
      networkOk: true,
      expired: true,
      actionSafe: true,
    };
  }

  // 4. Check wallet match — connectedWallet is REQUIRED for safety
  if (!normalizedConnected) {
    return {
      allowed: false,
      blockedReason: "Connected wallet address is required for approval validation. Ensure your wallet is connected and the session is active.",
      walletOk: false,
      networkOk: false,
      expired: false,
      actionSafe: true,
    };
  }

  const walletOk =
    !record.walletAddress ||
    normalizedConnected === normalizeWallet(record.walletAddress);

  if (!walletOk) {
    return {
      allowed: false,
      blockedReason: `Connected wallet ${connectedWallet} does not match the prepared transaction's owner ${record.walletAddress}.`,
      walletOk: false,
      networkOk: true,
      expired: false,
      actionSafe: true,
    };
  }

  // 5. Check network match — connectedNetwork is REQUIRED for safety
  if (!connectedNetwork) {
    return {
      allowed: false,
      blockedReason: "Connected network is required for approval validation. Ensure your wallet is connected and a network is selected.",
      walletOk: true,
      networkOk: false,
      expired: false,
      actionSafe: true,
    };
  }

  const networkOk =
    !record.network ||
    connectedNetwork.toLowerCase() === record.network.toLowerCase();

  if (!networkOk) {
    return {
      allowed: false,
      blockedReason: `Connected network ${connectedNetwork} does not match the prepared transaction's network ${record.network}. Switch networks in your wallet.`,
      walletOk: true,
      networkOk: false,
      expired: false,
      actionSafe: true,
    };
  }

  // 6. Check action safety — block avoid/manual_review/no_action
  const decisionAction = record.decisionAction;
  const actionSafe = !decisionAction || !UNSAFE_ACTIONS.has(decisionAction);

  if (!actionSafe) {
    return {
      allowed: false,
      blockedReason: `The recommended action "${decisionAction}" cannot be signed. Only swap, reduce_exposure, and trustline actions are signable.`,
      walletOk: true,
      networkOk: true,
      expired: false,
      actionSafe: false,
    };
  }

  // 7. Build the typed payload for the wallet
  const payload = buildTypedPayload(record);

  // 8. Validate the built payload against expected effects
  //    Ensures the server does not blindly return caller-supplied calldata/XDR
  //    without cross-checking against the stored quote, simulation, and effects.
  const payloadValid = validatePayloadAgainstEffects(record, payload);
  if (!payloadValid.valid) {
    return {
      allowed: false,
      blockedReason: payloadValid.reason ?? "Payload validation failed: the stored transaction data does not match the expected effects.",
      walletOk: true,
      networkOk: true,
      expired: false,
      actionSafe: true,
    };
  }

  // 9. Metadata-only guard — block swap / reduce_exposure actions when there is
  //    no real calldata/XDR to sign. Metadata-only payloads (empty calldata/XDR)
  //    are acceptable for trustline or no-op actions where the wallet prompt is
  //    not expected to contain executable blockchain calldata. For swap actions,
  //    allowing a metadata-only payload through would show the user an empty
  //    wallet prompt (data: "0x") rather than the actual recommended swap.
  const isMetadataOnly = record.chainFamily === "evm"
    ? !record.calldata || record.calldata === "0x"
    : !record.stellarDetails?.envelopeXdr || record.stellarDetails.envelopeXdr.trim() === "";

  if (isMetadataOnly) {
    // Only "create_trustline" can proceed without calldata/XDR; "hold" and
    // "watch" are already blocked at step 6 by UNSAFE_ACTIONS, and swap
    // actions must have real calldata to avoid empty wallet prompts.
    const signableActions = new Set(["create_trustline"]);
    const action = record.decisionAction;

    // Explicitly block undefined actions too — being conservative avoids
    // sending an empty-calldata payload to the wallet for untyped records.
    if (action === undefined || !signableActions.has(action)) {
      const reason = action
        ? `This is a metadata-only transaction. Action "${action}" requires a real transaction payload built from a swap quote and simulation. A quote provider must be connected before wallet signing.`
        : "This is a metadata-only transaction without a recognized action type. Real transaction calldata is required before wallet signing.";
      return {
        allowed: false,
        blockedReason: reason,
        walletOk: true,
        networkOk: true,
        expired: false,
        actionSafe: false,
      };
    }
  }

  return {
    allowed: true,
    payload,
    walletOk: true,
    networkOk: true,
    expired: false,
    actionSafe: true,
  };
}

/**
 * Build a discriminated `PreparedTransactionPayload` from the transaction record.
 * The payload encodes everything the wallet needs to construct the signing prompt.
 */
function buildTypedPayload(record: TransactionRecord): PreparedTransactionPayload {
  const family = record.chainFamily;

  if (family === "evm") {
    return buildEvmPayload(record);
  }

  return buildStellarPayload(record);
}

/**
 * Build the same unsigned payload the approval endpoint returns, directly
 * from a prepared record. The prepare endpoint uses this so the browser can
 * verify the payload against the preview before the approval step.
 */
export function buildPreparedPayloadForTransaction(record: TransactionRecord): PreparedTransactionPayload {
  return buildTypedPayload(record);
}

function buildEvmPayload(record: TransactionRecord): EvmPreparedTransactionPayload {
  // Extract the target contract from expected effects or fall back to the asset
  const toContract =
    record.expectedEffects?.find((e) => e.contractAddress)?.contractAddress ?? record.asset;

  // Compute preparation expiry from the record's creation time
  const createdAtMs = new Date(record.createdAt).getTime();
  const preparationExpiry = new Date(createdAtMs + PREPARATION_TTL_MS).toISOString();

  // Estimate minimum output from the first effect's amount at ~1% slippage
  const firstEffect = record.expectedEffects?.[0];
  const rawAmount = firstEffect?.amount ? parseFloat(firstEffect.amount) : undefined;
  const minOutputAmount = rawAmount !== undefined ? (rawAmount * 0.99).toFixed(6) : undefined;

  return {
    chainFamily: "evm",
    to: toContract.startsWith("0x") ? toContract : `0x${toContract}`,
    data: record.calldata ?? "0x",
    value: "0",
    chainId: parseEvmChainId(record.network),
    gas: undefined,
    gasPrice: undefined,
    method: record.expectedEffects?.find((e) => e.method)?.method ?? record.type,
    displayParams: {
      action: record.decisionAction ?? "swap",
      asset: record.asset,
      valueUsd: record.valueUsd,
      policyAllowed: record.policyStatus?.allowed,
      policyViolations: record.policyStatus?.violations,
      preparationExpiry,
      minOutputAmount,
      expectedEffects: record.expectedEffects?.map((e) => ({
        kind: e.kind,
        from: e.fromAddress ?? record.walletAddress,
        to: e.toAddress,
        amount: e.amount,
      })),
    },
  };
}

function buildStellarPayload(record: TransactionRecord): StellarPreparedTransactionPayload {
  const stellarNetwork = record.network.startsWith("stellar-")
    ? record.network
    : "stellar-testnet";
  const networkPassphrase =
    stellarNetwork === "stellar-pubnet"
      ? "Public Global Stellar Network ; September 2015"
      : "Test SDF Network ; September 2015";

  const operations = (record.expectedEffects ?? []).map((effect) => ({
    type: effect.kind === "contract_call" ? "invokeHostFunction" : effect.kind === "publish_risk" ? "invokeHostFunction" : "payment",
    asset: effect.assetKey ?? effect.contractAddress,
    amount: effect.amount,
    destination: effect.toAddress,
    contractId: effect.contractAddress,
    method: effect.method,
  }));

  // Compute preparation expiry from the record's creation time
  const createdAtMs = new Date(record.createdAt).getTime();
  const preparationExpiry = new Date(createdAtMs + PREPARATION_TTL_MS).toISOString();

  // Estimate minimum output from the first effect's amount at ~1% slippage
  const firstEffect = record.expectedEffects?.[0];
  const rawAmount = firstEffect?.amount ? parseFloat(firstEffect.amount) : undefined;
  const minOutputAmount = rawAmount !== undefined ? (rawAmount * 0.99).toFixed(6) : undefined;

  return {
    chainFamily: "stellar",
    xdr: record.stellarDetails?.envelopeXdr ?? "",
    networkPassphrase,
    sourceAccount: record.sourceAccount ?? record.walletAddress ?? "",
    operations,
    fee: record.stellarDetails?.feeCharged,
    sequence: record.stellarDetails?.sequence,
    timeBounds: undefined,
    method: record.decisionAction ?? "swap",
    displayParams: {
      action: record.decisionAction ?? "swap",
      asset: record.asset,
      valueUsd: record.valueUsd,
      operationCount: operations.length,
      policyAllowed: record.policyStatus?.allowed,
      policyViolations: record.policyStatus?.violations,
      preparationExpiry,
      minOutputAmount,
    },
  };
}

/**
 * Extract the 4-byte method selector from 0x-prefixed EVM calldata.
 * Returns lowercase hex string (e.g. "a9059cbb") or undefined.
 */
function extractEvmMethodSelector(calldata: string): string | undefined {
  const hex = calldata.startsWith("0x") ? calldata.slice(2) : calldata;
  return hex.length >= 8 ? hex.slice(0, 8).toLowerCase() : undefined;
}

/**
 * Derive the expected 4-byte method selector from a human-readable
 * method signature using viem's toFunctionSelector.
 */
function deriveMethodSelector(method: string | undefined): string | undefined {
  if (!method) return undefined;
  try {
    return toFunctionSelector(method).toLowerCase().replace("0x", "");
  } catch {
    return undefined;
  }
}

/**
 * Validate the built payload against the stored transaction record.
 * Ensures the server does not blindly return caller-supplied calldata/XDR
 * without cross-checking against stored expected effects, contract address,
 * method selectors, amounts, and operation details.
 */
function validatePayloadAgainstEffects(
  record: TransactionRecord,
  payload: PreparedTransactionPayload,
): { valid: boolean; reason?: string } {
  const effects = record.expectedEffects;
  const family = record.chainFamily;

  // No effects to validate against — skip validation
  if (!effects || effects.length === 0) {
    // Still ensure basic payload integrity: at minimum verify the payload
    // is not trivially empty for the given chain family
    if (family === "evm") {
      const evmP = payload as EvmPreparedTransactionPayload;
      if (!evmP.to || evmP.to === "0x" || evmP.data === "0x") {
        return { valid: false, reason: "EVM payload is empty: no target contract or calldata provided." };
      }
    }
    if (family === "stellar") {
      const stP = payload as StellarPreparedTransactionPayload;
      if (!stP.xdr || stP.xdr.trim() === "") {
        return { valid: false, reason: "Stellar payload is empty: no XDR envelope provided." };
      }
    }
    return { valid: true };
  }

  // ── Metadata-only payloads ────────────────────────────────────────────────
  // When the transaction record was prepared without a real payload (no swap
  // quote or simulation that produces calldata/XDR), the stored 'calldata' and
  // 'stellarDetails.envelopeXdr' fields will be empty. This is the normal case
  // for dashboard-initiated generic prepares where the server only has metadata
  // (expected effects, amounts, addresses) from the agent decision, not actual
  // blockchain-calldata.
  //
  // For metadata-only payloads:
  //   - Validate the *effects* (contract addresses, amounts, operation types)
  //     against the record's expected effects — this ensures the metadata that
  //     WAS stored is internally consistent.
  //   - Do NOT fail on missing calldata/XDR because there simply isn't any to
  //     validate — the server rebuilt what it could from its own trusted data.
  //
  // When a real payload IS present (full swap integration), calldata and XDR
  // will be present and the cross-checks below run strictly.

  const isMetadataOnly = family === "evm"
    ? !(payload as EvmPreparedTransactionPayload).data ||
      (payload as EvmPreparedTransactionPayload).data === "0x"
    : !(payload as StellarPreparedTransactionPayload).xdr ||
      (payload as StellarPreparedTransactionPayload).xdr.trim() === "";

  if (isMetadataOnly) {
    // For metadata-only payloads, validate what we have: effect metadata must
    // be consistent. Skip calldata/XDR-specific checks.
    if (family === "evm") {
      const evmP = payload as EvmPreparedTransactionPayload;
      // Verify the to address matches the first effect's contract address
      const contractEffect = effects.find((e) => e.contractAddress);
      if (contractEffect?.contractAddress) {
        const expectedTo = contractEffect.contractAddress.startsWith("0x")
          ? contractEffect.contractAddress.toLowerCase()
          : `0x${contractEffect.contractAddress.toLowerCase()}`;
        const actualTo = evmP.to.toLowerCase();
        if (actualTo !== expectedTo) {
          return {
            valid: false,
            reason: `EVM payload target contract ${actualTo} does not match expected contract ${expectedTo}.`,
          };
        }
      }
    } else {
      // Stellar: validate that operation types from effects match the built payload
      const stP = payload as StellarPreparedTransactionPayload;
      if (stP.operations.length > 0 && stP.operations.length !== effects.length) {
        return {
          valid: false,
          reason: `Stellar payload operation count (${stP.operations.length}) does not match expected effects (${effects.length}).`,
        };
      }
      // Validate operation type consistency
      for (let i = 0; i < Math.min(effects.length, stP.operations.length); i++) {
        const effectKind = effects[i].kind;
        const opType = stP.operations[i]?.type;
        if (effectKind === "contract_call" && opType !== "invokeHostFunction") {
          return {
            valid: false,
            reason: `Stellar effect #${i} is "contract_call" but operation type is "${opType}".`,
          };
        }
        if (effectKind === "transfer" && opType !== "payment") {
          return {
            valid: false,
            reason: `Stellar effect #${i} is "transfer" but operation type is "${opType}".`,
          };
        }
      }
      // Validate source account if available
      if (record.sourceAccount && stP.sourceAccount) {
        const expectedSrc = record.sourceAccount.trim().toUpperCase();
        const actualSrc = stP.sourceAccount.trim().toUpperCase();
        if (actualSrc !== expectedSrc) {
          return {
            valid: false,
            reason: `Stellar payload source account ${actualSrc} does not match expected ${expectedSrc}.`,
          };
        }
      }
    }
    return { valid: true };
  }

  // Cross-check calldata/XDR against expected effects
  if (family === "evm") {
    const evmP = payload as EvmPreparedTransactionPayload;
    const contractEffect = effects.find((e) => e.contractAddress);

    // If effects specify a contract, verify the to address matches
    if (contractEffect?.contractAddress) {
      const expectedTo = contractEffect.contractAddress.startsWith("0x")
        ? contractEffect.contractAddress.toLowerCase()
        : `0x${contractEffect.contractAddress.toLowerCase()}`;
      const actualTo = evmP.to.toLowerCase();
      if (actualTo !== expectedTo) {
        return {
          valid: false,
          reason: `EVM payload target contract ${actualTo} does not match expected contract ${expectedTo}.`,
        };
      }
    }

    // Validate method selector from calldata matches expected method
    const methodEffect = effects.find((e) => e.method);
    if (methodEffect?.method) {
      if (!evmP.data || evmP.data === "0x") {
        return {
          valid: false,
          reason: `EVM payload is missing calldata for method "${methodEffect.method}".`,
        };
      }

      // Extract the actual method selector from calldata bytes [0..3]
      const actualSelector = extractEvmMethodSelector(evmP.data);
      const expectedSelector = deriveMethodSelector(methodEffect.method);

      if (actualSelector && expectedSelector && actualSelector !== expectedSelector) {
        return {
          valid: false,
          reason: `EVM calldata method selector 0x${actualSelector} does not match expected selector 0x${expectedSelector} for method "${methodEffect.method}".`,
        };
      }
    }

    // Validate amounts specified in effects are reflected in display params
    for (const effect of effects) {
      if (effect.amount && effect.kind) {
        // The effect amount must be present in displayParams.expectedEffects
        const matched = evmP.displayParams?.expectedEffects as
          | Array<{ kind?: string; amount?: string }>
          | undefined;
        if (matched) {
          const match = matched.find(
            (m) => m.kind === effect.kind && m.amount !== effect.amount,
          );
          if (match) {
            return {
              valid: false,
              reason: `EVM effect "${effect.kind}" amount ${match.amount} does not match expected amount ${effect.amount}.`,
            };
          }
        }
      }
    }
  }

  if (family === "stellar") {
    const stP = payload as StellarPreparedTransactionPayload;

    // Validate XDR is present when effects exist
    if (!stP.xdr || stP.xdr.trim() === "") {
      return { valid: false, reason: "Stellar payload is missing XDR envelope for expected operations." };
    }

    // Validate operation count matches expectations
    if (stP.operations.length !== effects.length) {
      return {
        valid: false,
        reason: `Stellar payload operation count (${stP.operations.length}) does not match expected effects (${effects.length}).`,
      };
    }

    // Validate source account matches
    if (record.sourceAccount && stP.sourceAccount) {
      const expectedSrc = record.sourceAccount.trim().toUpperCase();
      const actualSrc = stP.sourceAccount.trim().toUpperCase();
      if (actualSrc !== expectedSrc) {
        return {
          valid: false,
          reason: `Stellar payload source account ${actualSrc} does not match expected ${expectedSrc}.`,
        };
      }
    }

    // Validate operation types match effect kinds
    for (let i = 0; i < effects.length; i++) {
      const effectKind = effects[i].kind;
      const opType = stP.operations[i]?.type;
      if (effectKind === "contract_call" && opType !== "invokeHostFunction") {
        return {
          valid: false,
          reason: `Stellar effect #${i} is "contract_call" but XDR operation type is "${opType}".`,
        };
      }
      if (effectKind === "transfer" && opType !== "payment") {
        return {
          valid: false,
          reason: `Stellar effect #${i} is "transfer" but XDR operation type is "${opType}".`,
        };
      }
    }
  }

  return { valid: true };
}

function parseEvmChainId(network: string): number {
  const chainIdMap: Record<string, number> = {
    ethereum: 1,
    base: 8453,
    bsc: 56,
    arbitrum: 42161,
    polygon: 137,
    optimism: 10,
    avalanche: 43114,
    goat: 48816,
    line: 59144,
    scroll: 534352,
    zksync: 324,
    berachain: 80094,
    sonic: 146,
    unichain: 130,
    worldchain: 480,
    monad: 143,
    plasma: 9745,
  };

  const normalized = network.trim().toLowerCase();
  return chainIdMap[normalized] ?? 1;
}
