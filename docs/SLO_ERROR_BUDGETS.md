# Service Level Objectives (SLOs) & Error Budget Math

This document formalizes Cryptara's Service Level Objectives (SLOs), Service Level Indicators (SLIs), PromQL formulas, burn-rate alerting math, and on-call escalation policies.

---

## 1. Core Service Level Indicators (SLIs)

### A. Availability SLI (Scan & Assessment Endpoints)
- **Target**: 99.9% over a 30-day rolling window.
- **Definition**: Percentage of requests to `/api/scan/token` returning successful HTTP status codes (< 500).
- **PromQL**:
  ```promql
  sum(rate(http_requests_total{route="/api/scan/token", status!~"5.."}[30d]))
  /
  sum(rate(http_requests_total{route="/api/scan/token"}[30d]))
  ```

### B. Latency SLI (Execution Preview Generation)
- **Target**: 99.0% of requests served in ≤ 1200ms.
- **PromQL**:
  ```promql
  sum(rate(http_request_duration_seconds_bucket{route="/api/execute/prepare", le="1.2"}[30d]))
  /
  sum(rate(http_request_duration_seconds_count{route="/api/execute/prepare"}[30d]))
  ```

---

## 2. Multi-Window Multi-Burn-Rate Alerting

| Severity | Time Window | Burn Rate | Budget Consumed | Action / Escalation |
|---|---|---|---|---|
| **Critical (P1)** | 1 hour | 14.4x | 2% in 1 hour | Page On-Call Engineer immediately |
| **High (P2)** | 6 hours | 6.0x | 5% in 6 hours | Page Secondary / Lead Engineer |
| **Warning (P3)** | 3 days | 1.0x | 10% in 3 days | File Jira/GitHub Issue for next sprint |

---

## 3. Escalation Procedures

1. **P1 Alert Fired**:
   - On-call responds within 15 minutes.
   - Run health checks: `/api/health`.
   - Inspect upstream provider circuit breakers (DexScreener / Horizon).
   - If downstream RPC is unresponsive, enable fallback provider or toggle read-only maintenance mode.
