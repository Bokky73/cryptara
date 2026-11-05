<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://img.shields.io/badge/Cryptara-f59e0b?style=for-the-badge&labelColor=1a1a2e&color=f59e0b">
  <img alt="Cryptara" src="https://img.shields.io/badge/Cryptara-f59e0b?style=for-the-badge&labelColor=white&color=f59e0b">
</picture>

# Cryptara

**Web3 risk intelligence — understand any token before you trade.**

> 🎥 *Screenshot placeholder: add a GIF or image of the AI Risk Report UI here.*

Cryptara is an open-source, approval-only risk-intelligence platform that
analyses blockchain tokens across **EVM** and **Stellar** networks. Enter a
contract address, asset identifier, or DexScreener link and receive a structured
AI Risk Report with scores, evidence, and suggested actions — **no financial
advice, just data-driven signals.**

👉 **[Live demo](https://cryptara.vercel.app)** (testnet) — try it without
setting up a local environment.

| Feature | Status |
|---------|--------|
| Token contract / DexScreener analysis | ✅ V1 |
| AI Risk Report (buy risk %, confidence, verdict) | ✅ V1 |
| Onchain / Social / News / Portfolio agents | ✅ V1 |
| Deterministic Decision Agent | ✅ V1 |
| Approval-only execution preview | ✅ V1 |
| Real quote providers (Horizon, DexScreener) | ✅ V2 |
| Stellar trustline + swap parity | ✅ V2 |
| Risk Registry contract (Soroban) | ✅ V2 |
| Supabase persistent storage | 🔜 V2 |
| Semi-auto execution with user rules | 🔜 V2 |
| Discovery agent + alerts | 🔜 V3 |

---

## Quick start

```sh
# Prerequisites: Node.js 22+, npm 10+, Rust 1.84+
git clone https://github.com/Drago-Labs/cryptara.git
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

## Architecture

```
frontend/  (Next.js App Router)
├── server/       — Server-only agent pipeline & provider adapters
│   ├── agents/   — Portfolio, News, Social, Onchain, Decision, Execution
│   ├── providers/— Quote, portfolio, onchain data adapters
│   ├── stellar/  — Stellar swap, trustline, risk registry
│   ├── storage/  — Memory (default) or Supabase adapter
│   └── x402/     — Premium deep scan payment guards
├── app/          — Pages + API routes
└── components/   — React UI components

soroban/  (Rust Soroban contracts)
└── contracts/risk-registry/ — Non-custodial publication registry

backend/contracts/  (EVM Solidity contracts)
└── CryptaraVault.sol — Audit-log vault (prototype)
```

### Local Development

For information on how to bootstrap and run Cryptara locally, please see [Local Development](docs/LOCAL_DEVELOPMENT.md).

### Agent pipeline

```
Input → [Onchain] → [Social] → [News] → [Portfolio*] → [Decision] → [Execution]
           ↓           ↓          ↓           ↓              ↓             ↓
        Contract    Twitter/  News RSS   Wallet         Deterministic   Approval-only
        security    website   feeds      exposure        verdict         trade plan
        + liquidity signals               (optional)
```

\* Portfolio agent requires a connected wallet; otherwise it is skipped.

## Supported chains

### EVM

Ethereum, Base, BSC, Arbitrum, Polygon, Optimism, Avalanche, Linea, Scroll,
zkSync Era, opBNB, Mantle, Blast, Fantom, Gnosis, Celo, Moonbeam, Moonriver,
Berachain, Sonic, Unichain, World Chain, Monad, Plasma, GOAT Network

- **Quote provider:** DexScreener (V2, public API)
- **Transaction model:** User-wallet-signed EIP-1559 txs

### Stellar

Stellar Testnet, Stellar Pubnet

- **Quote provider:** Horizon path-finding (V2, official Stellar API)
- **Transaction model:** User-wallet-signed classic ops / Soroban
- **Contract:** Risk Registry (Soroban, testnet + pubnet)

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

Agent scores are computed deterministically from available data sources. There
is no LLM / AI-generated output in the agent pipeline. Every score is
traceable to a specific factor and source.

### ⚠️ Not financial advice

Risk scores, verdicts, and suggested actions are **informational indicators**
based on available onchain, social, and news data. They do not constitute
financial, investment, or legal advice. Always do your own research.

---

## Product status

### V1 — Complete ✅

- Token contract / DexScreener input analysis
- AI Risk Report with buy risk %, confidence, verdict
- 5 agent pipeline (Onchain, Social, News, Portfolio, Decision)
- Deterministic scoring with factor breakdown
- Approval-only execution preview
- No mock data in production mode
- Multi-EVM chain support

### V2 — In progress 🔄

- [x] Real quote adapters (Stellar Horizon + EVM DexScreener)
- [x] Stellar trustline creation and swap parity
- [x] Soroban Risk Registry contract hardening
- [ ] Supabase persistent storage adapter
- [ ] User rules / strategy configuration
- [ ] History and watchlist pages

### V3 — Planned 📋

- Policy vault contract (EVM + Soroban)
- Semi-auto execution (within user limits)
- Discovery agent (new pair monitoring)
- Alert system (risk changes, liquidity events)

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run quality:gate` | Run all local checks (lint, TS, fixtures, config) |
| `npm run dev --prefix frontend` | Start Next.js dev server |
| `npm run lint --prefix frontend` | Lint frontend code |
| `cargo test --manifest-path soroban/Cargo.toml` | Run Soroban contract tests |
| `npm run deploy:check --prefix frontend` | Run deploy readiness checks |

---

## Environment variables

See [`.env.example`](./.env.example) for all required and optional variables.
**Never commit a `.env` file or expose provider credentials.**

Key variables:

| Variable | Required for |
|----------|-------------|
| `GOAT_RPC_URL` | GOAT chain portfolio |
| `GOPLUS_API_KEY` | Token security checks |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect |
| `STELLAR_RPC_URL` | Soroban interactions |
| `X402_PAY_TO` | Premium deep scan |

---

## Security

- **Report vulnerabilities:** See [SECURITY.md](SECURITY.md)
- **Code of conduct:** See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- **Contributing:** See [CONTRIBUTING.md](CONTRIBUTING.md)

---

## License

[MIT](LICENSE) © 2026 Drago Labs
