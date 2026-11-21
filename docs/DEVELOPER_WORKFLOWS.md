# Developer Workflows & Verification

This guide outlines the standard development workflows, toolchain prerequisites, and verification procedures across Cryptara repositories.

## Toolchain Prerequisites

- **Node.js**: v22.x LTS
- **npm**: v10.x+
- **Rust**: 1.84+ with `wasm32-unknown-unknown` target
- **Stellar CLI**: Latest stable release

## Verification Commands

1. **Root Quality Gate**:
   ```bash
   npm run quality:gate
   ```
2. **Frontend E2E Tests**:
   ```bash
   npm run test:e2e --prefix frontend
   ```
3. **Soroban Contract Tests**:
   ```bash
   cargo test --manifest-path soroban/Cargo.toml
   ```
4. **EVM Contract Tests**:
   ```bash
   cd backend/contracts && npm test
   ```
