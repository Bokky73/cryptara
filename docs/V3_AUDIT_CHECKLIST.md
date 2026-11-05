# V3 External Audit Checklist

| Field | Value |
| --- | --- |
| Issue | Drago-Labs/cryptara#31 |
| Companion spec | `docs/V3_CONTRACT_SPEC.md` |
| Companion test matrix | `docs/V3_CONTRACT_TEST_MATRIX.md` |
| Companion upgrade/recovery analysis | `docs/V3_UPGRADE_RECOVERY.md` |
| Status | Audit-ready. This checklist is the deliverable that the external auditor uses to verify the V3 contracts. Each item must be checked off with a test reference or a code reference. |

This checklist is organized by the threats in `docs/V3_CONTRACT_SPEC.md` §8 and the acceptance criteria in §10. The auditor checks each item against the implementation and marks it ✅ (pass), ❌ (fail), or N/A (not applicable).

---

## 1. Custody and non-custodial invariant

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 1.1 | The EVM contract has no `ERC20.transfer`, `ERC20.transferFrom`, `ERC20.approve`, `ERC20.permit`, `swap`, or `deposit` methods. | Spec §3, §5.3 | |
| 1.2 | The EVM contract never calls an external token contract. | Spec §5.3, T-EVM-064 | |
| 1.3 | The Soroban contract has no token transfer / swap / approve methods. | Spec §6.3, T-SOR-071 | |
| 1.4 | The Soroban contract never invokes another contract. | Spec §6.3, T-SOR-074 | |
| 1.5 | No `selfdestruct` opcode is reachable in the EVM contract. | T-EVM-068 | |
| 1.6 | No `private` storage holds a private key or secret. | T-EVM-065, T-SOR-072 | |
| 1.7 | Pause does not move funds (no `Transfer` event on pause). | T-EVM-066, T-SOR-073 | |
| 1.8 | The contract never holds a signer (no `ecrecover`, no `sign`, no `permit` verification). | Spec §1 (non-custodial proof) | |

---

## 2. Reentrancy (T1)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 2.1 | No external calls in any state-changing function. | Spec §8 T1, T-EVM-048, T-SOR-070 | |
| 2.2 | No token callbacks (no `onERC777Received`, no `ERC721.receiver`). | T-EVM-064 | |
| 2.3 | State writes use the Checks-Effects-Interactions pattern (trivially satisfied since there are no interactions). | Spec §5.3 | |

---

## 3. Replay protection (T2)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 3.1 | EVM: `usedIntents[intentHash]` is set on first `logExecutionIntent`; subsequent calls revert `Replay`. | Spec §5.5, T-EVM-021 | |
| 3.2 | Soroban: `PublisherCounterNonce(publisher)` is monotonic; duplicate `(publisher, nonce)` reverts `ReplayProtection`. | Spec §6.5, T-SOR-023, T-SOR-024 | |
| 3.3 | Intent hash includes `chainId` (EVM) / `network_short_name` (Soroban) to prevent cross-chain replay. | Spec §7, §8 | |
| 3.4 | Reverted replay calls emit no events. | Spec §5.5, T-EVM-021 | |

---

## 4. Stale intent (T3, T10)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 4.1 | EVM: `logExecutionIntent` reverts `StaleIntent` when `block.timestamp > expiry`. | Spec §5.5, T-EVM-022 | |
| 4.2 | EVM: `surfaceStale(intentHash, expiry, observedTs)` emits `ExecutionIntentExpired` for indexer correlation. | Spec §5.3, T-EVM-022a | |
| 4.3 | Soroban: `publish_risk` reverts `StaleReport` when `updated_at <= existing.updated_at`. | Spec §6.5, T-SOR-019 | |
| 4.4 | `MAX_FUTURE_SECONDS` is bounded (300 seconds) to prevent clock manipulation. | Spec §6.4, T-SOR-018 | |

---

## 5. Malicious agent (T4)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 5.1 | Agents have per-address expiry; `agentExpiries[agent] <= block.timestamp` reverts `Expired`. | Spec §5.2, T-EVM-016 | |
| 5.2 | Agents can be revoked via `removeAgent`; revocation emits `AgentRevoked` and clears the agent mapping. | Spec §5.3, T-EVM-006 | |
| 5.3 | Agents are bound by the policy hash; `logDecision` reverts `PolicyMismatch` if the caller-supplied hash does not match. | Spec §5.3, T-EVM-059 | |
| 5.4 | Agents cannot bypass the daily limit, trade percent, slippage, or price impact bounds. | Spec §5.8, §5.9, T-EVM-052–T-EVM-055 | |
| 5.5 | Soroban publishers have per-address expiry and tier; expired publishers revert `Expired`. | Spec §6.2, T-SOR-016 | |

---

## 6. Infinite approval (T5)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 6.1 | `logExecutionIntent` emits `InfiniteApprovalWarning` when the from-token's allowance is `type(uint256).max`. | Spec §3, T-EVM-062 | |
| 6.2 | `logExecutionIntent` emits `RevokeAllowanceSuggested` when the allowance exceeds 10x the intent value. | Spec §3, T-EVM-063 | |
| 6.3 | The contract does not grant itself any allowance (no `approve` call). | T-EVM-064 | |
| 6.4 | The frontend blocks execution on `InfiniteApprovalWarning` (frontend-side check, not contract-enforced). | Spec §3 | |

---

## 7. Admin compromise (T6)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 7.1 | `transferOwnership` is two-step: `transferOwnership` + `acceptOwnership`. | Spec §5.6, T-EVM-040, T-EVM-041 | |
| 7.2 | `transferOwnership(address(0))` reverts `ZeroAddress`. | T-EVM-043 | |
| 7.3 | `acceptOwnership` by non-pending owner reverts `NotPendingOwner`. | T-EVM-042 | |
| 7.4 | Guardian can pause but cannot unpause, set policy, or upgrade. | Spec §5.2, T-EVM-031, T-EVM-037 | |
| 7.5 | Soroban: `transfer_admin` is two-step with `AdminAlreadyPending` guard. | Spec §6.3, T-SOR-047, T-SOR-051 | |
| 7.6 | Soroban: `accept_admin` by non-pending admin reverts `NotPendingAdmin`. | T-SOR-049 | |

---

## 8. Upgrade security (T7)

| # | Check | Reference | Status |
| --- | --- | --- |
| 8.1 | EVM: UUPS proxy with `scheduleUpgrade` + `executeUpgrade` + `cancelUpgrade`. | Spec §5.7, T-EVM-044–T-EVM-050 | |
| 8.2 | EVM: `scheduleUpgrade` delay is ≥ 24h and ≤ 30d. | T-EVM-045, T-EVM-046 | |
| 8.3 | EVM: `executeUpgrade` before `effectiveAt` reverts `UpgradeNotReady`. | T-EVM-048 | |
| 8.4 | EVM: `cancelUpgrade` before `executeUpgrade` is allowed. | T-EVM-050 | |
| 8.5 | EVM: `scheduleUpgrade` while pending reverts `UpgradeNotPending`. | T-EVM-047 | |
| 8.6 | EVM: After upgrade, `version()` emits `VersionReported`. | T-EVM-051 | |
| 8.7 | Soroban: `schedule_upgrade` with delay bounds and cancel path. | Spec §6.7, T-SOR-054–T-SOR-060 | |
| 8.8 | The frontend refuses to follow a new implementation that does not match the expected selector. | Spec §8 T7 | |

---

## 9. Cross-chain replay (T8)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 9.1 | EVM intent hash includes `block.chainid`. | Spec §8 | |
| 9.2 | Soroban asset_id includes `network_id`. | Spec §8 | |
| 9.3 | `isTransactionHashForChain` rejects EVM hashes (`0x` prefix) against Stellar RPC. | Spec §7, T-X-007 | |
| 9.4 | `isTransactionHashForChain` rejects Stellar hashes (no prefix) against EVM. | Spec §7, T-X-007 | |
| 9.5 | No hash collision between EVM `keccak256` and Soroban `sha256` outputs. | Spec §7, T-X-010 | |

---

## 10. Oracle / provider failure (T9, T17)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 10.1 | The contract does not read external oracles or price feeds. | Spec §8 T9 | |
| 10.2 | Price impact and slippage are user-supplied bounds, not oracle-derived. | Spec §5.3, T-EVM-053, T-EVM-054 | |
| 10.3 | The contract does not depend on RPC providers. | Spec §8 T17 | |
| 10.4 | The frontend falls back to RPC providers with `runProviderFallbacks`. | Spec §8 T17 | |

---

## 11. Policy broadening (T11)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 11.1 | Policy is a hash committed by the owner via `setPolicy`. | Spec §5.3, T-EVM-011 | |
| 11.2 | `logDecision` reverts `PolicyMismatch` if the caller-supplied hash does not match `getPolicyHash(owner)`. | Spec §5.3, T-EVM-059 | |
| 11.3 | The contract cannot broaden a policy it does not store. | Spec §1 (non-custodial proof) | |
| 11.4 | `PolicyUpdated` event is emitted on every policy change. | Spec §4, T-EVM-011 | |

---

## 12. Daily limit bypass (T12)

| # | Check | Reference | Status |
| --- | --- | --- |
| 12.1 | `dailySpentUsd` is enforced on `logExecutionIntent`. | Spec §5.8, T-EVM-049 | |
| 12.2 | The daily window resets every 24h. | Spec §5.8, T-EVM-060 | |
| 12.3 | The daily limit is per-wallet. | Spec §5.8 | |
| 12.4 | `DailyLimitExceeded` reverts when the limit is exceeded. | T-EVM-049 | |
| 12.5 | `DailyLimitReset` is emitted on window rollover. | T-EVM-060 | |

---

## 13. Nonce reuse (T13)

| # | Check | Reference | Status |
| --- | --- | --- |
| 13.1 | `nonces[wallet]` is monotonic. | Spec §5.3 | |
| 13.2 | `InvalidNonce` reverts on mismatch. | T-EVM-048 | |
| 13.3 | Soroban: `PublisherCounterNonce(publisher)` is monotonic. | Spec §6.5, T-SOR-023 | |

---

## 14. Asset allow/block bypass (T14)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 14.1 | `allowedAssets` is enforced per intent. | Spec §5.9, T-EVM-057 | |
| 14.2 | `blockedAssets` is enforced per intent. | Spec §5.9, T-EVM-056 | |
| 14.3 | Both sets are part of the policy hash. | Spec §8 | |
| 14.4 | `AssetBlocked` reverts when a blocked asset is used. | T-EVM-056 | |
| 14.5 | `AssetNotAllowed` reverts when an asset is not in the allowlist. | T-EVM-057 | |

---

## 15. Pause as fund extraction (T15)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 15.1 | No `transfer` / `approve` / `swap` methods exist. | T-EVM-064, T-SOR-071 | |
| 15.2 | Pause only suppresses writes. | Spec §5.5, T-EVM-038 | |
| 15.3 | Pause does not block reads. | T-EVM-039 | |

---

## 16. Soroban eviction (T16)

| # | Check | Reference | Status |
| --- | --- | --- |
| 16.1 | `Record` TTL is bumped on `publish_risk` and `get_risk`. | Spec §6.6, T-SOR-065, T-SOR-066 | |
| 16.2 | `Publisher` TTL is bumped on `set_publisher` and `publish_risk`. | Spec §6.6, T-SOR-067, T-SOR-068 | |
| 16.3 | Instance TTL is bumped on admin writes. | Spec §6.6, T-SOR-069 | |
| 16.4 | `UpgradePending` TTL uses `UPGRADE_TTL_THRESHOLD` / `UPGRADE_TTL_EXTEND_TO`. | Spec §6.6, T-SOR-070 | |

---

## 17. Network fork (T18)

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 17.1 | EVM contract uses `block.chainid` in intent hash. | Spec §8 | |
| 17.2 | Non-custodial: users re-sign and resend on the canonical chain. | Spec §8 T18 | |

---

## 18. Gas and resource exhaustion

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 18.1 | No unbounded loops in any function. | Spec §5.3, §6.3 | |
| 18.2 | No unbounded array or mapping growth without a cap. | Spec §5.3, §6.3 | |
| 18.3 | String inputs are length-bounded (`planId` ≤ 160, `asset_label` ≤ 64, `evidence_uri` ≤ 512). | Spec §5.4, §6.4 | |
| 18.4 | No `ecrecover` or signature verification that could be gas-griefed. | Spec §1 (non-custodial proof) | |

---

## 19. Integer overflow / underflow

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 19.1 | Solidity 0.8.24+ with built-in overflow checks. | Spec §5.3 | |
| 19.2 | `decisionCounter` uses `uint256` with saturating arithmetic where applicable. | Spec §5.3 | |
| 19.3 | Soroban uses `saturating_add` for version increments. | Spec §6.3 | |

---

## 20. Access control

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 20.1 | `onlyOwner` modifier on all owner-only functions. | Spec §5.2, §5.3 | |
| 20.2 | `onlyAgent` modifier on `logDecision`. | Spec §5.2, §5.3 | |
| 20.3 | `onlyGuardian` or `onlyOwner` on `pause`. | Spec §5.2, §5.3 | |
| 20.4 | `require_auth()` on all admin/publisher functions in Soroban. | Spec §6.3 | |
| 20.5 | `is_publisher` check before `publish_risk`. | Spec §6.3, T-SOR-015 | |
| 20.6 | No function is accidentally `external` without access control. | Spec §5.3, §6.3 | |

---

## 21. Event integrity

| # | Check | Reference | Status |
| --- | --- | --- | |
| 21.1 | All state-changing functions emit events. | Spec §4 | |
| 21.2 | Events are emitted in the documented order. | Spec §4, "Side-effect ordering" | |
| 21.3 | Reverted calls emit no events. | Spec §5.5, "Failure-mode coverage" | |
| 21.4 | `VersionReported` is emitted on first admin call after deploy/upgrade. | Spec §4, §5.7 | |
| 21.5 | `UpgradeScheduled` / `UpgradeExecuted` / `UpgradeCancelled` are emitted on upgrade operations. | Spec §4, §5.7 | |

---

## 22. Upgradeability

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 22.1 | EVM: UUPS proxy pattern with `ERC1967Proxy`. | Spec §5.7, T-EVM-044 | |
| 22.2 | EVM: `_authorizeUpgrade` is restricted to owner. | Spec §5.7 | |
| 22.3 | EVM: `scheduleUpgrade` delay ≥ 24h. | T-EVM-045 | |
| 22.4 | EVM: `cancelUpgrade` is callable before `executeUpgrade`. | T-EVM-050 | |
| 22.5 | Soroban: versioned WASM with `migrate`. | Spec §6.7, T-SOR-054 | |
| 22.6 | Soroban: `schedule_upgrade` delay ≥ 24h. | T-SOR-055 | |
| 22.7 | Soroban: `cancel_upgrade` is callable before `execute_upgrade`. | T-SOR-060 | |
| 22.8 | After upgrade, the new implementation calls `version()` and emits `VersionReported`. | Spec §5.7, T-EVM-051 | |

---

## 23. Recovery

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 23.1 | Two-step ownership transfer prevents accidental loss. | Spec §5.6, T-EVM-040, T-EVM-041 | |
| 23.2 | Guardian can pause if the owner key is compromised. | Spec §5.6, T-EVM-031 | |
| 23.3 | `cancelUpgrade` allows aborting a malicious upgrade during the timelock. | T-EVM-050 | |
| 23.4 | Soroban: two-step admin transfer + guardian pause. | Spec §6.3, T-SOR-047, T-SOR-048 | |
| 23.5 | Recovery tradeoffs are documented in `docs/V3_UPGRADE_RECOVERY.md`. | V3_UPGRADE_RECOVERY.md | |

---

## 24. Cross-chain parity

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 24.1 | `VersionReported` event format is consistent across chains. | T-X-001 | |
| 24.2 | `EmergencyPauseSet` event format is consistent across chains. | T-X-003 | |
| 24.3 | `UpgradeScheduled` / `UpgradeExecuted` event format is consistent across chains. | T-X-004 | |
| 24.4 | `decision_id` canonicalization is consistent (lower-case EVM, upper-case Soroban). | T-X-006 | |
| 24.5 | `plan_id` is a transparent pass-through on both chains. | T-X-009 | |
| 24.6 | `asset_id` domain separation prevents cross-chain collision. | T-X-010 | |
| 24.7 | Transaction hash chain-family collision is rejected. | T-X-007 | |

---

## 25. Final acceptance

| # | Check | Reference | Status |
| --- | --- | --- | --- |
| 25.1 | Every privilege has a limit, revoke path, and event. | Spec §5.2, §5.3, §4 | |
| 25.2 | Cross-chain/domain separation and canonical asset encoding are explicit. | Spec §7, §8 | |
| 25.3 | Contract cannot silently broaden user policy. | Spec §5.3, §8 T11 | |
| 25.4 | Threats map to controls and tests. | Spec §8, this checklist | |
| 25.5 | Maintainers have approved custody, upgrade, admin, and audit decisions. | Spec §9.6 | |
| 25.6 | All tests in `docs/V3_CONTRACT_TEST_MATRIX.md` pass. | V3_CONTRACT_TEST_MATRIX.md | |
| 25.7 | No implementation code is introduced in this spec PR. | Spec (header) | |

---

## Auditor notes

- The auditor should verify that the implementation matches the interface in `docs/V3_CONTRACT_SPEC.md` §5 and §6 exactly.
- The auditor should run the full test matrix in `docs/V3_CONTRACT_TEST_MATRIX.md` against the implementation.
- The auditor should confirm that no new external calls, token interfaces, or `selfdestruct` opcodes are introduced in the implementation.
- The auditor should confirm that the upgrade path (UUPS proxy / versioned WASM) is correctly implemented and that the timelock is enforced.
- The auditor should confirm that the daily limit, trade percent, slippage, price impact, and asset allow/block enforcement are correctly implemented and cannot be bypassed.
