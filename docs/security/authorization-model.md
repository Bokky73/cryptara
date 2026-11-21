# Route-by-Route Authorization Matrix & Threat Boundaries

Cryptara enforces a multi-tier, zero-trust authorization architecture. Key invariants:
1. `serverCanSign: false` is enforced globally.
2. The server never has access to, transmits, or generates private keys.
3. Every mutating onchain action requires explicit cryptographic signatures from the user's wallet.

---

## 1. Route Authorization Matrix

| Endpoint / Route | HTTP Method | Auth Requirement | Security Guard / Invariant |
|---|---|---|---|
| `/api/scan/token` | POST | Public | Rate-limited per IP; deterministic analysis only |
| `/api/scan/deep` | POST | x402 Payment | Validates amount, recipient, tx hash, anti-replay nonces |
| `/api/execute/prepare` | POST | Wallet Session | Rejects wallet/chain mismatch; builds unsigned payload |
| `/api/execute/confirm` | POST | User Signature | Verifies EIP-712 or Stellar op signature; non-custodial |
| `/api/portfolio/summary`| GET | Connected Wallet | Scoped strictly to requested wallet; no cross-tenant reads |
| `/api/watchlist/*` | ALL | User Auth (Cookie/JWT)| Row-Level Security (RLS) isolation per user |
| `/api/health` | GET | Public | Exposes liveness without revealing internal credentials |
| `/api/dev/*` | POST | Test Mode Only | Disabled in production (`APP_MODE !== 'test'`) |

---

## 2. Threat Boundaries & Fail-Closed Behavior

- **Wallet Mismatch**: If the user's active wallet address does not match the session proof, all execution requests immediately abort.
- **Watcher Registry Health**: Audit and Access Registries (AR) must verify that Watcher Registries (WR) contain active authorized watchers before accepting registration to prevent total reader lockout.
