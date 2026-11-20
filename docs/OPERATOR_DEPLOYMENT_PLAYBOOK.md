# Operator Production Deployment & Hardening Playbook

This playbook provides step-by-step procedures for deploying, hardening, and verifying Cryptara in production environments across Vercel, Supabase/PostgreSQL, Stellar Soroban, and EVM.

---

## 1. Vercel Frontend Deployment

### Pre-Deployment Quality Gate
Every production deployment must pass the local quality gate:
```bash
npm run quality:gate
```

### Environment Configuration
Configure required environment variables in the Vercel dashboard:
- `NODE_ENV=production`
- `APP_MODE=production`
- `NEXT_PUBLIC_APP_URL=https://cryptara.com`
- `STELLAR_RPC_URL=https://mainnet.sorobanrpc.com`
- `STELLAR_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015`
- `GOPLUS_API_KEY=<SECRET>`
- `DATABASE_URL=postgres://...`

### Verification
Run production deploy check:
```bash
npm run deploy:check --prefix frontend
```

---

## 2. Supabase / PostgreSQL Hardening

1. **Connection Pooling**: Use Supavisor connection pooling (port 6543) for serverless functions.
2. **Row-Level Security (RLS)**: Enforce RLS on all tables (`agent_runs`, `watchlist_scan_runs`, `alerts`).
3. **Data Retention**: Run `scripts/retention-purge.mjs` on a daily schedule to purge unlinked data older than retention thresholds.

---

## 3. Smart Contract Verification

- **Soroban Contracts**: Verify contract WASM hashes against pinned release tags before publishing.
- **EVM Contracts**: Verify deployed contracts on Etherscan/Basescan using Hardhat verification plugins.
