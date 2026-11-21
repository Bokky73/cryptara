# Soroban Storage Lifetime Diagnostics

Soroban state entries (ContractData and ContractCode) are subject to Stellar's State Archival lifecycle. Entries must maintain an active Time-To-Live (TTL) to remain accessible to smart contracts and client queries.

Cryptara provides storage lifetime diagnostics to monitor, diagnose, and extend ledger entry lifetimes without risking unverified state mutations.

---

## Storage Durability Tiers

| Durability | Archival Behavior | Recovery Path | Best Used For |
|---|---|---|---|
| **Instance** | Tied to contract instance; archived when contract expires | Restorable via `restoreFootprintOp` | Contract admin, configuration, global counters |
| **Persistent** | Survives beyond single invocation; subject to archival after live-until ledger | Restorable via `restoreFootprintOp` | Balances, audit logs, risk records, published reports |
| **Temporary** | Automatically deleted upon expiry; **never archived** | **Non-recoverable** (permanent deletion) | Nonces, transient rate limits, ephemeral session proofs |

> [!WARNING]
> Temporary storage cannot be restored once expired. Only Persistent and Instance entries can be restored from the archive.

---

## Diagnostic Inspection Workflow

The Storage Lifetime Inspector accepts SDK-decodable ledger-key XDR values and inspects them against the active Stellar RPC endpoint without enumerating complete storage.

### 1. Querying Storage Lifetime via API

```bash
curl -X POST https://api.cryptara.com/api/stellar/storage-lifetime \
  -H "Content-Type: application/json" \
  -d '{
    "network": "stellar:pubnet",
    "keys": ["AAAAFA=="]
  }'
```

### 2. Interpreting Diagnostic Output

Each entry result returns:
- `currentLedger`: Current ledger sequence number observed on-chain.
- `liveUntilLedger`: Boundary ledger sequence up to which the entry remains live.
- `ledgersRemaining`: Number of ledgers until archival (`liveUntilLedger - currentLedger`).
- `estimatedTimeRemaining`: Calculated wall-clock duration based on the canonical 5-second ledger cadence.
- `status`:
  - `LIVE_HEALTHY`: > 100,000 ledgers remaining (~5.7 days).
  - `EXPIRING_SOON`: < 40,960 ledgers remaining (~2.3 days). Action required.
  - `ARCHIVED`: Entry has passed the live-until boundary. Must be restored before reads succeed.

---

## Practical Restoration and Extension Runbook

### 1. Extending Active Entries (TTL Extension)

Active entries should have their TTL extended before they cross into the archived state.

Using the Stellar CLI:

```bash
# Extend contract instance TTL to 500,000 ledgers (~28 days)
stellar contract extend \
  --id <CONTRACT_ADDRESS> \
  --durability persistent \
  --ledgers-to-extend 500000 \
  --source <OPERATOR_SECRET_OR_IDENTITY> \
  --network testnet
```

Programmatically using Soroban SDK / RPC:
- Assemble an `ExtendFootprintTTLOp` transaction with:
  - `readOnly` footprint containing the target ledger keys.
  - `extendTo`: Target ledger sequence (e.g. `currentLedger + 500_000`).

### 2. Restoring Archived Entries

If a Persistent entry has reached its live-until boundary without renewal, contract invocations referencing the key fail with `HostError(Error(Storage, MissingValue))`.

Using the Stellar CLI:

```bash
# Restore archived contract data
stellar contract restore \
  --id <CONTRACT_ADDRESS> \
  --durability persistent \
  --key-xdr <BASE64_KEY_XDR> \
  --source <OPERATOR_SECRET_OR_IDENTITY> \
  --network testnet
```

Programmatically using Soroban SDK / RPC:
- Assemble a `RestoreFootprintOp` transaction with:
  - `readWrite` footprint containing the archived ledger keys.
  - Sufficient resource fee for archival restoration storage charges.

---

## Safety and Operational Rules

1. **Preflight Validation**: Cryptara's diagnostic API validates ledger key XDR, rejects cross-contract data keys, and enforces a maximum of 20 keys per inspection request.
2. **Never Infer Archival from Network Errors**: A missing RPC response or timeout does not prove an entry is archived. Always verify RPC connectivity before triggering restore operations.
3. **Automated Monitoring**: Run scheduled health checks to alert whenever any production contract instance has fewer than 50,000 ledgers remaining.
