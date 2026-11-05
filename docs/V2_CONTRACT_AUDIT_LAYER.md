# V2 Contract Audit Layer

Implementation notes, interface reference and verification procedure for the
non-custodial authorization and audit contracts.

> **Status: proposed, pending approval of the issue #16 specification and the
> maintainer target-network decision.**
>
> Issue #17 requires that "approved interfaces and events are implemented
> exactly". At the time of writing issue #16 is still open, so no approved
> interface document exists. The surface below is derived directly from the
> requirements #16 enumerates — agent authorization and revocation, user-policy
> hash, decision hash, execution-intent log, emergency pause, version reporting
> — and is offered as the concrete proposal to approve. Both contracts report
> `VERSION = 1`; any change agreed during review bumps it.
>
> No network has been deployed to. See [Deployment](#deployment) for why, and
> for what has to happen before testnet artifacts exist.

## What these contracts are for

They record **who may act**, **under what policy**, and **what was decided**.
That is all.

They are not a vault. Neither contract holds funds or moves value:

- `CryptaraAudit.sol` has no `payable` function, no `receive`, no
  `fallback`, and no transfer, approval or balance logic. Ether sent to it
  reverts. A test asserts this over the compiled ABI so it stays true.
- `AuditRegistry` (Soroban) instantiates no token client and performs no
  transfer.

Recording an execution intent commits an agent to a plan. It does not authorize
a transfer: the resulting transaction is still signed by the user's own wallet.

## Authorization model

Every user is their own admin. There is no protocol-level owner who can act for
someone else, which means there is no key whose compromise affects all users.

```
user ──setPolicy(policyHash)────────────► policy committed
user ──authorizeAgent(agent, policyHash, expiresAt)──► agent may act
agent ─logDecision(user, policyHash, …)──► DecisionLogged
agent ─recordIntent(user, policyHash, …)─► IntentRecorded
user ──revokeAgent(agent)───────────────► agent inert immediately
user ──setPaused(true)──────────────────► all logging for this user halts
```

An agent is live only when **all** of the following hold. Each is tested
independently:

| Condition | Enforced by | Failure |
|---|---|---|
| The user is not paused | `paused[user]` / `DataKey::Paused` | `ContractPaused` |
| An authorization exists | authorization lookup | `NotAuthorized` |
| It has not been revoked | `active` flag | `NotAuthorized` |
| It has not expired | `expiresAt > now` | `AuthorizationExpired` |
| The presented policy matches the grant | `authorization.policyHash` | `PolicyMismatch` |
| The presented policy is still the user's current one | `policyHashOf[user]` | `PolicyMismatch` |

The last row is the one that is easy to omit. Without it, an agent could keep
acting on work it computed against a policy the user has since replaced. Because
the check compares against *both* the grant and the user's live policy, rotating
a policy invalidates every outstanding grant until the user deliberately
re-authorizes.

Revocation is idempotent on purpose. A user reacting to an incident must never
be blocked by a revert, so revoking an unknown or already-revoked agent
succeeds.

## Replay and staleness

An execution intent carries a caller-supplied `intentId`, consumed on first use.

- **Replay**: a second `recordIntent` with the same id for the same user reverts
  with `IntentReplayed`. Ids are scoped per user, so two users may
  coincidentally choose the same id without colliding.
- **Staleness**: `expiresAt` must be in the future, and no more than
  `MAX_INTENT_WINDOW` (1 hour) ahead. An intent prepared against a quote that has
  since moved cannot be revived later — it reverts with `IntentStale`.

Authorizations are separately bounded by `MAX_AUTHORIZATION_WINDOW` (365 days),
so a mistyped expiry cannot create a decade-long grant.

## Interface

Both chains expose the same seven operations. Names differ only in casing
convention.

| Operation | EVM | Soroban |
|---|---|---|
| Version | `VERSION() → uint16` | `version() → u32` |
| Commit policy | `setPolicy(bytes32)` | `set_policy(Address, BytesN<32>)` |
| Authorize agent | `authorizeAgent(address, bytes32, uint64)` | `authorize_agent(Address, Address, BytesN<32>, u64)` |
| Revoke agent | `revokeAgent(address)` | `revoke_agent(Address, Address)` |
| Pause | `setPaused(bool)` | `set_paused(Address, bool)` |
| Log decision | `logDecision(address, bytes32, bytes32, bytes32, uint16)` | `log_decision(Address, Address, BytesN<32>, BytesN<32>, BytesN<32>, u32)` |
| Record intent | `recordIntent(address, bytes32, bytes32, bytes32, bytes32, uint64)` | `record_intent(Address, Address, BytesN<32>, BytesN<32>, BytesN<32>, BytesN<32>, u64)` |

Reads: `authorizationOf` / `authorization_of`, `policyHashOf` / `policy_of`,
`paused` / `is_paused`, `isAgentLive` / `is_agent_live`, `intentUsed` /
`is_intent_used`.

### Events

Event names and field order are identical on both chains, so one indexer schema
covers both.

| Event | Topics | Data |
|---|---|---|
| `PolicyUpdated` | user, policyHash | timestamp |
| `AgentAuthorized` | user, agent, policyHash | expiresAt |
| `AgentRevoked` | user, agent | timestamp |
| `DecisionLogged` | user, agent, decisionId | decisionHash, buyRisk, timestamp |
| `IntentRecorded` | user, agent, intentId | decisionId, intentHash, expiresAt |
| `PauseChanged` | user | paused, timestamp |

`decisionId` and `intentId` are the identifiers the frontend already generates,
so an event can be joined to a stored agent run without a translation table.
`decisionHash` and `intentHash` are digests of payloads that stay off chain — no
user strategy or portfolio is published to a public ledger.

### Errors

Both chains use the same error names. Soroban assigns them stable numeric codes;
appending is safe, renumbering is not.

| Error | Soroban code | Meaning |
|---|---|---|
| `ZeroHash` | 1 | A hash argument was all zeroes |
| `NotAuthorized` | 2 | No live grant for this agent |
| `AuthorizationExpired` | 3 | The grant's `expiresAt` has passed |
| `WindowTooLong` | 4 | Requested window exceeds the maximum |
| `ExpiryInPast` | 5 | Authorization expiry is not in the future |
| `IntentReplayed` | 6 | This intent id was already consumed |
| `IntentStale` | 7 | The intent's `expiresAt` has passed |
| `ContractPaused` | 8 | The user has paused logging |
| `InvalidBuyRisk` | 9 | Buy Risk outside 0-100 |
| `PolicyMismatch` | 10 | Presented policy is not the live grant policy |
| `PolicyNotSet` | 11 | The user has committed to no policy |

`ZeroAddress` exists on EVM only; Soroban's `Address` type has no zero value to
guard against.

### Chain differences

| Concern | EVM | Soroban |
|---|---|---|
| Caller identity | `msg.sender` | explicit `Address` + `require_auth()` |
| Storage lifetime | permanent | entries expire; TTL bumped on write and read |
| Intent consumption | permanent `mapping` | `temporary` storage, TTL sized to the intent's own window |
| Version type | `uint16` | `u32` |

The Soroban intent marker deliberately uses temporary storage. A consumed intent
id only needs to outlive the intent: once `expiresAt` passes the call is refused
on staleness regardless, so paying rent beyond that point buys nothing.

## Building and testing

```sh
# Soroban
cargo test --manifest-path soroban/Cargo.toml
RUSTC="$(rustup which rustc)" stellar contract build --manifest-path soroban/Cargo.toml

# EVM
npm --prefix backend/contracts install
npm --prefix backend/contracts test
```

Toolchain versions are pinned in `rust-toolchain.toml`, `soroban/Cargo.toml`
(`soroban-sdk = "=26.0.1"`) and `backend/contracts/hardhat.config.ts`
(`solidity: "0.8.24"`). See `CONTRIBUTING.md` for the required Stellar CLI
version.

## Deployment

`scripts/deploy-audit-layer.mjs` drives both chains. It enforces four rules:

1. **`--network` is mandatory.** There is no default and no "current network"
   fallback. A missing or unknown network is an error.
2. **Production networks are refused.** Pubnet and every EVM mainnet are
   rejected by name with an explicit message. Production deployment needs
   separate security approval, which a script cannot grant.
3. **No secret is ever printed.** Credentials are read from named environment
   variables; the script prints the variable names and never their values, and
   nothing secret is written to the artifact record.
4. **The working tree must be clean.** An artifact record that names a commit
   which does not describe the deployed source is worse than no record.

```sh
# Validate configuration and build without deploying:
node scripts/deploy-audit-layer.mjs --chain soroban --network testnet --dry-run
node scripts/deploy-audit-layer.mjs --chain evm --network base-sepolia --dry-run

# Deploy:
STELLAR_TESTNET_RPC_URL=… STELLAR_DEPLOYER_SECRET=… \
  node scripts/deploy-audit-layer.mjs --chain soroban --network testnet
```

Deployer credentials stay outside the repository. `.gitignore` and the
`deploy:check` secret scan both cover this; never commit a Stellar secret key,
an EVM private key, or a signed XDR.

### Why there are no testnet artifacts in this change

Recording contract ids, transaction links and a WASM hash requires actually
deploying, which requires two things this change cannot supply:

- **A maintainer decision on target networks.** Issue #16 lists this as an
  explicit prerequisite and it is still open. The networks in
  `scripts/deploy-audit-layer.mjs` are the plausible testnets, not an approved
  list.
- **Funded deployer credentials**, which must never live in the repository.

`docs/deployments/TEMPLATE.md` is the record to fill in once a maintainer has
chosen the networks and run the script. The script writes the machine-readable
half of that record itself, so the numbers in it come from the toolchain rather
than from someone typing them.

## Independent verification

Anyone can reproduce the deployed artifacts from a commit and toolchain:

**Soroban**

```sh
git checkout <commit>
rustup show                       # must match rust-toolchain.toml
stellar --version                 # must match the recorded version
RUSTC="$(rustup which rustc)" stellar contract build --manifest-path soroban/Cargo.toml
sha256sum soroban/target/wasm32v1-none/release/cryptara_audit_registry.wasm
# compare against wasmSha256 in the artifact record, and against
# `stellar contract info --id <contractId>` on the recorded network
```

**EVM**

```sh
git checkout <commit>
npm --prefix backend/contracts ci
npm --prefix backend/contracts run compile
# compare the artifact's bytecodeSha256 against the record, and the on-chain
# code at the recorded address via the block explorer's verification tab
```

Both hashes are recorded by the deploy script rather than pasted in by hand, so
a mismatch means the source and the deployment genuinely differ.

## Frontend bindings

Typed interfaces are generated, not hand-written, so they cannot drift:

- **EVM**: `npm --prefix backend/contracts run compile` emits the ABI to
  `artifacts/contracts/CryptaraAudit.sol/CryptaraAudit.json`. TypeChain
  types come from the same run via `@nomicfoundation/hardhat-toolbox`.
- **Soroban**: `stellar contract bindings typescript --contract-id <id>
  --network <network> --output-dir <dir>` generates a typed client from the
  deployed contract's own spec.

Both commands are deterministic given a commit and a toolchain version, so
regenerating produces a byte-identical result.
