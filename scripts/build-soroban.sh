#!/usr/bin/env bash
set -euo pipefail

# Reproducible Soroban WASM build (aligned with CI).
# Pinned: soroban-sdk =26.0.1, stellar contract build, wasm32v1-none
# Profile: release (opt-level=z, LTO, strip=symbols, codegen-units=1)
# The lockfile is mandatory and the target is Stellar's wasm32v1-none runtime target.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Soroban Reproducible Build ==="
echo "Soroban SDK: =26.0.1 (pinned in soroban/Cargo.toml)"
echo "Build: stellar contract build"
echo "Target: wasm32v1-none"
echo "Profile: release (opt-level=z, LTO, strip=symbols)"
echo ""

if [ ! -f "${ROOT_DIR}/soroban/Cargo.lock" ]; then
  echo "ERROR: soroban/Cargo.lock missing; refuse unlocked builds" >&2
  exit 1
fi

if ! command -v stellar >/dev/null 2>&1; then
  echo "ERROR: stellar CLI is required (CI pins 26.1.x)" >&2
  exit 1
fi

stellar contract build --manifest-path "${ROOT_DIR}/soroban/Cargo.toml"

WASM_DIR="${ROOT_DIR}/soroban/target/wasm32v1-none/release"
EXPECTED_WASMS=(
  cryptara_policy.wasm
  cryptara_vault.wasm
  cryptara_risk_registry.wasm
  cryptara_audit_registry.wasm
)

hash_file() {
  local file="$1"
  if command -v sha256sum &> /dev/null; then
    sha256sum "$file" | cut -d' ' -f1
  else
    shasum -a 256 "$file" | cut -d' ' -f1
  fi
}

echo "=== Build Verification ==="
MISSING=0
for name in "${EXPECTED_WASMS[@]}"; do
  WASM="${WASM_DIR}/${name}"
  if [ ! -f "$WASM" ]; then
    echo "ERROR: WASM file not found after build: soroban/target/wasm32v1-none/release/${name}" >&2
    MISSING=1
    continue
  fi
  HASH="$(hash_file "$WASM")"
  echo "${name}: ${HASH}"
done

if [ "$MISSING" -ne 0 ]; then
  exit 1
fi

# Supply-chain build provenance (dependency-policy governed manifest).
WASM_ARTIFACTS=()
while IFS= read -r artifact; do
  WASM_ARTIFACTS+=("$artifact")
done < <(find "${WASM_DIR}" -maxdepth 1 -type f -name '*.wasm' | LC_ALL=C sort)
if [ "${#WASM_ARTIFACTS[@]}" -eq 0 ]; then
  echo "ERROR: no Soroban WASM files were generated" >&2
  exit 1
fi

node "$ROOT_DIR/scripts/verify-build-provenance.mjs" create soroban "${WASM_ARTIFACTS[@]}"
node "$ROOT_DIR/scripts/verify-build-provenance.mjs" verify soroban

echo ""
echo "To verify reproducibility:"
echo "  1. git checkout <commit>"
echo "  2. ./scripts/build-soroban.sh"
echo "  3. Compare WASM hashes with CI/reference build"
echo "  4. npm run provenance:freeze -- --release && npm run provenance:verify:artifacts -- --strict"
echo ""
echo "Build complete."
