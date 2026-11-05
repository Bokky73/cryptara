# Contract Artifact Provenance & Reproducible Builds

## Overview

Cryptara emits cryptographic provenance manifests for Hardhat EVM bytecode and Soroban WASM release artifacts. Reviewers can prove which commit, lockfiles, compiler settings, and source inputs produced a given artifact hash.

Manifests live under `release-manifests/` and use **repo-relative paths only**.

## Deterministic toolchains

| Layer | Pin |
|---|---|
| Solidity | `0.8.24` via Hardhat |
| EVM version | `paris` |
| Optimizer | enabled, `runs: 200`, `viaIR: true` |
| Soroban SDK | `=26.0.1` in `soroban/Cargo.toml` |
| Soroban build | `stellar contract build` → `wasm32v1-none` |
| Stellar CLI (CI) | `26.1.x` |

## What is hashed

- **EVM**: creation bytecode SHA-256, deployed bytecode SHA-256, Solidity metadata SHA-256, ABI SHA-256.
- **Soroban**: full WASM file SHA-256 for `cryptara_*.wasm` under `soroban/target/wasm32v1-none/release/`.
- **Inputs**: Hardhat config, Solidity sources, `soroban/Cargo.toml`, `soroban/Cargo.lock`, contracts `package-lock.json`.

## Commands

```bash
npm run build:evm
npm run build:soroban
npm run provenance:freeze -- --write --release
npm run provenance:verify -- --strict release-manifests/latest.json
node scripts/verify-artifact-provenance.mjs --self-test
```

`--release` refuses dirty git trees, missing lockfiles, incompatible Hardhat/Soroban settings, and incompatible Stellar CLI versions.

## Deploy gate

Deploy scripts require a verified manifest path:

```bash
./scripts/deploy-policy-evm.sh sepolia release-manifests/latest.json
./scripts/deploy-policy-soroban.sh testnet release-manifests/latest.json
node scripts/deploy-audit-layer.mjs --chain evm --network sepolia --manifest release-manifests/latest.json --dry-run
```

## Security invariants

- Manifests must never contain secrets, private keys, signed transactions, credential-bearing URLs, or absolute user paths.
- Offline verification recomputes hashes and validates schema, claimed tools, and live config pins.
- Health/readiness expose only `unchecked | verified | failed` for provenance status.
- This workflow does not deploy to mainnet/pubnet.
