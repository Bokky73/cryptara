#!/usr/bin/env bash
set -euo pipefail

# Deploy Risk Registry to Stellar Testnet
# Usage: ./scripts/deploy-testnet.sh [--dry-run] [--no-wasm]
#
# --dry-run  Validate inputs and compiled artifact without broadcasting.
# --no-wasm  Skip the Cargo build step (artifact must already exist).

NETWORK="testnet"
RPC_URL="https://soroban-testnet.stellar.org"
DRY_RUN=0
NO_WASM=0

for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=1 ;;
    --no-wasm) NO_WASM=1 ;;
    *) echo "Unknown argument: ${arg}" >&2; exit 1 ;;
  esac
done

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}═══ Risk Registry Deployment ═══${NC}"
echo "Network:  ${NETWORK}"
echo "RPC URL:  ${RPC_URL}"
if [ "${DRY_RUN}" -eq 1 ]; then
  echo "Mode:     DRY RUN (no transactions will be broadcast)"
fi
echo ""

# --- Build optimized WASM ------------------------------------------------

WASM_PATH="target/wasm32-unknown-unknown/release/cryptara_risk_registry.wasm"

if [ "${NO_WASM}" -eq 0 ]; then
  echo -e "${BLUE}Installing WASM target for reproducible build...${NC}"
  rustup target add wasm32-unknown-unknown 2>&1
  echo -e "${BLUE}Building optimized WASM (locked)${NC}"
  cargo build --locked --release --target wasm32-unknown-unknown --package cryptara-risk-registry 2>&1
  echo -e "${GREEN}WASM built: ${WASM_PATH}${NC}"
fi

# --- Artifact validation -------------------------------------------------

if [ ! -f "${WASM_PATH}" ]; then
  echo "ERROR: WASM artifact not found: ${WASM_PATH}" >&2
  echo "       Run without --no-wasm, or build manually with cargo." >&2
  exit 1
fi

echo "WASM size: $(wc -c < "${WASM_PATH}") bytes"
echo "SHA256:    $(sha256sum "${WASM_PATH}" | cut -d' ' -f1)"
echo ""

# --- Dry-run exit point --------------------------------------------------

if [ "${DRY_RUN}" -eq 1 ]; then
  echo "dry-run: wasm artifact OK: ${WASM_PATH}"
  echo "dry-run: would deploy to network=${NETWORK} rpc=${RPC_URL}"
  echo "dry-run complete — no transaction broadcast."
  exit 0
fi

# --- Install soroban-cli if not present ----------------------------------

if ! command -v soroban >/dev/null 2>&1; then
  echo "Installing soroban-cli..."
  cargo install soroban-cli --locked 2>&1 | tail -3
fi

# --- Identity setup ------------------------------------------------------

IDENTITY="risk-registry-admin"
if ! soroban config identity ls 2>&1 | grep -q "${IDENTITY}"; then
  echo "Creating identity: ${IDENTITY}"
  soroban config identity generate "${IDENTITY}"
fi

ADMIN_ADDRESS="$(soroban config identity address "${IDENTITY}")"
echo "Admin address: ${ADMIN_ADDRESS}"
echo ""

# --- Deploy contract -----------------------------------------------------

echo -e "${BLUE}Deploying contract...${NC}"
CONTRACT_ID="$(soroban contract deploy \
  --network "${NETWORK}" \
  --source "${IDENTITY}" \
  --wasm "${WASM_PATH}")"
echo -e "${GREEN}Contract ID: ${CONTRACT_ID}${NC}"
echo ""

# --- Initialize contract -------------------------------------------------

INITIAL_PUBLISHERS="${ADMIN_ADDRESS}"
echo -e "${BLUE}Initializing contract...${NC}"
soroban contract invoke \
  --network "${NETWORK}" \
  --source "${IDENTITY}" \
  --id "${CONTRACT_ID}" \
  -- \
  initialize \
  --admin "${ADMIN_ADDRESS}" \
  --publishers "[${INITIAL_PUBLISHERS}]"
echo -e "${GREEN}Contract initialized${NC}"
echo ""

# --- Summary -------------------------------------------------------------

echo -e "${BLUE}═══ Deployment Summary ═══${NC}"
echo "Network:        ${NETWORK}"
echo "Admin:          ${ADMIN_ADDRESS}"
echo "Contract ID:    ${CONTRACT_ID}"
echo "RPC URL:        ${RPC_URL}"
echo ""
echo "Verification:"
echo "  soroban contract read --network ${NETWORK} --id ${CONTRACT_ID} --key admin"
echo "  soroban contract invoke --network ${NETWORK} --id ${CONTRACT_ID} -- is_publisher --publisher ${ADMIN_ADDRESS}"
echo ""
echo "Bindings:"
echo "  soroban contract bindings ts --network ${NETWORK} --id ${CONTRACT_ID} --output-dir bindings/risk-registry"
echo ""
