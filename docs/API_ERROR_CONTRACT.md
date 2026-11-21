# API Error Contract & Catalog

Cryptara enforces a strict, machine-readable API error contract across all endpoints. Errors are fail-closed, deterministic, and provide actionable recovery instructions for client applications and users.

---

## 1. Standard Error Envelope

All API errors return a standard JSON structure with `Content-Type: application/json`:

```typescript
type ApiErrorResponse = {
  ok: false;
  error: {
    code: string;               // Machine-readable SCREAMING_SNAKE_CASE identifier
    message: string;            // Human-readable, non-technical explanation
    details?: Record<string, unknown>; // Optional contextual metadata
    retryable: boolean;         // Indicates whether an immediate/delayed retry is valid
    retryAfterMs?: number;      // Recommended backoff duration
    recoveryAction: string;     // Explicit guidance for UI/caller recovery
  };
};
```

---

## 2. HTTP Status Code Mapping

| Status Code | Description | Typical Use Cases |
|---|---|---|
| **400 Bad Request** | Malformed JSON, unparseable parameters, invalid address formatting | Invalid Ethereum `0x` address or malformed Stellar StrKey |
| **401 Unauthorized** | Missing or unverified wallet session proof | Attempting to access private portfolio exposure without wallet |
| **402 Payment Required** | x402 payment required to access premium deep scan | Unpaid deep scan request; includes price and pay-to terms |
| **403 Forbidden** | Signature verification failed, disallowed network | Network mismatch between connected wallet and target chain |
| **404 Not Found** | Unindexed token contract, missing transaction hash | Non-existent pair on DEX or unmined transaction hash |
| **409 Conflict** | State collision or duplicate x402 payment replay | Replaying an already-settled x402 payment receipt |
| **422 Unprocessable Entity** | Syntactically valid request failing semantic domain rules | Zero liquidity token or unsupported slippage tolerance |
| **429 Too Many Requests** | Rate limit exhausted | Client exceeding IP or wallet-scoped request limits |
| **502 Bad Gateway** | Upstream provider RPC error or unparseable upstream data | DexScreener, GoPlus, or Stellar RPC temporary failure |
| **503 Service Unavailable** | Circuit breaker open or maintenance mode | Automated circuit breaker tripping on upstream degradation |

---

## 3. Categorized Error Codes & Recovery Matrix

| Error Code | HTTP Status | Retryable | Recovery Action |
|---|---|---|---|
| `TOKEN_NOT_FOUND` | 404 | No | Verify token contract address or select a supported blockchain network |
| `UNSUPPORTED_CHAIN` | 400 | No | Switch network in wallet to a supported EVM or Stellar network |
| `INSUFFICIENT_LIQUIDITY`| 422 | No | Cannot generate valid quote; pool reserves are below execution threshold |
| `PAYMENT_REQUIRED` | 402 | Yes (with sig) | Settle x402 payment receipt and re-submit with payment signature |
| `PAYMENT_EXPIRED` | 402 | Yes | Payment signature timestamp has expired; sign a fresh payment |
| `PAYMENT_REPLAY_DETECTED`| 409 | No | Receipt ID has already been redeemed; sign a new payment for this query |
| `WATCHER_NOT_AUTHORIZED` | 403 | No | Gated read rejected; Watcher Registry has no active authorized watchers |
| `PROVIDER_RATE_LIMITED` | 429 | Yes (exp backoff)| Back off using exponential jitter (minimum 1000ms delay) |
| `UPSTREAM_PROVIDER_TIMEOUT`| 504 | Yes (max 2 retries)| Upstream RPC timed out; retry query |
