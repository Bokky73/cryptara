# Agent notes

## Verification commands

### Soroban (Rust)
- Tests: `cd soroban && cargo test --locked`
- Single package: `cargo test --package cryptara-vault --locked`
- Clippy: `cargo clippy --all-targets -- -D warnings`
- Format: `cargo fmt --check`
- Build script: `scripts/build-soroban.sh`

### Hardhat (Solidity)
- Tests: `cd backend/contracts && npx hardhat test`
- Compile: `npx hardhat compile`

## Known issues
- Lockfile regeneration (`cargo generate-lockfile` without `--locked`) can pull incompatible sub-dependency versions; always use `--locked` for CI
- Soroban SDK pinned at `27.0.6`; cross-contract calls must use `env.invoke_contract` with `Vec<Val>` args (not `env.call` with tuples)
- Rust toolchain is pinned to `1.93.0` with the `wasm32v1-none` target; `rust-toolchain.toml` and `soroban/rust-toolchain.toml` must stay identical (enforced by `scripts/build-soroban.sh`)
