# Low-Value Smoke Test Procedure

> Purpose: Quick verification that the deployed system is functional.
> Performed after: Every deploy, DNS change, or configuration update.
> Duration: < 5 minutes.
> Cost: < 0.01 ETH / < 1 XLM.

## Prerequisites

- [ ] Test wallet funded with small amount of ETH (0.01) and XLM (1)
- [ ] `SMOKE_TEST_WALLET` environment variable set
- [ ] Policy contract address available as `POLICY_ADDRESS`
- [ ] Vault contract address available as `VAULT_ADDRESS`
- [ ] Simulate endpoint healthy

## Step 1: Health check

```bash
curl -s https://app.cryptara.xyz/api/health | jq .

# Expected response:
# {"status":"ok","timestamp":"<ISO>","version":"1.0.0"}
```

## Step 2: Simulation smoke test

```bash
curl -s -X POST https://app.cryptara.xyz/api/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "chainId": 1,
    "tokenIn": "USDC",
    "tokenOut": "ETH",
    "amount": "0.01",
    "userAddress": "'"$SMOKE_TEST_WALLET"'"
  }' | jq .

# Expected: SimulationResult with non-null quote, valid expiry
# Assert: .status == "completed" (or "success")
# Assert: .quote is not null
# Assert: .expiry > now()
```

## Step 3: Policy contract check

```bash
# EVM
cast call $POLICY_ADDRESS "VERSION()(string)" --rpc-url $RPC_URL
# Expected: "1.0.0"

# Soroban
stellar contract invoke \
  --id $POLICY_SOROBAN_ID \
  --network testnet \
  --source $SMOKE_TEST_SECRET \
  -- \
  version
# Expected: "1.0.0" (or equivalent string)
```

## Step 4: Vault contract check

```bash
cast call $VAULT_ADDRESS "policy()(address)" --rpc-url $RPC_URL
# Expected: $POLICY_ADDRESS
```

## Step 5: x402 payment flow (if applicable)

```bash
node scripts/smoke-api.mjs --url https://app.cryptara.xyz --wallet $SMOKE_TEST_WALLET
# Expected: Exit code 0
```

## Step 6: UI smoke test

- [ ] Open app URL in browser
- [ ] Verify wallet connection works
- [ ] Initiate a simulation from UI
- [ ] Verify results display
- [ ] Verify no console errors

## Success criteria (ALL must pass)

- [ ] Health endpoint returns 200
- [ ] Simulation returns valid quote
- [ ] Contract VERSION matches expected
- [ ] Vault points to correct policy
- [ ] x402 flow passes (if applicable)
- [ ] UI loads without errors

## If any step fails

| Step | Action |
|---|---|
| Health check | Check deployment status, revert to previous build |
| Simulation | Check RPC keys, verify simulation backend |
| Contract version | Re-deploy contracts or rollback |
| Vault policy address | Re-configure vault or re-deploy |
| x402 flow | Check payment provider config |
| UI | Check build, CDN, DNS |
