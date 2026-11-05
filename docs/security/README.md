# Production Hardening Documentation

This directory contains the production-hardening deliverables for Cryptara, produced on 2026-07-29 as part of pre-mainnet readiness.

## Documents

| File | Purpose |
|---|---|
| `PRODUCTION_HARDENING_THREAT_MODEL.md` | 9 threat categories with mitigations, gaps, and risk levels |
| `dependency-review-checklist.md` | npm audit results and remediation plan |
| `evm-contract-review-checklist.md` | 39-point review of CryptaraPolicy, Vault, RiskRegistry |
| `soroban-contract-review-checklist.md` | 24-point review of Soroban policy and vault contracts |
| `testnet-soak-runbook.md` | 48-hour testnet soak test procedure |
| `pubnet-deploy-procedure.md` | Step-by-step mainnet deployment procedure |
| `rollback-procedure.md` | 15-minute rollback procedure |
| `emergency-pause-procedure.md` | 2-minute emergency pause runbook |
| `low-value-smoke-test-procedure.md` | Post-deploy smoke test (< 5 min, < 0.01 ETH) |
| `production-hardening-signoff.md` | Sign-off template for release readiness |

## Scripts (in `scripts/`)

| Script | Purpose |
|---|---|
| `load-test-simulation.mjs` | Load test for `/api/simulate` path |
| `load-test-execution.mjs` | Load test for `/api/execute` path |
| `hash-freeze-build.mjs` | Generate SHA-256 build manifest |

## Status

| Area | Status |
|---|---|
| Threat model | COMPLETE |
| Dependency audit | COMPLETE |
| Contract review (EVM) | COMPLETE (39/39 pass) |
| Contract review (Soroban) | COMPLETE (24/24 pass) |
| Load test scripts | COMPLETE |
| Hash freeze script | COMPLETE |
| Deploy runbook | COMPLETE |
| Rollback runbook | COMPLETE |
| Emergency pause runbook | COMPLETE |
| Smoke test procedure | COMPLETE |
| Sign-off template | COMPLETE |

## Critical gaps found

1. **Wallet ownership verification**: No SIWE (EIP-4361) or Stellar `Auth` challenge — client can impersonate any wallet address.
2. **Agent endpoint authentication**: No API key, JWT, or session auth on agent endpoints.
3. **SEP-1 SSRF protections**: Must be implemented before SEP-1/SEP-2 fetching is enabled.
4. **Dependency vulnerabilities**: 1 critical (protobufjs), 34 high (across frontend + backend).
5. **`cargo audit` not configured**: No CI step for Rust dependency scanning.

See `PRODUCTION_HARDENING_THREAT_MODEL.md` for full details on each gap.
