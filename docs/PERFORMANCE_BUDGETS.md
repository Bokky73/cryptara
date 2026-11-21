# Performance budgets

Cryptara treats performance regressions like functional regressions. This
document defines the Web Vitals, API latency, and load-test throughput budgets
the platform must stay inside of, how they are measured, and how regressions are detected.

---

## 1. API Latency Budgets

Measured across 50th (p50) and 95th (p95) percentiles from the in-memory ring buffer:

| Route / Subsystem | p50 Budget | p95 Budget | Notes |
|---|---|---|---|
| `scan:token` (`/api/scan/token`) | ≤ 4000 ms | ≤ 9000 ms | Multi-provider fan-out & scoring |
| `execute:prepare` (`/api/execute/prepare`) | ≤ 450 ms | ≤ 1200 ms | Non-custodial transaction preview |
| `execute:confirm` (`/api/execute/confirm`) | ≤ 600 ms | ≤ 1800 ms | Signature verification & receipt |
| `simulate` (`/api/simulate`) | ≤ 500 ms | ≤ 1500 ms | Gas and slippage simulation |
| `health` (`/api/health`) | ≤ 300 ms | ≤ 800 ms | Liveness and provider ping |

---

## 2. Nightly Load Test Benchmarks

Nightly CI runs `.github/workflows/nightly-load-tests.yml` to benchmark execution and simulation throughput under sustained load:

- **Execution Path** (`scripts/load-test-execution.mjs`):
  - Minimum Throughput: ≥ 25 requests/sec under concurrency of 5.
  - Error Rate: 0.00% (zero 5xx errors).
  - P95 Latency Threshold: ≤ 1200 ms for `/api/execute/prepare`.

- **Simulation Path** (`scripts/load-test-simulation.mjs`):
  - Minimum Throughput: ≥ 30 requests/sec under concurrency of 5.
  - Error Rate: 0.00%.
  - P95 Latency Threshold: ≤ 1500 ms.

Any regression exceeding 15% of the p95 baseline triggers a CI failure and alerts maintainers.

---

## 3. Bundle Size & Web Vitals

| Metric | Desktop | Constrained Mobile |
|---|---|---|
| Initial JS (first load) | ≤ 220 KB | ≤ 220 KB |
| Per-route chunk | ≤ 120 KB | ≤ 120 KB |
| LCP (Largest Contentful Paint) | ≤ 2500 ms | ≤ 4000 ms |
| INP (Interaction to Next Paint) | ≤ 200 ms | ≤ 500 ms |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | ≤ 0.1 |
| TTFB (Time to First Byte) | ≤ 800 ms | ≤ 1800 ms |
