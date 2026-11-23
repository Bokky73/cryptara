import { randomUUID } from "node:crypto";
import { Horizon } from "@stellar/stellar-sdk";
import {
  getStellarDataApiUrls,
  getStellarNetwork,
  type StellarNetworkId,
} from "@/lib/stellar/config";
import {
  StellarDataLayerError,
  type StellarProviderAttempt,
  type StellarProviderMetadata,
} from "@/server/stellar/dataLayer";
import { redactProviderUrl } from "@/lib/stellar/failover";
import { sharedProviderCircuits } from "@/server/providers/adapter";
import { recordNegativeCacheEntry } from "@/server/cache/negative";

export type StellarAccountRecord = Awaited<
  ReturnType<Horizon.Server["loadAccount"]>
>;

export type StellarAccountDataAdapter = {
  loadAccount(
    accountId: string,
    network: StellarNetworkId,
    requestId?: string,
  ): Promise<{ value: StellarAccountRecord; meta: StellarProviderMetadata }>;
};

type HorizonAdapterOptions = {
  providerUrls?: Partial<Record<StellarNetworkId, readonly string[]>>;
  serverFactory?: (url: string, requestId: string) => Pick<Horizon.Server, "loadAccount">;
  timeoutMs?: number;
  retryLimit?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Absolute epoch-ms deadline for the whole orchestration; per-call budgets derive from it. */
  deadlineAt?: number;
  /** Minimum per-call budget so we don't fire zero-timeout requests. */
  minTimeoutMs?: number;
};

const IDEMPOTENT_RETRY_CODES = new Set(["timeout", "transport_error"]);
const IDEMPOTENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);

function isIdempotentRetryable(error: unknown, failure: ReturnType<typeof classify>) {
  if (!failure.retryable) return false;
  const status =
    typeof error === "object" && error !== null && "response" in error
      ? (error as { response?: { status?: unknown } }).response?.status
      : undefined;
  if (typeof status === "number") {
    return IDEMPOTENT_HTTP_STATUSES.has(status);
  }
  return IDEMPOTENT_RETRY_CODES.has(failure.code);
}

function jitteredBackoff(attempt: number) {
  const base = 100 * 2 ** attempt;
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function defaultServerFactory(url: string, requestId: string) {
  return new Horizon.Server(url, {
    allowHttp: url.startsWith("http://"),
    headers: { "x-request-id": requestId },
  });
}

function classify(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const timeout = normalized.includes("timeout") || normalized.includes("abort");
  return {
    message,
    code: timeout ? ("timeout" as const) : ("transport_error" as const),
    retryable:
      timeout ||
      normalized.includes("fetch") ||
      normalized.includes("network") ||
      normalized.includes("econn"),
  };
}

async function timeout<T>(operation: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new StellarDataLayerError(
            "timeout",
            `Horizon request timed out after ${milliseconds}ms`,
            true,
          ),
        ),
      milliseconds,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class HorizonAccountDataAdapter implements StellarAccountDataAdapter {
  private readonly options: Required<
    Pick<
      HorizonAdapterOptions,
      "timeoutMs" | "retryLimit" | "now" | "sleep" | "minTimeoutMs"
    >
  > &
    HorizonAdapterOptions;

  constructor(options: HorizonAdapterOptions = {}) {
    this.options = {
      ...options,
      timeoutMs: options.timeoutMs ?? 8_000,
      retryLimit: Math.max(0, options.retryLimit ?? 1),
      now: options.now ?? Date.now,
      minTimeoutMs: Math.max(1, options.minTimeoutMs ?? 250),
      sleep:
        options.sleep ??
        ((milliseconds) =>
          new Promise((resolve) => {
            setTimeout(resolve, milliseconds);
          })),
    };
  }

  private remainingBudget() {
    if (typeof this.options.deadlineAt !== "number") {
      return this.options.timeoutMs;
    }
    return this.options.deadlineAt - this.options.now();
  }

  private attemptTimeout() {
    const remaining = this.remainingBudget();
    if (remaining <= 0) return 0;
    return Math.max(this.options.minTimeoutMs, Math.min(this.options.timeoutMs, remaining));
  }

  async loadAccount(
    accountId: string,
    networkId: StellarNetworkId,
    requestId: string = randomUUID(),
  ) {
    const network = getStellarNetwork(networkId);
    if (!network) {
      throw new StellarDataLayerError(
        "invalid_request",
        `Unsupported Stellar network: ${networkId}`,
        false,
      );
    }
    const urls =
      this.options.providerUrls?.[networkId] ?? getStellarDataApiUrls(network);
    const attempts: StellarProviderAttempt[] = [];
    const startedAt = this.options.now();

    for (const [providerIndex, providerUrl] of urls.entries()) {
      const safeProviderUrl = redactProviderUrl(providerUrl);
      const circuitKey = `stellar-horizon:${networkId}:${safeProviderUrl}`;
      for (let attempt = 0; attempt <= this.options.retryLimit; attempt += 1) {
        if (this.remainingBudget() <= 0) {
          attempts.push({
            providerUrl: safeProviderUrl,
            stage: "operation",
            attempt: attempt + 1,
            ok: false,
            latencyMs: 0,
            errorCode: "timeout",
            error: "Orchestration deadline exhausted before Horizon call.",
          });
          break;
        }
        const attemptStartedAt = this.options.now();
        try {
          sharedProviderCircuits.acquire(circuitKey);
          const server = (this.options.serverFactory ?? defaultServerFactory)(
            providerUrl,
            requestId,
          );
          const account = await timeout(
            server.loadAccount(accountId),
            this.attemptTimeout(),
          );
          const ledgerHeight =
            "last_modified_ledger" in account &&
            typeof account.last_modified_ledger === "number"
              ? account.last_modified_ledger
              : undefined;
          sharedProviderCircuits.success(circuitKey, this.options.now() - attemptStartedAt);
          attempts.push({
            providerUrl: safeProviderUrl,
            stage: "operation",
            attempt: attempt + 1,
            ok: true,
            latencyMs: this.options.now() - attemptStartedAt,
            ledgerHeight,
          });
          const failures = attempts.filter((item) => !item.ok).length;
          const fallbackUsed = providerIndex > 0;
          const reliability = Math.max(
            0,
            0.96 - failures * 0.16 - (fallbackUsed ? 0.1 : 0),
          );

          return {
            value: account,
            meta: {
              requestId,
              network: networkId,
              providerUrl: safeProviderUrl,
              fallbackUsed,
              checkedAt: new Date(startedAt).toISOString(),
              freshnessMs: 0,
              latencyMs: this.options.now() - startedAt,
              ledgerHeight,
              highestObservedLedger: ledgerHeight,
              ledgerLag: 0,
              providerDisagreement: failures > 0,
              attempts,
              reliability,
              confidence: Math.max(0, reliability - (failures > 0 ? 0.1 : 0)),
            },
          };
        } catch (error) {
          const failure = classify(error);
          const latencyMs = this.options.now() - attemptStartedAt;
          const circuitOpen =
            error instanceof Error &&
            (error.name === "ProviderCircuitOpenError" ||
              error.message.toLowerCase().includes("circuit"));
          if (!circuitOpen) {
            sharedProviderCircuits.failure(circuitKey, latencyMs, failure.retryable);
          }
          attempts.push({
            providerUrl: safeProviderUrl,
            stage: "operation",
            attempt: attempt + 1,
            ok: false,
            latencyMs,
            errorCode: circuitOpen ? "circuit_open" : failure.code,
            error: failure.message.replaceAll(providerUrl, safeProviderUrl),
          });
          if (circuitOpen) {
            // Circuit is open: short-circuit this provider immediately.
            break;
          }
          const idempotent = isIdempotentRetryable(error, failure);
          if (!idempotent) {
            recordNegativeCacheEntry({
              key: `stellar-horizon:${networkId}:${safeProviderUrl}:${accountId}`,
              provider: "stellar-horizon",
              reason: failure.code,
              ttlMs: 5_000,
            });
            break;
          }
          if (attempt === this.options.retryLimit) break;
          const backoff = jitteredBackoff(attempt);
          if (this.remainingBudget() - backoff <= 0) break;
          await this.options.sleep(backoff);
        }
      }
    }

    const failures = attempts.filter((attempt) => !attempt.ok);
    const allCircuitsOpen =
      failures.length > 0 &&
      failures.every((attempt) => attempt.errorCode === "circuit_open");
    const retryable =
      failures.length > 0 &&
      failures.every(
        (attempt) =>
          attempt.errorCode === "timeout" ||
          attempt.errorCode === "transport_error",
      );
    // Never fabricate data in live mode: surface an honest unavailable state.
    throw new StellarDataLayerError(
      allCircuitsOpen ? "unavailable" : "all_providers_failed",
      allCircuitsOpen
        ? `Stellar data API circuit open for ${networkId}; provider unavailable.`
        : `All Stellar data API providers failed for ${networkId}.`,
      retryable,
      attempts,
    );
  }
}
