# End-to-end (browser) tests

Cryptara ships a Playwright test suite that exercises critical user journeys against a locally running app with deterministic fixtures and mock wallets. No real private keys or mainnet funds are ever used.

## Quick start

From the repository root:

```bash
npm ci
npm ci --prefix frontend
npm run test:e2e --prefix frontend
```

Or from `frontend/`:

```bash
cd frontend
npm run test:e2e
```

The test execution flow:

1. Starts the Next.js application in **test** mode (`APP_MODE=test`, `NODE_ENV=test`).
2. Runs global setup to pin a fixed UTC seed epoch (`2024-01-01T00:00:00.000Z`).
3. Resets and seeds in-memory test fixtures via `POST /api/dev/reset` and `POST /api/dev/seed`.
4. Runs journey specs under `frontend/e2e/specs/` with mock EVM and Stellar wallets.

## Test suite coverage

| Spec | Journey & Coverage |
|------|-------------------|
| `connect-wallet.spec.ts` | Connect modal, mock EVM/Stellar sessions, private-key guard |
| `scan-evm.spec.ts` | EVM token contract scan → deterministic risk report |
| `scan-stellar.spec.ts` | Stellar contract asset, native XLM, classic `CODE:ISSUER` |
| `execution-preview.spec.ts` | Execution details, deep-scan gate, approval/submit guards |
| `fail-closed.spec.ts` | Unavailable provider, unpriced asset, network mismatch, rejected signature |
| `history.spec.ts` | Seeded recommendations, approvals, transactions |

Legacy navigation and smoke specs under `frontend/e2e/*.spec.ts` execute under the `legacy-desktop` project.

---

## Debugging Flaky Tests & Playwright Traces

When a test fails intermittently or produces unexpected timeouts in CI or local runs, Playwright trace files provide an exact time-travel recording of DOM mutations, console logs, network requests, and visual action snapshots.

### 1. Generating Traces Locally

By default, traces are captured on first retry in CI. To force full trace recording locally:

```bash
cd frontend
npx playwright test e2e/specs/scan-evm.spec.ts --trace on
```

Or run in interactive headed mode with step-by-step debugger:

```bash
npx playwright test e2e/specs/scan-evm.spec.ts --debug
```

### 2. Inspecting Saved Traces

Playwright outputs zip archives to `frontend/test-results/` (e.g., `test-results/scan-evm-chromium/trace.zip`). Open the trace viewer:

```bash
npx playwright show-trace test-results/<folder-name>/trace.zip
```

### 3. Step-by-Step Trace Analysis Workflow

1. **Timeline bar**: Scrub horizontally across the top timeline to locate the exact frame where the UI diverged from expectations.
2. **Action snapshots**:
   - **Before**: State of DOM when locator evaluation began.
   - **Action**: Moment click/fill was dispatched.
   - **After**: Resulting state after user event handling.
3. **Network tab**: Inspect requests to `/api/scan/token`, `/api/dev/seed`, or quote providers. Verify:
   - Request headers and mock wallet addresses.
   - Status codes (e.g. 402 payment gate vs 200 report).
   - Server-Timing headers for latency bottlenecks.
4. **Console & Errors**: Inspect browser JavaScript errors, hydration mismatches, and unhandled promise rejections.
5. **Source tab**: Identifies the exact test line and locator that timed out.

### 4. Common Flakiness Causes and Solutions

- **Hydration Race Conditions**: Clicking elements before React finishes hydration causes dropped events.
  - *Fix*: Use web-first assertions like `await expect(page.getByRole('button', { name: 'Analyze' })).toBeVisible()` and verify enabled state before dispatching clicks.
- **Dynamic Time & Epoch Drift**: Tests comparing relative dates can drift across midnight.
  - *Fix*: Ensure global setup pins `E2E_FIXTURE_CREATED_AT = 2024-01-01T00:00:00.000Z` and never compare against `Date.now()`.
- **Wallet State Leaks**: LocalStorage sessions leaking across tests.
  - *Fix*: Each spec must call `test.beforeEach` with isolated context or invoke `POST /api/dev/reset`.

---

## Mock Wallets & Security Boundaries

- **EVM** — `e2e/fixtures/mockEvmWallet.ts` injects `window.ethereum` and mock wagmi storage. All signatures are deterministic mock hashes.
- **Stellar** — `e2e/fixtures/mockStellarWallet.ts` seeds a Freighter-style display session from `localStorage`.

Neither test harness holds, requests, or transmits real private keys. Every test asserts:
- API payloads never transmit `privateKey`.
- Scan responses never include pre-signed or auto-executed transactions.

## CI Execution

The `e2e-journey` job in `.github/workflows/ci.yml` builds the production Next.js bundle, executes the suite against the production build, and uploads the `playwright-report/` artifact on failure.
