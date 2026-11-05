# End-to-end (browser) tests

Cryptara ships a Playwright suite that exercises the critical user journeys against a locally running app with deterministic fixtures and mock wallets. No real private keys or mainnet calls are used.

## Quick start

From the repository root:

```bash
npm ci
npm ci --prefix frontend
npm run test:e2e --prefix frontend
```

Or from `frontend/`:

```bash
npm run test:e2e
```

The command:

1. Starts the app in **test** mode (`APP_MODE=test`, `NODE_ENV=test`).
2. Runs global setup to pin a fixed UTC seed epoch (`2024-01-01T00:00:00.000Z`).
3. Resets and seeds in-memory history via `POST /api/dev/reset` and `POST /api/dev/seed`.
4. Runs journey specs under `frontend/e2e/specs/` with mock EVM and Stellar wallets.

## What is covered

| Spec | Journey |
|------|---------|
| `connect-wallet.spec.ts` | Connect modal, mock EVM/Stellar sessions, private-key guard |
| `scan-evm.spec.ts` | EVM token scan → risk report |
| `scan-stellar.spec.ts` | Stellar contract asset, native XLM, classic `CODE:ISSUER` |
| `execution-preview.spec.ts` | Execution details, deep-scan gate, approval/submit guards |
| `fail-closed.spec.ts` | Unavailable provider, unpriced asset, network mismatch, rejected signature |
| `history.spec.ts` | Seeded recommendations, approvals, transactions |

Legacy specs at `frontend/e2e/*.spec.ts` (navigation, landing, etc.) still run under the `legacy-desktop` project.

## Mock wallets

- **EVM** — `e2e/fixtures/mockEvmWallet.ts` injects `window.ethereum` and wagmi storage; signatures are deterministic mocks.
- **Stellar** — `e2e/fixtures/mockStellarWallet.ts` restores a Freighter-style display session from `localStorage`.

Neither harness holds or transmits real signing keys. Tests assert API payloads never include `privateKey` and server scan responses never include signed transactions.

## Determinism

- Fixed seed epoch and UTC timezone in global setup.
- Seeded history uses `E2E_FIXTURE_CREATED_AT = 2024-01-01T00:00:00.000Z`.
- EVM and Stellar journeys use separate fixture data and do not share wallet state.

## CI

The `e2e-journey` job in `.github/workflows/ci.yml` builds the production app, runs the suite, and uploads `playwright-report/` on failure.

## Debugging failures

```bash
cd frontend
npx playwright show-report
```

Traces and screenshots are retained on failure in CI. To run a single spec locally:

```bash
npx playwright test e2e/specs/scan-evm.spec.ts --project=chromium-desktop
```

## Deliberate regression check

Break a field in the scan API mock (for example remove `overallRiskScore`) and confirm `scan-evm.spec.ts` fails with a visible assertion on the risk report.
