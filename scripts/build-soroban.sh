#!/usr/bin/env bash
# Build optimized Soroban WASM artifacts and enforce per-contract size budgets.
#
# Soroban enforces strict on-chain WASM size limits (~64KB-128KB depending on
# protocol parameters). We keep a tighter internal budget so that dependency or
# serialization changes cannot silently bloat the artifacts.
set -euo pipefail

# Documented per-contract WASM size budget (in KB).
MAX_WASM_KB="${MAX_WASM_KB:-40}"
# Reproducible Soroban WASM build (aligned with CI).
# Pinned: soroban-sdk =27.0.6, stellar contract build, wasm32v1-none
# Profile: release (opt-level=z, LTO, strip=symbols, codegen-units=1)
# The lockfile is mandatory and the target is Stellar's wasm32v1-none runtime target.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOROBAN_DIR="$(cd "${SCRIPT_DIR}/../soroban" && pwd)"

CONTRACTS=(
  "risk-registry"
  "policy"
  "governance"
  "audit"
  "vault"
)
echo "=== Soroban Reproducible Build ==="
echo "Soroban SDK: =27.0.6 (pinned in soroban/Cargo.toml)"
echo "Build: stellar contract build"
echo "Target: wasm32v1-none"
echo "Profile: release (opt-level=z, LTO, strip=symbols)"
echo ""

cd "${SOROBAN_DIR}"

if command -v stellar >/dev/null 2>&1; then
  echo "==> Building optimized Soroban WASM via stellar contract build"
  stellar contract build
else
  echo "==> stellar CLI not found; building via cargo" >&2
  cargo build --locked --target wasm32-unknown-unknown --release
# Toolchain drift guard: soroban/rust-toolchain.toml must match the root one so
# that cargo invoked from either directory selects the same Rust version and
# WASM target (reproducible hashes / provenance).
ROOT_TOOLCHAIN="${ROOT_DIR}/rust-toolchain.toml"
SOROBAN_TOOLCHAIN="${ROOT_DIR}/soroban/rust-toolchain.toml"
if [ ! -f "$ROOT_TOOLCHAIN" ] || [ ! -f "$SOROBAN_TOOLCHAIN" ]; then
  echo "ERROR: rust-toolchain.toml missing (root or soroban/)" >&2
  exit 1
fi
if ! cmp -s "$ROOT_TOOLCHAIN" "$SOROBAN_TOOLCHAIN"; then
  echo "ERROR: soroban/rust-toolchain.toml diverges from root rust-toolchain.toml" >&2
  echo "       Keep them identical to preserve reproducible WASM builds." >&2
  diff -u "$ROOT_TOOLCHAIN" "$SOROBAN_TOOLCHAIN" >&2 || true
  exit 1
fi

if ! command -v stellar >/dev/null 2>&1; then
  echo "ERROR: stellar CLI is required (CI pins 26.1.x)" >&2
  exit 1
fi

WASM_DIR="${SOROBAN_DIR}/target/wasm32-unknown-unknown/release"

fail=0
printf '\n%-20s %10s %10s\n' "CONTRACT" "SIZE(KB)" "BUDGET(KB)"
printf '%-20s %10s %10s\n' "--------" "--------" "----------"

for contract in "${CONTRACTS[@]}"; do
  wasm="${WASM_DIR}/${contract}.wasm"
  if [[ ! -f "${wasm}" ]]; then
    echo "ERROR: missing WASM artifact for '${contract}' at ${wasm}" >&2
    fail=1
    continue
  fi

  size_bytes=$(wc -c < "${wasm}" | tr -d ' ')
  size_kb=$(( (size_bytes + 1023) / 1024 ))
  printf '%-20s %10s %10s\n' "${contract}" "${size_kb}" "${MAX_WASM_KB}"

  if (( size_kb > MAX_WASM_KB )); then
    echo "ERROR: ${contract}.wasm is ${size_kb}KB, exceeds budget of ${MAX_WASM_KB}KB" >&2
    fail=1
  fi
done

if (( fail != 0 )); then
  echo "\nSoroban WASM size budget check FAILED" >&2
  exit 1
fi

echo "\nSoroban WASM size budget check passed (<= ${MAX_WASM_KB}KB per contract)"
