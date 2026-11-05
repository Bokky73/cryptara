# Production Hardening Threat Model

> **Status**: DRAFT — produced as part of the production-hardening program. This document identifies threats, enumerates existing mitigations observable in the codebase, and flags gaps that require human execution or implementation before mainnet/V3 automation can be enabled.
>
> **Last updated**: 2026-07-29
> **Review required by**: Maintainer security review

---

## Table of Contents

1. [Wallet Connection Compromise](#1-wallet-connection-compromise)
2. [XDR/Calldata Substitution](#2-xdrcalldata-substitution)
3. [SEP-1 SSRF](#3-sep-1-ssrf)
4. [Contract Impersonation](#4-contract-impersonation)
5. [Stale Simulation](#5-stale-simulation)
6. [Event Spoofing](#6-event-spoofing)
7. [x402 Failure](#7-x402-failure)
8. [Agent Authorization Abuse](#8-agent-authorization-abuse)
9. [Automation Abuse](#9-automation-abuse)

---

## 1. Wallet Connection Compromise

| Field | Value |
|---|---|
| **Attack scenario** | An attacker gains control of a user's wallet (phished key, malicious browser extension, compromised WalletConnect session) and submits fraudulent transactions or approvals through the frontend. |
| **Affected component(s)** | `frontend/src/` — Wallet connection via wagmi/RainbowKit (EVM), `stellar-wallets-kit` (Stellar), all API routes that accept `walletAddress`. |
| **Impact** | Unauthorised transaction execution, asset loss if the server were to sign/submit transactions (currently it does not), fraudulent risk reports attributed to the victim address. |
| **Existing mitigations** | 1. `policy.ts` (`assertApprovalOnly`) enforces that the server never signs or submits — execution is approval-only. 2. `rateLimit.ts` limits per-wallet call frequency on execution and scan endpoints. 3. Wallet connection is client-side; the server only reads `walletAddress` as an identifier, not as an authenticator. 4. No server-side private keys exist in the codebase (verified by `policy.ts` forbidden-secret detection). |
| **Residual risk** | **MEDIUM**. The server currently has no mechanism to verify that the wallet address submitted in API requests actually owns the session. An attacker who controls the client can impersonate any address. Mitigation: require a signed challenge (SIWE / Stellar `Auth` envelope) for all write operations. **This mitigation is not yet implemented.** |
| **Gaps** | No session-bound signed challenge. Stellar `Auth` envelope verification is not implemented. No nonce-tracking endpoint for challenge/response. |

**Action required (pre-mainnet):** Implement wallet-ownership verification via SIWE (EIP-4361) for EVM and Stellar `Auth`/`WEB_AUTH_DOMAIN` for Stellar before enabling mainnet or automation.

---

## 2. XDR/Calldata Substitution

| Field | Value |
|---|---|
| **Attack scenario** | The agent displays a benign transaction envelope (XDR or calldata) for user review, but a different payload is submitted for execution. This could occur via: (a) client-side manipulation, (b) a malicious agent returning one payload while logging another, (c) a race between review and execution. |
| **Affected component(s)** | `frontend/src/server/simulation/freshness.ts` — `checkCalldataMatch`, `hashCalldata`; `frontend/src/app/api/execute/confirm/route.ts` — server-side confirmation gate; `frontend/src/server/agents/execution/index.ts` — execution agent. |
| **Impact** | User approves a safe transaction but a dangerous one executes. |
| **Existing mitigations** | 1. `checkCalldataMatch` in `freshness.ts` compares client-provided calldata hash against the simulation calldata. 2. `hashCalldata` computes a server-side hash from the raw calldata string (not trusting the client-supplied hash alone). 3. `confirm/route.ts` receives `currentCalldata` and re-computes the hash server-side before comparison. 4. The server never signs — it only records approval intents. The actual signing happens client-side in the wallet. |
| **Residual risk** | **LOW** for approval-only mode. The server verifies calldata consistency, but the final signing is client-side. If the wallet signs a different payload than what was verified, the server has no recourse. |
| **Gaps** | No commitment scheme where the server receives the signed transaction hash before recording approval (the `txHash` is already accepted in `confirm/route.ts`). Stellar XDR verification is less mature than EVM calldata hashing. |

---

## 3. SEP-1 SSRF

| Field | Value |
|---|---|
| **Attack scenario** | SEP-1 (`stellar.toml`) and SEP-2 (`federation`) endpoints fetch remote URIs based on user-provided or domain-derived inputs. An attacker provides a `stellar.toml` URL that points to an internal network resource (`169.254.169.254`, `localhost:8545`, etc.), causing the server to make requests to internal infrastructure. |
| **Affected component(s)** | `frontend/src/server/security/urlSafety.ts` — URL safety validation; any code that fetches `stellar.toml` or federation responses (directory TBD — survey suggests this is planned but not fully implemented). |
| **Impact** | Information disclosure (cloud metadata), internal service scanning, potential server-side request forgery against RPC endpoints or databases. |
| **Existing mitigations** | 1. `urlSafety.ts` exists as a module (provides URL validation). 2. Rate limiting on scan endpoints limits abuse velocity. 3. No SEP-1/SEP-2 fetching is currently wired into the agent pipeline (survey suggests this is a planned/partial feature). |
| **Residual risk** | **HIGH** if SEP-1 fetching is enabled without proper allow-listing. **MEDIUM** in current state since the feature is not fully wired. |
| **Gaps** | **Not yet present in codebase** — SEP-1 stellar.toml fetching and SEP-2 federation resolution are not yet implemented. Once implemented, they MUST: (a) resolve only against the Stellar network's authoritative domain, (b) block private IP ranges, (c) enforce DNS pinning, (d) limit redirect depth, (e) set HTTP request timeouts. |

**Action required (pre-feature-enablement):** Before SEP-1/SEP-2 resolution is enabled in production, implement the URL-safety mitigations listed above. Review `urlSafety.ts` to confirm it enforces an allow-list, not a block-list.

---

## 4. Contract Impersonation

| Field | Value |
|---|---|
| **Attack scenario** | An attacker deploys a counterfeit token contract or policy contract that mimics the legitimate one. Users or agents interact with the fake contract, believing it is the authorised Cryptara contract. |
| **Affected component(s)** | `frontend/src/server/agents/onchain/` — contract analysis; `backend/contracts/contracts/CryptaraPolicy.sol` — the legitimate policy; `soroban/contracts/policy/src/lib.rs` — the legitimate Soroban policy. |
| **Impact** | Users approve allowances on a malicious contract, agents produce risk scores based on fake onchain data, or policy-gated withdrawals are bypassed. |
| **Existing mitigations** | 1. Policy contracts (EVM and Soroban) are deployed at known addresses and version-stamped (`VERSION = "1.0.0"`). 2. `hashPolicyDecision` and `hashIntent` bind commitments to the chain ID (EVM) or ledger sequence (Soroban), preventing cross-domain replay. 3. The vault contracts reference an explicit `policy` address set at construction. 4. The risk registry contract authorises specific publisher addresses. |
| **Residual risk** | **MEDIUM**. There is no on-chain registry of "known-good" contract addresses that the frontend verifies before interacting. Users must independently verify the policy address. |
| **Gaps** | No frontend-side contract-address verification against a published registry. No ENS/stellar address resolution for the policy contract. |

---

## 5. Stale Simulation

| Field | Value |
|---|---|
| **Attack scenario** | A user or agent executes against a simulation that is no longer valid — the network state, price quote, or parameter set has changed. The user approves based on stale data. |
| **Affected component(s)** | `frontend/src/server/simulation/freshness.ts` — `checkSimulationFreshness`, `checkCalldataMatch`, `checkParamsMatch`, `isHighRiskExecution`, `hashCalldata`; `frontend/src/app/api/execute/confirm/route.ts` — server-side freshness gate; `frontend/src/components/SimulationResultPanel.tsx` — UI display of staleness. |
| **Impact** | Trade executes at unfavourable rates, against incorrect parameters, or on a stale state root. |
| **Existing mitigations** | 1. `checkSimulationFreshness` enforces: max block age (50 blocks), max ledger age (50 ledgers), max elapsed time (300s), quote expiry. 2. `checkParamsMatch` compares every bound simulation parameter against current values — fail-closed (any absent field causes mismatch). 3. `checkCalldataMatch` compares server-computed calldata hash. 4. `isHighRiskExecution` gates high-risk (>=50 riskScore, trade actions) to require a fresh, passed simulation. 5. `confirm/route.ts` requires the full `simulation` object for high-risk and rejects if stale, mismatched, or absent. 6. UI (`SimulationResultPanel.tsx`) shows stale-state guidance, quote-expiry countdown, and per-status next-action instructions. |
| **Residual risk** | **LOW** for high-risk trades. **MEDIUM** for low-risk actions (they skip simulation validation entirely). |
| **Gaps** | Low-risk actions (`riskScore < 50` or non-trade actions) have no simulation freshness requirement. The 300-second max elapsed time is a constant — should be configurable per-deployment. |

**Action required (pre-V3 automation):** Make elapsed-time, block-age, and ledger-age thresholds configurable via environment variables. Consider extending freshness gates to medium-risk actions.

---

## 6. Event Spoofing

| Field | Value |
|---|---|
| **Attack scenario** | An attacker emits fake events from a counterfeit contract that the monitoring system or agent pipeline consumes as legitimate. Examples: fake `PolicyApplied`, `IntentExecuted`, or `RiskPublished` events. |
| **Affected component(s)** | Any event-listener or indexer that processes onchain events without verifying the emitting contract address. Soroban events are authenticated at the protocol level; EVM events are not. |
| **Impact** | Automated systems take action based on fabricated state (e.g., believing a policy was revoked when it was not, or trusting a fake risk score). |
| **Existing mitigations** | 1. All event consumers should verify the emitting contract address matches the known legitimate address. 2. Soroban contract events include the contract ID as a topic (protocol-level authenticity). 3. EVM events are not protocol-authenticated — consumer code must check `address`. 4. No automated event listener is deployed in the current codebase (the system is request-driven, not event-driven). |
| **Residual risk** | **LOW** in current request-driven architecture. **HIGH** if an event-driven indexer is added without emitter-address verification. |
| **Gaps** | No event-listener code exists yet in this repo. Any future indexer must verify the emitting contract address before processing events. |

---

## 7. x402 Failure

| Field | Value |
|---|---|
| **Attack scenario** | The x402 (payment-required) protocol fails during a scan or execution flow — either the payment is not completed, the payment receipt is not verified, or the protocol enters an inconsistent state where the user is charged but receives no result. |
| **Affected component(s)** | `@coinbase/x402`, `@x402/core`, `@x402/evm`, `@x402/next` — x402 integration; `frontend/src/app/api/x402/` — x402 API endpoints (`deep-scan`, `terms`). |
| **Impact** | User pays for a service they do not receive, or receives a service without payment. |
| **Existing mitigations** | 1. `scripts/smoke-api.mjs` validates x402 flows end-to-end. 2. The storage layer records `x402_payment_receipts`. 3. `policy.ts` enforces approval-only, preventing automatic retry or unbilled execution. |
| **Residual risk** | **MEDIUM**. The x402 integration depends on external providers (Coinbase) and their uptime. No circuit-breaker or fallback payment path exists. |
| **Gaps** | No on-chain payment verification (the server trusts the x402 provider's receipt). No retry budget or escalation path for failed x402 calls. |

---

## 8. Agent Authorization Abuse

| Field | Value |
|---|---|
| **Attack scenario** | An unauthorised party invokes agent endpoints (e.g., `/api/agents/decision`, `/api/agent/analyze`) to either (a) drain API credits, (b) extract frontend-only data, or (c) trigger execution preparation for a fraudulent transaction. |
| **Affected component(s)** | All agent API routes; `policy.ts` — approval enforcement; `rateLimit.ts` — rate limiting; agent orchestration in `orchestration.ts`. |
| **Impact** | Denial-of-wallet (rate-limit exhaustion), information disclosure (portfolio data, risk analysis), or preparation of fraudulent execution intents. |
| **Existing mitigations** | 1. All agent endpoints are rate-limited per-namespace in `rateLimit.ts`. 2. `policy.ts` enforces approval-only — no server-side execution. 3. The server never holds private keys. 4. Agent results are deterministic and stored in-memory (no long-term persistence of agent outputs). |
| **Residual risk** | **MEDIUM**. No authentication or authorisation check on agent endpoints — any client can call them. No per-wallet or per-session access tokens. |
| **Gaps** | No API key, JWT, or session-based authentication on agent endpoints. **This is the single highest-priority gap for mainnet readiness.** |

**Action required (pre-mainnet):** Implement authentication for all agent and execution endpoints. Recommended: wallet-signed challenge (SIWE/Stellar Auth) for write operations, rate-limited API keys or session tokens for read operations.

---

## 9. Automation Abuse

| Field | Value |
|---|---|
| **Attack scenario** | Automated behaviour (planned for V3) executes trades, rebalances, or approvals without appropriate human oversight, at excessive frequency, or in amounts that exceed limits. |
| **Affected component(s)** | Planned automation features (not yet implemented in current codebase). Future: `execute/confirm`, policy contracts, vault contracts. |
| **Impact** | Unchecked automated trading leads to asset loss, market manipulation, or protocol abuse. |
| **Existing mitigations** | 1. Policy contracts enforce per-user max transaction value, max slippage, max daily spend, and asset allow/block lists. 2. Nonce-based replay protection prevents intent replay. 3. Expiry windows on both policies and intents. 4. The current codebase has NO automated execution — all execution is approval-only. |
| **Residual risk** | **HIGH** only if V3 automation is enabled without additional safeguards. Currently **LOW** because automation is not active. |
| **Gaps** | **Automation is not yet implemented.** When V3 automation is built, it must include: (a) per-user daily execution budgets, (b) circuit-breaker after N failed attempts, (c) maximum frequency (cooldown) per asset, (d) human-in-the-loop for above-threshold amounts, (e) audit logging of all automated actions, (f) pause capability at both user and global levels. |

**Action required (pre-V3 automation):** Implement automation abuse safeguards listed above. Do not enable automated execution before the production-hardening sign-off is complete.

---

## Threat Model Sign-Off

This threat model identifies **9 threat categories** with the following risk profile:

| Risk Level | Count | Key Gap |
|---|---|---|
| **HIGH** | 1 | SEP-1 SSRF (component not yet built) |
| **MEDIUM** | 5 | Wallet auth, contract impersonation, low-risk sim skip, x402 failures, agent auth |
| **LOW** | 3 | Calldata substitution, event spoofing, stale simulation (high-risk) |

**Critical blockers for mainnet:**
1. Wallet-ownership verification (SIWE/Stellar Auth) is not implemented.
2. Agent endpoint authentication is not implemented.
3. SEP-1/SEP-2 URL fetching (if enabled) must implement SSRF protections.

**Critical blockers for V3 automation:**
1. Automation abuse safeguards must be built from scratch.
2. Per-user execution budgets and circuit-breakers are not implemented.

> This document does not constitute a security audit. It is a threat-model survey of the current codebase conducted by an automated assistant. An independent external security review is required before mainnet deployment.
