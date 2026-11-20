# Logging & Observability Specification

Cryptara enforces structured JSON logging and W3C distributed trace correlation across all server-side routes, background workers, and evaluation harnesses.

## 1. Structured JSON Log Schema

All logs must adhere to the standard schema:

```typescript
interface LogRecord {
  ts: string;               // ISO 8601 UTC timestamp
  level: "debug" | "info" | "warn" | "error";
  service: string;          // e.g. "cryptara-frontend"
  event: string;            // Dot-delimited event name (e.g. "scan.token.start")
  requestId: string;        // Request UUID or correlation identifier
  traceId?: string;         // W3C trace ID from traceparent
  spanId?: string;          // W3C span ID
  chainFamily?: "evm" | "stellar";
  network?: string;         // e.g. "mainnet", "testnet"
  durationMs?: number;      // Execution latency in milliseconds
  errorCode?: string;       // Normalized error code on failure
  fields?: Record<string, unknown>;
}
```

## 2. Redaction & Privacy Guarantees

In compliance with `docs/OPERATOR_PRIVACY_PROCEDURES.md`:
- **Private keys, seeds, and bearer tokens** must NEVER be logged.
- **x402 Authorization headers** and payment tokens are scrubbed.
- **Sensitive query parameters** (API keys, session secrets) are redacted in URLs before logging.
- `frontend/src/server/observability/redaction.ts` automatically strips forbidden fields.

## 3. Usage Examples

### Route Handler:
```typescript
import { getLogger } from "@/server/observability/logging";

const logger = getLogger("api.scan");
logger.info("Token scan requested", {
  event: "scan.start",
  chainFamily: "evm",
  network: "mainnet",
  tokenAddress: "0x...",
});
```

## 4. Verification Gate

To prevent forbidden `console.log` statements in server code, run:
```bash
npm --prefix frontend run logging-check
```
