# Cryptara — Provider Failure Runbooks

> Issue #18: V2 Execution Observability, Audit Logs, and Provider Failure Runbooks

These runbooks cover the six critical execution provider failure scenarios.
Each runbook follows a standard format: **Detection → Diagnosis → Containment → Recovery → Verification**.

---

## RB-001: Quote / Simulation Provider Outage

**Severity:** High  
**Disable switch:** `DISABLE_QUOTE_PROVIDER=true`, `DISABLE_SIMULATION_PROVIDER=true`

### Scenario
The DEX aggregator or simulation provider (Tenderly, Stellar aggregator) is unavailable,
returning errors, or timing out. Execution previews fail to produce fresh quotes or
simulation results.

### Detection
- Monitor `/api/health` → `executionAudit.byKind.quote_unavailable` and `simulation_failed`
- Elevated `executionMetrics.providers.quote.staleRate` or `simulation.failureRate`
- Alert engine fires on `rpc_degradation` observations for quote/simulation providers

### Diagnosis
- Check provider status pages: DEX aggregator API, Tenderly dashboard
- Verify API key validity and rate limits
- Test direct provider connectivity:
  ```bash
  curl -s <PROVIDER_HEALTH_URL> | jq .
  ```

### Containment
- Set `DISABLE_QUOTE_PROVIDER=true` to skip live quote calls
- Optionally set `DISABLE_SIMULATION_PROVIDER=true`
- Full recommendation-only mode: `RECOMMENDATION_ONLY_MODE=true`
- Agent analysis, risk scoring, and portfolio review continue unaffected
- Users see clear messages that live quotes/simulations are temporarily unavailable

### Recovery
- Remove disable flags once provider status pages show recovery
- Run smoke test against execute/prepare endpoint:
  ```bash
  npm run smoke
  ```

### Verification
- Confirm `executionMetrics.providers.quote.successRate` > 90%
- Confirm `executionMetrics.providers.simulation.failureRate` < 5%
- Audit events show `quote_received` and `simulation_passed` with `outcome=ok`

---

## RB-002: Stellar RPC Lag / Degradation

**Severity:** High  
**Disable switch:** `DISABLE_STELLAR_SUBMISSION=true`

### Scenario
The Stellar Soroban RPC is returning stale ledger data, timing out, or reporting
degraded health. This affects Stellar swap quotes, trustline checks, portfolio
valuation, and risk registry contract interactions.

### Detection
- `/api/health` → `productionHealth.providerHealth.stellar` shows `degraded` or `unavailable`
- Elevated `providerFailureRate` in metrics for Stellar sources
- Alert engine fires on `provider_degraded` audit events

### Diagnosis
- Query Stellar RPC health directly:
  ```bash
  curl -s https://soroban-testnet.stellar.org/health | jq .
  ```
- Compare latest ledger against public Stellar network
- Check Stellar Discord for known incidents

### Containment
- Set `DISABLE_STELLAR_SUBMISSION=true` to block Stellar transaction submission
- Stellar portfolio valuation and risk checks continue via data API
- EVM execution is completely unaffected
- Users see a clear message: "Stellar execution is temporarily paused"

### Recovery
- Wait until RPC reports healthy status
- Confirm latest ledger is within 10 of public network
- Remove `DISABLE_STELLAR_SUBMISSION`

### Verification
- Run Stellar execution smoke test: request swap quote → prepare preview → submit
- Check `submission_broadcast` audit events with `outcome=ok`
- Confirm Stellar portfolio valuation returns accurate data

---

## RB-003: EVM RPC Failure

**Severity:** Critical  
**Disable switch:** `DISABLE_EVM_SUBMISSION=true`, `RECOMMENDATION_ONLY_MODE=true`

### Scenario
The EVM RPC provider (GOAT Network RPC or fallback) is unreachable, returning errors,
or failing to return block data. This affects transaction submission, confirmation
polling, and portfolio balance checks.

### Detection
- `/api/health` → `productionHealth.providerHealth.evm` shows `unavailable`
- Elevated `providerFailureRate` in metrics
- Alert engine fires on `rpc_degradation` observations
- `provider_degraded` and `submission_failed` audit events increase

### Diagnosis
- Test RPC directly:
  ```bash
  curl -s -X POST <RPC_URL> \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
  ```
- Check block production rate against public explorer
- Verify RPC URL hasn't changed and API key is valid

### Containment
- Set `DISABLE_EVM_SUBMISSION=true` to block EVM transactions
- For full safe mode: `RECOMMENDATION_ONLY_MODE=true`
- Token scanning uses cached/fallback data
- All agent analysis continues — only transactions are paused

### Recovery
- Verify RPC returns healthy block data
- Remove `DISABLE_EVM_SUBMISSION`
- Monitor submission success rate for 5 minutes

### Verification
- Run full execution flow smoke test
- `submission_broadcast` audit events show `outcome=ok`
- Confirmation polling produces terminal states within expected time
- Portfolio balance checks return current data

---

## RB-004: Stuck Transactions

**Severity:** Medium

### Scenario
Transactions remain in `submitted` or `pending` state for longer than the
submission TTL (5 minutes). This can happen due to low gas, network congestion,
nonce conflicts, or RPC provider issues.

### Detection
- Elevated `executionMetrics.confirmation.failureRate` in health endpoint
- `lifecycle_expired` audit events with elevated counts
- `executionConfirmFailureHigh` fires in alert thresholds

### Diagnosis
- Query transaction records for transactions in `pending`/`submitted` state
- Check explorer URLs for onchain status:
  ```bash
  curl -s <HEALTH_URL> | jq '.executionMetrics.confirmation'
  ```
- Verify gas prices haven't spiked beyond the transaction's gas limit

### Containment
- The lifecycle manager automatically expires transactions after TTL (5 minutes)
- No server-side action needed — users can re-submit with higher gas
- If systemic, set `DISABLE_CONFIRMATION_POLLING=true` to stop polling overhead

### Recovery
- Transactions expire automatically after TTL
- Users submit replacement transactions if needed
- Remaining transactions confirm naturally once congestion resolves

### Verification
- All transaction records are in terminal states (confirmed/failed/replaced/expired)
- Confirmation failure rate returns to baseline (<5%)
- No transactions older than TTL remain in pending/submitted state

---

## RB-005: Supabase / Storage Failure

**Severity:** Critical  
**Disable switch:** `DISABLE_SUPABASE_WRITES=true`

### Scenario
The Supabase Postgres database is unreachable, returning connection errors, or
failing writes. The in-memory store continues to serve reads but persistence is
lost on restart.

### Detection
- `/api/health` → `storage.persistent` is `false`
- `storage.detail` indicates connection failure
- `supabaseWriteFailureHigh` fires when write failure rate exceeds 1%
- `persistence_failed` audit events increase

### Diagnosis
- Log into Supabase dashboard and check project health
- Verify connection string validity: `DATABASE_URL`, `SUPABASE_DB_URL`, `POSTGRES_URL`
- Test direct connection:
  ```bash
  psql <DATABASE_URL> -c 'SELECT 1'
  ```
- Check IP allowlist and network connectivity from deployment environment

### Containment
- Set `DISABLE_SUPABASE_WRITES=true` to stop mirror write attempts
- Server continues operating with in-memory store
- Alert engine and agent analysis continue unaffected
- Data persists only for the lifetime of the server process

### Recovery
- Fix connection issue (network, credentials, Supabase project)
- Remove `DISABLE_SUPABASE_WRITES`
- Next server restart hydrates from existing Supabase data
- Mirror writes resume immediately

### Verification
- `storage.persistent` is `true` in health endpoint
- Trigger an agent run and verify it persists across server restart
- `storageCounts` match expected values
- `persistence_written` audit events resume with `outcome=ok`

---

## RB-006: x402 Payment Settlement Failure

**Severity:** Medium  
**Disable switch:** `DISABLE_X402_SETTLEMENT=true`

### Scenario
x402 payment verification or settlement is failing. This affects premium deep-scan
access but does not impact free-tier functionality.

### Detection
- Elevated `verification_status=failed` in payment receipts
- `x402_payment_receipts` show increased error rates
- Health endpoint shows x402 settlement issues

### Diagnosis
- Check x402 facilitator URL is reachable
- Verify payment network (GOAT Network) is producing blocks
- Confirm facilitator hasn't changed API or payment address
- Check payment receipt verification logic

### Containment
- Set `DISABLE_X402_SETTLEMENT=true`
- Premium endpoints return 402 with clear message
- Free-tier features (standard scan, portfolio review, alerts) are unaffected
- No payment processing occurs until re-enabled

### Recovery
- Verify facilitator is accepting payments
- Clear any stuck payment receipts in database
- Remove `DISABLE_X402_SETTLEMENT`

### Verification
- Run x402 smoke test:
  ```bash
  npm run smoke
  ```
- Payment-required responses include valid payment headers
- Settlements succeed with `verification_status=verified`
- Payment receipt flow works end-to-end

---

## General Guidance

## RB-007: Every eligible provider circuit is open

**Severity:** Critical
**Disable switch:** `RECOMMENDATION_ONLY_MODE=true`

### Detection
- `/api/health` reports every entry in `providerCircuits` as `open`
- `monitor:production` exits non-zero with the all-circuits-open message
- User surfaces report providers as unavailable; no mock result is returned

### Diagnosis
1. Correlate failures by provider/network and request ID; do not paste raw endpoint URLs into tickets.
2. Confirm whether failures are timeouts, 429/5xx responses, malformed payloads, or ledger lag.
3. Verify the configured EVM chain ID or Stellar passphrase before considering a fallback.
4. Run `npm --prefix frontend run test:provider-resilience` to rule out a policy regression.

### Containment
- Enable recommendation-only mode when execution freshness cannot be established.
- Never add a provider from another chain or Stellar network as an emergency fallback.
- Respect `Retry-After`; do not increase retry counts beyond the bounded policy.

### Recovery and verification
- Wait for the open interval and observe a single half-open probe.
- A successful probe must transition the circuit to closed and preserve the request ID/freshness metadata.
- Confirm no provider credentials or wallet identifiers appear in `/api/health`.
- Remove recommendation-only mode only after at least one exact-network provider is healthy.

See `docs/PROVIDER_RESILIENCE.md` for state-machine and scoring details.

---

### Recommendation-Only Mode
Set `RECOMMENDATION_ONLY_MODE=true` to disable ALL execution providers while
preserving full agent analysis, risk scoring, portfolio review, token scanning,
and alerting. This is the safest fallback during any provider incident.

### Monitoring Commands
```bash
# Full health check
curl -s <BASE_URL>/api/health | jq .

# Execution audit summary
curl -s <BASE_URL>/api/health | jq '.executionAudit'

# Runbooks reference
curl -s <BASE_URL>/api/health | jq '.runbooks'

# Disable flags status
curl -s <BASE_URL>/api/health | jq '.disableFlags'
```

### Correlation ID Tracing
Every execution event carries a `correlationId` (the orchestration `runId`).
To trace a full execution flow:
1. Get the `runId` from the agent run record or decision response
2. Filter audit events: `listAuditEvents({ correlationId: "<runId>" })`
3. Follow the event chain: decision → quote → simulation → policy → approval → submission → confirmation

### Related Files
- `frontend/src/server/observability/executionAudit.ts` — Structured audit events
- `frontend/src/server/observability/executionMetrics.ts` — Execution-specific metrics
- `frontend/src/server/observability/providerHealth.ts` — Provider health checks and disable switches
- `frontend/src/server/observability/executionRedaction.ts` — Sensitive field redaction
- `frontend/src/server/observability/runbooks.ts` — Programmatic runbook definitions
- `frontend/scripts/execution-fixture-check.ts` — Provider failure fixture tests
