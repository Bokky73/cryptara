# Operator Privacy & Data Retention Procedures

Cryptara enforces strict privacy-by-design standards. The application stores only the minimum operational state required to provide token risk intelligence and does not track users, correlate wallet identities, or retain stale execution histories indefinitely.

---

## 1. Automated Retention Purge Schedule

Production databases enforce automated data purge cycles via `.github/workflows/retention-purge.yml`, executing daily at 02:00 UTC.

### Retention Windows & Thresholds

| Table / Entity | Retention Period | Action Taken |
|---|---|---|
| `agent_runs` | 30 days | Hard DELETE of records older than cutoff |
| `alert_observations` | 14 days | Hard DELETE of expired observation points |
| `alerts` | 60 days | Hard DELETE of resolved/acknowledged alerts |
| `watchlist_scan_runs` | 14 days | Hard DELETE of intermediate scan iterations |
| `transactions` | 90 days | Anonymization / unlinking of wallet identifiers |
| `x402_payment_receipts`| 90 days | Unlinking of payer IP/network metadata |

---

## 2. Operator Manual & Dry-Run Execution

Operators can verify pending purges without affecting production data:

```bash
# Run in dry-run mode (read-only audit logging)
npm run retention:purge:dry

# Run live purge manually
DATABASE_URL=postgres://... npm run retention:purge
```

Exit codes:
- `0`: Purge executed successfully.
- `1`: Fatal database connection or authentication error.
- `2`: Partial failure on secondary tables (logged for audit).

---

## 3. Compliance & Audit Logging

Every purge run outputs a structured JSON log containing:
- Execution timestamp (UTC)
- Count of deleted rows per table
- Elapsed query duration
- Remaining row count estimates

Logs are preserved in the CI run history for compliance auditing.
