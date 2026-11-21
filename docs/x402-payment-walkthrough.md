# x402 Multi-Chain Payment Protocol Walkthrough & Testing Guide

Cryptara uses the **x402 protocol** to monetize premium Deep Scan analyses onchain. The integration spans two distinct virtual machines and settlement models:
- **EVM (Base / Ethereum)**: Powered by `@x402/evm` and Coinbase CDP Facilitator.
- **Stellar (Soroban / Classic)**: Powered by `frontend/src/server/x402/stellarScheme.ts` using SEP-41 USDC with 7 decimal precision.

This guide provides an end-to-end protocol walkthrough, handshake sequence, and local testing workflows for developers integrating or testing paid deep scans.

---

## 1. Protocol Handshake Sequence

```
Client                                      Cryptara Resource Server             Facilitator / Onchain
  │                                                    │                                   │
  │─── 1. POST /api/scan/deep (no payment) ───────────►│                                   │
  │                                                    │                                   │
  │◄── 2. HTTP 402 Payment Required ───────────────────│                                   │
  │       WWW-Authenticate: x402                       │                                   │
  │       Body: { price, payTo, network, asset }       │                                   │
  │                                                    │                                   │
  │─── 3. Settle payment on Base or Stellar ───────────┼──────────────────────────────────►│
  │                                                    │                                   │
  │◄── 4. Obtain signed receipt or tx hash ────────────┼───────────────────────────────────│
  │                                                    │                                   │
  │─── 5. POST /api/scan/deep ────────────────────────►│                                   │
  │       Headers:                                     │                                   │
  │         x-payment-signature: <sig>                 │─── 6. Verify settlement ─────────►│
  │         x-payment-tx-hash: <txHash>                │◄── 7. Valid settlement confirmed ─│
  │         x-payment-network: <caip2>                 │                                   │
  │                                                    │                                   │
  │◄── 8. HTTP 200 OK (Deep Scan Report) ──────────────│                                   │
  │       Body: { premium: { unlocked: true } }        │                                   │
```

---

## 2. EVM vs Stellar Payment Comparison

| Parameter | EVM (Base / Ethereum) | Stellar (Pubnet / Testnet) |
|---|---|---|
| **Network CAIP-2** | `eip155:8453` (Base) | `stellar:pubnet` or `stellar:testnet` |
| **Asset Identifier** | `USDC` (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) | Canonical SEP-41 USDC Contract |
| **Decimals** | 6 decimals | 7 decimals (`STELLAR_USDC_DECIMALS = 7`) |
| **Recipient Format** | `0x` prefixed, 40 hex chars (case-insensitive) | `G` prefixed StrKey, 56 chars (case-sensitive) |
| **Tx Hash Format** | `0x` + 64 hex characters | 64 hex characters (no `0x` prefix) |
| **Server Scheme** | `@x402/evm` server adapter | `src/server/x402/stellarScheme.ts` |

---

## 3. Server Guards & Threat Hardening

Before premium agents execute, `assertFreshX402Payment` verifies:
- **Body & Resource Binding**: `requestId` is computed from `sha256(requestBody)` + `protectedResource`. A receipt cannot be replayed for another token or query.
- **Replay Protection**: Receipt IDs and tx hashes are stored in the persistence layer; repeated submissions return `HTTP 409 Conflict`.
- **Payment Expiry**: Payments older than `X402_PAYMENT_EXPIRY_SECONDS` (default: 300s) are rejected with `payment_expired`.
- **Amount & Recipient Enforcement**: Strict check against `X402_PRICE_USD` and `X402_PAY_TO`.

---

## 4. Local Testing & Mocking Guide

Developers can test x402 deep scans locally without spending real tokens using the test harness and smoke scripts:

### A. Testing Missing Payment (Expect 402)
```bash
curl -i -X POST http://localhost:3000/api/scan/token \
  -H "Content-Type: application/json" \
  -d '{"address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "deepScan": true}'
```
*Expected response*: HTTP 402 with `code: "PAYMENT_REQUIRED"` and payment terms.

### B. Running Automated x402 Smoke Tests
```bash
# Test payment rejection and configuration
node scripts/smoke-api.mjs

# Test duplicate payment rejection
SMOKE_DUPLICATE_X402_ENABLED=1 node scripts/smoke-api.mjs

# Test end-to-end premium unlock with mock facilitator
SMOKE_X402_FULL=1 node scripts/smoke-api.mjs
```

### C. Fixture Check
```bash
npm run test:fixtures --prefix frontend
```
Validates runtime configuration, chain-family identity decoders, and pricing schemas.
