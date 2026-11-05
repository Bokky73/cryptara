# Performance budgets

Cryptara treats performance regressions like functional regressions. This
document defines the Web Vitals and API latency budgets the frontend must stay
inside of, how they are measured, and how a maintainer approves an intentional
change to a budget. Note that these performance budgets tie closely into our
Service Level Objectives (SLOs) defined in [SLO_ERROR_BUDGETS.md](./SLO_ERROR_BUDGETS.md).

Machine-readable thresholds live in [`docs/performance/budgets.json`](./performance/budgets.json)
and are enforced by `npm run test:perf` (see [`frontend/scripts/perf-budget-check.ts`](../frontend/scripts/perf-budget-check.ts)),
which also runs as part of the root `quality:gate`.

## Measurement profiles

Every budget is defined for two profiles, because Cryptara's users check
token risk from both desks and phones on the go:

| Profile | Network | CPU | Intent |
| --- | --- | --- | --- |
| **Desktop** | Unthrottled | Unthrottled | Baseline, best-case experience. |
| **Constrained mobile** | Slow 4G | 4x CPU slowdown | Worst-case honest experience; this is the profile that should gate ship/no-ship decisions. |

Use Chrome DevTools' built-in network/CPU throttling presets (or Lighthouse's
"Mobile" preset, which applies an equivalent slowdown) to reproduce the
constrained-mobile profile locally.

## Budgets

### Bundle size

| Metric | Desktop | Constrained mobile |
| --- | --- | --- |
| Initial JS (first load) | ≤ 220 KB | ≤ 220 KB |
| Per-route chunk | ≤ 120 KB | ≤ 120 KB |

Measured from `.next/static/chunks/**` after `npm run build`. `npm run test:perf`
reads the build manifest and fails if any route's first-load JS or an
individual chunk exceeds budget.

### Web Vitals (field/lab, reported from `frontend/src/lib/webVitals.ts`)

| Metric | Desktop | Constrained mobile |
| --- | --- | --- |
| LCP (Largest Contentful Paint) | ≤ 2500 ms | ≤ 4000 ms |
| INP (Interaction to Next Paint, FID fallback) | ≤ 200 ms | ≤ 500 ms |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | ≤ 0.1 |
| TTFB (Time to First Byte) | ≤ 800 ms | ≤ 1800 ms |

### API latency (from the in-memory ring buffer in `frontend/src/server/observability/timing.ts`, exposed at `/api/health`)

| Route | p50 | p95 |
| --- | --- | --- |
| `scan:token` (`/api/scan/token`) | ≤ 4000 ms | ≤ 9000 ms |
| `health` (`/api/health`) | ≤ 300 ms | ≤ 800 ms |

### Time-to-first-meaningful-risk-result

The time from submitting a token scan to the first fully rendered verdict
(risk score, verdict badge, and at least one analysis check) reaching the
screen.

| Desktop | Constrained mobile |
| --- | --- |
| ≤ 6000 ms | ≤ 11000 ms |

This budget intentionally allows the scan pipeline (identity resolution,
provider fan-out, agent scoring) to take multiple seconds — it must never be
made to look faster by skipping honest loading states or dropping provider
evidence. See "No fabricating faster results" below.

## Phase timing (server-side)

`frontend/src/server/observability/timing.ts` exposes `createPhaseTimer()` so
server code can record how long each stage of a request takes. The scan
pipeline (`frontend/src/app/api/scan/token/route.ts` and
`frontend/src/server/scan/tokenScan.ts`) records these named phases:

1. **identity** — resolving the raw query into a chain/contract/asset identity.
2. **providers** — fan-out network calls to onchain/news/social/portfolio
   provider adapters (see `providerTimeoutBudgets` in
   `frontend/src/server/providers/adapter.ts`).
3. **agents** — running the decision agent over specialist results.
4. **scoring** — building the execution preview and combined risk breakdown.
5. **rendering** — assembling the final JSON payload and risk report.

A sixth phase, **persistence**, applies to routes that write agent run
records or alerts to storage (for example `/api/agent/decision`); it is not
present on `/api/scan/token` today because that route does not persist a
record itself.

Phase durations are attached to the JSON response as an additive `timing`
field and mirrored in the `Server-Timing` response header, so they never
change the shape of existing response fields and never hide a slow or failed
phase.

## How to measure

1. Build a production bundle: `npm run build --prefix frontend`.
2. Serve it: `npm run start --prefix frontend`.
3. Run `npm run test:perf` from the repo root to check bundle sizes against
   `docs/performance/budgets.json`. If `.next` does not exist yet, the script
   still validates the structure of `budgets.json` and prints a skip note for
   the size checks — it never silently reports "passed" for a check it did
   not actually run.
4. For Web Vitals, open the app in Chrome with DevTools open (Console tab).
   `frontend/src/components/WebVitalsReporter.tsx` logs each vital as it is
   measured in development. Run each profile (desktop, constrained mobile)
   **three times** and record the **median** for LCP/INP/TTFB and the
   **worst (maximum)** observed value for CLS, since layout shift regressions
   are usually intermittent and the worst case is what users notice.
5. For API latency, call `GET /api/health` after generating traffic (for
   example, a handful of `/api/scan/token` requests) and read
   `performance.recentApiLatency`. The ring buffer only stores latency
   numbers, route names, and timestamps — never wallet addresses, queries, or
   response bodies, so it is safe to read cross-session.

## Progressive disclosure

Long lists (for example, the alert history list) load and render only the
most recent N items by default with a "Show more" control that reveals the
next page from data already fetched, instead of rendering hundreds of DOM
nodes up front. This directly protects LCP/INP budgets on constrained mobile
without adding new dependencies. See `frontend/src/components/AlertHistoryList.tsx`.

## Approving an intentional budget change

Budgets are not meant to be edited to make a failing CI check pass. A
maintainer may raise (or lower) a value in `docs/performance/budgets.json`
only when the pull request includes:

1. **Evidence of the new baseline** — actual measured numbers (three runs,
   median/worst per the rules above) for both profiles, pasted into the PR
   description or attached as a screenshot/log. Evidence must not be
   fabricated or estimated.
2. **A stated reason** the regression (or improvement) is intentional — for
   example, a new dependency required for a safety feature, or an
   optimization that lowered a budget.
3. **An updated row in this document and in `budgets.json` in the same PR** —
   the two files must never drift out of sync; `npm run test:perf` will fail
   if `budgets.json` is missing required keys.
4. **Sign-off from a maintainer other than the PR author**, recorded as a PR
   review approval.

Budget *reductions* (tightening) do not require the same evidence bar, but
should still explain why the new number is achievable.

## Constraints this document must not violate

- No fabricating faster results by dropping evidence: latency and vitals
  numbers must reflect what actually happened, including failures, timeouts,
  and provider fallbacks.
- No unsafe caching across wallets: the API latency ring buffer stores only
  latency numbers, route names, and timestamps. It never stores wallet
  addresses, request bodies, or response payloads.
- Honest loading/error states must be preserved even when a phase is slow —
  a slow phase should show a loading indicator, not a masked/faked result.
