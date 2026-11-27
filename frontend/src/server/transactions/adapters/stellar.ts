import { createHash } from "node:crypto";
import { TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import type { ChainFamily } from "@/lib/chainIdentity";
import { isTransactionHashForChain } from "@/lib/chainIdentity";
import { getStellarNetwork, type StellarNetworkConfig, type StellarNetworkId } from "@/lib/stellar/config";
import type { TransactionExpectedEffect } from "@/server/types";

export type StellarTerminalStatus = "confirming" | "confirmed" | "failed" | "replaced" | "reorged" | "dropped" | "manual_review" | "expired" | "pending" | "submitted";

export type StellarVerificationExpectation = {
  walletAddress?: string;
  expectedEffects?: TransactionExpectedEffect[];
  sourceAccount?: string;
};

export type StellarSubmitResult = {
  hash: string;
  family: ChainFamily;
  network: StellarNetworkId;
  status: StellarTerminalStatus;
  providerUrl: string;
  broadcastAcceptedAt?: string;
  detail: string;
  errorResultXdr?: string;
  failureReason?: string;
};

export type StellarPollResult = {
  hash: string;
  family: ChainFamily;
  network: StellarNetworkId;
  status: StellarTerminalStatus;
  ledger?: number;
  createdAt?: string;
  envelopeXdr?: string;
  resultXdr?: string;
  revertReason?: string;
  providerUrl: string;
  polledAt: string;
  sourceAccount?: string;
  matchedEffects?: boolean;
  verificationDetail?: string;
  observationStatus?: "not_found" | "pending" | "included" | "confirmed" | "failed" | "replaced" | "expired" | "duplicate" | "provider_disagreement";
  confirmations?: number;
  requiredConfirmations?: number;
  replacementHash?: string;
  providerAgreement?: boolean;
};

export type StellarAdapterOptions = {
  network: string;
  rpcUrl?: string;
  confirmationDepth?: number;
};

type StellarPollFixtureStatus = "confirmed" | "failed" | "replaced" | "duplicate" | "provider_disagreement" | "expired" | "pending";

type StellarSimulatorConfig = {
  submitOutcome?: "submitted" | "rejected" | "expired" | "failed";
  pollOutcome?: StellarPollFixtureStatus;
  pollSequence?: Array<{ status: StellarPollFixtureStatus; ledger?: number; latestLedger?: number; confirmations?: number }>;
  pollCursor?: number;
  expectedEffects?: TransactionExpectedEffect[];
};

const STELLAR_SIMULATOR = new Map<string, StellarSimulatorConfig>();

export function configureStellarSimulator(family: ChainFamily, network: string, config: StellarSimulatorConfig) {
  if (family !== "stellar") return;
  STELLAR_SIMULATOR.set(`${family}:${network.toLowerCase()}`, config);
}

export function clearStellarSimulator() {
  STELLAR_SIMULATOR.clear();
}

function getStellarSimulator(family: ChainFamily, network: string) {
  return STELLAR_SIMULATOR.get(`${family}:${network.toLowerCase()}`);
}

function getStellarNetworkByName(network: string): StellarNetworkId {
  const normalized = network.trim().toLowerCase();
  if (normalized === "stellar-pubnet" || normalized === "pubnet" || normalized === "stellar-mainnet") return "stellar-pubnet";
  return "stellar-testnet";
}

function getStellarRpcUrl(network: StellarNetworkId, override?: string): string {
  if (override) return override;
  const config = getStellarNetwork(network);
  return config?.rpcUrls?.[0] ?? "https://soroban-testnet.stellar.org";
}

function computeSimulatedHash(payload: string, network: string) {
  return createHash("sha256").update(`${network}:${payload}`).digest("hex");
}

function isPreHashInput(payload: string) {
  return isTransactionHashForChain(payload, "stellar") || /^[a-fA-F0-9]{64}$/.test(payload);
}

type StellarRpcSendResponse = Awaited<ReturnType<rpc.Server["sendTransaction"]>>;
type StellarRpcGetResponse = Awaited<ReturnType<rpc.Server["getTransaction"]>>;

export function getStellarChainAdapter(options: StellarAdapterOptions): {
  family: ChainFamily;
  network: StellarNetworkId;
  deriveHash: (payload: string) => string;
  submit: (
    payload: string,
    overrides?: {
      simulate?: StellarSimulatorConfig["submitOutcome"];
      expectedEffects?: TransactionExpectedEffect[];
      sourceAccount?: string;
    },
  ) => Promise<StellarSubmitResult>;
  poll: (
    hash: string,
    overrides?: {
      simulate?: StellarSimulatorConfig["pollOutcome"];
      expectation?: StellarVerificationExpectation;
    },
  ) => Promise<StellarPollResult>;
} {
  const network = getStellarNetworkByName(options.network);
  const family: ChainFamily = "stellar";
  const providerUrl = getStellarRpcUrl(network, options.rpcUrl);

  function requireConfig(): StellarNetworkConfig {
    const config = getStellarNetwork(network);
    if (!config) throw new Error(`Unsupported Stellar network: ${options.network}`);
    return config;
  }

  function performPreSubmitChecks(payload: string, config: StellarNetworkConfig, expectation: StellarVerificationExpectation | undefined) {
    const transaction = TransactionBuilder.fromXDR(payload, config.networkPassphrase);
    if ("innerTransaction" in transaction) {
      throw new Error("Fee-bump transactions are not accepted by the transaction lifecycle.");
    }
    if (expectation?.sourceAccount && transaction.source !== expectation.sourceAccount) {
      throw new Error(`Stellar transaction source ${transaction.source} does not match expected connected account ${expectation.sourceAccount}.`);
    }
    if (expectation?.expectedEffects?.some((effect) => effect.kind === "publish_risk")) {
      const operations = transaction.operations.map((operation) => operation.type);
      if (!operations.includes("invokeHostFunction")) {
        throw new Error("Stellar publish_risk expected an invokeHostFunction operation.");
      }
    }
    return transaction;
  }

  const config = requireConfig();
  const networkPassphrase = config.networkPassphrase;

  return {
    family,
    network,
    deriveHash(payload: string) {
      if (getStellarSimulator(family, options.network) || isPreHashInput(payload)) {
        return computeSimulatedHash(payload, options.network);
      }
      const transaction = TransactionBuilder.fromXDR(payload, networkPassphrase);
      return Buffer.from(transaction.hash()).toString("hex");
    },
    async submit(payload, overrides) {
      const simulator = getStellarSimulator(family, options.network);
      const outcome = overrides?.simulate ?? simulator?.submitOutcome;
      const expectation: StellarVerificationExpectation = {
        sourceAccount: overrides?.sourceAccount,
        expectedEffects: overrides?.expectedEffects,
      };
      const useSimulatedHash = Boolean(simulator) || isPreHashInput(payload);

      const transactionHash = useSimulatedHash
        ? computeSimulatedHash(payload, options.network)
        : (() => {
            try {
              const transaction = performPreSubmitChecks(payload, config, expectation);
              return Buffer.from(transaction.hash()).toString("hex");
            } catch (error) {
              throw new Error(error instanceof Error ? error.message : "Stellar XDR could not be parsed for the configured network passphrase.");
            }
          })();

      if (outcome === "rejected") {
        throw new Error("Stellar RPC rejected the transaction (bad sequence or insufficient fee).");
      }
      if (outcome === "expired") {
        throw new Error("Stellar RPC submission expired (stale ledger or sequence number).");
      }
      if (outcome === "failed") {
        throw new Error("Stellar RPC reported a fatal provider error.");
      }

      const submitted = !simulator && !outcome && !useSimulatedHash
        ? await safeSendTransaction(payload, networkPassphrase, providerUrl).catch(() => undefined)
        : undefined;

      if (!simulator && !outcome && !useSimulatedHash && !submitted) {
        throw new Error("Stellar RPC refused the transaction (broadcast did not return a response).");
      }

      return {
        hash: transactionHash,
        family,
        network,
        status: "submitted",
        providerUrl,
        broadcastAcceptedAt: submitted?.broadcastAt ?? new Date().toISOString(),
        detail: outcome
          ? `Simulated ${outcome} submit outcome for chain adapter tests.`
          : submitted
            ? "Stellar signed transaction submitted to RPC."
            : "Stellar transaction hash accepted as already broadcast (skip provider).",
        errorResultXdr: submitted?.errorResultXdr,
      };
    },
    async poll(hash, overrides) {
      const simulator = getStellarSimulator(family, options.network);
      const sequenceItem = simulator?.pollSequence?.[simulator.pollCursor ?? 0];
      if (sequenceItem && simulator) simulator.pollCursor = (simulator.pollCursor ?? 0) + 1;
      const outcome = overrides?.simulate ?? sequenceItem?.status ?? simulator?.pollOutcome;
      const polledAt = new Date().toISOString();
      const requiredConfirmations = Math.max(1, options.confirmationDepth ?? Number(process.env.STELLAR_FINALITY_LEDGERS ?? 2));

      if (outcome === "expired") return { hash, family, network, status: "expired", observationStatus: "expired", providerUrl, polledAt, confirmations: 0, requiredConfirmations };
      if (outcome === "replaced") return { hash, family, network, status: "replaced", observationStatus: "replaced", providerUrl, polledAt, confirmations: 0, requiredConfirmations };
      if (outcome === "failed") return { hash, family, network, status: "failed", observationStatus: "failed", providerUrl, polledAt, revertReason: "Simulated revert reason (fixture coverage).", confirmations: 0, requiredConfirmations };
      if (outcome === "pending") return { hash, family, network, status: "pending", observationStatus: "pending", providerUrl, polledAt, confirmations: 0, requiredConfirmations };
      if (outcome === "duplicate") return { hash, family, network, status: "pending", observationStatus: "duplicate", providerUrl, polledAt, confirmations: 0, requiredConfirmations };
      if (outcome === "provider_disagreement") return { hash, family, network, status: "manual_review", observationStatus: "provider_disagreement", providerAgreement: false, providerUrl, polledAt, confirmations: 0, requiredConfirmations };

      if (simulator) {
        return {
          hash,
          family,
          network,
          status: (sequenceItem?.confirmations ?? requiredConfirmations) >= requiredConfirmations ? "confirmed" : "confirming",
          observationStatus: "included",
          providerUrl,
          polledAt,
          ledger: sequenceItem?.ledger ?? 1,
          confirmations: sequenceItem?.confirmations ?? requiredConfirmations,
          requiredConfirmations,
          matchedEffects: undefined,
          verificationDetail: "Simulated on-chain confirmation (fixture coverage).",
        };
      }

      const real = await safeGetTransaction(hash, providerUrl).catch(() => undefined);
      if (!real) {
        return { hash, family, network, status: "pending", observationStatus: "not_found", providerUrl, polledAt, confirmations: 0, requiredConfirmations };
      }

      const decodedSource = decodeStellarEnvelopeSource(real, networkPassphrase);
      const mapped = mapStellarPollResponse(real, hash, family, network, providerUrl, polledAt, decodedSource);

      if (mapped.status === "pending") {
        return mapped;
      }

      const decodedOps = decodeStellarEnvelopeOperations(real, networkPassphrase);
      const effectsCheck = verifyStellarEffects(real, overrides?.expectation, decodedSource, decodedOps);
      if (!effectsCheck.matched) {
        return {
          ...mapped,
          status: "failed",
          revertReason: effectsCheck.detail ?? mapped.revertReason ?? "Effect verification failed.",
          matchedEffects: false,
          verificationDetail: effectsCheck.detail,
        };
      }

      if (mapped.status === "confirmed") {
        const latestLedger = await safeGetLatestLedger(providerUrl).catch(() => mapped.ledger);
        const confirmations = mapped.ledger && latestLedger ? Math.max(0, latestLedger - mapped.ledger + 1) : 1;
        return {
          ...mapped,
          status: confirmations >= requiredConfirmations ? "confirmed" : "confirming",
          observationStatus: "included",
          confirmations,
          requiredConfirmations,
          matchedEffects: effectsCheck.matched,
          verificationDetail: effectsCheck.detail,
        };
      }

      return { ...mapped, confirmations: 0, requiredConfirmations, matchedEffects: effectsCheck.matched, verificationDetail: effectsCheck.detail };
    },
  };
}

async function safeSendTransaction(payload: string, networkPassphrase: string, providerUrl: string): Promise<{ broadcastAt: string; errorResultXdr?: string } | undefined> {
  let transaction;
  try {
    transaction = TransactionBuilder.fromXDR(payload, networkPassphrase);
    if ("innerTransaction" in transaction) return undefined;
  } catch {
    return undefined;
  }

  try {
    const server = new rpc.Server(providerUrl, { allowHttp: false, timeout: 8_000 });
    const raw = await server.sendTransaction(transaction).catch((error) => {
      throw error instanceof Error ? error : new Error("Unknown RPC error during sendTransaction");
    });
    const response = raw as StellarRpcSendResponse;
    const record = response as unknown as Record<string, unknown>;
    if (typeof record.hash === "string") {
      return { broadcastAt: new Date().toISOString() };
    }
    const errorResult = record.errorResult;
    if (errorResult && typeof (errorResult as { toString?: unknown }).toString === "function") {
      return { broadcastAt: new Date().toISOString(), errorResultXdr: (errorResult as { toString: (encoding: string) => string }).toString("base64") };
    }
    return { broadcastAt: new Date().toISOString() };
  } catch (error) {
    return undefined;
  }
}

async function safeGetTransaction(hash: string, providerUrl: string): Promise<StellarRpcGetResponse | undefined> {
  try {
    const server = new rpc.Server(providerUrl, { allowHttp: false, timeout: 8_000 });
    return (await server.getTransaction(hash)) as StellarRpcGetResponse;
  } catch {
    return undefined;
  }
}

async function safeGetLatestLedger(providerUrl: string): Promise<number | undefined> {
  const server = new rpc.Server(providerUrl, { allowHttp: false, timeout: 8_000 });
  const latest = await server.getLatestLedger();
  return toLedgerNumber((latest as unknown as Record<string, unknown>).sequence);
}

function decodeStellarEnvelopeSource(response: StellarRpcGetResponse, networkPassphrase: string): string | undefined {
  const record = response as unknown as Record<string, unknown>;
  const envelope = typeof record.envelopeXdr === "string" ? record.envelopeXdr : undefined;
  if (!envelope) return undefined;
  try {
    const transaction = TransactionBuilder.fromXDR(envelope, networkPassphrase);
    if ("innerTransaction" in transaction) return undefined;
    return (transaction as unknown as Record<string, unknown>).source as string | undefined;
  } catch {
    return undefined;
  }
}

function decodeStellarEnvelopeOperations(response: StellarRpcGetResponse, networkPassphrase: string): Array<Record<string, unknown>> {
  const record = response as unknown as Record<string, unknown>;
  const envelope = typeof record.envelopeXdr === "string" ? record.envelopeXdr : undefined;
  if (!envelope) return [];
  try {
    const transaction = TransactionBuilder.fromXDR(envelope, networkPassphrase);
    if ("innerTransaction" in transaction) return [];
    const txSource = (transaction as unknown as Record<string, unknown>).source as string | undefined;
    return transaction.operations.map((op) => {
      const opRecord: Record<string, unknown> = { type: op.type };
      if ("to" in op) opRecord.to = (op as unknown as Record<string, unknown>).to;
      if ("from" in op) opRecord.from = (op as unknown as Record<string, unknown>).from;
      if ("destination" in op) opRecord.destination = (op as unknown as Record<string, unknown>).destination;
      if ("amount" in op) opRecord.amount = (op as unknown as Record<string, unknown>).amount;
       if ("source" in op) opRecord.source = (op as unknown as Record<string, unknown>).source ?? txSource;
       if ("asset" in op) opRecord.asset = (op as unknown as Record<string, unknown>).asset;
       return opRecord;
    });
  } catch {
    return [];
  }
}

function mapStellarPollResponse(response: StellarRpcGetResponse, hash: string, family: ChainFamily, network: StellarNetworkId, providerUrl: string, polledAt: string, decodedSource?: string): StellarPollResult {
  const status = response.status;
  const record = response as unknown as Record<string, unknown>;
  const ledger = toLedgerNumber(record.ledger);
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : undefined;
  const resultXdr = typeof record.resultXdr === "string" ? record.resultXdr : undefined;
  const sourceAccount = decodedSource ?? (typeof record.sourceAccount === "string" ? record.sourceAccount : undefined);

  if (status === "SUCCESS") {
    return { hash, family, network, status: "confirmed", observationStatus: "included", providerUrl, polledAt, ledger, createdAt, resultXdr, sourceAccount };
  }

  if (status === "FAILED") {
    return { hash, family, network, status: "failed", observationStatus: "failed", providerUrl, polledAt, ledger, createdAt, resultXdr, revertReason: resultXdr };
  }

  return { hash, family, network, status: "pending", observationStatus: "pending", providerUrl, polledAt };
}

function toLedgerNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.length > 0 && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
}

function verifyStellarEffects(response: StellarRpcGetResponse, expectation: StellarVerificationExpectation | undefined, decodedSource?: string, decodedOps?: Array<Record<string, unknown>>) {
  if (!expectation) return { matched: true, detail: undefined as string | undefined };

  const responseRecord = response as unknown as Record<string, unknown>;
  const observedSource = decodedSource ?? (typeof responseRecord.sourceAccount === "string" ? responseRecord.sourceAccount : undefined);
  const expectedSource = expectation.sourceAccount ?? expectation.walletAddress;

  if (expectedSource) {
    if (!observedSource) {
      return { matched: false, detail: `expected Stellar sourceAccount ${expectedSource} but response.sourceAccount is absent` };
    }
    if (observedSource.toLowerCase() !== expectedSource.toLowerCase()) {
      return { matched: false, detail: `Stellar sourceAccount ${observedSource} does not match expected ${expectedSource}` };
    }
  }

  const operationsList = decodedOps ?? undefined;

  for (const effect of expectation.expectedEffects ?? []) {
    if (effect.kind === "publish_risk") {
      if (!operationsList || !operationsList.some((operation) => operation.type === "invokeHostFunction")) {
        return { matched: false, detail: `publish_risk expected invokeHostFunction operation, observed ${operationsList ? operationsList.map((o) => String(o.type ?? "unknown")) : "none"}` };
      }
      continue;
    }

    if (effect.kind === "transfer" || effect.kind === "swap") {
      if (!operationsList) {
        return { matched: false, detail: `${effect.kind} expected at least one payment/transfer/invokeHostFunction operation, observed none` };
      }
      const paymentOp = operationsList.find((operation) => operation.type === "payment" || operation.type === "pathPaymentStrictSend" || operation.type === "pathPaymentStrictReceive");
      if (!paymentOp) {
        return { matched: false, detail: `${effect.kind} expected payment-style operation, observed ${operationsList.map((o) => String(o.type ?? "unknown"))}` };
      }
      if (effect.fromAddress || effect.toAddress) {
        // Stellar SDK decoded operations record the effective source under
        // `source` (per-operation override or tx-level default), not `from`.
        const opSource = typeof paymentOp.source === "string" ? paymentOp.source : undefined;
        const opTo = typeof paymentOp.to === "string" ? paymentOp.to : (typeof paymentOp.destination === "string" ? paymentOp.destination : undefined);
        if (effect.fromAddress && (!opSource || opSource.toLowerCase() !== effect.fromAddress.toLowerCase())) {
          return { matched: false, detail: `${effect.kind} expected fromAddress ${effect.fromAddress}, observed ${opSource ?? "absent"}` };
        }
        if (effect.toAddress && (!opTo || opTo.toLowerCase() !== effect.toAddress.toLowerCase())) {
          return { matched: false, detail: `${effect.kind} expected toAddress ${effect.toAddress}, observed ${opTo ?? "absent"}` };
        }
      }
      if (effect.assetKey) {
        const opAsset = typeof paymentOp.asset === "string"
          ? paymentOp.asset
          : (paymentOp.asset as { code?: string; issuer?: string } | undefined)?.code;
        if (opAsset && opAsset.toLowerCase() !== effect.assetKey.toLowerCase()) {
          return { matched: false, detail: `${effect.kind} expected assetKey ${effect.assetKey}, observed ${opAsset}` };
        }
      }
      if (effect.amountBaseUnits || effect.amount) {
        const opAmountRaw = typeof paymentOp.amount === "string" ? paymentOp.amount : undefined;
        // Stellar SDK returns amounts as decimal strings (e.g. "100.5000000").
        // Convert to integer by removing the decimal separator and padding to the
        // expected scale so the comparison with BigInt base-units works correctly.
        const opAmountBaseUnits = opAmountRaw
          ? BigInt(opAmountRaw.replace(".", "").replace(/^0+/, "") || "0")
          : undefined;
        const expectedBaseUnits = effect.amountBaseUnits
          ?? (/^\d+$/.test(effect.amount ?? "") ? effect.amount : undefined);
        if (expectedBaseUnits) {
          try {
            const expectedBig = BigInt(expectedBaseUnits);
            if (opAmountBaseUnits !== expectedBig) {
              return { matched: false, detail: `${effect.kind} expected amount ${expectedBaseUnits} base units, observed ${opAmountRaw ?? "absent"} (${String(opAmountBaseUnits ?? "N/A")} base units)` };
            }
          } catch (error) {
            return { matched: false, detail: `${effect.kind} amount comparison failed: ${error instanceof Error ? error.message : "unknown"}` };
          }
        } else if (effect.amount && opAmountRaw && opAmountRaw !== effect.amount) {
          return { matched: false, detail: `${effect.kind} expected amount ${effect.amount}, observed ${opAmountRaw}` };
        }
      }
      continue;
    }

    if (effect.kind === "approval") {
      if (!operationsList) {
        return { matched: false, detail: `approval expected an authorize trustline or setOptions operation, observed none` };
      }
      const matches = operationsList.some((operation) => operation.type === "allowTrust" || operation.type === "setTrustLineFlags" || operation.type === "setOptions");
      if (!matches) {
        return { matched: false, detail: `approval expected allowTrust/setTrustLineFlags/setOptions operation, observed ${operationsList.map((o) => String(o.type ?? "unknown"))}` };
      }
      continue;
    }

    if (effect.kind === "contract_call") {
      if (!operationsList || !operationsList.some((operation) => operation.type === "invokeHostFunction")) {
        return { matched: false, detail: `contract_call expected invokeHostFunction operation, observed ${operationsList ? operationsList.map((o) => String(o.type ?? "unknown")) : "none"}` };
      }
    }
  }

  return { matched: true, detail: undefined as string | undefined };
}
