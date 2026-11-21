# Local Development Guide

This guide covers bootstrapping and running Cryptara across all three runtimes: Node.js (frontend/backend), Rust (Soroban smart contracts), and Hardhat (EVM contracts).

---

## 1. Prerequisites

- **Node.js**: `v22.x` or higher
- **npm**: `v10.x` or higher
- **Rust**: `1.84+` with target `wasm32-unknown-unknown`
- **Stellar CLI**: Installed and on `PATH`
- **PostgreSQL / Supabase**: Optional for local persistent storage mode (default runs in memory)

Run the environment doctor to verify your system:
```bash
node scripts/doctor.mjs
```

---

## 2. Bootstrapping

```bash
# Clone the repository
git clone https://github.com/Bokky73/cryptara.git
cd cryptara

# Install root and frontend dependencies
npm install
npm install --prefix frontend

# Configure local environment variables
cp .env.example frontend/.env.local

# Run quality gate
npm run quality:gate
```

---

## 3. Running Locally

```bash
# Start frontend dev server
npm run dev --prefix frontend

# Run Soroban contract tests
cargo test --manifest-path soroban/Cargo.toml

# Run EVM contract tests
npm test --prefix backend/contracts
```
