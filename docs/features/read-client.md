# Read client compatibility

Baseline: `d41a5ebeea2e4d671e2e0d4e89e20ddcb8020e86`. Only existing GET handlers
are supported. The package is private; it is not published to npm.

| Method | Handler path after `/api` | Preserved response shape |
| --- | --- | --- |
| `health.get()` | `/health` | health object |
| `portfolio.get({ walletAddress, chain })` | `/portfolio` | portfolio object, nullable prices and data warnings |
| `history.transactions({ walletAddress?, cursor?, limit? })` | `/history/transactions` | `{ items, total, nextCursor? }` |
| `history.agentRun(id)` | `/history/agent-runs/[id]` | `{ record, decisionDetail?, sourceSnapshots? }`; nullable snapshots are preserved |
| `watchlist.list({ walletAddress? })` | `/watchlist` | `{ entries }`; current wallet-session cookie is authoritative |
| `alerts.list({ walletAddress })` | `/alerts` | `{ alerts }` (discovery alerts) |
| `alerts.history({ walletAddress?, status?, limit? })` | `/alerts/alerts` | `{ alerts, counts, walletAddress? }` with immutable evidence |
| `alerts.deliveries({ alertId? })` | `/alerts/deliveries` | delivery audit rows, including `channel` and `status` |
| `registry.history({ network? })` | `/stellar/registry/history` | `{ ok, count, records }` |
| `registry.find({ network, txHash })` | `/stellar/registry/history` | `{ ok, record: object or null }` |
| `registry.status({ network, hash })` | `/stellar/registry/status` | transaction status including provider metadata |
| `snapshots.get(id)` | `/snapshots/[id]` | `{ snapshot }`, public redacted document |

All other endpoints, downloads, mutations, scanning, x402 payment, signing,
automatic pagination and session creation are unsupported. There is no GET on
`/snapshots`; use a known snapshot ID. No generic arbitrary-path method is exported.

The current OpenAPI v1 describes history as an array, while the current handler
and `listTransactionRecordsPaginated` return a page object. Registry history and
snapshot retrieval are absent from the document. This package follows the current
handlers and records these discrepancies without changing server routes or the
shared OpenAPI contract. Existing API compatibility policy still applies.

Fixture provenance: `packages/read-client/tests/fixtures` contains deterministic,
synthetic examples transcribed from the baseline handlers and their server types:
`server/types.ts`, `server/stellar/riskHistory.ts`, `server/snapshots/schema.ts`, and
`server/storage/index.ts:listTransactionRecordsPaginated`. No production wallet
data was captured. Health uses the documented minimal public fields; nested
operational metadata remains unknown. Unknown additive fields survive unchanged.
These fixtures assert wire compatibility, not provider correctness or financial
accuracy. Portfolio unavailable prices, empty lists, absent cursor, missing
registry record, structured/legacy errors and version mismatch are distinct cases.

Validation from the package directory:

```sh
npm ci
npm test
npm run build
```

The test suite calls every client method with mocked fetch, rejects malformed
nested records, checks credentials/cancellation/Retry-After and runs a browser
bundle without Node globals. Both consumption examples type-check. Tests make no
blockchain requests and require no paid credentials. The dedicated workflow runs
independently of the frontend installation and unrelated baseline build failures.

Compatibility: additive untyped fields are retained; removals/type changes of
typed fields produce `CompatibilityError`. Open-ended status/code strings keep
using `text`; the closed enums declared by the alert/watchlist server types
(status, severity, trigger type, channel, classification, source) use `oneOf`
and fail closed on unknown values. New public snapshot document versions require
an explicit client update. Error messages do not retain request URLs or payloads.

## Browser integration

`frontend/src/lib/apiClient.ts` is the single browser-facing entry point. Reads
(history snapshots, alert history/deliveries and watchlist) go through
`createReadClient`; writes stay on the deliberately small `apiRequest` helper.
The client derives its base URL from `window.location.origin`, sends
`same-origin` credentials, supports `AbortSignal` cancellation and builds the
read package during `npm run build` (via `prebuild`) so the shared `dist/`
artifact is always current. `frontend/next.config.ts` sets `turbopack.root` to
the monorepo root to match `outputFileTracingRoot` and allow resolution of the
shared package.

All failures normalise to `ApiClientError` with `code`, `retryable` and
`recoveryAction` from the canonical nested/flat API error envelope.
`ApiErrorNotice` is the single UI surface for these fields; a missing or
unexpected payload becomes a non-retryable `compatibility_error` with the
`refresh_data` recovery action instead of a blank view. `parseErrorEnvelope` is
exported from the package for consumers that need the raw bounded fields.
