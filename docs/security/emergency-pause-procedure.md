# Emergency Pause Procedure

> **Owner**: Lead Maintainer (on-call)
> **Goal**: Pause the system within 2 minutes of detecting a critical issue.

## When to trigger emergency pause

- Active security incident (exploit, hack, unauthorised access)
- Critical vulnerability discovered in policy/vault contracts
- x402 payment provider breach or key compromise
- Infrastructure compromise (host, cloud provider, RPC)
- Unusual on-chain activity suggesting active exploit (e.g., unexpected large withdrawals)

## Who can trigger

- Any maintainer can trigger emergency pause
- No approval needed — **err on the side of pausing**
- Follow-up: Notify second maintainer within 5 minutes

## Quick-reference commands

### EVM contracts

```bash
# Policy contract
cast send <POLICY_ADDRESS> "emergencyPause()" --rpc-url <RPC_URL> --private-key <ADMIN_KEY>

# Vault contract
cast send <VAULT_ADDRESS> "pause()" --rpc-url <RPC_URL> --private-key <ADMIN_KEY>
```

### Soroban contracts

```bash
stellar contract invoke \
  --id <POLICY_CONTRACT_ID> \
  --network mainnet \
  --source <ADMIN_SECRET_KEY> \
  -- \
  emergency_pause

stellar contract invoke \
  --id <VAULT_CONTRACT_ID> \
  --network mainnet \
  --source <ADMIN_SECRET_KEY> \
  -- \
  pause
```

### Frontend / API

Feature-flags (if implemented):
```bash
curl -X POST https://app.cryptara.xyz/admin/feature-flag \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"flag": "app_enabled", "value": false}'
```

## What happens when paused

| Component | Behaviour |
|---|---|
| EVM Policy Contract | All `checkPolicy` calls return `Rejected` with reason `EmergencyPaused` |
| EVM Vault Contract | All `deposit`/`withdraw` calls revert |
| Soroban Policy Contract | All `check_policy` calls return `PolicyDecision::Rejected` |
| Soroban Vault Contract | All `deposit`/`withdraw` calls fail |
| Frontend | Execution flow disabled; simulation still allowed (read-only) |
| API | POST to `/api/execute` returns 503 with body `{ "status": "paused" }` |
| Agents | Withdraw/execution agent tasks rejected; analysis agents continue |

## Post-pause actions

### Immediate (first 15 minutes)
1. [ ] Confirm pause was effective (check contract state)
2. [ ] Notify second maintainer
3. [ ] Determine severity and plan
4. [ ] Start incident documentation

### Short-term (first 24 hours)
1. [ ] Deploy fix or rollback
2. [ ] Test fix on testnet
3. [ ] Schedule resume with maintainer approval

### Resume procedure

```bash
# EVM: resume policy
cast send <POLICY_ADDRESS> "resume()" --rpc-url <RPC_URL> --private-key <ADMIN_KEY>

# EVM: unpause vault
cast send <VAULT_ADDRESS> "unpause()" --rpc-url <RPC_URL> --private-key <ADMIN_KEY>

# Soroban: resume
stellar contract invoke \
  --id <POLICY_CONTRACT_ID> \
  --network mainnet \
  --source <ADMIN_SECRET_KEY> \
  -- \
  resume

# Soroban: unpause vault
stellar contract invoke \
  --id <VAULT_CONTRACT_ID> \
  --network mainnet \
  --source <ADMIN_SECRET_KEY> \
  -- \
  unpause
```

## Preparation (before mainnet)

- [ ] Admin private key stored in secure vault (e.g., 1Password, AWS Secrets Manager, hardware wallet)
- [ ] Admin key accessible by at least 2 maintainers (different locations)
- [ ] Cast CLI available on on-call workstation(s)
- [ ] Stellar CLI (`stellar`) installed and configured
- [ ] Emergency pause runbook printed (this document)
- [ ] Emergency contacts list updated and accessible offline
