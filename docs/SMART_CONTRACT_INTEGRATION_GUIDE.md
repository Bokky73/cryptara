# Smart Contract Architecture & Integration Guide

Cryptara maintains 10 production smart contracts across two virtual machine ecosystems:
- **5 Soroban Contracts** (Rust / Stellar VM) under `soroban/contracts/`
- **5 EVM Contracts** (Solidity / EVM) under `backend/contracts/`

This document details the architecture, roles, interfaces, and integration patterns for both contract suites.

---

## 1. Soroban Contracts (Stellar)

Located in `soroban/contracts/`, built with Rust (`soroban-sdk = 27.0.6`):

| Contract | Path | Purpose |
|---|---|---|
| **risk-registry** | `contracts/risk-registry/` | Onchain publication of token risk scores, hashes, and publisher credentials |
| **audit-registry** | `contracts/audit-registry/` | Tamper-proof logging of agent decisions, intents, and authorizations |
| **policy** | `contracts/policy/` | Onchain enforcement of max slippage, daily spend limits, and asset allowlists |
| **governance** | `contracts/governance/` | Multi-signature proposal queuing, emergency pause, and parameter updates |
| **vault** | `contracts/vault/` | Non-custodial escrow for approval-based trade settlement |

### Soroban Testing & Build
```bash
cargo build --manifest-path soroban/Cargo.toml --target wasm32-unknown-unknown --release
cargo test --manifest-path soroban/Cargo.toml
```

---

## 2. EVM Contracts (Solidity)

Located in `backend/contracts/contracts/`, compiled with Hardhat:

| Contract | File | Purpose |
|---|---|---|
| **CryptaraAudit** | `CryptaraAudit.sol` | EVM audit logging with cryptographic proof verification |
| **CryptaraPolicy** | `CryptaraPolicy.sol` | Core transaction policy validator |
| **CryptaraPolicyV2** | `CryptaraPolicyV2.sol` | Upgraded modular policy engine supporting composite rules |
| **CryptaraTimelock** | `CryptaraTimelock.sol` | Time-delayed execution controller for governance upgrades |
| **CryptaraVault** | `CryptaraVault.sol` | Non-custodial escrow vault with policy pre-checks |

### EVM Testing & Deployment
```bash
cd backend/contracts
npm install
npx hardhat test
```

---

## 3. Cross-VM Protocol Parity

Cryptara guarantees semantic parity across both EVM and Stellar:
1. **Approval-Only Enforcement**: Neither contract suite permits custodial withdrawals or unauthorized agent execution.
2. **Deterministic Hashing**: Audit logs on both VMs record cryptographic hashes of inputs and outputs for verifiable replay.
3. **Emergency Pause**: Both architectures support time-scoped emergency pause mechanisms controlled by multi-sig governance.
