# Contributing to Cryptara

## Required toolchain

Cryptara uses Node.js for the Next.js application and Rust for Soroban contracts.

- Node.js 22 or newer.
- npm 10 or newer.
- Rust stable 1.84 or newer. `wasm32v1-none` first became available in Rust 1.84.
- Stellar CLI 26.1.x for a mainnet Protocol 26 release build. A newer CLI may be used for Protocol 27 testnet work after compatibility is verified.
- Soroban SDK exactly `26.0.1`, pinned in `soroban/Cargo.toml` for current mainnet compatibility.

Install the contract toolchain on macOS:

```sh
rustup toolchain install stable
rustup target add wasm32v1-none
cargo install --locked stellar-cli --version 26.1.0
```

Homebrew may also install Stellar CLI, but `brew install stellar-cli` follows the newest release and can move ahead of mainnet. Check all versions before building:

```sh
node --version
npm --version
rustc --version
stellar --version
```

If both Homebrew Rust and rustup are installed, force Stellar CLI to use the rustup compiler that owns the WASM target:

```sh
RUSTC="$(rustup which rustc)" stellar contract build --manifest-path soroban/Cargo.toml
```

## Installation and verification

First, install the repository dependencies:

```bash
npm run bootstrap
npm run doctor
```

See [Local Development](docs/LOCAL_DEVELOPMENT.md) for more details.

```bash
npm run quality:gate
cargo test --manifest-path soroban/Cargo.toml
RUSTC="$(rustup which rustc)" stellar contract build --manifest-path soroban/Cargo.toml
```

Never commit a Stellar secret key, signed XDR, provider credential, or production wallet seed. User transactions must be signed only by the connected wallet.

## Accessibility

Cryptara targets WCAG 2.2 AA across core flows (scan, wallet, risk
report, strategy, execution, history, operations, Soroban publication). When
changing UI:

- Run `npm run test:a11y` (included in `npm run quality:gate`) before
  opening a PR. It statically checks for skip links, focus-visible styles,
  reduced-motion support, non-color-only risk indicators, and required
  `docs/A11Y_AUDIT.md` sections.
- Prefer the shared helpers in `frontend/src/components/a11y/` (`LiveRegion`,
  `VisuallyHidden`, `StatusBadge`) instead of ad hoc status text or
  color-only indicators.
- Update `docs/A11Y_AUDIT.md` when you fix or knowingly defer an
  accessibility issue, and complete its manual audit checklist (keyboard,
  screen reader, contrast, 200% zoom, mobile reflow, reduced motion) for any
  release that touches UI.
