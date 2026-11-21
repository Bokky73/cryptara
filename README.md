<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Cryptara-f59e0b?style=for-the-badge&labelColor=1a1a2e&color=f59e0b">
  <img alt="Cryptara" src="https://img.shields.io/badge/Cryptara-f59e0b?style=for-the-badge&labelColor=white&color=f59e0b">
</picture>

# Cryptara

**Web3 risk intelligence — understand any token before you trade.**

[![CI Quality Gate](https://github.com/Bokky73/cryptara/actions/workflows/ci.yml/badge.svg)](https://github.com/Bokky73/cryptara/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![EVM Contracts](https://img.shields.io/badge/EVM_Contracts-5_Verified-green.svg)](backend/contracts)
[![Soroban Contracts](https://img.shields.io/badge/Soroban_Contracts-5_Shipped-blueviolet.svg)](soroban/contracts)
[![Insights Modules](https://img.shields.io/badge/Insights_Engines-60%2B_Active-orange.svg)](frontend/src/app/api/insights)

Cryptara is an open-source, approval-only risk-intelligence platform that
analyses blockchain tokens across **EVM** and **Stellar** networks. Enter a
contract address, asset identifier, or DexScreener link and receive a structured
AI Risk Report with scores, evidence, and suggested actions — **no financial
advice, just data-driven signals.** See our [Risk Scoring Methodology](docs/RISK_SCORING_METHODOLOGY.md) for full calculation details.

👉 **[Live demo](https://cryptara.vercel.app)** (testnet) — try it without
setting up a local environment.

| Feature / Subsystem | Status | Description |
|---|---|---|
| Token contract / DexScreener analysis | ✅ V1 | Automated contract resolution & multi-factor signals |
| AI Risk Report (buy risk %, confidence, verdict) | ✅ V1 | Deterministic non-LLM risk scoring |
| Onchain / Social / News / Portfolio agents | ✅ V1 | Multi-source evidence collection |
| Deterministic Decision Agent | ✅ V1 | 100% reproducible audit verdicts |
| Approval-only execution preview | ✅ V1 | `serverCanSign: false` enforced |
| Real quote providers (Horizon, DexScreener) | ✅ V2 | Live path-finding & market pricing |
| Stellar trustline + swap parity | ✅ V2 | Full dual-VM execution preview |
| History and Watchlist pages | ✅ V2 | User saved assets, runs, and alerts |
| Supabase persistent storage adapter | ✅ V2 | Encrypted run logging & alert persistence |
| packages/read-client SDK | ✅ V2 | Isomorphic TypeScript client for Cryptara APIs |
| 5 Soroban smart contracts | ✅ V2 | Rust smart contracts on Stellar |
| 5 EVM smart contracts | ✅ V2 | Solidity smart contracts on EVM chains |
| 60+ Insights modules | ✅ V2 | Deep modular token security inspection |
| Playwright E2E journey suite | ✅ V2 | End-to-end browser tests with mock wallets |
| Semi-auto execution with user rules | 🔜 V3 | User policy thresholds & timelocks |
| Discovery agent + alerts | 🔜 V3 | Liquidity change & rug-pull monitoring |

---

## Quick start

```sh
# Prerequisites: Node.js 22+, npm 10+, Rust 1.84+
git clone https://github.com/Bokky73/cryptara.git
cd cryptara

npm install
npm install --prefix frontend
cp .env.example frontend/.env.local
npm run quality:gate         # ✔ local gate must pass
```

Open [http://localhost:3000](http://localhost:3000) to see the application.

> **Note:** The quality gate may report warnings about missing environment
> variables on first run. This is expected — fill in your `.env.local` values
> and re-run. See [`.env.example`](./.env.example) for all required variables.

> **Full setup instructions** — including Rust toolchain, Stellar CLI, and
> Soroban contract build — are in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Shipped Subsystems & Architecture

```
cryptara/
├── frontend/                     (Next.js App Router)
│   ├── src/app/api/insights/     — 60+ specialized risk intelligence engines
│   ├── src/server/agents/        — Portfolio, News, Social, Onchain, Decision
│   ├── src/server/providers/     — Quote, portfolio, and security adapters
│   ├── src/server/stellar/       — Stellar swap, trustline, and registry
│   ├── src/server/x402/          — Multi-chain x402 payment gates
│   └── e2e/                      — Playwright browser test suite & mock wallets
│
├── packages/read-client/         (Isomorphic TypeScript Client SDK)
│   └── src/                      — Read APIs: health, history, registry, alerts
│
├── soroban/                      (Rust Soroban Smart Contracts)
│   ├── contracts/audit-registry/ — Immutable decision & authorization logging
│   ├── contracts/governance/     — Timelock & multi-sig governance controls
│   ├── contracts/policy/         — Slippage & daily spend limit validation
│   ├── contracts/risk-registry/  — Onchain risk report publication registry
│   └── contracts/vault/          — Non-custodial escrow & deposit vault
│
└── backend/contracts/            (EVM Solidity Smart Contracts)
    ├── CryptaraAudit.sol         — Onchain audit trail & log verification
    ├── CryptaraPolicy.sol        — Policy verification & rule enforcement
    ├── CryptaraPolicyV2.sol      — Multi-factor modular policy engine
    ├── CryptaraTimelock.sol      — Governance timelock & queue controller
    └── CryptaraVault.sol         — Non-custodial execution escrow vault
```

---

## Supported chains

### EVM
Ethereum, Base, BSC, Arbitrum, Polygon, Optimism, Avalanche, Linea, Scroll,
zkSync Era, opBNB, Mantle, Blast, Fantom, Gnosis, Celo, Moonbeam, Moonriver,
Berachain, Sonic, Unichain, World Chain, Monad, Plasma, GOAT Network.

- **Quote provider:** DexScreener (public API)
- **Transaction model:** User-wallet-signed EIP-1559 txs
- **Contracts:** 5 Solidity contracts (`backend/contracts/`)

### Stellar
Stellar Testnet, Stellar Pubnet.

- **Quote provider:** Horizon path-finding (official Stellar API)
- **Transaction model:** User-wallet-signed classic ops & Soroban contract calls
- **Contracts:** 5 Soroban contracts (`soroban/contracts/`)

---

## Key design constraints

### 🚫 No auto-execute
Cryptara never signs or sends transactions on behalf of a user. Every
blockchain action requires explicit user approval through their connected
wallet. Auto-execute is disabled at every level — code, policy, and deployment.

### 🔒 Server never holds keys
The server has no access to user private keys. It prepares, previews, and
verifies transactions — the user always owns the signature.

### 📊 Deterministic decision engine
Agent scores are computed deterministically from verified data sources. There
is no LLM / AI hallucination in the agent pipeline. Every score is mathematically
traceable to specific factors and sources.

### ⚠️ Not financial advice
Risk scores, verdicts, and suggested actions are **informational indicators**
based on available onchain, social, and news data. They do not constitute
financial, investment, or legal advice. Always do your own research.

---

## Development & Verification Commands

| Command | Description |
|---|---|
| `npm run quality:gate` | Run all local checks (lint, TS, fixtures, config) |
| `npm run dev --prefix frontend` | Start Next.js dev server |
| `npm run test:e2e --prefix frontend` | Execute Playwright E2E journey tests |
| `cargo test --manifest-path soroban/Cargo.toml` | Run all Soroban contract tests |
| `npm test --prefix backend/contracts` | Run Hardhat EVM contract tests |
| `npm run deploy:check --prefix frontend` | Run deploy readiness & safety verification |

---

## License

[MIT](LICENSE) © 2026 Cryptara
