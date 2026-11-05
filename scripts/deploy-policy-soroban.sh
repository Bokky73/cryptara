#!/usr/bin/env bash
set -euo pipefail

# Deploy CryptaraPolicy to Soroban testnet
# Usage: ./scripts/deploy-policy-soroban.sh <network> <manifest-path>
# Requires: stellar CLI, SOROBAN_SECRET_KEY env var
# Never commit a Stellar secret key.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NETWORK="${1:-}"
MANIFEST="${2:-}"

if [ -z "${NETWORK}" ] || [ -z "${MANIFEST}" ]; then
  echo "Usage: ./scripts/deploy-policy-soroban.sh <network> <manifest-path>" >&2
  echo "Provenance manifest path is required and must verify before deploy." >&2
  exit 1
fi

case "${NETWORK}" in
  mainnet|pubnet|public|production)
    echo "ERROR: pubnet/mainnet deployment is refused by this script." >&2
    exit 1
    ;;
esac

echo "Verifying artifact provenance before deploy..."
node "${ROOT}/scripts/verify-artifact-provenance.mjs" --strict "${MANIFEST}"

echo "Building CryptaraPolicy via workspace stellar contract build..."
stellar contract build --manifest-path "${ROOT}/soroban/Cargo.toml"

WASM="${ROOT}/soroban/target/wasm32v1-none/release/cryptara_policy.wasm"
if [ ! -f "${WASM}" ]; then
  echo "ERROR: expected wasm at soroban/target/wasm32v1-none/release/cryptara_policy.wasm" >&2
  exit 1
fi

if [ -z "${SOROBAN_SECRET_KEY:-}" ] && [ -z "${STELLAR_SECRET_KEY:-}" ]; then
  echo "ERROR: set SOROBAN_SECRET_KEY or STELLAR_SECRET_KEY in the environment (value never printed)." >&2
  exit 1
fi

echo "Deploying to ${NETWORK}..."
# Credentials stay in the environment; do not interpolate secrets into argv.
stellar contract deploy \
  --wasm "${WASM}" \
  --network "${NETWORK}"

echo "Deployment complete. No secrets in output."
