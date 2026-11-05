# Mainnet Deploy Procedure

> **Owner**: Lead Maintainer
> **Approval required**: Production-hardening sign-off (see `production-hardening-signoff.md`)
> **Rollback plan**: See `rollback-procedure.md`

## Pre-flight checklist

### Governance
- [ ] Security audit completed (external firm) — all HIGH/CRITICAL findings resolved
- [ ] Production-hardening sign-off document signed
- [ ] Emergency contacts identified (at least 2 maintainers)
- [ ] Timing: deploy at least 1 hour before end of business day, NOT on Friday or before holidays
- [ ] Communications: internal announcement sent 24h prior

### Infrastructure
- [ ] Production environment provisioned (variables, secrets, RPC keys)
- [ ] Monitoring dashboards verified working
- [ ] Alerting configured (PagerDuty / Slack)
- [ ] Rate limiting configured for production scale
- [ ] x402 payment provider configured with production keys
- [ ] Logging sink configured (no PII logged)
- [ ] Database backups configured (if applicable)

### Code
- [ ] Release branch created from `main` (naming: `release/vX.Y.Z`)
- [ ] All CI checks green (lint, typecheck, unit test, integration test)
- [ ] Soak test passed (48h testnet, <2% error rate)
- [ ] Contract addresses verified:
  - [ ] EVM Policy contract on target chain
  - [ ] EVM Vault contract on target chain
  - [ ] Soroban Policy contract on target network
  - [ ] Soroban Vault contract on target network
- [ ] Frontend points to production API, not testnet RPCs
- [ ] `next.config.js` has `poweredByHeader: false`, `reactStrictMode: true`
- [ ] Build produces no warnings

### Contracts
- [ ] Policy contract deployed and verified on block explorer
- [ ] Vault contract deployed and verified
- [ ] Risk Registry contract deployed and verified
- [ ] Admin addresses set correctly (multi-sig? EOA?)
- [ ] `emergencyPause()` tested on testnet
- [ ] All `setUser*` functions tested
- [ ] Hash freeze manifest signed (see `hash-freeze-build.mjs`)

## Deployment steps

### Phase 1: Backend (Contracts)

```bash
# 1. Build contracts
cd backend/contracts
npx hardhat compile

# 2. Deploy policy contract
npx hardhat run scripts/deploy-policy.js --network mainnet

# 3. Verify on block explorer
npx hardhat verify --network mainnet <POLICY_ADDRESS>

# 4. Deploy vault contract (linking to policy)
npx hardhat run scripts/deploy-vault.js --network mainnet

# 5. Deploy risk registry
npx hardhat run scripts/deploy-risk-registry.js --network mainnet

# 6. Soroban: build and deploy
cd soroban
cargo build --target wasm32-unknown-unknown --release
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/cryptara_policy.wasm --network mainnet
```

### Phase 2: Frontend

```bash
# 1. Build
cd frontend
npm run build

# 2. Verify build
node scripts/hash-freeze-build.mjs

# 3. Deploy static assets to CDN / hosting provider
#    (provider-specific — e.g., Vercel, AWS S3+CloudFront, Railway)
npm run deploy
```

### Phase 3: Verification

```bash
# 1. Health check
curl https://app.cryptara.xyz/api/health

# 2. Smoke test (see low-value-smoke-test-procedure.md)
# 3. Verify contract interaction
cast call <POLICY_ADDRESS> "VERSION()(string)" --rpc-url $MAINNET_RPC
```

### Phase 4: DNS / Cutover

- [ ] Update DNS if deploying to new host
- [ ] Wait for DNS propagation (check with `dig`)
- [ ] Verify SSL certificate (https://www.ssllabs.com/ssltest/)
- [ ] Verify all external links resolve

### Phase 5: Post-deploy

- [ ] Monitoring: watch for 30 minutes after DNS change
- [ ] Alerting: verify alerts fire by triggering a test alert
- [ ] Announcement: publish deploy notice to users

## Success Criteria

- [ ] All endpoints return HTTP 200
- [ ] Contract introspection returns correct VERSION
- [ ] x402 payment flow end-to-end works
- [ ] Simulation returns valid results in < 5s
- [ ] No console errors in browser

## Rollback triggers

| Trigger | Action |
|---|---|
| Error rate > 5% in first 15 minutes | Rollback immediately |
| Contract interaction returns unexpected results | Rollback immediately |
| x402 payment provider returns errors | Failover to backup provider or rollback |
| DNS issues affecting > 10% of users | Rollback DNS or fix within 15 min |
