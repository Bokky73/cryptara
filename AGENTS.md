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
- Soroban SDK pinned at `26.0.1`; cross-contract calls must use `env.invoke_contract` with `Vec<Val>` args (not `env.call` with tuples)
