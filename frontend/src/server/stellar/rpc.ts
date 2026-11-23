import type { rpc } from "@stellar/stellar-sdk";
import { withRpcSpan } from "@/server/observability/tracing/spans";
import { withStellarRpcFallback as baseWithStellarRpcFallback } from "@/server/stellar/client";
import {
  sharedProviderCircuits,
  isIdempotentReadError,
  computeJitteredBackoffMs,
  sleep,
  resolveProviderBudgetMs,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/server/providers/resilience";
import { recordNegativeCacheEntry } from "@/server/cache/negative";

const STELLAR_RPC_PROVIDER = "stellar_rpc";

export async function withStellarRpcFallback<T>(
  value: string | undefined,
  operation: (server: rpc.Server, providerUrl: string) => Promise<T>,
) {
  return withRpcSpan("stellar_rpc", value, async () => {
    const providerKey = `${STELLAR_RPC_PROVIDER}:${value ?? "default"}`;
    const circuit = sharedProviderCircuits.get(providerKey);

    if (circuit && !circuit.allowRequest()) {
      recordProviderFailure(providerKey, {
        reason: "circuit_open",
        state: circuit.getState(),
      });
      throw new Error(`Stellar RPC circuit open for provider ${value ?? "default"}`);
    }

    const budgetMs = resolveProviderBudgetMs();
    const controller = new AbortController();
    const timer =
      budgetMs > 0
        ? setTimeout(() => controller.abort(), budgetMs)
        : undefined;

    const startedAt = Date.now();
    let attempt = 0;
    const maxAttempts = 2;

    try {
      for (;;) {
        attempt += 1;
        try {
          const result = await baseWithStellarRpcFallback(value, (server, providerUrl) =>
            operation(server, providerUrl),
          );

          const latencyMs = Date.now() - startedAt;
          circuit?.recordSuccess();
          recordProviderSuccess(providerKey, {
            latencyMs,
            state: circuit?.getState() ?? "closed",
          });
          return result;
        } catch (error) {
          const latencyMs = Date.now() - startedAt;
          const aborted = controller.signal.aborted;
          const idempotent = isIdempotentReadError(error);

          circuit?.recordFailure();
          recordProviderFailure(providerKey, {
            reason: aborted ? "timeout" : idempotent ? "idempotent_error" : "error",
            latencyMs,
            state: circuit?.getState() ?? "closed",
          });

          if (aborted) {
            recordNegativeCacheEntry(providerKey, {
              reason: "timeout",
              ttlMs: budgetMs,
            });
            throw error;
          }

          if (idempotent && attempt < maxAttempts) {
            const backoffMs = computeJitteredBackoffMs(attempt);
            if (budgetMs > 0 && Date.now() - startedAt + backoffMs >= budgetMs) {
              recordNegativeCacheEntry(providerKey, {
                reason: "budget_exhausted",
                ttlMs: budgetMs,
              });
              throw error;
            }
            await sleep(backoffMs);
            continue;
          }

          if (idempotent) {
            recordNegativeCacheEntry(providerKey, {
              reason: "idempotent_error",
              ttlMs: budgetMs,
            });
          }

          throw error;
        }
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}