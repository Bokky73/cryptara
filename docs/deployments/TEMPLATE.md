# Audit Layer Deployment Record — <chain> / <network>

Fill one copy of this file per deployed network. The machine-readable half is
written by `scripts/deploy-audit-layer.mjs` to
`docs/deployments/<chain>-<network>.json`; this file is the human-readable
record that points at it.

> Do not paste a private key, secret seed, or signed XDR into this file, or into
> any file in this repository.

## Identity

| Field | Value |
|---|---|
| Chain | `evm` \| `soroban` |
| Network | |
| Contract | `CryptaraAudit` \| `AuditRegistry` |
| Interface version | |
| Contract address / id | |
| Deployment transaction | |
| Explorer link | |
| Deployer address (public) | |
| Deployed at (UTC) | |

## Source

| Field | Value |
|---|---|
| Commit SHA | |
| Working tree clean at deploy | yes / no |
| Artifact record | `docs/deployments/<chain>-<network>.json` |
| Provenance manifest | `release-manifests/<manifest>.json` |

A record whose commit does not describe the deployed source is not evidence. The
deploy script refuses to run against a dirty tree for this reason. Deploy scripts
also require `--manifest` / a manifest path argument and offline verification
(`npm run provenance:verify -- --strict`) before broadcasting.

## Toolchain

| Field | Value |
|---|---|
| rustc | |
| cargo | |
| soroban-sdk | `=26.0.1` (pinned in `soroban/Cargo.toml`) |
| Stellar CLI | |
| Node.js | |
| Hardhat | |
| solc | `0.8.24` (pinned in `backend/contracts/hardhat.config.ts`) |

## Artifact hashes

| Field | Value |
|---|---|
| WASM SHA-256 (Soroban) | |
| Creation bytecode SHA-256 (EVM) | |
| Solidity metadata SHA-256 (EVM) | |
| ABI SHA-256 (EVM) | |

## Build provenance

- [ ] Manifest generated via `npm run provenance:freeze -- --write --release`
- [ ] Offline verification passed via `npm run provenance:verify -- --strict`
- [ ] Manifest contains no secrets, credential URLs, or absolute user paths
- [ ] Dual clean CI builds produced matching artifact hashes

## Verification performed

Record what was actually checked, by whom, and what the output was. An unchecked
box is more useful than a checked one that nobody ran.

- [ ] Rebuilt from the recorded commit and toolchain; hash matches the record.
- [ ] On-chain code matches the rebuilt artifact
      (`stellar contract info --id <id>` / explorer source verification).
- [ ] `cargo test --manifest-path soroban/Cargo.toml` passes at the recorded commit.
- [ ] `npm --prefix backend/contracts test` passes at the recorded commit.
- [ ] Frontend bindings regenerated from the deployed contract and committed.
- [ ] A smoke transaction exercised authorize → log decision → revoke, and the
      emitted events match the documented shapes.

Verified by: _______________  Date: _______________

## Rollback

The contracts are not upgradeable. Rolling back means deploying a corrected
contract and repointing clients; the superseded address stays readable so its
history is not lost.

| Field | Value |
|---|---|
| Previous address / id, if any | |
| Client config key to repoint | |
| Users notified | yes / no / not applicable |

## Notes and known limitations


## Stellar pubnet readiness gate

Pubnet is not reachable through configuration alone. Before a pubnet-enabled
build ships, four conditions are verified at runtime, and the gate fails
closed — an unverifiable condition blocks pubnet rather than being assumed
satisfied.

| Check | What it proves |
| --- | --- |
| Contract identity | The registry contract on pubnet is the reviewed WASM build, on the public network passphrase |
| x402 payment configuration | Payments settle to the approved account, in the approved USDC contract, through the approved facilitator |
| RPC provider independence | Primary and fallback are different operators, both reachable, agreeing on ledger height |
| Governance addresses | The registry and policy contracts in use are the governance-approved ones |

Record the approved values for this deployment:

| Value | Environment variable | Recorded |
| --- | --- | --- |
| Registry WASM hash | `STELLAR_PUBNET_APPROVED_REGISTRY_WASM_HASH` | |
| Registry contract | `STELLAR_PUBNET_APPROVED_REGISTRY_ID` | |
| Policy contract | `STELLAR_PUBNET_APPROVED_POLICY_ID` | |
| x402 destination | `STELLAR_PUBNET_APPROVED_X402_PAY_TO` | |
| USDC contract | `STELLAR_PUBNET_APPROVED_USDC_CONTRACT` | |
| Facilitator origin | `STELLAR_PUBNET_APPROVED_FACILITATOR_ORIGIN` | |

Verify before release:

```bash
cd frontend && npm run test:pubnet-gate     # drives each condition through a failure
node scripts/check-deploy-readiness.mjs     # blocks a pubnet build missing approved values
```

Live status is on `/operations` and in `GET /api/health` under
`stellarPubnetGate`, per check, with the blocking reason named.

A gated deployment refuses pubnet actions with a typed reason
(`PubnetGatedError`). Testnet behaviour is unchanged throughout.

