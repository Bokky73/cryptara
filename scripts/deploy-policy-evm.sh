#!/usr/bin/env bash
set -euo pipefail

# Deploy CryptaraPolicy to EVM testnet
# Usage: ./scripts/deploy-policy-evm.sh [--dry-run] <network> <manifest-path>
# Requires PRIVATE_KEY env var
# Never commit a private key.

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
  echo "Usage: ./scripts/deploy-policy-evm.sh [--dry-run] <network> <manifest-path>" >&2
  echo "Provenance manifest path is required and must verify before deploy." >&2
  exit 1
fi

case "${NETWORK}" in
  mainnet|production|ethereum|base|goat|goat-mainnet)
    echo "ERROR: production/mainnet deployment is refused by this script." >&2
    exit 1
    ;;
esac

# --- Artifact validation -------------------------------------------------

CONTRACTS_DIR="${ROOT}/backend/contracts"
ARTIFACT="${CONTRACTS_DIR}/artifacts/contracts/CryptaraPolicy.sol/CryptaraPolicy.json"

if [ ! -f "${ARTIFACT}" ]; then
  echo "ERROR: compiled artifact not found: backend/contracts/artifacts/contracts/CryptaraPolicy.sol/CryptaraPolicy.json" >&2
  echo "       Run 'npm run build:evm' or 'npx hardhat compile' in backend/contracts first." >&2
  exit 1
fi

# --- Credential check ----------------------------------------------------

if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "ERROR: PRIVATE_KEY is not set (value never printed)." >&2
  exit 1
fi

# --- Provenance verification ---------------------------------------------

echo "Verifying artifact provenance before deploy..."
node "${ROOT}/scripts/verify-artifact-provenance.mjs" --strict "${MANIFEST}"

# --- Dry-run exit point --------------------------------------------------

if [ "${DRY_RUN}" -eq 1 ]; then
  echo "dry-run: network=${NETWORK} manifest=${MANIFEST}"
  echo "dry-run: artifact OK: ${ARTIFACT}"
  echo "dry-run: credential PRIVATE_KEY is set (value not printed)"
  echo "dry-run: would run: npx hardhat run scripts/deploy-policy.ts --network ${NETWORK}"
  echo "dry-run complete — no transaction broadcast."
  exit 0
fi

# --- Live deploy ---------------------------------------------------------

echo "Deploying CryptaraPolicy to ${NETWORK}..."
cd "${CONTRACTS_DIR}"
npx hardhat run scripts/deploy-policy.ts --network "${NETWORK}"

echo "Deployment complete. No secrets in output."
