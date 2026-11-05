# V3 Contract Test Matrix

| Field | Value |
| --- | --- |
| Issue | Drago-Labs/cryptara#31 |
| Companion spec | `docs/V3_CONTRACT_SPEC.md` |
| Companion audit checklist | `docs/V3_AUDIT_CHECKLIST.md` |
| Status | Audit-ready. All defaults in `docs/V3_CONTRACT_SPEC.md` §9.5 are binding unless a maintainer comment substitutes a specific item; absent substitutions, defaults merge at PR approval. |
| Scope | Implementation-ready test cases for both `CryptaraVault` (EVM) and `RiskRegistry` (Soroban), with explicit threat-to-control-to-test mapping. |

The matrix is exhaustive enough to implement without product guesses. Each row carries a stable identifier (`T-EVM-xxx`, `T-SOR-xxx`, `T-X-xxx`) so it can be cross-referenced from the implementation PRs and the audit checklist.

Conventions:

- ✅ = pass / expected behavior
- ❌ = revert / expected error
- `events[N]` = the Nth event expected in the order listed
- `state` = expected post-state of the contract storage
- Both chains follow the same human-readable semantic events; the implementation per chain is described in the test row.

Pre-conditions common to all tests:

- `CryptaraVault` is deployed on GOAT Network (id 48816) with `owner = deployer`, `agent = address(0)`, `paused = false`, `agents = {}`, `policyHash = bytes32(0)`, `usedIntents = {}`.
- `RiskRegistry` is deployed on Stellar Testnet with `admin = deployer`, `publishers = {}`, `paused = false`, `version = (0,1,0, ZERO)`.
- Block timestamps and ledger timestamps are deterministic per test harness.

---

## Threat-to-control-to-test mapping

This table maps each threat in `docs/V3_CONTRACT_SPEC.md` §8 to its control and the test IDs that verify the control.

| Threat | Control | Test IDs |
| --- | --- | --- |
| T1: Reentrancy | No token calls in contract | T-EVM-048, T-SOR-070 |
| T2: Replay | `usedIntents[intentHash]` / `PublisherCounterNonce` | T-EVM-021, T-SOR-023 |
| T3: Stale intent | `expiry` + `StaleIntent` revert + `surfaceStale` | T-EVM-022, T-EVM-022a |
| T4: Malicious agent | Per-agent expiry + revocation + replay protection | T-EVM-006, T-EVM-016, T-EVM-008 |
| T5: Infinite approval | `InfiniteApprovalWarning` + `RevokeAllowanceSuggested` | T-EVM-050, T-EVM-051 |
| T6: Admin compromise | Two-step transfer + guardian pause + timelock | T-EVM-036, T-EVM-037, T-EVM-040 |
| T7: Upgrade with malicious impl | Timelock + `VersionReported` + `UpgradeCancelled` | T-EVM-040, T-EVM-043, T-EVM-044 |
| T8: Cross-chain replay | `chainId` in intent hash + `isTransactionHashForChain` | T-X-007, T-X-008 |
| T9: Oracle/provider failure | No oracle dependency; user-supplied bounds | T-EVM-052, T-EVM-053 |
| T10: Stale intent on chain | `block.timestamp > expiry` reverts | T-EVM-022 |
| T11: Policy broadening | Policy hash commitment + `PolicyMismatch` | T-EVM-013, T-EVM-014 |
| T12: Daily limit bypass | `dailySpentUsd` enforced per window | T-EVM-049, T-EVM-050 |
| T13: Nonce reuse | `nonces[wallet]` monotonic + `InvalidNonce` | T-EVM-048 |
| T14: Asset allow/block bypass | `allowedAssets` / `blockedAssets` enforced | T-EVM-047, T-EVM-049 |
| T15: Pause as fund extraction | No transfer/approve/swap methods | T-EVM-050 |
| T16: Soroban eviction | TTL bumps on every write | T-SOR-064, T-SOR-066 |
| T17: RPC provider downtime | No RPC dependency in contract | T-X-009 |
| T18: Network fork | `chainId` distinct per chain | T-X-007 |

---

## Governance Timelock (Issue #145)

| ID | Test case | Precondition | Action | Expected |
|---|---|---|---|---|
| T-GOV-001 | Propose happy path (EVM) | 2+ signers, delay ∈ [24h,30d] | `propose(target, selector, payload, 24h)` | `ProposalCreated` with `payloadHash=keccak256(payload)` |
| T-GOV-002 | Propose happy path (Soroban) | 2+ signers | `propose(proposer, target, selector, payload, 24h)` | `ProposalCreated` with `payloadHash` |
| T-GOV-003 | Single signer cannot execute alone (EVM) | 1 signature, threshold=2 | `sign` once then `execute` after delay | revert `InsufficientSignatures` |
| T-GOV-004 | Single signer cannot execute alone (Soroban) | 1 signature | `sign` once then `execute` | revert `InsufficientSignatures` |
| T-GOV-005 | Execute early fails (EVM) | before `effectiveAt` | `execute` | revert `ProposalNotReady` |
| T-GOV-006 | Execute early fails (Soroban) | before `effectiveAt` | `execute` | revert `ProposalNotReady` |
| T-GOV-007 | Cancel during delay prevents execution (EVM) | pending | `cancel` then `execute` after delay | revert `ProposalAlreadyCancelled`, replay fails |
| T-GOV-008 | Cancel during delay prevents execution (Soroban) | pending | `cancel` then `execute` | revert `ProposalAlreadyCancelled`, replay fails |
| T-GOV-009 | Emergency pause immediate (EVM) | paused | `propose`/`execute` | revert `Paused`, pause event immediate |
| T-GOV-010 | Emergency pause immediate (Soroban) | paused | `propose` | revert `Paused` |
| T-GOV-011 | Pending queue readable (EVM) | 2 pending | `getPendingQueue`/`getPendingCount` | queue length matches count, `payloadHash` matches |
| T-GOV-012 | Pending queue readable (Soroban) | 2 pending | `get_pending_queue`/`get_pending_count` | queue matches on-chain state |
| T-GOV-013 | Replay after cancel fails (EVM) | cancelled | second `cancel`/`execute` | revert `ProposalAlreadyCancelled` |
| T-GOV-014 | Replay after cancel fails (Soroban) | cancelled | second `cancel`/`execute` | revert `ProposalAlreadyCancelled` |
| T-GOV-015 | Expiry/invalid signer (EVM) | unknown proposal / outsider sign | `sign`/`execute` | revert `ProposalNotFound`/`Unauthorized` |
| T-GOV-016 | Expiry/invalid signer (Soroban) | unknown / outsider | `sign`/`execute` | revert `ProposalNotFound`/`InvalidSigner` |
| T-GOV-017 | Delay bounds (EVM) | delay <24h or >30d | `propose` | revert `InvalidDelay` |
| T-GOV-018 | Delay bounds (Soroban) | delay out of range | `propose` | revert `InvalidDelay` |

Covered by `backend/contracts/test/timelock.test.ts`, `policy-governance.test.ts`, `soroban/contracts/governance/src/test.rs`.

## EVM — `CryptaraVault`

### Authorization and lifecycle

| ID | Test case | Precondition | Action | Expected events | Expected state | Expected error |
| --- | --- | --- | --- | --- | --- | --- |
| T-EVM-001 | `version()` returns registered triple | contract deployed | `version()` | `VersionReported` (on first call) | `version = (0,1,0, buildHash)` then unchanged | none |
| T-EVM-002 | `addAgent` happy path | owner is `deployer` | `addAgent(agentA, expiry = block.timestamp + 30 days, "cryptara")` | `AgentApproved(wallet, agentA, approvedAt, policyHash, "cryptara", expiry)` | `agentExpiries[agentA] = expiry`, `agentOwner[agentA] = owner` | none |
| T-EVM-003 | `addAgent` zero agent | owner | `addAgent(address(0), expiry, "tier")` | — | unchanged | `ZeroAddress` |
| T-EVM-004 | `addAgent` zero expiry | owner | `addAgent(agentA, 0, "tier")` | — | unchanged | `InvalidFormat("expiry required")` |
| T-EVM-005 | `addAgent` non-owner | sender ≠ owner | `addAgent(agentA, expiry, "tier")` | — | unchanged | `NotOwner` |
| T-EVM-006 | `removeAgent` happy path | agent added | `removeAgent(agentA, "rotated")` | `AgentRevoked(wallet, agentA, revokedAt, "rotated")` | `agentExpiries[agentA] = 0`, `agentOwner[agentA] = address(0)` | none |
| T-EVM-007 | `removeAgent` unknown agent | owner | `removeAgent(agentUnknown, "x")` | — | unchanged | `InvalidFormat("unknown agent")` |
| T-EVM-008 | `rotateAgent` happy path | agentA added | `rotateAgent(agentA, agentB, newExpiry, "cryptara")` | `AgentRevoked(wallet, agentA, …)`, `AgentApproved(wallet, agentB, …, "cryptara", newExpiry)` | `agentExpiries[agentB] = newExpiry`, `agentExpiries[agentA] = 0` | none |
| T-EVM-009 | `rotateAgent` previous agent unknown | owner | `rotateAgent(address(0), agentB, newExpiry, "tier")` | — | unchanged | `InvalidFormat("agent not registered")` |
| T-EVM-010 | `rotateAgent` while paused | paused | `rotateAgent(agentA, agentB, newExpiry, "tier")` | — | unchanged | `Paused` |
| T-EVM-011 | `setPolicy` happy path | owner | `setPolicy(policyBytes)` | `PolicyUpdated(wallet, policyHash, updatedAt)` | `policyHash[w] = newPolicyHash`, `maxDailyValueUsd[w]`, `maxTradePercent[w]`, etc. | none |
| T-EVM-012 | `setPolicy` malformed bytes | owner | `setPolicy(0x00)` | — | unchanged | `InvalidFormat("policy length")` |
| T-EVM-013 | `getPolicyHash` returns current | policy set | `getPolicyHash(wallet)` | — | `policyHash` matches last set | none |
| T-EVM-014 | `logDecision` happy path | agent added, policy set | `logDecision(decisionHash, policyHash, riskScore, "plan_id_uuid")` | `DecisionLogged(wallet, agent, decisionHash, decisionId, policyHash, "plan_id_uuid", riskScore, createdAt)` | `decisionCounter[owner] += 1` | none |
| T-EVM-014-NI | `logDecision` non-canonical planId | agent added, policy set | `logDecision(decisionHash, policyHash, riskScore, "")` | — | unchanged | `InvalidFormat("plan_id required")` |
| T-EVM-014-NI-2 | `logDecision` oversized planId | agent added, policy set | `logDecision(decisionHash, policyHash, riskScore, "<161-char utf8>")` | — | unchanged | `InvalidFormat("plan_id too long")` |
| T-EVM-015 | `logDecision` non-agent | sender ≠ agent | `logDecision(...)` | — | unchanged | `NotAgent` |
| T-EVM-016 | `logDecision` expired agent | agent expiry < now | `logDecision(...)` | — | unchanged | `Expired` |
| T-EVM-017 | `logDecision` zero hash | agent | `logDecision(bytes32(0), …)` | — | unchanged | `ZeroHash` |
| T-EVM-018 | `logDecision` invalid risk score | agent | `logDecision(..., riskScore=200)` | — | unchanged | `InvalidRiskScore(200)` |
| T-EVM-019 | `logDecision` while paused | paused | `logDecision(...)` | — | unchanged | `Paused` |
| T-EVM-020 | `logExecutionIntent` happy path | intent hash derived | `logExecutionIntent(intentHash, decisionHash, expiry, nonce, fromToken, toToken, percent, valueUsd, maxSlippageBps, maxPriceImpactBps, "plan_id_uuid")` | `ExecutionIntentLogged(wallet, intentHash, decisionHash, "plan_id_uuid", expiry, nonce, fromToken, toToken, percent, valueUsd, maxSlippageBps, maxPriceImpactBps)` | `usedIntents[intentHash] = true`, `nonces[w] += 1`, `dailySpentUsd[w] += valueUsd` | none |
| T-EVM-021 | `logExecutionIntent` replay | already recorded | `logExecutionIntent(sameIntentHash, …)` | — (no event on revert) | unchanged | `Replay` |
| T-EVM-022 | `logExecutionIntent` stale | expiry <= now | `logExecutionIntent(intentHash, decisionHash, expiry, …)` | — (no event on revert) | unchanged | `StaleIntent` |
| T-EVM-021a | `surfaceReplay` happy path | a `logExecutionIntent` previously reverted with `Replay` | `surfaceReplay(intentHash)` (onlyOwner) | `ExecutionIntentReplayed(intentHash, msg.sender, uint64(block.timestamp))` | unchanged | none |
| T-EVM-021a-NI | `surfaceReplay` non-owner | third party | `surfaceReplay(intentHash)` | — | unchanged | `NotOwner` |
| T-EVM-022a | `surfaceStale` happy path | a `logExecutionIntent` previously reverted with `StaleIntent` | `surfaceStale(intentHash, expiry, observedTs)` (onlyOwner) | `ExecutionIntentExpired(msg.sender, intentHash, expiry, observedTs)` | unchanged | none |
| T-EVM-022a-NI | `surfaceStale` non-owner | third party | `surfaceStale(intentHash, expiry, observedTs)` | — | unchanged | `NotOwner` |
| T-EVM-023 | `logExecutionIntent` zero hash | owner | `logExecutionIntent(bytes32(0), …)` | — | unchanged | `ZeroHash` |
| T-EVM-024 | `logExecutionIntent` non-owner | agent | `logExecutionIntent(...)` | — | unchanged | `NotOwner` |
| T-EVM-025 | `logExecutionIntent` while paused | paused | `logExecutionIntent(...)` | — | unchanged | `Paused` |
| T-EVM-026 | `cancelExecutionIntent` happy path | intent logged | `cancelExecutionIntent(intentHash, "user cancelled")` | `ExecutionIntentCancelled(wallet, intentHash, cancelledAt, "user cancelled")` | intent marked cancelled | none |
| T-EVM-027 | `cancelExecutionIntent` non-owner | third party | `cancelExecutionIntent(intentHash, "x")` | — | unchanged | `NotOwner` |
| T-EVM-028 | `cancelExecutionIntent` on cancelled intent | already cancelled | `cancelExecutionIntent(intentHash, "x")` | — | unchanged | `IntentCancelled` |
| T-EVM-029 | `cancelExecutionIntent` on unknown intent | never logged | `cancelExecutionIntent(unknownHash, "x")` | — | unchanged | `InvalidFormat("intent not found")` |
| T-EVM-030 | `pause` by owner | owner | `pause("security review")` | `EmergencyPauseSet(wallet, true, pausedAt, "security review")` | `paused = true` | none |
| T-EVM-031 | `pause` by guardian | guardian set | `pause("incident")` | `EmergencyPauseSet(wallet, true, pausedAt, "incident")` | `paused = true` | none |
| T-EVM-032 | `pause` empty reason by guardian | guardian | `pause("")` | `EmergencyPauseSet(wallet, true, …, "")` | `paused = true` | none |
| T-EVM-033 | `pause` empty reason by owner | owner | `pause("")` | — | unchanged | `InvalidFormat("reason required")` |
| T-EVM-034 | `pause` by non-owner non-guardian | third party | `pause("x")` | — | unchanged | `NotGuardian` |
| T-EVM-035 | `pause` while paused | owner | `pause("again")` | `EmergencyPauseSet(wallet, true, …, "again")` | `paused = true` (no-op) | none |
| T-EVM-036 | `unpause` by owner | paused | `unpause()` | `EmergencyPauseSet(wallet, false, pausedAt, "")` | `paused = false` | none |
| T-EVM-037 | `unpause` by guardian | paused | `unpause()` | — | unchanged | `NotOwner` |
| T-EVM-038 | `pause` blocks writes | paused | `addAgent`, `setPolicy`, `logDecision`, `logExecutionIntent` | — | unchanged | `Paused` |
| T-EVM-039 | `pause` does not block reads | paused | `version()`, `getPolicyHash`, `is_paused()` | — | n/a | none |
| T-EVM-040 | `transferOwnership` step 1 | owner | `transferOwnership(newOwner)` | `OwnershipTransferStarted(wallet, newOwner)` | `pendingOwner = newOwner` | none |
| T-EVM-041 | `acceptOwnership` happy path | pendingOwner set | `acceptOwnership()` | `OwnershipTransferred(wallet, pendingOwner)` | `owner = newOwner`, `pendingOwner = address(0)` | none |
| T-EVM-042 | `acceptOwnership` non-pending | third party | `acceptOwnership()` | — | unchanged | `NotPendingOwner` |
| T-EVM-043 | `transferOwnership` zero new owner | owner | `transferOwnership(address(0))` | — | unchanged | `ZeroAddress` |
| T-EVM-044 | `scheduleUpgrade` happy path | owner | `scheduleUpgrade(newImpl, delaySec = 24 * 3600)` | `UpgradeScheduled(contract, newImpl, effectiveAt, delaySec)` | `upgradePending = newImpl`, `effectiveAt = now + 24h` | none |
| T-EVM-045 | `scheduleUpgrade` delay too small | owner | `scheduleUpgrade(newImpl, 60)` | — | unchanged | `InvalidUpgradeDelay` |
| T-EVM-046 | `scheduleUpgrade` delay too large | owner | `scheduleUpgrade(newImpl, 31 * 86400)` | — | unchanged | `InvalidUpgradeDelay` |
| T-EVM-047 | `scheduleUpgrade` while pending | one pending | `scheduleUpgrade(newImpl2, 24 * 3600)` | — | unchanged | `UpgradeNotPending` |
| T-EVM-048 | `executeUpgrade` before effective | pending | `executeUpgrade()` | — | unchanged | `UpgradeNotReady` |
| T-EVM-049 | `executeUpgrade` after effective | pending, effectiveAt reached | `executeUpgrade()` | `UpgradeExecuted(contract, newImpl, executedAt)` | `upgradePending` cleared; implementation swapped | none |
| T-EVM-050 | `cancelUpgrade` before execute | pending | `cancelUpgrade()` | `UpgradeCancelled(contract, newImpl, cancelledAt)` | `upgradePending` cleared | none |
| T-EVM-051 | `upgrade` after `executeUpgrade` re-emits version | new implementation | `version()` on new impl | `VersionReported(contract, semver, buildHash, reportedAt)` | `version` reflects new impl | none |

### Policy and limit enforcement

| ID | Test case | Precondition | Action | Expected events | Expected state | Expected error |
| --- | --- | --- | --- | --- | --- | --- |
| T-EVM-052 | `logExecutionIntent` trade percent exceeds limit | policy set with `maxTradePercent = 50` | `logExecutionIntent(..., percent=75, ...)` | — | unchanged | `InvalidTradePercent` |
| T-EVM-053 | `logExecutionIntent` slippage exceeds limit | policy set with `maxSlippageBps = 100` | `logExecutionIntent(..., maxSlippageBps=200, ...)` | — | unchanged | `InvalidSlippage` |
| T-EVM-054 | `logExecutionIntent` price impact exceeds limit | policy set with `maxPriceImpactBps = 50` | `logExecutionIntent(..., maxPriceImpactBps=100, ...)` | — | unchanged | `InvalidPriceImpact` |
| T-EVM-055 | `logExecutionIntent` daily limit exceeded | `dailySpentUsd + valueUsd > maxDailyValueUsd` | `logExecutionIntent(..., valueUsd=large, ...)` | — | unchanged | `DailyLimitExceeded` |
| T-EVM-056 | `logExecutionIntent` blocked asset | `toToken` in `blockedAssets[wallet]` | `logExecutionIntent(..., toToken=blocked, ...)` | — | unchanged | `AssetBlocked` |
| T-EVM-057 | `logExecutionIntent` asset not in allowlist | `allowedAssets[wallet]` non-empty, `toToken` not in it | `logExecutionIntent(..., toToken=notAllowed, ...)` | — | unchanged | `AssetNotAllowed` |
| T-EVM-058 | `logExecutionIntent` nonce mismatch | `nonces[wallet] = 5` | `logExecutionIntent(..., nonce=3, ...)` | — | unchanged | `InvalidNonce` |
| T-EVM-059 | `logExecutionIntent` policy hash mismatch | caller-supplied `policyHash != getPolicyHash(owner)` | `logExecutionIntent(..., policyHash=different, ...)` | — | unchanged | `PolicyMismatch` |
| T-EVM-060 | Daily limit window resets | `block.timestamp >= dailyWindowStart + 24h` | `logExecutionIntent(...)` after window reset | `DailyLimitReset(wallet, resetAt, 0)` then `ExecutionIntentLogged(...)` | `dailySpentUsd[w] = valueUsd`, `dailyWindowStart[w] = now` | none |
| T-EVM-061 | Daily limit accumulates within window | two intents in same window | `logExecutionIntent(valueUsd=100)`, `logExecutionIntent(valueUsd=200)` | `ExecutionIntentLogged(...)` ×2 | `dailySpentUsd[w] = 300` | none |
| T-EVM-062 | `logExecutionIntent` with infinite allowance | allowance is `type(uint256).max` | `logExecutionIntent(...)` | `ExecutionIntentLogged(...)` then `InfiniteApprovalWarning(...)` | unchanged | none |
| T-EVM-063 | `logExecutionIntent` with high allowance | allowance > 10x valueUsd | `logExecutionIntent(...)` | `ExecutionIntentLogged(...)` then `RevokeAllowanceSuggested(...)` | unchanged | none |

### Non-custodial guard

| ID | Test case | Precondition | Action | Expected behavior |
| --- | --- | --- | --- | --- |
| T-EVM-064 | No ERC-20 / swap / transfer / approve methods | contract ABI | reflection | ABI surface contains only vault-managed methods; no token interface |
| T-EVM-065 | No `private` storage holds a key | contract ABI | reflection | no `mapping(address=>bytes32) private _keys` or similar |
| T-EVM-066 | Pause does not move funds | paused | arbitrary admin call | no `Transfer` event ever emitted; events limited to vault-managed events |
| T-EVM-067 | No external contract calls | contract ABI | reflection | no `interface` or `call` to external contracts |
| T-EVM-068 | No `selfdestruct` | contract ABI | reflection | no `selfdestruct` opcode reachable |

---

## Soroban — `RiskRegistry`

### Initialization and authorization

| ID | Test case | Precondition | Action | Expected events | Expected state | Expected error |
| --- | --- | --- | --- | --- | --- | --- |
| T-SOR-001 | `initialize` happy path | not initialized | `initialize(admin, publishers, tiers, expiries, version)` | `RegistryInitialized(admin)`, `VersionReported(...)` | `Admin = admin`, `Publishers = {…}`, `Version = version`, `Paused = false` | none |
| T-SOR-002 | `initialize` second call | initialized | `initialize(...)` | — | unchanged | `AlreadyInitialized` |
| T-SOR-003 | `initialize` zero admin | not initialized | `initialize(Address::zero(), …)` | — | unchanged | `ZeroAddress` |
| T-SOR-004 | `initialize` zero publisher | not initialized | `initialize(admin, [zero], …)` | — | unchanged | `ZeroAddress` |
| T-SOR-005 | `initialize` invalid tier | not initialized | `initialize(admin, …, tiers = ["x".repeat(33)], …)` | — | unchanged | `InvalidTier` |
| T-SOR-006 | `initialize` invalid expiry | not initialized | `initialize(admin, …, expiries = [0])` | — | unchanged | `InvalidFormat("publisher expiry required")` |
| T-SOR-007 | `initialize` zero upgrade build | not initialized | `initialize(admin, …, version = (0,1,0, BytesN::from_array([0;32])))` | — | unchanged | `ZeroHash` |
| T-SOR-008 | `set_publisher` happy path | initialized | `set_publisher(p, true, "cryptara", expiry)` | `PublisherAuthorizationChanged(p, true, "cryptara", changedAt)` | `Publisher(p) = true`, `Tier(p) = "cryptara"`, `Expiry(p) = expiry` | none |
| T-SOR-009 | `set_publisher` revoke | publisher added | `set_publisher(p, false, "cryptara", 0)` | `PublisherAuthorizationChanged(p, false, "cryptara", ts)` | `Publisher(p)` removed | none |
| T-SOR-010 | `set_publisher` non-admin | non-admin signer | `set_publisher(p, true, "tier", expiry)` | — | unchanged | `(no auth)` — `require_auth` reverts |
| T-SOR-011 | `set_publisher` zero publisher | admin | `set_publisher(Address::zero(), true, "tier", expiry)` | — | unchanged | `ZeroAddress` |
| T-SOR-012 | `set_publisher` invalid tier | admin | `set_publisher(p, true, "x".repeat(33), expiry)` | — | unchanged | `InvalidTier` |
| T-SOR-013 | `set_publisher` while paused | paused | `set_publisher(p, true, "tier", expiry)` | — | unchanged | `Paused` |

### Publishing and revoking

| ID | Test case | Precondition | Action | Expected events | Expected state | Expected error |
| --- | --- | --- | --- | --- | --- | --- |
| T-SOR-014 | `publish_risk` happy path | authorized publisher | `publish_risk(p, asset, "GOAT", "GOAT", 42, "watch", reportHash, "https://…", updatedAt, nonce=1)` | `RiskPublished(asset, "GOAT", p, 42, "watch", reportHash, updatedAt)` | `Record(asset, "GOAT") = new record` | none |
| T-SOR-015 | `publish_risk` non-publisher | unknown signer | `publish_risk(...)` | — | unchanged | `UnauthorizedPublisher` |
| T-SOR-016 | `publish_risk` expired publisher | publisher expiry < now | `publish_risk(...)` | — | unchanged | `Expired` |
| T-SOR-017 | `publish_risk` score > 100 | publisher | `publish_risk(..., score=200, ...)` | — | unchanged | `InvalidScore` |
| T-SOR-018 | `publish_risk` future timestamp | publisher | `publish_risk(..., updatedAt = now + 600, ...)` | — | unchanged | `FutureTimestamp` |
| T-SOR-019 | `publish_risk` stale | existing record newer | `publish_risk(..., updatedAt = existing.updated_at, ...)` | — | unchanged | `StaleReport` |
| T-SOR-020 | `publish_risk` zero asset id | publisher | `publish_risk(..., assetId = zero, ...)` | — | unchanged | `ZeroHash` |
| T-SOR-021 | `publish_risk` zero report hash | publisher | `publish_risk(..., reportHash = zero, ...)` | — | unchanged | `ZeroHash` |
| T-SOR-022 | `publish_risk` paused | paused | `publish_risk(...)` | — | unchanged | `Paused` |
| T-SOR-023 | `publish_risk` replay same nonce | publisher, nonce=1 already used | `publish_risk(..., nonce=1, ...)` | — | unchanged | `ReplayProtection` |
| T-SOR-024 | `publish_risk` nonce out of order | publisher, last nonce=5 | `publish_risk(..., nonce=3, ...)` | — | unchanged | `ReplayProtection` |
| T-SOR-025 | `revoke_risk` happy path | record exists | `revoke_risk(asset, "GOAT", "incorrect")` | `RiskRevoked(asset, "GOAT", revokedAt, "incorrect", admin)` | `record.revoked = true`, `record.revocation_reason = "incorrect"`, `record.revocation_admin = admin` | none |
| T-SOR-026 | `revoke_risk` non-admin | non-admin signer | `revoke_risk(...)` | — | unchanged | `(no auth)` |
| T-SOR-027 | `revoke_risk` zero asset | admin | `revoke_risk(zero, "GOAT", "x")` | — | unchanged | `ZeroHash` |
| T-SOR-028 | `revoke_risk` unknown record | admin | `revoke_risk(arbitraryAsset, "GOAT", "x")` | — | unchanged | `InvalidFormat("record not found")` |
| T-SOR-029 | `revoke_risk` already revoked | record already revoked | `revoke_risk(asset, "GOAT", "x")` | — | unchanged | `StaleReport` |
| T-SOR-030 | `revoke_risk` while paused | paused | `revoke_risk(...)` | — | unchanged | `Paused` |
| T-SOR-031 | `get_risk` returns current record | record exists | `get_risk(asset, "GOAT")` | — | record returned | none |
| T-SOR-032 | `get_risk` unknown record | record absent | `get_risk(asset, "GOAT")` | — | `None` | none |
| T-SOR-033 | `get_risk` bumps TTL | record exists | `get_risk(asset, "GOAT")` | — | `Record` TTL extended | none |
| T-SOR-034 | `is_publisher` true | publisher added | `is_publisher(p)` | — | `true` | none |
| T-SOR-035 | `is_publisher` false | publisher revoked | `is_publisher(p)` | — | `false` | none |
| T-SOR-036 | `is_publisher` expired | publisher expiry < now | `is_publisher(p)` | — | `false` | none |

### Pause, version, admin transfer

| ID | Test case | Precondition | Action | Expected events | Expected state | Expected error |
| --- | --- | --- | --- | --- | --- | --- |
| T-SOR-037 | `pause` by admin | initialized | `pause("incident")` | `RegistryEmergencyPauseSet(true, pausedAt, "incident")` | `Paused = true`, `PauseReason = "incident"` | none |
| T-SOR-038 | `pause` by guardian | guardian set | `pause("")` | `RegistryEmergencyPauseSet(true, ts, "")` | `Paused = true` | none |
| T-SOR-039 | `pause` empty reason by admin | admin | `pause("")` | — | unchanged | `InvalidFormat("reason required")` |
| T-SOR-040 | `pause` while paused | paused | `pause("x")` | `RegistryEmergencyPauseSet(true, ts, "x")` | `Paused = true` (no-op) | none |
| T-SOR-041 | `unpause` by admin | paused | `unpause()` | `RegistryEmergencyPauseSet(false, ts, "")` | `Paused = false` | none |
| T-SOR-042 | `unpause` by guardian | paused | `unpause()` | — | unchanged | `NotOwner` |
| T-SOR-043 | `pause` blocks writes | paused | `publish_risk`, `revoke_risk`, `set_publisher` | — | unchanged | `Paused` |
| T-SOR-044 | `pause` does not block reads | paused | `get_risk`, `version`, `is_paused` | — | n/a | none |
| T-SOR-045 | `version` returns current | initialized | `version()` | — | `version` tuple | none |
| T-SOR-046 | `version` emits event | first call | `version()` | `VersionReported(...)` | `version` unchanged | none |
| T-SOR-047 | `transfer_admin` step 1 | initialized | `transfer_admin(newAdmin)` | `AdminTransferStarted(admin, newAdmin)` | `PendingAdmin = newAdmin` | none |
| T-SOR-048 | `accept_admin` happy path | pending set | `accept_admin()` | `AdminTransferred(admin, newAdmin)` | `Admin = newAdmin`, `PendingAdmin = none` | none |
| T-SOR-049 | `accept_admin` non-pending | third party | `accept_admin()` | — | unchanged | `NotPendingAdmin` |
| T-SOR-050 | `transfer_admin` zero | admin | `transfer_admin(Address::zero())` | — | unchanged | `ZeroAddress` |
| T-SOR-051 | `transfer_admin` while pending | pending | `transfer_admin(other)` | — | unchanged | `AdminAlreadyPending` |
| T-SOR-052 | `admin` returns current | initialized | `admin()` | — | `Some(admin)` | none |
| T-SOR-053 | `is_paused` returns current | initial or paused | `is_paused()` | — | current value | none |

### Upgrade

| ID | Test case | Precondition | Action | Expected events | Expected state | Expected error |
| --- | --- | --- | --- | --- | --- | --- |
| T-SOR-054 | `schedule_upgrade` happy path | initialized | `schedule_upgrade(newWasm, 24 * 3600)` | `UpgradeScheduled(contract, newWasm, effectiveAt, delaySec)` | `UpgradePending = newWasm`, `EffectiveAt = now + 24h` | none |
| T-SOR-055 | `schedule_upgrade` delay too small | initialized | `schedule_upgrade(newWasm, 60)` | — | unchanged | `InvalidUpgradeDelay` |
| T-SOR-056 | `schedule_upgrade` delay too large | initialized | `schedule_upgrade(newWasm, 31 * 86400)` | — | unchanged | `InvalidUpgradeDelay` |
| T-SOR-057 | `schedule_upgrade` while pending | pending | `schedule_upgrade(newWasm2, 24 * 3600)` | — | unchanged | `UpgradeNotPending` |
| T-SOR-058 | `execute_upgrade` before effective | pending | `execute_upgrade()` | — | unchanged | `UpgradeNotReady` |
| T-SOR-059 | `execute_upgrade` after effective | pending, effectiveAt reached | `execute_upgrade()` | `UpgradeExecuted(newWasm, executedAt)` | `UpgradePending` cleared | none |
| T-SOR-060 | `cancel_upgrade` before execute | pending | `cancel_upgrade()` | `UpgradeCancelled(newWasm, cancelledAt)` | `UpgradePending` cleared | none |
| T-SOR-061 | `cancel_upgrade` no pending | none | `cancel_upgrade()` | — | unchanged | `UpgradeNotPending` |
| T-SOR-062 | `execute_upgrade` without pending | none | `execute_upgrade()` | — | unchanged | `UpgradeNotPending` |
| T-SOR-063 | `schedule_upgrade` zero wasm hash | initialized | `schedule_upgrade(BytesN::from_array([0;32]), 24 * 3600)` | — | unchanged | `ZeroHash` |
| T-SOR-064 | `schedule_upgrade` non-admin | non-admin | `schedule_upgrade(...)` | — | unchanged | `NotOwner` |

### Storage / TTL

| ID | Test case | Precondition | Action | Expected state |
| --- | --- | --- | --- | --- |
| T-SOR-065 | Persistent storage TTL bump on `publish_risk` | record exists | `publish_risk(...)` | `Record` TTL extended |
| T-SOR-066 | Persistent storage TTL bump on `get_risk` | record exists | `get_risk(...)` | `Record` TTL extended |
| T-SOR-067 | Instance TTL bump on admin write | any admin write | `set_publisher(...)` | instance TTL extended |
| T-SOR-068 | Publisher TTL bump on `publish_risk` | publisher exists | `publish_risk(...)` | `Publisher` and `Tier` TTLs extended |
| T-SOR-069 | Publisher TTL bump on `set_publisher` | publisher added | `set_publisher(...)` | publisher TTL extended |
| T-SOR-070 | Upgrade pending TTL | upgrade scheduled | `get_risk(...)` (no TTL bump on upgrade pending) | `UpgradePending` TTL = `UPGRADE_TTL_THRESHOLD`/`UPGRADE_TTL_EXTEND_TO` constants |

### Non-custodial guard

| ID | Test case | Precondition | Action | Expected behavior |
| --- | --- | --- | --- | --- |
| T-SOR-071 | No token transfer / swap / approve methods | contract ABI | reflection | only operations in `RiskRegistry` are present; no token contract is referenced |
| T-SOR-072 | No `private` storage holds a key | contract ABI | reflection | no `pub _signers: Map<>` for keys |
| T-SOR-073 | Pause does not move funds | paused | arbitrary admin call | no `transfer` / `move` / `approve` events ever emitted |
| T-SOR-074 | No external contract calls | contract ABI | reflection | no `invoke_contract` or cross-contract calls |

---

## Cross-chain parity tests

These tests assert that the same semantic event name, field order, and indexer mapping apply to both chains. They are run with dual indexers in the test harness.

| ID | Test case | Expected behavior |
| --- | --- | --- |
| T-X-001 | `VersionReported` event ordering | EVM `VersionReported` and Soroban `VersionReported` follow the same identifier format (semver + 32-byte build hash) |
| T-X-002 | `PolicyUpdated` / `DecisionLogged` parity | EVM emits `PolicyUpdated`/`DecisionLogged`; Soroban reference emits `PublisherAuthorizationChanged` mirror events |
| T-X-003 | `EmergencyPauseSet` parity | both chains emit `EmergencyPauseSet` with `paused` boolean and `reason` |
| T-X-004 | `UpgradeScheduled` / `UpgradeExecuted` parity | both chains emit matching events with `newImplementationHash` and `effectiveAt` |
| T-X-005 | `idempotencyKey` pass-through | both chains never parse the key; the frontend correlates by `tx_hash` |
| T-X-006 | `decision_id` canonicalization | EVM lower-cased hex; Soroban upper-cased hex; both 64 hex chars (32 bytes). `decision_id` is contract-computed; callers must NOT supply a value. Re-derive via §8 from `(chainId, wallet, decisionCounter)` (EVM) or `(network_short_name, publisher, counter)` (Soroban). |
| T-X-007 | `tx_hash` chain family collision | submitting an EVM hash against a Stellar RPC rejects with `hash_chain_family_mismatch` |
| T-X-008 | `network_chain_family_mismatch` | submitting `chainFamily: evm` with `network: stellar-testnet` rejects with `network_chain_family_mismatch` |
| T-X-009 | `plan_id` passthrough parity | EVM emits `DecisionLogged.planId` and `ExecutionIntentLogged.planId` as the same byte-for-byte UTF-8 string the agent supplied; Soroban mirrors the byte-for-byte string. The contract NEVER reads `plan_id` and NEVER hashes it. Both chains treat `plan_id` as a transparent correlation key. |
| T-X-010 | `asset_id` domain separation | EVM `assetId` uses `keccak256(chainId, tokenAddress)`; Soroban `assetId` uses `sha256(network_id, asset_key)`. No collision possible. |

---

## Side-effect ordering

For every state-changing call the test must verify:

1. The state delta is applied first (state writes complete; for Soroban, instance TTL is bumped on the same atomic write).
2. Then the event is emitted. Topic ordering is per-event as documented in `docs/V3_CONTRACT_SPEC.md` §4 — there is no single global topic ordering. The relevant per-event topic orderings are:
   - `DecisionLogged`: `wallet`, `agent`, `decisionHash`. (`decision_id` is in the data field, not a topic.)
   - `ExecutionIntentLogged`: `wallet`, `intentHash`.
   - `ExecutionIntentReplayed`: `intentHash`, `wallet`.
   - `ExecutionIntentExpired`: `wallet`, `intentHash`.
   - `ExecutionIntentCancelled`: `wallet`, `intentHash`.
   - `RiskPublished`: `asset_id`, `network`, `publisher`.
   - `RiskRevoked`: `asset_id`, `network`.
3. Then any data-field indexer fields (`nonce`, `expiry`, `decision_id`, etc.) are read in the documented `docs/V3_CONTRACT_SPEC.md` §4 column order per event.
4. Then the function returns.

Invalid orderings or missing events fail the test.

---

## Failure-mode coverage

For every revert path the test must verify:

1. No state delta is applied.
2. No event is emitted.
3. The storage TTL is unchanged.
4. The error code is correct.

These invariants are mirrored on the frontend side via the V2 transaction lifecycle (#15) and the indexer.

---

## Test harness requirements

- Both contracts must be deployed with deterministic admin keys owned by the test harness.
- Both chains must use deterministic block timestamps; tests cannot rely on `block.timestamp` or `env.ledger().timestamp()` returning real-time values.
- The frontend must:
  - Receive indexer events for both chains and index them against the same `transaction_lifecycle_events` table.
  - Reject events whose canonical identifier does not match the chain family.
  - Surface `EmergencyPauseSet` and `UpgradeExecuted` events as veto signals in the agent timeline.
  - Surface `InfiniteApprovalWarning` and `RevokeAllowanceSuggested` as blocking findings in the execution preview.
- The Soroban `publish_risk` replay test must use a deterministic `reportHash` to ensure the nonce check is reproducible.
- The EVM daily-limit test must use deterministic `valueUsd` values and a deterministic `block.timestamp` to ensure the window reset is reproducible.
