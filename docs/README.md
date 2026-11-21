# Cryptara Documentation Index

Welcome to the central documentation directory for Cryptara.

---

## 📚 Core Architecture & Methodology

- [RISK_SCORING_METHODOLOGY.md](RISK_SCORING_METHODOLOGY.md) — Mathematical specification of buy risk weights, verdicts, confidence penalties, and replay verification.
- [SMART_CONTRACT_INTEGRATION_GUIDE.md](SMART_CONTRACT_INTEGRATION_GUIDE.md) — 5 Soroban & 5 EVM contracts, architectures, and testing runbooks.
- [PERFORMANCE_BUDGETS.md](PERFORMANCE_BUDGETS.md) — Web Vitals, API latency budgets, and nightly load test gates.
- [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) — Complete environment variable reference across all modules.

---

## 🛠 Developer & Operations Playbooks

- [TESTING_E2E.md](TESTING_E2E.md) — Playwright E2E test suite, trace viewer debugging, and mock wallet harnesses.
- [STORAGE_LIFETIME_DIAGNOSTICS.md](STORAGE_LIFETIME_DIAGNOSTICS.md) — Soroban ledger TTL inspection, state archival, and CLI restoration.
- [OPERATOR_DEPLOYMENT_PLAYBOOK.md](OPERATOR_DEPLOYMENT_PLAYBOOK.md) — Production deployment and hardening on Vercel, Supabase, and nodes.
- [OPERATOR_PRIVACY_PROCEDURES.md](OPERATOR_PRIVACY_PROCEDURES.md) — Data retention, purge workflows, and operator privacy safeguards.
- [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) — Multi-runtime local development setup for Node, Rust, and Hardhat.

---

## 💳 Payment & Monetization

- [x402-payment-walkthrough.md](x402-payment-walkthrough.md) — Multi-chain x402 payment protocol walkthrough (EVM + Stellar).
- [x402-payment-hardening.md](x402-payment-hardening.md) — Payment verification guards and anti-replay threat controls.

---

## 🧩 Client SDK & Features Catalog

- [READ_CLIENT_DEVELOPER_GUIDE.md](READ_CLIENT_DEVELOPER_GUIDE.md) — TypeScript client SDK guide for `packages/read-client`.
- [features/](features/) — Catalog of 60+ modular token security and risk intelligence engines.
