#!/usr/bin/env bash
set -euo pipefail

# Deploy CryptaraPolicy to EVM testnet
# Usage: ./scripts/deploy-policy-evm.sh <network> <manifest-path>
# Requires PRIVATE_KEY env var
# Never commit a private key.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NETWORK="${1:-}"
MANIFEST="${2:-}"

if [ -z "${NETWORK}" ] || [ -z "${MANIFEST}" ]; then
  echo "Usage: ./scripts/deploy-policy-evm.sh <network> <manifest-path>" >&2
  echo "Provenance manifest path is required and must verify before deploy." >&2
  exit 1
fi

case "${NETWORK}" in
  mainnet|production|ethereum|base|goat|goat-mainnet)
    echo "ERROR: production/mainnet deployment is refused by this script." >&2
    exit 1
    ;;
esac

echo "Verifying artifact provenance before deploy..."
node "${ROOT}/scripts/verify-artifact-provenance.mjs" --strict "${MANIFEST}"

echo "Deploying CryptaraPolicy to ${NETWORK}..."
cd "${ROOT}/backend/contracts"
npx hardhat run scripts/deploy-policy.ts --network "${NETWORK}"

echo "Deployment complete. No secrets in output."
