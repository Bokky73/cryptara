#!/usr/bin/env bash
set -euo pipefail

# Deploy CryptaraPolicy to Soroban testnet
# Usage: ./scripts/deploy-policy-soroban.sh [--dry-run] <network> <manifest-path>
# Requires: stellar CLI, SOROBAN_SECRET_KEY env var
# Never commit a Stellar secret key.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=0

# Parse optional --dry-run flag before positional args.
ARGS=()
for arg in "$@"; do
  if [ "${arg}" = "--dry-run" ]; then
    DRY_RUN=1
  else
    ARGS+=("${arg}")
  fi
done

NETWORK="${ARGS[0]:-}"
MANIFEST="${ARGS[1]:-}"

if [ -z "${NETWORK}" ] || [ -z "${MANIFEST}" ]; then
  echo "Usage: ./scripts/deploy-policy-soroban.sh [--dry-run] <network> <manifest-path>" >&2
  echo "Provenance manifest path is required and must verify before deploy." >&2
  exit 1
fi

case "${NETWORK}" in
  mainnet|pubnet|public|production)
    echo "ERROR: pubnet/mainnet deployment is refused by this script." >&2
    exit 1
    ;;
esac

# --- Credential check ----------------------------------------------------

if [ -z "${SOROBAN_SECRET_KEY:-}" ] && [ -z "${STELLAR_SECRET_KEY:-}" ]; then
  echo "ERROR: set SOROBAN_SECRET_KEY or STELLAR_SECRET_KEY in the environment (value never printed)." >&2
  exit 1
fi

# --- Provenance verification ---------------------------------------------

echo "Verifying artifact provenance before deploy..."
node "${ROOT}/scripts/verify-artifact-provenance.mjs" --strict "${MANIFEST}"

# --- Build & artifact validation -----------------------------------------

echo "Building CryptaraPolicy via workspace stellar contract build..."
stellar contract build --manifest-path "${ROOT}/soroban/Cargo.toml"

WASM="${ROOT}/soroban/target/wasm32v1-none/release/cryptara_policy.wasm"
if [ ! -f "${WASM}" ]; then
  echo "ERROR: expected wasm at soroban/target/wasm32v1-none/release/cryptara_policy.wasm" >&2
  exit 1
fi

# --- Dry-run exit point --------------------------------------------------

if [ "${DRY_RUN}" -eq 1 ]; then
  echo "dry-run: network=${NETWORK} manifest=${MANIFEST}"
  echo "dry-run: wasm OK: ${WASM}"
  echo "dry-run: credential is set (value not printed)"
  echo "dry-run: would run: stellar contract deploy --wasm ${WASM} --network ${NETWORK}"
  echo "dry-run complete — no transaction broadcast."
  exit 0
fi

# --- Live deploy ---------------------------------------------------------

echo "Deploying to ${NETWORK}..."
# Credentials stay in the environment; do not interpolate secrets into argv.
stellar contract deploy \
  --wasm "${WASM}" \
  --network "${NETWORK}"

echo "Deployment complete. No secrets in output."
