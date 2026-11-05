# V3 Upgradeability and Recovery Tradeoffs

| Field | Value |
| --- | --- |
| Issue | Drago-Labs/cryptara#31 |
| Companion spec | `docs/V3_CONTRACT_SPEC.md` |
| Status | Audit-ready. This document analyzes the upgradeability and recovery tradeoffs for the V3 vault and policy contracts. |

---

## 0. Governance and Timelock (Issue #145)

All privileged changes (upgrades, `setLimits`, `setAgent`, `setEmergencyAdmin`, `allowAsset`/`blockAsset`, `set_publisher`, `set_governance`, `updateSigners`) are routed through the timelock controller:

- **EVM**: `CryptaraTimelock.sol` — multi-signer timelock with `propose(target, selector, payload, delaySecs)`, `sign(id)`, `execute(id)`, `cancel(id)`, and a readable `getPendingQueue()` / `getPendingCount()` view. `delaySecs ∈ [24h, 30d]`, threshold ≥2 signers. Events `ProposalCreated`, `ProposalSigned`, `ProposalExecuted`, `ProposalCancelled` carry `payloadHash` (keccak256). `pause()`/`unpause()` remain immediate and separate.
- **Soroban**: `governance` contract (`contracts/governance/src/lib.rs` + `timelock.rs`) — identical semantics with `propose`, `sign`, `execute`, `cancel`, `get_pending_queue`, `get_pending_count`, `PauseChanged`, `ProposalCreated`/`ProposalSigned`/`ProposalExecuted`/`ProposalCancelled` carrying payload hash.

**Guarantees**: (1) no execution before `effectiveAt`, (2) single signer cannot schedule alone (threshold enforcement), (3) cancel during delay permanently prevents execution, (4) emergency pause immediate, (5) pending queue readable and verifiable (payload hash), (6) test matrices cover authorization, delay, cancel, replay, expiry on both chains.

## 1. Upgradeability model

### 1.1 EVM — UUPS proxy

The EVM `CryptaraVault` uses the **UUPS (Universal Upgradeable Proxy Standard)** pattern:

- **Proxy**: OpenZeppelin `ERC1967Proxy` — a minimal proxy that delegates all calls to an implementation address stored in an `ERC1967` slot.
- **Implementation**: `UUPSUpgradeable` — the implementation contract itself contains the `_authorizeUpgrade` function that gates who can upgrade.
- **Timelock**: `scheduleUpgrade(newImplementation, delaySec)` queues the upgrade; `delaySec` must be ≥ 24h and ≤ 30d. `executeUpgrade` is callable only after `effectiveAt`. `cancelUpgrade` is callable at any time before `executeUpgrade`.

#### Tradeoffs

| Aspect | UUPS (chosen) | Transparent proxy | Beacon | Minimal proxy |
| --- | --- | --- | --- | --- |
| Storage layout | Must be preserved across upgrades | Must be preserved | Must be preserved | Must be preserved |
| Upgrade gas cost | Low (single SSTORE) | Low | Low | Low |
| Admin control | `_authorizeUpgrade` in implementation | Admin in proxy | Admin in beacon | Admin in factory |
| Upgrade transparency | High (events on both proxy and impl) | Medium | Medium | Low |
| Recommended for V3 | ✅ Yes | No (extra indirection) | No (extra contract) | No (no upgrade gate) |

**Decision**: UUPS is chosen because it has the lowest gas overhead, the upgrade gate is in the implementation (auditable), and the `VersionReported` event is emitted on the proxy address (consistent with the frontend's address-based correlation).

### 1.2 Soroban — Versioned WASM

The Soroban `RiskRegistry` uses **versioned WASM with explicit `migrate`**:

- **WASM hash**: The new implementation is identified by its WASM hash (`BytesN<32>`).
- **Timelock**: `schedule_upgrade(new_wasm_hash, delay_sec)` queues the upgrade; `delay_sec` must be ≥ 24h and ≤ 30d. `execute_upgrade` is callable only after `effective_at`. `cancel_upgrade` is callable at any time before `execute_upgrade`.
- **Migration**: After `execute_upgrade`, the new instance must call `initialize` only if it is a fresh deployment; otherwise it must call `migrate` with a clean state migration plan.

#### Tradeoffs

| Aspect | Versioned WASM (chosen) | In-place code replacement | No upgrade |
| --- | --- | --- | --- |
| State migration | Explicit `migrate` function | Automatic | N/A |
| Upgrade gas cost | High (WASM upload + migrate) | Low | N/A |
| Admin control | `require_auth()` on admin | `require_auth()` on admin | N/A |
| Upgrade transparency | High (events + WASM hash) | Medium | N/A |
| Recommended for V3 | ✅ Yes | No (state loss risk) | No (no recovery) |

**Decision**: Versioned WASM with explicit `migrate` is chosen because Soroban's architecture requires it — contracts cannot be upgraded in-place. The explicit `migrate` function ensures state is preserved and auditable.

---

## 2. Recovery model

### 2.1 Owner / Admin compromise

| Scenario | Recovery path | Time to recover | Funds at risk |
| --- | --- | --- | --- |
| Owner key compromised, guardian available | Guardian pauses → owner transfers to new key | Minutes to hours | None (non-custodial) |
| Owner key permanently lost, guardian available | Guardian pauses indefinitely → new deployment | Days to weeks | None (non-custodial) |
| Owner key permanently lost, no guardian | New deployment with new admin | Days to weeks | None (non-custodial) |
| Admin key compromised (Soroban) | Same as owner compromise | Minutes to hours | None (non-custodial) |

### 2.2 Recovery steps

1. **Guardian pause**: The guardian calls `pause(reason)` to freeze all state-changing operations. This is the first recovery action.
2. **Ownership/admin transfer**: If the owner/admin key is still accessible, they call `transferOwnership(newOwner)` / `transfer_admin(newAdmin)`. The new owner/admin calls `acceptOwnership()` / `accept_admin()` within 7 days.
3. **If the owner/admin key is lost**: The guardian can pause indefinitely. A new deployment is required with a new admin key. The frontend rolls back to the old contract address via env var swap.
4. **If the guardian key is also lost**: The contract is frozen. A new deployment is required. The frontend rolls back.

### 2.3 Recovery tradeoffs

| Recovery mechanism | Pros | Cons | Recommended for V3 |
| --- | --- | --- | --- |
| Guardian pause | Fast, no funds at risk | Guardian key must be secure | ✅ Yes |
| Two-step ownership transfer | Prevents accidental loss | Requires 7-day window | ✅ Yes |
| Timelock on upgrade | Gives time to detect malicious upgrade | Delays legitimate upgrades | ✅ Yes (24h min) |
| Admin quorum (n-of-m) | Survives single-key compromise | Complex, gas overhead | ❌ Deferred to V3-108+ |
| Social recovery (guardian set) | Survives single-key compromise | Complex, trust assumptions | ❌ Deferred to V3-108+ |
| Fund recovery (withdraw pattern) | Recovers stuck funds | Custodial risk | ❌ Not applicable (non-custodial) |

---

## 3. Upgrade security analysis

### 3.1 Threat: Malicious implementation

An attacker who compromises the owner key can schedule an upgrade to a malicious implementation that drains funds. The controls are:

1. **Timelock (24h min)**: The upgrade is not effective for at least 24 hours, giving the owner and guardian time to detect and cancel.
2. **`cancelUpgrade`**: The owner can cancel the upgrade at any time before `executeUpgrade`.
3. **`VersionReported`**: After upgrade, the new implementation must call `version()` and emit `VersionReported`. The frontend checks the new implementation's selector against an expected list and refuses to follow unknown selectors.
4. **Non-custodial invariant**: Even if the implementation is malicious, it cannot drain funds because the contract never holds funds or grants allowances.

### 3.2 Threat: Storage collision

An upgrade that changes the storage layout can corrupt state. The controls are:

1. **UUPS storage gap**: The implementation reserves storage slots for future variables.
2. **Audit checklist item 22.2**: The auditor verifies that `_authorizeUpgrade` is restricted to owner.
3. **Test matrix T-EVM-044–T-EVM-050**: The test matrix verifies upgrade scheduling, execution, and cancellation.

### 3.3 Threat: State loss on Soroban

An upgrade that does not properly migrate state can lose records. The controls are:

1. **Explicit `migrate`**: The new implementation must call `migrate` with a clean state migration plan.
2. **Audit checklist item 22.5**: The auditor verifies that `schedule_upgrade` is correctly implemented.
3. **Test matrix T-SOR-054–T-SOR-060**: The test matrix verifies upgrade scheduling, execution, and cancellation.

---

## 4. Recovery testing

| ID | Test case | Precondition | Action | Expected behavior |
| --- | --- | --- | --- | --- |
| T-REC-001 | Guardian pause on compromised owner | guardian set | `pause("compromised owner")` | `EmergencyPauseSet(wallet, true, …, "compromised owner")`; all writes blocked |
| T-REC-002 | Owner transfer on accessible key | owner accessible | `transferOwnership(newOwner)` | `OwnershipTransferStarted(wallet, newOwner)` |
| T-REC-003 | Cancel malicious upgrade during timelock | upgrade pending | `cancelUpgrade()` | `UpgradeCancelled(contract, newImpl, cancelledAt)` |
| T-REC-004 | Frontend refuses unknown implementation | upgrade executed | frontend checks selector | frontend refuses to follow unknown selector |
| T-REC-005 | Soroban admin transfer | admin accessible | `transfer_admin(newAdmin)` | `AdminTransferStarted(admin, newAdmin)` |
| T-REC-006 | Soroban cancel malicious upgrade | upgrade pending | `cancel_upgrade()` | `UpgradeCancelled(newWasm, cancelledAt)` |

---

## 5. Upgrade and recovery decision log

| Decision | Rationale | Status |
| --- | --- | --- |
| UUPS proxy for EVM | Lowest gas overhead, auditable upgrade gate, consistent address | ✅ Approved |
| Versioned WASM for Soroban | Required by Soroban architecture, explicit state migration | ✅ Approved |
| 24h minimum timelock | Gives time to detect and cancel malicious upgrades | ✅ Approved |
| 30d maximum timelock | Prevents indefinite lockup of upgrade path | ✅ Approved |
| Guardian pause | Fast recovery on owner compromise, no funds at risk | ✅ Approved |
| Two-step ownership transfer | Prevents accidental loss of admin key | ✅ Approved |
| Admin quorum (n-of-m) | Deferred to V3-108+ — adds complexity without proportional benefit for V3 | ⏸️ Deferred |
| Social recovery (guardian set) | Deferred to V3-108+ — trust assumptions not yet evaluated | ⏸️ Deferred |
| Fund recovery (withdraw pattern) | Not applicable — contract is non-custodial | ❌ Not applicable |

---

## 6. Recovery playbook (for maintainers)

### 6.1 If the owner key is compromised

1. Guardian calls `pause("compromised owner")` immediately.
2. If the owner key is still accessible, the owner calls `transferOwnership(newOwner)`.
3. The new owner calls `acceptOwnership()` within 7 days.
4. If the owner key is lost, deploy a new contract with a new admin key and roll back the frontend via env var swap.

### 6.2 If a malicious upgrade is scheduled

1. The owner calls `cancelUpgrade()` immediately.
2. If the owner key is compromised, the guardian pauses the contract.
3. If the upgrade was already executed, the frontend refuses to follow the new implementation (unknown selector).
4. Deploy a new contract with the correct implementation and roll back the frontend.

### 6.3 If the admin key is compromised (Soroban)

1. Guardian calls `pause("compromised admin")` immediately.
2. If the admin key is still accessible, the admin calls `transfer_admin(newAdmin)`.
3. The new admin calls `accept_admin()` within 7 days.
4. If the admin key is lost, deploy a new contract with a new admin key and roll back the frontend.

### 6.4 If the guardian key is also lost

1. The contract is frozen (no one can pause or upgrade).
2. Deploy a new contract with a new admin key.
3. Roll back the frontend via env var swap.
4. Migrate any off-chain state (user rules, decisions) to the new contract.
