# Operator Privacy Procedures, Retention Policy, and Erasure Workflow

This document covers the operational procedures, per-table retention policies,
scheduled purge mechanics, the full erasure workflow, and tamper-evident
receipt verification for Cryptara maintainers and operators.

---

## 1. Stored Data Inventory & Retention Policy Matrix

Every product table that holds wallet-linked data has a declared retention
policy in `frontend/src/server/privacy/retention/policy.ts`. The table below
is the human-readable summary; the code is the authoritative source.

| Table | Retention | Strategy | Wallet Columns | Chain-Scoped | Legal Basis |
|---|---|---|---|---|---|
| `wallets` | Account lifetime | Hard delete | `address` | No | GDPR Art.17 right to erasure |
| `agent_runs` | 90 days† | Hard delete | `wallet_address` | No | Operational necessity — dispute resolution |
| `agent_results` | 90 days | Cascade delete | — | No | Cascade from `agent_runs` |
| `source_snapshots` | 90 days | Cascade delete | — | No | Cascade from `agent_runs` |
| `recommendations` | 90 days† | Hard delete | `wallet_address` | No | Same window as agent_runs |
| `approvals` | 180 days | Hard delete | `wallet_address` | **Yes** | Post-trade dispute resolution |
| `transactions` | 365 days† | **Anonymize** | `wallet_address`, `source_account` | **Yes** | Financial audit compliance (GDPR Recital 26) |
| `x402_payment_receipts` | 1095 days† (3 yr) | **Anonymize** | `wallet_address`, `payer` | **Yes** | Accounting audit compliance |
| `user_rules` | Account lifetime | Hard delete | `wallet_address` | No | User preference — no independent retention |
| `alert_rules` | Account lifetime | Hard delete | `wallet_address` | No | Cascade deletes alerts + deliveries |
| `alert_observations` | 30 days† | Hard delete | `wallet_address` | No | Signal deduplication window |
| `alerts` | 90 days† | Hard delete | `wallet_address` | No | Notification history |
| `alert_deliveries` | 90 days† | Cascade delete | `wallet_address` | No | Delivery audit log |
| `watchlist_entries` | Account lifetime | Hard delete | `wallet_address` | No | Cascade deletes scan runs |
| `watchlist_scan_runs` | 90 days† | Hard delete | `wallet_address` | No | Operational history |
| `discovery_alerts` | 90 days† | Hard delete | `wallet_address` | No | Discovery notification history |
| `recovery_requests` | 365 days | Hard delete | `wallet_address` | **Yes** | Emergency audit trail |
| `risk_snapshots` | — | Excluded | — | No | Public, no personal data |
| `token_identities` | — | Anonymize | `wallet_address` | No | Token data is not personal |
| `erasure_receipts` | Permanent | Excluded | — | No | One-way hash only; compliance proof |

† = overridable via environment variable (see Section 2)

**Strategy definitions:**
- **Hard delete** — the row is removed; referential integrity via `ON DELETE CASCADE`
- **Anonymize** — identity columns are set to `NULL`; the row is preserved for aggregate history
- **Excluded** — the table is not wallet-scoped and is not touched by erasure

---

## 2. Retention Configuration Environment Variables

```bash
# Agent runs and evaluation telemetry retention (days)
RETENTION_AGENT_RUNS_DAYS=90

# Alert engine raw signal observation retention (days)
RETENTION_ALERT_OBSERVATIONS_DAYS=30

# Alert history notification retention (days)
RETENTION_ALERTS_DAYS=90

# Watchlist scan run history retention (days)
RETENTION_WATCHLIST_RUNS_DAYS=90

# Execution audit transaction anonymization threshold (days)
RETENTION_TRANSACTIONS_UNLINK_DAYS=365

# X402 payment receipt anonymization threshold for accounting audit compliance (days)
RETENTION_X402_RECEIPTS_UNLINK_DAYS=1095
```

---

## 3. Scheduled Purge

The retention purge deletes or anonymizes expired records in bounded batches
without acquiring long-running table locks.

### Running the purge

```bash
# Production (requires DATABASE_URL)
DATABASE_URL=postgres://... npm run retention:purge

# Dry run — shows what would be purged without deleting
DRY_RUN=true npm run retention:purge:dry

# Root package.json shortcuts
npm run retention:purge
npm run retention:purge:dry
```

### How it works

1. **In-memory pass**: filters every in-memory global store, removing or
   anonymizing records whose timestamp has passed the retention cutoff.
2. **Postgres batch pass**: issues `DELETE`/`UPDATE` statements with a
   `LIMIT $batchSize` clause. The loop repeats until fewer than `batchSize`
   rows remain, preventing any single statement from running for more than
   a few milliseconds.

```
Default batch size: 500 rows per statement
Override: PURGE_BATCH_SIZE=200 node scripts/retention-purge.mjs
```

### Purge tables and timestamp columns

| Table | Timestamp column | Action |
|---|---|---|
| `agent_runs` | `created_at` | DELETE |
| `alert_observations` | `created_at` | DELETE |
| `alerts` | `triggered_at` | DELETE |
| `watchlist_scan_runs` | `scanned_at` | DELETE |
| `transactions` | `created_at` | NULL identity columns |
| `x402_payment_receipts` | `created_at` | NULL identity columns |

### Recommended cron schedule

```cron
# Run nightly at 02:00 UTC
0 2 * * * DATABASE_URL="${DATABASE_URL}" node /app/scripts/retention-purge.mjs >> /var/log/cryptara/purge.log 2>&1
```

---

## 4. Full Wallet Erasure Workflow

When a user requests deletion of their account, the server runs a full
structured erasure that:

1. **Walks every table** containing wallet identity (per the policy matrix)
2. **Hard-deletes** rows from delete-strategy tables immediately
3. **Anonymizes** rows in audit-preserved tables (sets identity columns to `NULL`)
4. **Evicts** the in-memory portfolio cache for the wallet
5. **Runs the residue check** to assert zero identity leaks
6. **Emits a tamper-evident erasure receipt** the requester can independently verify

### Chain scoping

Erasing an EVM wallet (`0x…`) never touches records belonging to a Stellar
wallet (`G…`) even if both wallets were active in the same session. Each
erasure request carries an explicit `chainFamily` so scoped tables
(`approvals`, `transactions`, `x402_payment_receipts`) are filtered
correctly.

### API endpoints

```
DELETE /api/wallet-privacy/delete?walletAddress=0x...
POST   /api/wallet-privacy/delete          { walletAddress, chainFamily, network }
POST   /api/wallet-privacy/erasure-receipt { receipt: { body, sha256 } }
```

The delete endpoint returns:

```json
{
  "ok": true,
  "deletedAt": "2026-08-29T04:00:00.000Z",
  "walletAddress": "0x...",
  "chainFamily": "evm",
  "memoryRecordsRemoved": 42,
  "memoryAuditRecordsUnlinked": 3,
  "portfolioCacheEvicted": 1,
  "pgResult": { "deletedCount": 38, "unlinkedAuditCount": 3 },
  "residueCheckPassed": true,
  "receipt": {
    "body": {
      "version": 1,
      "receiptId": "er_abc123_1",
      "walletHash": "e3b0c44298fc1c149afbf4c8996fb924...",
      "chainFamily": "evm",
      "erasedAt": "2026-08-29T04:00:00.000Z",
      "tables": [...],
      "totalDeleted": 42,
      "totalAnonymized": 3,
      "residueCheckPassed": true
    },
    "sha256": "7f83b1657ff1fc53b92dc18148a1d65..."
  }
}
```

On partial failure (e.g. PG unreachable):
```json
{ "ok": false, "partialFailure": true, "retryable": true, ... }
```

Retrying the request safely re-runs all erasure steps idempotently.

---

## 5. Erasure Receipt Verification

The erasure receipt proves that a deletion completed and records exactly what
was removed. The proof does not require trusting the server.

### Receipt structure

- `body.walletHash` — one-way SHA-256 of the wallet address (never the raw address)
- `body.tables[]` — per-table report: `action`, `rowsAffected`, `strategy`
- `body.residueCheckPassed` — whether the server's own residue scan found zero leaks
- `sha256` — SHA-256 of the canonical (sorted-key) serialization of `body`

### Verifying a receipt

```bash
# Via API
curl -X POST /api/wallet-privacy/erasure-receipt \
  -H 'Content-Type: application/json' \
  -d '{ "receipt": <receipt object from delete response> }'

# Returns:
# { "valid": true, "issues": [], "computedSha256": "...", "storedSha256": "..." }
```

```typescript
import { verifyErasureReceipt } from "@/server/privacy/retention/receipt";

const result = verifyErasureReceipt(receipt);
// result.valid === true  →  receipt is intact
// result.issues          →  ["SHA-256 mismatch: ..."] if tampered
```

Any change to `body` (including re-ordering keys) will produce a different
SHA-256 and fail verification — the receipt cannot be forged silently.

---

## 6. Residue Check

After erasure, operators can assert that no wallet identity survives in any store.

### Running the residue check

```bash
# Full lifecycle: seed → erase → residue check (both EVM + Stellar)
npm run test:erasure-residue

# Or via the frontend package
cd frontend && npm run test:erasure-residue
```

The script (`frontend/scripts/erasure-residue-check.ts`):
1. Seeds an EVM and a Stellar wallet across every product table
2. Runs `eraseWalletData` for each
3. Calls `checkErasureResidue` to assert zero leaks
4. Verifies chain isolation (erasing EVM does not remove Stellar records)
5. Verifies aggregate preservation (transaction rows survive, identity stripped)
6. Tests receipt tamper detection (mutated body fails SHA-256 check)

---

## 7. Operator Execution Procedures

### 7.1 Data Export

```
GET  /api/wallet-privacy/export?walletAddress=0x...
POST /api/wallet-privacy/export   { walletAddress, chainFamily, network }
```

Returns a portable JSON document containing all user-bound records across
memory adapters and Postgres. The format is stable and unchanged from V1.

### 7.2 Deletion / Erasure

```
DELETE /api/wallet-privacy/delete?walletAddress=0x...
POST   /api/wallet-privacy/delete  { walletAddress, chainFamily, network }
```

See Section 4 for full response format and retry behaviour.

### 7.3 Audit Bundle Export

```
POST /api/wallet-privacy/audit-export  { walletAddress, chainFamily, network }
```

Returns a redacted, verifiable audit bundle (no raw wallet, no strategy data,
no signed XDR). Unchanged from V1.

---

## 8. User-Facing Disclosures

### 8.1 Onchain Ledger Immutability

Cryptara cannot alter or delete transaction records, smart contract
interactions, or balances recorded on public blockchain ledgers (EVM
mainnet/testnets or Stellar pubnet/testnet). These are public, immutable records.

### 8.2 Financial & Accounting Audit Compliance

`x402_payment_receipts` and `transactions` are preserved with identity
columns irreversibly NULL-ed. Amount, asset, and transaction hash survive
without personal linkage. This is per GDPR Recital 26 (anonymized data is
no longer personal data) and financial record-keeping requirements.

---

## 9. Verification

```bash
# Full quality gate (includes lint, build, and existing test suite)
npm run quality:gate

# Erasure residue check (seed + erase + assert)
npm run test:erasure-residue

# Existing privacy lifecycle check
npm run test:privacy

# Retention purge dry run
npm run retention:purge:dry
```

### Verification acceptance criteria

| Criterion | Verification command |
|---|---|
| Every table has a declared retention policy | `test:erasure-residue` (prints policy catalogue) |
| Purge deletes in bounded batches | `retention:purge:dry` (logs per-table counts) |
| Erasure removes/anonymizes all wallet identity | `test:erasure-residue` (zero leaks asserted) |
| Aggregate records survive with no identity | `test:erasure-residue` (transaction row count check) |
| Erasure receipt is verifiable | `test:erasure-residue` (SHA-256 round-trip + tamper test) |
| EVM erase does not affect Stellar wallet | `test:erasure-residue` (chain isolation assertion) |

---

## 10. Rollback Procedure

- No schema migration destroys data. The `erasure_receipts` table is
  append-only (immutability trigger prevents updates).
- `transactions` and `x402_payment_receipts` anonymization sets columns to
  `NULL` — this is irreversible by policy intent.
- All other purge operations are standard row deletions; re-seeding is
  required for testing after a destructive run.
- The `erasure_receipts` rows are retained permanently as compliance proof.

---

## 11. Source Files Reference

| File | Purpose |
|---|---|
| `frontend/src/server/privacy/retention/policy.ts` | Per-table retention policy declarations |
| `frontend/src/server/privacy/retention/purge.ts` | Bounded-batch scheduled purge |
| `frontend/src/server/privacy/retention/erase.ts` | Full wallet erasure orchestrator |
| `frontend/src/server/privacy/retention/residue.ts` | Residue check (post-erasure scan) |
| `frontend/src/server/privacy/retention/receipt.ts` | Tamper-evident receipt generation + verification |
| `frontend/src/server/storage/schema.sql` | `erasure_receipts` table + `retention_policy_summary` view |
| `frontend/src/app/api/wallet-privacy/delete/route.ts` | Erasure API with receipt |
| `frontend/src/app/api/wallet-privacy/erasure-receipt/route.ts` | Receipt verification API |
| `scripts/retention-purge.mjs` | Cron-ready purge runner (Postgres batch deletes) |
| `frontend/scripts/erasure-residue-check.ts` | End-to-end erasure verification script |
