# Provider resilience

Cryptara treats provider failover as a safety boundary, not only an availability feature. A fallback is eligible only when its chain family, network, and chain ID or Stellar network passphrase exactly match the request. A testnet response can never satisfy a pubnet request, and an EVM response from another chain fails before application data is accepted.

## Runtime policy

Every provider has a process-wide circuit keyed by provider and network identity. The state machine is deterministic:

1. `closed` allows calls and counts retryable operational failures.
2. The configured consecutive-failure threshold moves the circuit to `open`.
3. `open` rejects immediately until the recovery interval expires.
4. Exactly one `half_open` probe is admitted. Success closes the circuit; failure opens it again.

The registry is bounded to 128 providers and retains a bounded 20-sample window. This prevents endpoint churn from creating unbounded process memory. Circuits are intentionally local to one application process; no distributed lock or global circuit coordination is implied.

Retries are limited to three and constrained by an operation budget. Backoff is exponential with jitter, capped at five seconds, and honors provider `Retry-After` guidance. Invalid input, unsupported routes, cancellation, and network identity mismatches are terminal. Timeouts, 429s, 5xx responses, malformed responses, and transport failures may retry within the budget. Each attempt receives an abort signal and the operation timeout aborts outstanding I/O.

## Freshness and identity

Stellar RPC candidates are probed for health, network passphrase, protocol level, and latest ledger. Candidates outside the ledger-lag budget are ineligible. Horizon and RPC fallback lists are scoped by `StellarNetworkId`; returned metadata preserves the original request ID, selected provider, ledger freshness, fallback rank, and disagreement evidence.

EVM quote responses are checked for the requested application chain and required quote shape. Non-success HTTP responses are no longer converted to empty market data: 429 and 5xx responses reach the retry/circuit policy, while a genuine 404 or empty route remains a transparent no-route result.

## Health and privacy

`GET /api/health` exposes bounded circuit telemetry: state, sample count, error rate, average latency, and a 0–100 health score. It never exposes provider credentials, query tokens, Stellar wallet IDs, or EVM wallet addresses. Provider URLs are reduced to their public origin before entering attempts or health metadata, and error text passes through structured redaction.

The operations page shows configured EVM/Stellar readiness and whether tracked circuits exist. `scripts/monitor-production.mjs` fails when every tracked provider is open or when an endpoint leaks sensitive data.

## Verification

Run the deterministic chaos fixture without network access:

```bash
npm --prefix frontend run test:provider-resilience
```

It covers timeout, cancellation, 429 with `Retry-After`, 5xx recovery, malformed payload retry, stale ledger rejection, cross-network rejection, fallback request-ID preservation, circuit open/half-open/closed transitions, redaction, and all-providers-down behavior.

For a deployment, also run:

```bash
MONITOR_BASE_URL=https://your-production-domain.example npm run monitor:production
```

Environment controls use safe bounds: `PROVIDER_CIRCUIT_FAILURE_THRESHOLD` (1–10), `PROVIDER_CIRCUIT_OPEN_MS` (1–300 seconds), `PROVIDER_MAX_RETRIES` (0–3), and `PROVIDER_RETRY_BUDGET_MS` (1–120 seconds). Invalid values fall back to defaults.

## Non-goals

- No cross-network or cross-chain failover.
- No unbounded retries or endpoint discovery.
- No hidden mock response when every provider is unavailable.
- No claim that an in-process circuit provides distributed consensus.

When all eligible providers fail, the caller receives an unavailable result with attempt evidence. Execution must remain fail-closed; recommendation-only features may continue if their own providers are healthy.
