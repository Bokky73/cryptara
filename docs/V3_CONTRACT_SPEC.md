# V3: Threat-Modeled Multi-Chain Vault & Policy Contracts

| Field | Value |
| --- | --- |
| Issue | Drago-Labs/cryptara#31 |
| Companion docs | `docs/V3_CONTRACT_TEST_MATRIX.md`, `docs/V3_AUDIT_CHECKLIST.md`, `docs/V3_UPGRADE_RECOVERY.md` |
| Authors | Cryptara contributors |
| Status | Audit-ready specification. All defaults in §9 are binding unless a maintainer explicitly substitutes an item during PR review; absent substitutions, defaults merge at PR approval. **No implementation code is introduced.** |
| Roadmap coverage | V3-101 (vault custody model), V3-102 (policy commitment), V3-103 (agent authorization + limits), V3-104 (execution intent + nonce + expiry), V3-105 (pause + revoke + recovery), V3-106 (cross-chain domain separation), V3-107 (upgrade + admin), V3-108 (governance timelock, issue #145) |
| Target networks | **Primary (dev):** EVM — GOAT Network (id 48816); Soroban — Stellar Testnet. **Production:** deferred until third-party audit closes (see §9.3). |
| Out of scope | Implementing or deploying the contracts; choosing a production admin key inside this PR; autonomous fund movement; token swaps executed by the contract. |

This document is the audit-ready contract specification that closes V3 vault and policy requirements. It does not introduce implementation code. The matching test matrix is `docs/V3_CONTRACT_TEST_MATRIX.md`, the external audit checklist is `docs/V3_AUDIT_CHECKLIST.md`, and the upgradeability/recovery tradeoff analysis is `docs/V3_UPGRADE_RECOVERY.md`.

---

## 1. Goals and non-custodial guarantee

The V3 contract surface has four goals:

1. **Enforce user policy on-chain** — the vault stores or commits to a policy hash that bounds every execution: daily value limit, trade percent, slippage, price impact, allowed/blocked assets, nonce, expiry, and chain scope.
2. **Authorize agents with limits** — agents are per-address with expiry, tier, and scope; every agent action is attributable and revocable.
3. **Never hold user funds or sign on behalf of users** — the contract is a policy gate and audit log, not a custodian. The wallet is the only signer and the only mover of value.
4. **Survive the threat model** — reentrancy, replay, stale intent, malicious agent, infinite approval, admin compromise, upgrade, cross-chain replay, and oracle/provider failure are each mapped to a concrete control and a test.

### Non-custodial proof (each contract)

| Invariant | CryptaraVault (EVM) | RiskRegistry (Soroban) |
| --- | --- | --- |
| No `ERC20` / `transfer` / `transferFrom` / `swap` / `permit` calls | Contract exposes only `setAgent`, `setPolicy`, `logDecision`, `logExecutionIntent`, `revokeAgent`, `pause`, `upgrade`, `version`, and view accessors. It never calls into a token contract. | Contract exposes only `initialize`, `set_publisher`, `publish_risk`, `revoke_risk`, `get_risk`, `pause`, `upgrade`, `version`, and view accessors. No token transfer. |
| No private key custody | Contract never holds a signer; `agent` is a public address authorized by the owner. | Contract requires `require_auth()` on the publisher for state writes; never holds a secret. |
| Pause is reversible and never moves funds | Emergency pause only suppresses writes; does not perform any `transfer`/`approve`. | Emergency pause only suppresses writes; no token interaction. |
| Upgrade path is explicit and does not auto-execute work | §5.7 lays out a UUPS-style proxy with a meaningful upgrade delay and a cancel path. | §6.7 lays out Soroban versioned WASM with explicit `migrate` gated behind admin and a timelock. |
| No silent policy broadening | Policy is a hash committed by the owner; the contract rejects any intent whose policy hash does not match. The contract cannot broaden a policy it does not store. | Registry does not store user policy; it stores publisher-tier risk records. Policy commitment is EVM-only. |

---

## 2. V3 requirements traceability

| ID | Requirement | Owner | EVM (`CryptaraVault`) | Soroban (`RiskRegistry`) |
| --- | --- | --- | --- | --- |
| V3-101 | Funds-versus-allowance model | V3 | ✅ Allowance model: contract never holds funds; users approve token allowances directly to a DEX/router. The contract logs the intent and verifies policy. See §3. | N/A — registry does not touch funds |
| V3-102 | Policy commitment (hash) | V3 | ✅ `setPolicy` stores `policyHash` on-chain; `logExecutionIntent` requires the intent's policy hash to match. | N/A |
| V3-103 | Agent authorization with limits | V3 | ✅ `addAgent`/`removeAgent`/`rotateAgent` with expiry, tier, and scope. | ✅ `set_publisher` with tier and expiry |
| V3-103 | Daily/value limits | V3 | ✅ `maxDailyValueUsd` enforced per wallet per 24h window. | N/A |
| V3-103 | Trade percent limit | V3 | ✅ `maxTradePercent` enforced per intent. | N/A |
| V3-103 | Slippage limit | V3 | ✅ `maxSlippageBps` enforced per intent. | N/A |
| V3-103 | Price impact limit | V3 | ✅ `maxPriceImpactBps` enforced per intent. | N/A |
| V3-103 | Allowed/blocked assets | V3 | ✅ `allowedAssets` / `blockedAssets` sets enforced per intent. | N/A |
| V3-104 | Nonce | V3 | ✅ Per-wallet monotonic nonce; intent includes nonce. | ✅ Per-publisher monotonic nonce |
| V3-104 | Expiry | V3 | ✅ Intent expiry enforced; `surfaceStale` companion. | ✅ `StaleReport` for publish |
| V3-105 | Pause | V3 | ✅ `pause`/`unpause` by owner or guardian. | ✅ `pause`/`unpause` by admin or guardian |
| V3-105 | User revoke | V3 | ✅ `revokeAgent` + `removeAgent` + `cancelExecutionIntent`. | ✅ `revoke_risk` + `set_publisher(false)` |
| V3-105 | Recovery | V3 | ✅ Two-step ownership transfer + guardian pause. | ✅ Two-step admin transfer + guardian pause |
| V3-106 | Cross-chain domain separation | V3 | ✅ `chainId` in intent hash; `isTransactionHashForChain` rejects collisions. | ✅ `network_short_name` in asset_id; no cross-chain hash collision |
| V3-106 | Canonical asset encoding | V3 | ✅ `assetId = keccak256(abi.encode(chainId, tokenAddress))` | ✅ `assetId = sha256(network_id ++ ":" ++ asset_key)` |
| V3-107 | Upgrade gate | V3 | ✅ UUPS proxy + timelock + cancel. | ✅ Versioned WASM + timelock + cancel |
| V3-107 | Admin compromise | V3 | ✅ Two-step transfer + guardian pause + upgrade timelock. | ✅ Two-step transfer + guardian pause + upgrade timelock |
| V3-107 | Version reporting | V3 | ✅ `version()` + `VersionReported` event. | ✅ `version()` + `VersionReported` event. |

---

## 3. Funds-versus-allowance model

### Decision: Allowance model (non-custodial)

The V3 vault uses the **allowance model**. The contract never holds user funds. Instead:

1. The user approves a DEX/router contract to spend a specific token up to a specific amount (or uses `permit2` / `safePermit` for signature-based approval).
2. The user signs an **execution intent** that commits to: the policy hash, the from-token, to-token, percent, value, max slippage, max price impact, nonce, and expiry.
3. The vault contract **verifies** the intent against the committed policy and logs it on-chain.
4. The user (or their wallet) submits the actual swap transaction to the DEX/router directly. The DEX/router checks the allowance.
5. The vault's on-chain log is the audit trail; the actual fund movement happens outside the contract.

This model is chosen over the **funds model** (where the vault holds user tokens) because:

| Criterion | Funds model | Allowance model (chosen) |
| --- | --- | --- |
| Custody | Contract holds tokens → custodial | User holds tokens → non-custodial |
| Reentrancy surface | High (token callbacks) | None (no token calls) |
| Upgrade risk | Funds can be drained | No funds to drain |
| Infinite approval | Contract can grant itself allowance | User controls allowance; contract never grants |
| Recovery | Complex (withdraw patterns) | Simple (revoke allowance on-chain) |

### Infinite approval warning

The contract emits an `InfiniteApprovalWarning` event whenever a user logs an intent where the from-token's allowance is `type(uint256).max`. The frontend surfaces this as a blocking finding: the user must reduce the allowance before proceeding. The contract does not enforce allowance reduction — it only warns — because the allowance is checked at the DEX/router level, not at the vault level.

### Allowance revocation path

The contract exposes `revokeAllowance(address token, address spender)` as a **view-only hint**: it does not call `approve(0)` itself (it cannot, because it has no token interface). Instead, it emits a `RevokeAllowanceSuggested(token, spender, wallet)` event that the frontend uses to prompt the user to revoke the allowance in their wallet. The on-chain audit trail records that the user was warned.

---

## 4. Canonical event taxonomy

The contracts emit normalized events whose parameter names line up with the frontend `transaction_lifecycle_events` table and the `agent_results.raw_signals` shape. Both chains emit the same semantic name and the same field order. Indexers can use a single mapping table.

| Event | Emitted by | When | Topics (indexed) | Data fields |
| --- | --- | --- | --- | --- |
| `VersionReported` | both | `version()` called | `contract` | `semver`, `buildHash`, `reportedAt` |
| `AgentApproved` | EVM | owner adds an agent | `wallet`, `agent` | `approvedAt`, `policyHash`, `tier`, `expiry` |
| `AgentRevoked` | EVM | owner revokes an agent | `wallet`, `previousAgent` | `revokedAt`, `reason` |
| `AgentRotated` | EVM | owner rotates an agent | `wallet`, `previousAgent`, `newAgent` | `rotatedAt`, `policyHash` |
| `PolicyUpdated` | EVM | owner updates policy | `wallet`, `policyHash` | `updatedAt` |
| `DailyLimitReset` | EVM | 24h window rolls over | `wallet` | `resetAt`, `dailySpentUsd` (reset to 0) |
| `DecisionLogged` | EVM | agent logs a decision | `wallet`, `agent`, `decisionHash` | `decisionId`, `policyHash`, `planId`, `riskScore`, `createdAt` |
| `ExecutionIntentLogged` | EVM | owner logs a signed intent | `wallet`, `intentHash` | `decisionHash`, `planId`, `expiry`, `nonce`, `fromToken`, `toToken`, `percent`, `valueUsd`, `maxSlippageBps`, `maxPriceImpactBps` |
| `ExecutionIntentReplayed` | EVM | owner surfaces a replay attempt | `intentHash`, `wallet` | `at` |
| `ExecutionIntentExpired` | EVM | owner surfaces a stale intent | `wallet`, `intentHash` | `expiry`, `observedTs` |
| `ExecutionIntentCancelled` | EVM | owner cancels an intent | `wallet`, `intentHash` | `cancelledAt`, `reason` |
| `InfiniteApprovalWarning` | EVM | intent logged with infinite allowance | `wallet`, `intentHash`, `token` | `allowance`, `warning` |
| `RevokeAllowanceSuggested` | EVM | intent logged with high allowance | `wallet`, `intentHash`, `token` | `spender`, `suggestedAction` |
| `GuardianAdded` | EVM | owner adds a guardian | `wallet`, `guardian` | `addedAt` |
| `GuardianRemoved` | EVM | owner removes a guardian | `wallet`, `guardian` | `removedAt`, `reason` |
| `EmergencyPauseSet` | EVM | pause toggled | `wallet` | `paused`, `pausedAt`, `reason` |
| `PublisherAuthorizationChanged` | Soroban | admin toggles publisher | `publisher` | `authorized`, `tier`, `changedAt` |
| `PublisherExpired` | Soroban | publisher TTL elapses | `publisher` | `expiredAt`, `lastSeenAt` |
| `RiskPublished` | Soroban | authorized publisher publishes | `asset_id`, `network`, `publisher` | `score`, `verdict`, `report_hash`, `updated_at` |
| `RiskRevoked` | Soroban | admin reverts a risky record | `asset_id`, `network` | `revokedAt`, `reason` |
| `RegistryEmergencyPauseSet` | Soroban | admin toggles pause | n/a | `paused`, `pausedAt`, `reason` |
| `UpgradeScheduled` | both | admin schedules an upgrade | `contract` | `newImplementationHash`, `effectiveAt`, `delaySec` |
| `UpgradeExecuted` | both | upgrade committed | `contract` | `newImplementationHash`, `executedAt` |
| `UpgradeCancelled` | both | admin cancels an upgrade | `contract` | `newImplementationHash`, `cancelledAt` |

All events MUST be emitted in this order to keep frontend indexers deterministic:

1. `VersionReported` (on first admin call after `initialize` / constructor).
2. `AgentApproved` / `PublisherAuthorizationChanged` (per agent / publisher).
3. `PolicyUpdated` (when policy changes).
4. `DecisionLogged` (per decision).
5. `ExecutionIntentLogged` (per user intent).
6. `RiskPublished` (per registry record).
7. `EmergencyPauseSet` / `RegistryEmergencyPauseSet` (when paused).
8. `UpgradeScheduled`, `UpgradeExecuted`, `UpgradeCancelled` (when an upgrade is in flight).

---

## 5. CryptaraVault (EVM) interface

### 5.1 Storage layout

```solidity
// immutables
address public implementation; // UUPS-style proxy (deployed separately)

// state
address public owner;             // wallet-bound owner
mapping(address => uint256) public agentExpiries; // agent => unix seconds; 0 = unset
mapping(address => address)  public agentOwner;   // agent => owning wallet
mapping(address => bytes32) public policyHash;   // wallet => canonical policy hash
mapping(bytes32 => bool)    public usedIntents;  // intentHash => already submitted
mapping(address => uint256) public nonces;       // wallet => monotonic nonce
mapping(address => uint256) public decisionCounter; // wallet => monotonic
mapping(address => bool) public guardians;       // address => is guardian
mapping(address => uint256) public dailySpentUsd; // wallet => cumulative USD spent in current 24h window
mapping(address => uint256) public dailyWindowStart; // wallet => window start timestamp
mapping(address => uint256) public maxDailyValueUsd; // wallet => daily limit in USD (1e2)
mapping(address => uint256) public maxTradePercent; // wallet => max trade percent (1e2)
mapping(address => uint256) public maxSlippageBps; // wallet => max slippage (bps)
mapping(address => uint256) public maxPriceImpactBps; // wallet => max price impact (bps)
mapping(address => mapping(address => bool)) public allowedAssets; // wallet => token => allowed
mapping(address => mapping(address => bool)) public blockedAssets; // wallet => token => blocked
mapping(address => uint256) public maxRiskScore; // wallet => max risk score (1e2)
mapping(address => uint256) public maxMemeExposurePercent; // wallet => max meme exposure (1e2)
bool public paused;

// role bit
uint256 public constant ROLE_AGENT = 1;
```

### 5.2 Roles

| Role | Granted by | Type | Re-issuable | Limit |
| --- | --- | --- | --- | --- |
| `owner` | constructor | single address | no — two-step `transferOwnership` | Full policy + upgrade + pause authority |
| `agent` | owner | per-address with expiry | yes — owner can add and remove | Bound by policy hash, daily limit, trade percent, slippage, price impact, allowed/blocked assets |
| `guardian` | `addGuardian` / `removeGuardian` (owner) | per-address | yes — owner can add and remove | Pause only; cannot unpause, set policy, or upgrade |

### 5.3 Functions

```solidity
event VersionReported(address indexed contract, uint16 major, uint16 minor, uint16 patch, bytes32 buildHash, uint64 reportedAt);
event AgentApproved(address indexed wallet, address indexed agent, uint64 approvedAt, bytes32 policyHash, string tier, uint64 expiry);
event AgentRevoked(address indexed wallet, address indexed previousAgent, uint64 revokedAt, string reason);
event AgentRotated(address indexed wallet, address indexed previousAgent, address indexed newAgent, uint64 rotatedAt, bytes32 policyHash);
event PolicyUpdated(address indexed wallet, bytes32 indexed policyHash, uint64 updatedAt);
event DailyLimitReset(address indexed wallet, uint64 resetAt, uint256 dailySpentUsd);
event DecisionLogged(address indexed wallet, address indexed agent, bytes32 indexed decisionHash, bytes32 decisionId, bytes32 policyHash, string planId, uint16 riskScore, uint64 createdAt);
event ExecutionIntentLogged(address indexed wallet, bytes32 indexed intentHash, bytes32 decisionHash, string planId, uint64 expiry, uint256 nonce, address fromToken, address toToken, uint256 percent, uint256 valueUsd, uint256 maxSlippageBps, uint256 maxPriceImpactBps);
event ExecutionIntentReplayed(bytes32 indexed intentHash, address indexed wallet, uint64 at);
event ExecutionIntentExpired(address indexed wallet, bytes32 indexed intentHash, uint64 expiry, uint64 observedTs);
event ExecutionIntentCancelled(address indexed wallet, bytes32 indexed intentHash, uint64 cancelledAt, string reason);
event InfiniteApprovalWarning(address indexed wallet, bytes32 indexed intentHash, address indexed token, uint256 allowance, string warning);
event RevokeAllowanceSuggested(address indexed wallet, bytes32 indexed intentHash, address indexed token, address spender, string suggestedAction);
event GuardianAdded(address indexed wallet, address indexed guardian, uint64 addedAt);
event GuardianRemoved(address indexed wallet, address indexed guardian, uint64 removedAt, string reason);
event EmergencyPauseSet(address indexed wallet, bool paused, uint64 pausedAt, string reason);
event UpgradeScheduled(address indexed contract, address newImplementation, uint64 effectiveAt, uint64 delaySec);
event UpgradeExecuted(address indexed contract, address newImplementation, uint64 executedAt);
event UpgradeCancelled(address indexed contract, address newImplementation, uint64 cancelledAt);

error NotOwner();
error NotAgent();
error NotGuardian();
error ZeroAddress();
error ZeroHash();
error Paused();
error Expired();
error Replay();
error StaleIntent();
error PolicyMismatch();
error InvalidRiskScore(uint16 actual);
error InvalidTradePercent(uint256 actual);
error InvalidSlippage(uint256 actual);
error InvalidPriceImpact(uint256 actual);
error DailyLimitExceeded(uint256 spent, uint256 limit);
error AssetBlocked(address token);
error AssetNotAllowed(address token);
error InvalidNonce(uint256 actual, uint256 expected);
error InvalidFormat(string reason);
error IntentCancelled();

function version() external view returns (uint16 major, uint16 minor, uint16 patch, bytes32 buildHash);

function addAgent(address agent, uint64 expiry, string calldata tier) external; // onlyOwner
function removeAgent(address agent, string reason) external; // onlyOwner
function rotateAgent(address previous, address next, uint64 expiry, string calldata tier) external; // onlyOwner

function setPolicy(bytes calldata policy) external returns (bytes32 policyHash); // onlyOwner
function getPolicyHash(address wallet) external view returns (bytes32 policyHash);
function getPolicy(address wallet) external view returns (
    uint256 maxRiskScore,
    uint256 maxTradePercent,
    uint256 maxMemeExposurePercent,
    uint256 maxDailyValueUsd,
    uint256 maxSlippageBps,
    uint256 maxPriceImpactBps
);

function addGuardian(address guardian) external; // onlyOwner
function removeGuardian(address guardian, string reason) external; // onlyOwner
function isGuardian(address candidate) external view returns (bool);

function logDecision(bytes32 decisionHash, bytes32 policyHash, uint16 riskScore, string calldata planId) external; // onlyAgent
function logExecutionIntent(
    bytes32 intentHash,
    bytes32 decisionHash,
    uint64 expiry,
    uint256 nonce,
    address fromToken,
    address toToken,
    uint256 percent,
    uint256 valueUsd,
    uint256 maxSlippageBps,
    uint256 maxPriceImpactBps,
    string calldata planId
) external; // onlyOwner

function surfaceReplay(bytes32 intentHash) external; // onlyOwner
function surfaceStale(bytes32 intentHash, uint64 expiry, uint64 observedTs) external; // onlyOwner
function cancelExecutionIntent(bytes32 intentHash, string reason) external; // onlyOwner

function pause(string reason) external; // owner or guardian
function unpause() external; // onlyOwner
function transferOwnership(address newOwner) external; // onlyOwner, two-step
function acceptOwnership() external; // pendingOwner
function scheduleUpgrade(address newImplementation, uint64 delaySec) external; // onlyOwner
function executeUpgrade() external; // onlyOwner, after delaySec
function cancelUpgrade() external; // onlyOwner, before executeUpgrade
```

### 5.4 Validation rules

| Failure | Trigger | Reason |
| --- | --- | --- |
| `NotOwner` | non-owner calls `addAgent`/`setPolicy`/`pause`/`unpause`/`scheduleUpgrade` | ownership bit mismatch |
| `NotAgent` | non-agent calls `logDecision` | agent bit mismatch |
| `NotGuardian` | non-guardian calls `pause`; non-owner calls `unpause` | sub-role mismatch |
| `ZeroAddress` | `address(0)` passed to `addAgent` / `rotateAgent` / `transferOwnership` | canonical zero address |
| `ZeroHash` | decisionHash/intentHash is `bytes32(0)` | reject zero-hash signals |
| `Paused` | any state-changing call when `paused` is true | emergency pause gate |
| `Expired` | `agentExpiries[agent] <= block.timestamp` | agent lease |
| `Replay` | `usedIntents[intentHash]` | replay guard |
| `StaleIntent` | `block.timestamp > expiry` | stale intent |
| `PolicyMismatch` | `logDecision` caller-supplied `policyHash != getPolicyHash(owner)` | policy hash mismatch |
| `InvalidRiskScore` | `riskScore > 100` | score schema |
| `InvalidTradePercent` | `percent > maxTradePercent` | trade percent limit |
| `InvalidSlippage` | `maxSlippageBps > policy.maxSlippageBps` | slippage limit |
| `InvalidPriceImpact` | `maxPriceImpactBps > policy.maxPriceImpactBps` | price impact limit |
| `DailyLimitExceeded` | `dailySpentUsd + valueUsd > maxDailyValueUsd` | daily value limit |
| `AssetBlocked` | `toToken` or `fromToken` in `blockedAssets[wallet]` | blocked asset |
| `AssetNotAllowed` | `allowedAssets[wallet]` is non-empty and `toToken` not in it | allowed asset set |
| `InvalidNonce` | `nonce != nonces[wallet]` | nonce mismatch |
| `InvalidFormat` | `planId` exceeds 160 UTF-8 chars or contains `\u0000` | format validation |
| `IntentCancelled` | operation on a cancelled intent | intent was cancelled |

### 5.5 Replay, stale intent, zero-address, invalid hash, pause

- **Replay**: `usedIntents[intentHash]` is set on first `logExecutionIntent`; subsequent calls revert `Replay`. The intent entry is pure data — no funds move. The reverted call emits no events. The frontend surfaces the replay failure via the off-chain indexer reading `vm.revert_reason` or via the owner's non-reverting `surfaceReplay(intentHash)` companion call.
- **Stale intent**: any `logExecutionIntent` whose `expiry <= block.timestamp` reverts `StaleIntent`. The frontend computes `expiry` from the V2 transaction lifecycle's `lifecycle.expiresAt` field. The reverted call emits no events. Surface via `surfaceStale(intentHash, expiry, observedTs)`.
- **Zero address / zero hash**: reverts `ZeroAddress` / `ZeroHash` with no state change.
- **Invalid hash**: `decisionHash` and `intentHash` are `bytes32`. Zero is rejected. Length-checks are unnecessary because the type is fixed-size.
- **Pause**: state writes execute first, then the event emits in the same transaction. When `pause(reason)` is called by an authorized caller, the contract (a) validates ownership/guardian, (b) flips `paused = true`, and only then (c) emits `EmergencyPauseSet(wallet, true, pausedAt, reason)`. `pause(reason)` accepts a zero-length `reason` only if the caller is the guardian; the owner must supply a non-empty `reason`.

### 5.6 Pause / recovery

- `pause` is idempotent. A second `pause` while paused is a no-op but emits `EmergencyPauseSet(false,…)`.
- `unpause` requires the owner (not the guardian).
- After `pause`, the contract remains readable (`view` functions still work). The agent cannot `logDecision` while paused.
- **Recovery**: if the owner key is compromised, the guardian can pause. The owner can then call `transferOwnership` to a new key. If the owner is permanently lost, the guardian can pause indefinitely, and a new deployment is required (see §8 for recovery tradeoffs).

### 5.7 Upgrade policy

- Storage uses a UUPS proxy pattern (OpenZeppelin `ERC1967Proxy` + `UUPSUpgradeable`).
- `scheduleUpgrade(newImplementation, delaySec)` queues the upgrade; `delaySec` must be ≥ 24 hours and ≤ 30 days.
- `executeUpgrade` is callable only after `effectiveAt <= block.timestamp`. The owner can call `cancelUpgrade` at any time before `executeUpgrade`.
- Both `scheduleUpgrade` and `executeUpgrade` emit `UpgradeScheduled` / `UpgradeExecuted`.
- After every successful upgrade, the implementation must call `version()` and emit `VersionReported` from `initialize` so the route can be discovered.

### 5.8 Daily limit enforcement

The daily limit is enforced per wallet per 24-hour rolling window:

1. On `logExecutionIntent`, the contract checks `dailyWindowStart[wallet]`. If `block.timestamp >= dailyWindowStart[wallet] + 24 hours`, the window resets: `dailySpentUsd[wallet] = 0`, `dailyWindowStart[wallet] = block.timestamp`, and `DailyLimitReset` is emitted.
2. The contract checks `dailySpentUsd[wallet] + valueUsd > maxDailyValueUsd[wallet]`. If exceeded, revert `DailyLimitExceeded`.
3. On success, `dailySpentUsd[wallet] += valueUsd`.

The daily limit is **not** enforced on `logDecision` — only on `logExecutionIntent` — because decisions are risk assessments, not fund movements.

### 5.9 Asset allow/block enforcement

- `allowedAssets[wallet]` is an optional allowlist. If non-empty, only assets in the set are permitted as `toToken` or `fromToken`.
- `blockedAssets[wallet]` is a blocklist. If any asset is in the set, it is rejected regardless of the allowlist.
- Both sets are set by the owner via `setPolicy` and are part of the policy hash.
- The contract does **not** check on-chain token metadata (name, symbol, decimals) — it only checks the `address`. The frontend is responsible for canonical asset identity resolution (see §7).

### 5.10 Frontend correlation

- The frontend `transaction_lifecycle_events` row that already records `submitted` and `confirmed` continues to mirror `intentHash` from the new `ExecutionIntentLogged` event.
- `policyHash` from `PolicyUpdated` is required to mark a `user_rules` row as synced.
- `EmergencyPauseSet` and `UpgradeScheduled`/`UpgradeExecuted` are surfaced in the agent timeline and used as veto signals by the Execution Agent.
- `InfiniteApprovalWarning` and `RevokeAllowanceSuggested` are surfaced as blocking findings in the execution preview.

---

## 6. RiskRegistry (Soroban) interface

### 6.1 Storage layout

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Initialized,
    Version { major: u32, minor: u32, patch: u32, build_hash: BytesN<32> },
    Paused,
    PauseReason,
    Publisher(Address),
    PublisherTier(Address),
    PublisherExpiry(Address),
    PublisherCounter(Address),
    PublisherCounterNonce(Address),
    UpgradePending { new_wasm_hash: BytesN<32>, effective_at: u64, proposer: Address },
    UpgradeDelaySec,
    Record(BytesN<32>, Symbol),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RiskRecordScene {
    pub asset_id: BytesN<32>,
    pub network: Symbol,
    pub asset_label: String,
    pub score: u32,
    pub verdict: Symbol,
    pub report_hash: BytesN<32>,
    pub evidence_uri: String,
    pub publisher: Address,
    pub updated_at: u64,
    pub ledger: u32,
    pub revoked: bool,
    pub revocation_reason: Option<String>,
    pub revocation_admin: Option<Address>,
}
```

### 6.2 Roles

| Role | Granted by | Type | Re-issuable | Limit |
| --- | --- | --- | --- | --- |
| `admin` | `initialize` | single address | yes — two-step `transfer_admin` | Full publisher + pause + upgrade authority |
| `publisher` | admin | per-address with tier and expiry | yes | Bound by tier and expiry; cannot modify policy |
| `guardian` | admin (subset) | optional pause authority | yes | Pause only; cannot unpause, publish, or upgrade |

### 6.3 Functions

```rust
#[contractevent]
pub struct VersionReported(pub Address /*contract*/, pub u32, pub u32, pub u32, pub BytesN<32>);

#[contractevent]
pub struct RegistryInitialized(pub Address /*admin*/);

#[contractevent]
pub struct RegistryEmergencyPauseSet(pub bool, pub u64, pub String);

#[contractevent]
pub struct PublisherAuthorizationChanged(pub Address, pub bool, pub Symbol /*tier*/, pub u64);

#[contractevent]
pub struct PublisherExpired(pub Address, pub u64, pub u64);

#[contractevent]
pub struct RiskPublished(pub BytesN<32>, pub Symbol, pub Address, pub u32, pub Symbol, pub BytesN<32>, pub u64);

#[contractevent]
pub struct RiskRevoked(pub BytesN<32>, pub Symbol, pub u64, pub String, pub Address /*admin*/);

#[contractevent]
pub struct UpgradeScheduled(pub Address, pub BytesN<32> /*new wasm*/, pub u64, pub u64);

#[contractevent]
pub struct UpgradeExecuted(pub BytesN<32> /*new wasm*/, pub u64);

#[contractevent]
pub struct UpgradeCancelled(pub BytesN<32> /*new wasm*/, pub u64);

#[contracterror]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    UnauthorizedPublisher = 3,
    InvalidScore = 4,
    FutureTimestamp = 5,
    StaleReport = 6,
    ZeroAddress = 7,
    ZeroHash = 8,
    InvalidTier = 9,
    Paused = 10,
    Expired = 11,
    ReplayProtection = 12,
    InvalidUpgradeDelay = 13,
    UpgradeNotPending = 14,
    UpgradeNotReady = 15,
    AdminAlreadyPending = 16,
    InvalidFormat = 17,
    NotOwner = 18,
}

pub fn initialize(env: Env, admin: Address, publishers: Vec<Address>, tiers: Vec<Symbol>, expiries: Vec<u64>, version: (u32, u32, u32, BytesN<32>));
pub fn set_publisher(env: Env, publisher: Address, authorized: bool, tier: Symbol, expiry: u64);
pub fn publish_risk(env: Env, publisher: Address, asset_id: BytesN<32>, network: Symbol, asset_label: String, score: u32, verdict: Symbol, report_hash: BytesN<32>, evidence_uri: String, updated_at: u64, nonce: u64) -> Result<RiskRecord, RegistryError>;
pub fn revoke_risk(env: Env, asset_id: BytesN<32>, network: Symbol, reason: String) -> Result<(), RegistryError>;
pub fn get_risk(env: Env, asset_id: BytesN<32>, network: Symbol) -> Option<RiskRecord>;
pub fn is_publisher(env: Env, publisher: Address) -> bool;
pub fn pause(env: Env, reason: String);
pub fn unpause(env: Env);

pub fn schedule_upgrade(env: Env, new_wasm_hash: BytesN<32>, delay_sec: u64);
pub fn execute_upgrade(env: Env);
pub fn cancel_upgrade(env: Env);

pub fn transfer_admin(env: Env, new_admin: Address);
pub fn accept_admin(env: Env);

pub fn version(env: Env) -> (u32, u32, u32, BytesN<32>);
pub fn admin(env: Env) -> Result<Address, RegistryError>;
pub fn is_paused(env: Env) -> bool;
```

### 6.4 Validation rules

| Failure | Trigger | Reason |
| --- | --- | --- |
| `AlreadyInitialized` | second `initialize` call | state guard |
| `NotInitialized` | any state-changing call before `initialize` | state guard |
| `UnauthorizedPublisher` | publisher missing from storage | auth guard |
| `Expired` | `publisher_expiry <= env.ledger().timestamp()` | publisher lease |
| `InvalidScore` | `score > 100` | schema |
| `FutureTimestamp` | `updated_at > ledger_ts + MAX_FUTURE_SECONDS` | clock guard |
| `StaleReport` | `updated_at <= existing.updated_at` | monotonic guard |
| `ZeroAddress` | publisher or admin is `Address::zero()` | canonical zero |
| `ZeroHash` | `asset_id` or `report_hash` is `BytesN<32>::from_array([0;32])` | sentinel |
| `InvalidTier` | tier symbol length > 32 or numeric | serialization |
| `Paused` | `publish_risk` while `is_paused()` | emergency gate |
| `ReplayProtection` | duplicate `(publisher, nonce)` pair in `publish_risk` | per-publisher monotonic nonce |
| `InvalidUpgradeDelay` | `delay_sec < 24 * 3600` or `> 30 * 86400` | upgrade window |
| `UpgradeNotPending` | `execute_upgrade` / `cancel_upgrade` without pending upgrade | state guard |
| `UpgradeNotReady` | `execute_upgrade` before `effective_at` | timelock |
| `AdminAlreadyPending` | `transfer_admin` while another admin transfer is pending | state guard |
| `InvalidFormat` | `asset_label` or `evidence_uri` length > 256 or contains `\u0000` | encoding |
| `NotOwner` | non-admin calls admin-only function | auth guard |

### 6.5 Replay, stale, zero-address, invalid hash, pause

- **Replay**: `publish_risk` checks both (a) `updated_at > existing.updated_at` (monotonic guard) and (b) a per-publisher monotonic nonce (`PublisherCounterNonce(Address)`). The caller supplies a `nonce: u64` that must exceed the stored `PublisherCounterNonce(publisher)` value; if it does not, the call reverts `ReplayProtection`.
- **Stale**: `StaleReport` is already enforced for `publish_risk`. The new `revoke_risk` adds a `revoked_at` and rejects re-revocation with `StaleReport`.
- **Zero address / zero hash**: `ZeroAddress` / `ZeroHash` for the publisher parameter and the `asset_id` / `report_hash` parameters.
- **Pause**: `pause` / `unpause` are admin (or guardian for `pause`). `publish_risk` and `revoke_risk` revert `Paused` while paused. `get_risk` is always permitted.

### 6.6 Storage / TTL

| Key | TTL constant | Trigger |
| --- | --- | --- |
| `instance` | `INSTANCE_TTL_THRESHOLD` (30d) → `INSTANCE_TTL_EXTEND_TO` (120d) | bumped on every admin or pause write |
| `Publisher(addr)` | `PUBLISHER_TTL_THRESHOLD` (60d) → `PUBLISHER_TTL_EXTEND_TO` (365d) | bumped on `set_publisher` and `publish_risk` |
| `PublisherTier(addr)` | same as `Publisher(addr)` | same |
| `PublisherExpiry(addr)` | same as `Publisher(addr)` | same |
| `PublisherCounter(addr)` | same as `Publisher(addr)` | bumped on `publish_risk` only |
| `PublisherCounterNonce(addr)` | n/a (V2-066) | n/a |
| `Record(asset_id, network)` | `RECORD_TTL_THRESHOLD` (60d) → `RECORD_TTL_EXTEND_TO` (365d) | bumped on `publish_risk` and `get_risk` |

`MAX_FUTURE_SECONDS` stays at 300. The new `UpgradePending` key uses `UPGRADE_TTL_THRESHOLD` (7 days) → `UPGRADE_TTL_EXTEND_TO` (60 days).

### 6.7 Upgrade policy

- `schedule_upgrade(new_wasm_hash, delay_sec)` queues the upgrade. `delay_sec ∈ [24*3600, 30*86400]`. Admins may only schedule one pending upgrade at a time.
- `execute_upgrade` is callable only after `effective_at <= env.ledger().timestamp()`.
- `cancel_upgrade` is callable by the admin at any time before `execute_upgrade`.
- After `execute_upgrade`, the new instance must call `initialize` only if it is a fresh deployment; otherwise it must call `migrate` with a clean state migration plan.

### 6.8 Frontend correlation

- `RiskPublished` events are correlated to the frontend `riskReport.agentCards[].rawSignals.riskRegistry` field by `(asset_id, network)`.
- `RiskRevoked` sets `record.revoked = true` and surfaces a `Risk Registry Revoked` finding in the agent timeline.
- `RegistryEmergencyPauseSet` flips the `riskRegistry.paused` flag in the runtime-mode health and triggers a manual-review recommendation.

---

## 7. Cross-chain differences and domain separation

| Concern | EVM (CryptaraVault) | Soroban (RiskRegistry) |
| --- | --- | --- |
| Storage model | contract storage + event log | instance + persistent + TTL |
| Auth model | `owner` / `agent` / `guardian` modifiers | `require_auth` + storage-level allowlist |
| Replay protection | `usedIntents[intentHash]` mapping | `PublisherCounterNonce` per publisher + `updated_at` monotonic |
| Pause authority | owner or guardian | admin or guardian |
| Pause scope | all state-changing methods | `publish_risk`, `revoke_risk`, `set_publisher` |
| Upgrade | UUPS proxy + `effectiveAt` timelock | versioned WASM + `effectiveAt` timelock |
| Hash encoding | `keccak256` | `sha256` |
| Signature verification | implicit (msg.sender) | `require_auth()` per call |
| Fee model | gas (caller pays) | resource fees (caller pays) |
| Event ordering | constrained by insertion order | constrained by inclusion order |
| Finality | probabilistic (12-15 blocks typical) | deterministic at ledger close |
| Indexer compatibility | subgraph-friendly topics | subquery / Hubble-friendly |

### Domain separation

Every cross-chain identifier includes an explicit chain-family discriminator:

- **EVM intent hash**: `keccak256(abi.encode(uint256(block.chainid), ...))` — `block.chainid` is the domain separator.
- **Soroban asset_id**: `sha256(network_id ++ ":" ++ asset_key)` — `network_id` is the domain separator.
- **Transaction hash collision**: `isTransactionHashForChain(value, family)` rejects EVM hashes (`0x` prefix) submitted against Stellar RPC and vice versa.

### Canonical asset encoding

| Chain | Encoding |
| --- | --- |
| EVM | `assetId = keccak256(abi.encode(uint256(block.chainid), tokenAddress))` — 32 bytes, lower-cased hex |
| Soroban | `assetId = sha256(network_id ++ ":" ++ asset_key)` — 32 bytes, upper-cased hex |

The `asset_key` for Soroban is the canonical asset identity: `native` for XLM, `CODE:ISSUER` for classic assets, or the contract ID for Soroban contracts. The frontend resolves this via `frontend/src/lib/chainIdentity.ts`.

---

## 8. Threat model

Each threat is mapped to a concrete control and a test identifier in `docs/V3_CONTRACT_TEST_MATRIX.md`.

| # | Threat | Control | Test ID |
| --- | --- | --- | --- |
| T1 | **Reentrancy** | No token calls in the contract; all state writes are non-reentrant. The contract never calls external contracts. | T-EVM-048, T-SOR-070 |
| T2 | **Replay** | `usedIntents[intentHash]` on EVM; `PublisherCounterNonce` on Soroban. Both are monotonic and per-wallet/per-publisher. | T-EVM-021, T-SOR-023 |
| T3 | **Stale intent** | `expiry` field in intent; `StaleIntent` revert; `surfaceStale` companion. | T-EVM-022, T-EVM-022a |
| T4 | **Malicious agent** | Per-agent expiry; per-revocation event; replay protection on intents; agent is bound by policy hash. | T-EVM-006, T-EVM-016 |
| T5 | **Infinite approval** | `InfiniteApprovalWarning` event; `RevokeAllowanceSuggested` event; frontend blocks on infinite allowance. | T-EVM-050, T-EVM-051 |
| T6 | **Admin compromise** | Two-step ownership transfer; guardian pause; upgrade timelock (24h min). | T-EVM-036, T-EVM-037, T-EVM-040 |
| T7 | **Upgrade with malicious implementation** | Timelock + `VersionReported` event + `UpgradeCancelled` path; frontend refuses new implementation that does not match expected selector. | T-EVM-040, T-EVM-043, T-EVM-044 |
| T8 | **Cross-chain replay** | `block.chainid` in EVM intent hash; `network_id` in Soroban asset_id; `isTransactionHashForChain` rejects collisions. | T-X-007, T-X-008 |
| T9 | **Oracle / provider failure** | The contract does not read external oracles. Price impact and slippage are user-supplied bounds, not oracle-derived. The frontend is responsible for oracle data; the contract only enforces the user's stated bounds. | T-EVM-052, T-EVM-053 |
| T10 | **Stale intent on chain** | `block.timestamp > expiry` reverts `StaleIntent`; the window is set by the frontend from `lifecycle.expiresAt`. | T-EVM-022 |
| T11 | **Policy broadening** | Policy is a hash committed by the owner. The contract rejects any intent whose policy hash does not match. The contract cannot broaden a policy it does not store. | T-EVM-013, T-EVM-014 |
| T12 | **Daily limit bypass** | `dailySpentUsd` is enforced on `logExecutionIntent`; the window resets every 24h; the limit is per-wallet. | T-EVM-049, T-EVM-050 |
| T13 | **Nonce reuse** | `nonces[wallet]` is monotonic; `InvalidNonce` revert on mismatch. | T-EVM-048 |
| T14 | **Asset allow/block bypass** | `allowedAssets` and `blockedAssets` are enforced per intent; the sets are part of the policy hash. | T-EVM-047, T-EVM-049 |
| T15 | **Pause as fund extraction** | Pause is a write-only gate; no `transfer` / `approve` / `swap` methods exist; pause cannot move funds. | T-EVM-050 |
| T16 | **Soroban eviction** | TTL bumps on every write; `RECORD_TTL_THRESHOLD` set to 60 days for records and 120 days for instance. | T-SOR-064, T-SOR-066 |
| T17 | **RPC provider downtime** | The contract does not depend on RPC providers. The frontend falls back to RPC providers with `runProviderFallbacks`. | T-X-009 |
| T18 | **Network fork** | Non-custodial: users always re-sign and resend on the canonical chain; the contract treats each `chainId` distinctly. | T-X-007 |

---

## 9. Deployment plan

### 9.1 Network targets

| Network | Chain | Tier | Status |
| --- | --- | --- | --- |
| GOAT Network (id 48816) | EVM | dev (primary) | Default primary EVM target. |
| Stellar Testnet | Soroban | dev (primary) | Default primary Soroban target. |
| Stellar Pubnet | Soroban | prod | Deferred until §9.3 step 6 (third-party audit). |
| Base mainnet | EVM | prod | Deferred until §9.3 step 6 (third-party audit). |

### 9.2 Admin key lifecycle

- The deployment admin key is generated per network and stored in a hardware-backed signer (HSM-style or equivalent).
- The admin public key is emitted via `VersionReported` on first `initialize` / `version()` call.
- Two-step `transferOwnership` / `transfer_admin` requires the new admin to call `acceptOwnership` / `accept_admin` within 7 days, otherwise the transfer expires.
- A rotating admin quorum is **not** introduced in this spec; it is a follow-up.

### 9.3 Step-by-step rollout

1. **Spec sign-off** (this PR) — reviewer approves the spec.
2. **Testnet deploy** — both contracts deployed to testnet with deterministic admin keys owned by the deployment CI.
3. **Frontend integration PR** — the frontend wires the new events to the new contract events.
4. **Testnet soak** — 14 days of soak testing on testnet with synthetic load and a forced pause / unpause cycle.
5. **Audit** — third-party audit of the implementation PR (out of scope of this spec).
6. **Pubnet deploy** — only after audit, the admin calls `VersionReported`, then `setPublisher` / `addAgent` for the canonical Cryptara publisher / agent.
7. **Frontend cutoff** — the frontend flips `x402Required: true` for non-custodial write paths after the first confirmed event on pubnet.

### 9.4 Cutover and rollback

- The frontend MUST be able to roll back to the V2 contract addresses by swapping the `NEXT_PUBLIC_CRYPTARA_VAULT_ADDRESS` and `NEXT_PUBLIC_RISK_REGISTRY_ADDRESS` env vars.
- The frontend MUST NOT auto-upgrade; every version bump is gated behind a manual `NEXT_PUBLIC_CONTRACT_VERSION` bump and a code-release.

### 9.5 Defaults and maintainer substitution policy

The defaults below are binding at PR merge unless a single maintainer comment substitutes a specific item. A substitution overrides only that item; remaining defaults stay in force.

1. **Targeted EVM testnet** — Default: GOAT Network (id 48816) primary. Substitution path: comment "substitute EVM primary <network>".
2. **Stellar target** — Default: Stellar Testnet dev now, Stellar Pubnet deferred until audit. Substitution path: comment "substitute Stellar dev <network>".
3. **Proxy pattern for V3** — Default: UUPS proxy (`ERC1967Proxy` + `UUPSUpgradeable`) with §5.7 timelock and cancel path. Substitution alternatives: minimal proxy, beacon, or transparent proxy.
4. **Upgrade delay window** — Default: 24h minimum, 30d maximum. Substitution path: comment with new `[minSec, maxSec]` inclusive bounds.
5. **Publisher tier list** — Default: `cryptara`, `partner`, `community`. Substitution path: comment with the exact tier symbol list.
6. **Version-rebuild hash encoding** — Default: `sha256(git_commit || build_runner)` truncated to 32 bytes for Soroban; `keccak256(git_commit || build_runner)` truncated to 32 bytes for EVM.
7. **Custody model** — Default: allowance model (non-custodial). Substitution path: comment "substitute custody model <funds|fungible_vault>". The funds model requires a separate audit and is not recommended.
8. **Daily limit window** — Default: 24-hour rolling window. Substitution path: comment with new window in seconds.
9. **Admin quorum** — Default: single admin (deferred to V3-108+). Substitution path: comment "substitute admin quorum <n-of-m>".

### 9.6 Maintainer approval gate

Before implementation begins, maintainers must approve the following decisions:

- **Custody**: allowance model (non-custodial) — confirmed in §3.
- **Upgrade**: UUPS proxy + 24h–30d timelock + cancel path — confirmed in §5.7.
- **Admin**: single admin + two-step transfer + guardian pause — confirmed in §5.6.
- **Audit**: third-party audit required before pubnet deploy — confirmed in §9.3.

These approvals are captured as PR review comments on this spec. Absent a substitution comment, the defaults merge at PR approval.

---

## 10. Acceptance criteria mapping

| Issue #31 acceptance criterion | Spec section |
| --- | --- |
| Decide funds-versus-allowance model and explicitly minimize custody | §3 (allowance model, non-custodial proof) |
| Specify agent authorization, policy commitment, daily/value limits, trade percent, slippage, price impact, allowed/blocked assets, nonce, expiry, pause, and user revoke | §5.2 (roles), §5.3 (functions), §5.4 (validation), §5.8 (daily limit), §5.9 (asset enforcement), §6.2–6.4 (Soroban roles + validation) |
| Threat-model reentrancy, replay, stale intent, malicious agent, infinite approval, admin compromise, upgrade, cross-chain replay, and oracle/provider failure | §8 (threat model, 18 threats mapped to controls + tests) |
| Define EVM and Soroban interfaces/events and an external audit checklist | §5 (EVM), §6 (Soroban), `docs/V3_AUDIT_CHECKLIST.md` |
| Analyze upgradeability and recovery tradeoffs | `docs/V3_UPGRADE_RECOVERY.md` |
| Every privilege has a limit, revoke path, and event | §5.2 (roles table with limits), §5.3 (revoke functions), §4 (events) |
| Cross-chain/domain separation and canonical asset encoding are explicit | §7 (domain separation, canonical asset encoding) |
| Contract cannot silently broaden user policy | §5.3 (`setPolicy` + `PolicyUpdated` event), §8 T11 (policy broadening) |
| Threats map to controls and tests | §8 (threat table with test IDs) |
| Maintainers approve custody, upgrade, admin, and audit decisions before implementation | §9.6 (maintainer approval gate) |

---

## 10.1 Governance timelock (Issue #145)

Privileged changes (upgrades and parameter changes) are gated by the timelock controller:

- **EVM**: `CryptaraTimelock` (`backend/contracts/contracts/CryptaraTimelock.sol`) with `propose`, `sign`, `execute`, `cancel`, `getPendingQueue`/`getPendingCount`, `pause` immediate. Delay ∈ [24h, 30d], threshold ≥2.
- **Soroban**: `GovernanceContract` (`soroban/contracts/governance/src/lib.rs` + `timelock.rs`) with identical semantics and TTL extension.
- Events `ProposalCreated`/`ProposalSigned`/`ProposalExecuted`/`ProposalCancelled` carry `payloadHash` (keccak256). Pending queue is readable and verifiable by the frontend (`frontend/src/server/stellar/governance.ts` + `frontend/src/app/api/stellar/governance/pending/route.ts`).
- Policy/risk-registry/audit-registry expose `set_governance`/`governance` and emit `GovernanceUpdated`. Emergency pause remains immediate.

## 11. Canonical encoding reference

| Field | Type | Canonical encoding |
| --- | --- | --- |
| `decision_id` (EVM) | `bytes32` | `keccak256(abi.encode(uint256(block.chainid), owner, ++decisionCounter[owner]))` |
| `decision_id` (Soroban) | `BytesN<32>` | `sha256(network_short_name ++ "\u0000" ++ publisher ++ "\u0000" ++ ++publisherCounter[publisher])` |
| `policy_hash` (EVM) | `bytes32` | `keccak256(abi.encode(maxRiskScore, maxTradePercent, maxMemeExposurePercent, maxDailyValueUsd, maxSlippageBps, maxPriceImpactBps, allowedChainsHash, blockedTokensHash))` |
| `intent_hash` (EVM) | `bytes32` | `keccak256(abi.encode(decision_hash, chainId, fromToken, toToken, percent, valueUsd, maxSlippageBps, maxPriceImpactBps, expiry, nonce))` |
| `asset_id` (EVM) | `bytes32` | `keccak256(abi.encode(uint256(block.chainid), tokenAddress))` |
| `asset_id` (Soroban) | `BytesN<32>` | `sha256(network_id ++ ":" ++ asset_key)` |
| `report_hash` (Soroban) | `BytesN<32>` | `sha256(canonicalReportJson)` |

---

## 12. Roadmap to implementation

| Step | Owner | Depends on |
| --- | --- | --- |
| Approve this spec | Maintainer | PR review |
| Implement EVM `CryptaraVault` v3 | Frontend/Contracts | spec approval + maintainer custody/upgrade/admin/audit approval |
| Implement Soroban `RiskRegistry` v3 | Frontend/Contracts | spec approval |
| Frontend wiring | Frontend | contract deploys |
| Test matrix execution | Frontend | test matrix approval |
| Third-party audit | External | implementation freeze |
| Testnet deploy | DevOps | frontend wiring + audit |
| Pubnet deploy | Maintainer | audit pass + soak |
