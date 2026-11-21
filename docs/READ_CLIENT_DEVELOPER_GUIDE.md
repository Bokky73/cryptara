# packages/read-client SDK Developer Guide

`packages/read-client` is a lightweight, zero-dependency, isomorphic TypeScript SDK for consuming Cryptara's public read layer. It runs in both Node.js (22+) and modern browser environments.

---

## 1. Installation

```bash
# From npm (or local monorepo link)
npm install @cryptara/read-client
```

---

## 2. Quick Start

```typescript
import { createReadClient } from "@cryptara/read-client";

// Initialize client pointing to Cryptara API
const client = createReadClient({
  baseUrl: "https://cryptara.vercel.app",
  timeoutMs: 10000,
});

// 1. Health check & latency buffer
const health = await client.health.get();
console.log("Cryptara status:", health.status, "Ledger:", health.ledger);

// 2. Query Stellar Registry publication history
const registry = await client.registry.history({
  network: "stellar:pubnet",
});
console.log("Publications found:", registry.count);

// 3. Look up token risk snapshots
const snapshot = await client.snapshots.get({
  network: "eip155:8453",
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
});
console.log("Risk Score:", snapshot.score, "Verdict:", snapshot.verdict);
```

---

## 3. Client Module Reference

| Module | Method | Description |
|---|---|---|
| `health` | `.get()` | Query node health, active ledger sequence, and timing buffers |
| `registry` | `.history(query)` | Fetch onchain risk publication history |
| `registry` | `.find(query)` | Look up specific publication record by txHash |
| `registry` | `.status(query)` | Query Stellar transaction publication status |
| `snapshots` | `.get(query)` | Retrieve cached deterministic token risk reports |
| `alerts` | `.list(query)` | Fetch active security alerts for monitored tokens |
| `portfolio` | `.summary(query)` | Fetch portfolio exposure breakdown for connected wallet |
| `watchlist` | `.list(query)` | Fetch user's saved watchlist assets |

---

## 4. Error Handling & Validation

Every SDK method validates server responses against internal runtime schemas (defined in `validation.ts`). If a response fails validation, a typed `ValidationError` is thrown with exact path and expected types, preventing silent schema drift.
