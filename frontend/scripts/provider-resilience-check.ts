import assert from "node:assert/strict";
import {
  ProviderCircuitRegistry,
  ProviderRequestError,
  runProviderAdapter,
  runProviderFallbacks,
} from "../src/server/providers/adapter";
import { executeWithFallback, redactProviderUrl } from "../src/lib/stellar/failover";
import { redactSecrets } from "../src/server/observability/logging";
import { NegativeCache } from "../src/server/cache/negative";
import { ProviderHealthRegistry } from "../src/server/observability/providerHealth";

async function main() {
const identity = { family: "stellar" as const, network: "stellar-testnet", passphrase: "Test SDF Network ; September 2015" };
let clock = 1_700_000_000_000;
const now = () => clock;
const delays: number[] = [];
const sleep = async (milliseconds: number) => { delays.push(milliseconds); clock += milliseconds; };
const registry = new ProviderCircuitRegistry({ failureThreshold: 2, openMs: 1_000, now });
const base = { kind: "execution" as const, provider: "fixture", label: "fixture", identity, expectedIdentity: identity, now, sleep, random: () => 0.5, circuitRegistry: registry };

let calls = 0;
const rateLimited = await runProviderAdapter(async () => {
  calls += 1;
  if (calls === 1) throw new ProviderRequestError("HTTP 429", "rate_limited", { retryable: true, retryAfterMs: 750 });
  return { ok: true };
}, { ...base, retries: 1 });
assert.equal(rateLimited.ok, true);
assert.equal(calls, 2);
assert.equal(delays.at(-1), 750, "Retry-After must override jittered backoff");

calls = 0;
const serverError = await runProviderAdapter(async () => {
  calls += 1;
  if (calls === 1) throw new ProviderRequestError("HTTP 503", "provider_error", { retryable: true, status: 503 });
  return "recovered";
}, { ...base, provider: "five-hundred", retries: 1 });
assert.equal(serverError.value, "recovered");

calls = 0;
const malformed = await runProviderAdapter(async () => ({ valid: ++calls > 1 }), {
  ...base,
  provider: "malformed",
  retries: 1,
  validate: (value) => Boolean(value && typeof value === "object" && (value as { valid?: boolean }).valid),
});
assert.equal(malformed.ok, true);
assert.equal(calls, 2);

calls = 0;
const terminal = await runProviderAdapter(async () => {
  calls += 1;
  throw new ProviderRequestError("wallet validation failed", "invalid_request");
}, { ...base, provider: "terminal", retries: 3 });
assert.equal(terminal.error?.code, "invalid_request");
assert.equal(calls, 1, "terminal validation failures must not retry");

calls = 0;
const mismatch = await runProviderAdapter(async () => { calls += 1; return true; }, {
  ...base,
  provider: "wrong-network",
  identity: { ...identity, network: "stellar-pubnet" },
});
assert.equal(mismatch.error?.code, "network_mismatch");
assert.equal(calls, 0, "cross-network providers must fail before I/O");

const evmMismatch = await runProviderAdapter(async () => true, {
  ...base,
  provider: "wrong-evm-chain",
  identity: { family: "evm", network: "base", chainId: 1 },
  expectedIdentity: { family: "evm", network: "base", chainId: 8453 },
});
assert.equal(evmMismatch.error?.code, "network_mismatch", "EVM chain ID mismatches must fail closed");

const breaker = new ProviderCircuitRegistry({ failureThreshold: 2, openMs: 1_000, now });
for (let index = 0; index < 2; index += 1) {
  await runProviderAdapter(async () => { throw new ProviderRequestError("network down", "network_error", { retryable: true }); }, {
    ...base, provider: "circuit", retries: 0, circuitRegistry: breaker,
  });
}
const open = await runProviderAdapter(async () => "should-not-run", { ...base, provider: "circuit", retries: 0, circuitRegistry: breaker });
assert.equal(open.circuitState, "open");
assert.equal(open.attempts, 0);
clock += 1_000;
const recovered = await runProviderAdapter(async () => "healthy", { ...base, provider: "circuit", retries: 0, circuitRegistry: breaker });
assert.equal(recovered.ok, true);
assert.equal(recovered.circuitState, "closed", "one bounded half-open probe must close the circuit");

const fallback = await runProviderFallbacks([
  { ...base, provider: "testnet-primary", fallbackRank: 0, retries: 0, run: async () => { throw new ProviderRequestError("timeout", "timeout", { retryable: true }); } },
  { ...base, provider: "testnet-secondary", fallbackRank: 1, retries: 0, run: async () => ({ requestId: "req-42", freshnessMs: 25 }) },
], identity);
assert.equal(fallback.ok, true);
assert.equal(fallback.fallbackRank, 1);
assert.deepEqual(fallback.value, { requestId: "req-42", freshnessMs: 25 });

const stellarFallback = await executeWithFallback([
  "https://user:secret@primary.example/rpc?api_key=hidden",
  "https://fallback.example/rpc",
], async (_url, index, requestId) => {
  if (index === 0) throw new Error("provider unavailable");
  return { network: "stellar-testnet", passphrase: identity.passphrase, freshnessMs: 100, requestId };
}, { requestId: "req-42", expectedNetwork: identity.network, expectedPassphrase: identity.passphrase, maxFreshnessMs: 500, inspect: (value) => value });
assert.equal(stellarFallback.fallbackUsed, true);
assert.equal(stellarFallback.requestId, "req-42");
assert.equal(stellarFallback.providerUrl, "https://fallback.example");

await assert.rejects(() => executeWithFallback(["https://lag.example"], async () => ({ network: identity.network, passphrase: identity.passphrase, freshnessMs: 5_000 }), {
  expectedNetwork: identity.network, expectedPassphrase: identity.passphrase, maxFreshnessMs: 500, inspect: (value) => value,
}), /All Stellar providers failed/);
await assert.rejects(() => executeWithFallback(["https://wrong.example"], async () => ({ network: "stellar-pubnet", passphrase: "Public Global Stellar Network ; September 2015", freshnessMs: 1 }), {
  expectedNetwork: identity.network, expectedPassphrase: identity.passphrase, inspect: (value) => value,
}), /All Stellar providers failed/);
await assert.rejects(() => executeWithFallback(["https://one.example", "https://two.example"], async () => { throw new Error("all down"); }), /All Stellar providers failed/);

const timedOut = await runProviderAdapter(() => new Promise<never>(() => undefined), { ...base, provider: "timeout", retries: 0, timeoutMs: 2 });
assert.equal(timedOut.error?.code, "timeout");
const controller = new AbortController();
controller.abort();
const cancelled = await runProviderAdapter(async () => true, { ...base, provider: "cancelled", retries: 2, signal: controller.signal });
assert.equal(cancelled.error?.code, "cancelled");
assert.equal(cancelled.attempts, 0);

assert.equal(redactProviderUrl("https://user:pass@rpc.example/path/token?api_key=secret"), "https://rpc.example");
const redacted = redactSecrets("wallet GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF endpoint https://user:pass@rpc.example?token=secret owner 0x1111111111111111111111111111111111111111");
assert(!redacted.includes("secret") && !redacted.includes("GAAAA") && !redacted.includes("0x1111"));

// Fault injection: a provider that fails N times trips the circuit to open and
// subsequent calls short-circuit immediately without performing I/O.
{
  const faultRegistry = new ProviderCircuitRegistry({ failureThreshold: 3, openMs: 5_000, now });
  let ioCalls = 0;
  const failing = async () => {
    ioCalls += 1;
    throw new ProviderRequestError("HTTP 503", "provider_error", { retryable: true, status: 503 });
  };
  for (let index = 0; index < 3; index += 1) {
    const result = await runProviderAdapter(failing, { ...base, provider: "fault-inject", retries: 0, circuitRegistry: faultRegistry });
    assert.equal(result.ok, false);
  }
  assert.equal(ioCalls, 3, "each pre-trip failure must reach the provider");
  const shortCircuited = await runProviderAdapter(failing, { ...base, provider: "fault-inject", retries: 0, circuitRegistry: faultRegistry });
  assert.equal(shortCircuited.circuitState, "open");
  assert.equal(shortCircuited.attempts, 0, "open circuit must short-circuit without I/O");
  assert.equal(ioCalls, 3, "short-circuited calls must not hit the provider");
  assert.equal(shortCircuited.error?.code, "circuit_open");
}

// Fault injection: half-open probe recovers after cooldown, and a failing probe
// re-opens the circuit.
{
  const probeRegistry = new ProviderCircuitRegistry({ failureThreshold: 1, openMs: 500, now });
  await runProviderAdapter(async () => { throw new ProviderRequestError("network reset", "network_error", { retryable: true }); }, {
    ...base, provider: "probe", retries: 0, circuitRegistry: probeRegistry,
  });
  const stillOpen = await runProviderAdapter(async () => "nope", { ...base, provider: "probe", retries: 0, circuitRegistry: probeRegistry });
  assert.equal(stillOpen.circuitState, "open");
  clock += 500;
  let probeCalls = 0;
  const failedProbe = await runProviderAdapter(async () => { probeCalls += 1; throw new ProviderRequestError("still down", "network_error", { retryable: true }); }, {
    ...base, provider: "probe", retries: 0, circuitRegistry: probeRegistry,
  });
  assert.equal(probeCalls, 1, "half-open must allow exactly one probe");
  assert.equal(failedProbe.circuitState, "open", "failed half-open probe must re-open the circuit");
  clock += 500;
  const recoveredProbe = await runProviderAdapter(async () => "healthy", { ...base, provider: "probe", retries: 0, circuitRegistry: probeRegistry });
  assert.equal(recoveredProbe.ok, true);
  assert.equal(recoveredProbe.circuitState, "closed");
}

// Fault injection: deadline-derived timeout aborts a slow provider.
{
  const deadline = clock + 50;
  const slow = await runProviderAdapter(() => new Promise<never>(() => undefined), {
    ...base,
    provider: "slow-deadline",
    retries: 0,
    deadline,
    timeoutMs: 10_000,
  });
  assert.equal(slow.error?.code, "timeout", "deadline must cap the per-call budget");
  assert(clock <= deadline + 1, "slow provider must not exceed the orchestration deadline");
}

// Fault injection: jittered backoff applies only to idempotent errors.
{
  const before = delays.length;
  let idempotentCalls = 0;
  await runProviderAdapter(async () => {
    idempotentCalls += 1;
    if (idempotentCalls === 1) throw new ProviderRequestError("HTTP 502", "provider_error", { retryable: true, status: 502 });
    return "ok";
  }, { ...base, provider: "idempotent", retries: 1 });
  assert.equal(idempotentCalls, 2);
  assert(delays.length > before, "idempotent 502 must trigger jittered backoff");

  const nonIdempotentBefore = delays.length;
  let nonIdempotentCalls = 0;
  await runProviderAdapter(async () => {
    nonIdempotentCalls += 1;
    throw new ProviderRequestError("wallet validation failed", "invalid_request");
  }, { ...base, provider: "non-idempotent", retries: 3 });
  assert.equal(nonIdempotentCalls, 1, "non-idempotent errors must not retry");
  assert.equal(delays.length, nonIdempotentBefore, "non-idempotent errors must not back off");
}

// Fault injection: negative cache entries short-circuit repeated failures.
{
  const negative = new NegativeCache({ now, defaultTtlMs: 1_000 });
  let negativeCalls = 0;
  const failing = async () => {
    negativeCalls += 1;
    throw new ProviderRequestError("HTTP 503", "provider_error", { retryable: true, status: 503 });
  };
  const first = await runProviderAdapter(failing, { ...base, provider: "neg-cache", retries: 0, negativeCache: negative, cacheKey: "neg-cache:key" });
  assert.equal(first.ok, false);
  assert.equal(negativeCalls, 1);
  const cached = await runProviderAdapter(failing, { ...base, provider: "neg-cache", retries: 0, negativeCache: negative, cacheKey: "neg-cache:key" });
  assert.equal(cached.ok, false);
  assert.equal(negativeCalls, 1, "negative cache must short-circuit repeated failures");
  clock += 1_000;
  await runProviderAdapter(failing, { ...base, provider: "neg-cache", retries: 0, negativeCache: negative, cacheKey: "neg-cache:key" });
  assert.equal(negativeCalls, 2, "negative cache must expire after TTL");
}

// Fault injection: degraded providers yield unavailable status with reduced
// confidence, never mock data in live mode.
{
  const health = new ProviderHealthRegistry({ now });
  const degraded = await runProviderFallbacks([
    { ...base, provider: "degraded-primary", fallbackRank: 0, retries: 0, run: async () => { throw new ProviderRequestError("timeout", "timeout", { retryable: true }); } },
    { ...base, provider: "degraded-secondary", fallbackRank: 1, retries: 0, run: async () => { throw new ProviderRequestError("HTTP 503", "provider_error", { retryable: true, status: 503 }); } },
  ], identity, { health, live: true });
  assert.equal(degraded.ok, false);
  assert.equal(degraded.status, "unavailable");
  assert.equal(degraded.value, undefined, "live mode must never fabricate mock data");
  assert(degraded.confidence < 1, "unavailable status must reduce confidence");
}

console.log("provider-resilience-check: timeout, 429, 5xx, malformed, lag, Stellar/EVM identity, recovery, cancellation, redaction, circuit trip/half-open, deadline, backoff, negative cache, degraded-unavailable, and all-down fixtures passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
