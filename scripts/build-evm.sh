#!/usr/bin/env bash
set -euo pipefail

# Reproducible EVM build.
# Pinned: Solidity 0.8.24, Hardhat, evmVersion paris, viaIR, optimizer runs=200
# npm lifecycle scripts stay disabled until the dependency policy has reviewed
# them explicitly.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_DIR="${ROOT_DIR}/backend/contracts"

echo "=== EVM Reproducible Build ==="
echo "Compiler: Solidity 0.8.24 (Hardhat)"
echo "EVM target: paris"
echo "Settings: viaIR=true, optimizer runs=200"
echo ""

cd "${CONTRACTS_DIR}"

if [ ! -f package-lock.json ]; then
  echo "ERROR: backend/contracts/package-lock.json missing; use a locked install" >&2
  exit 1
fi

npx --no-install hardhat clean
npx --no-install hardhat compile

ARTIFACT="artifacts/contracts/CryptaraPolicy.sol/CryptaraPolicy.json"
if [ ! -f "$ARTIFACT" ]; then
  echo "ERROR: expected Hardhat artifact was not generated: $ARTIFACT" >&2
  exit 1
fi

# Supply-chain build provenance (dependency-policy governed manifest).
ARTIFACTS=()
while IFS= read -r artifact; do
  ARTIFACTS+=("$artifact")
done < <(find artifacts/contracts -type f -name '*.json' ! -name '*.dbg.json' | LC_ALL=C sort)
node "$ROOT_DIR/scripts/verify-build-provenance.mjs" create evm "${ARTIFACTS[@]}"
node "$ROOT_DIR/scripts/verify-build-provenance.mjs" verify evm

hash_file() {
  local file="$1"
  if command -v sha256sum &> /dev/null; then
    sha256sum "$file" | cut -d' ' -f1
  else
    shasum -a 256 "$file" | cut -d' ' -f1
  fi
}

hash_creation_bytecode() {
  local artifact="$1"
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    const art = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const hex = String(art.bytecode || "").replace(/^0x/, "");
    const meta = typeof art.metadata === "string" ? art.metadata : JSON.stringify(art.metadata || {});
    const creation = crypto.createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex");
    const metadata = crypto.createHash("sha256").update(meta).digest("hex");
    process.stdout.write(`${creation} ${metadata}`);
  ' "$artifact"
}

echo "=== Build Verification (creation bytecode + metadata) ==="
for ARTIFACT in \
  "artifacts/contracts/CryptaraPolicy.sol/CryptaraPolicy.json" \
  "artifacts/contracts/CryptaraVault.sol/CryptaraVault.json" \
  "artifacts/contracts/CryptaraAudit.sol/CryptaraAudit.json"
do
  if [ -f "$ARTIFACT" ]; then
    read -r CREATION_HASH METADATA_HASH < <(hash_creation_bytecode "$ARTIFACT")
    FILE_HASH="$(hash_file "$ARTIFACT")"
    echo "$(basename "$(dirname "$ARTIFACT")"): creation=${CREATION_HASH} metadata=${METADATA_HASH} json=${FILE_HASH}"
  fi
done

echo ""
echo "To verify reproducibility:"
echo "  1. git checkout <commit>"
echo "  2. ./scripts/build-evm.sh"
echo "  3. Compare creation bytecode hashes with CI/reference build"
echo "  4. npm run provenance:freeze -- --release && npm run provenance:verify:artifacts -- --strict"
echo ""
echo "Build complete."
