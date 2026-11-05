# Cryptara Soroban contracts

Workspace crates: policy, vault, risk-registry, and audit-registry. Reports remain off-chain where applicable; digests and policy state are stored on-chain.

## Local verification

```sh
cargo fmt --manifest-path soroban/Cargo.toml --all -- --check
cargo clippy --manifest-path soroban/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path soroban/Cargo.toml
stellar contract build --manifest-path soroban/Cargo.toml
```

CI and `scripts/build-soroban.sh` use `stellar contract build` with the `wasm32v1-none` target. Expected release WASM basenames:

- `cryptara_policy.wasm`
- `cryptara_vault.wasm`
- `cryptara_risk_registry.wasm`
- `cryptara_audit_registry.wasm`

## Provenance

```bash
npm run build:soroban
npm run provenance:freeze -- --write --release
npm run provenance:verify -- --strict
```

Deployment helpers require a verified manifest path. Never commit a Stellar secret key. Generated WASM under `soroban/target/` must stay untracked. See `docs/BUILD_PROVENANCE.md`.
