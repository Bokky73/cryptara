# Distributed Tracing

Cryptara uses OpenTelemetry on the Next.js server runtime to produce one
connected trace per API request. Tracing is **disabled by default** and degrades
to a no-op when no exporter is configured.

## What gets traced

- API route handlers: `scan/token`, all `agents/*` routes, `execute/prepare`, `execute/submit`
- Agent execution via `runAgentSafely`
- Provider adapter calls (`runProviderAdapter`)
- Storage adapter operations (memory and Supabase via `wrapStorageAdapter`)
- Stellar RPC calls via `frontend/src/server/stellar/rpc.ts`

Each span records safe attributes only: route name, chain family, network,
provider name, cache outcome, retry count, and normalized error codes. Wallet
addresses, balances, API keys, signed payloads, and request bodies are redacted
before attributes are attached.

Typed API errors from `jsonError()` include an optional `traceId` field and
`X-Trace-Id` response header when a trace is active.

## Enable tracing locally

1. Start an OTLP collector (Jaeger all-in-one example):

```bash
docker run --rm -p 4318:4318 -p 16686:16686 jaegertracing/all-in-one:1.64
```

2. Configure server-only environment variables in `frontend/.env.local`:

```env
OTEL_TRACING_ENABLED=1
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_SERVICE_NAME=cryptara-frontend
```

3. Run the frontend as usual (`npm run dev` from `frontend/`).

4. Trigger a scan or agent request, then open Jaeger at `http://127.0.0.1:16686`
   and search for service `cryptara-frontend`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OTEL_TRACING_ENABLED` | `0` | Must be `1` to activate the SDK |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | empty | OTLP HTTP base URL (`/v1/traces` appended when missing) |
| `OTEL_EXPORTER_OTLP_HEADERS` | empty | Optional comma-separated `key=value` auth headers |
| `OTEL_SERVICE_NAME` | `cryptara-frontend` | Service name in exported traces |
| `OTEL_LOG_LEVEL` | unset | Set to `debug` for OpenTelemetry SDK diagnostics |

Tracing requires **both** `OTEL_TRACING_ENABLED=1` and a non-empty
`OTEL_EXPORTER_OTLP_ENDPOINT`.

## Verification

```bash
cd frontend
npm test
npm run lint
```

See also: [LOGGING.md](./LOGGING.md), [PERFORMANCE_BUDGETS.md](./PERFORMANCE_BUDGETS.md).
