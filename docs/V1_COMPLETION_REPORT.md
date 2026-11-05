# V1 Completion Report

**Status: not complete. V1 cannot be declared done from this run.**

This report records an execution of `docs/V1_ACCEPTANCE_MATRIX.md`. It contains
what was observed and nothing else. Where a case was not executed it says so and
why, because a completion report that fills its gaps with assumptions is worse
than no report — it converts an unknown into a false claim.

## Verdict

| | |
|---|---|
| Automated cases passed | 3 of 7 |
| Automated cases failed | 4 (A1, A3, A5, A6) |
| Cases not run | 18 of 25 |
| Blocking issues open | #1, #2, #3, #4 |

The matrix cannot be completed until #1 through #4 land, because most of the
remaining cases test behaviour those issues implement.

It also cannot be completed while `main` is red. Four automated cases fail on
`main` as it stands, three of them from merged code rather than from the
environment, and between them they leave the Agent, Execution and Test sections
of the Definition of Done with **no** verified coverage at all.

## Run environment

| Field | Value |
|---|---|
| Commit | recorded in `docs/acceptance/evidence.json` |
| Branch | `issue-5-v1-acceptance-matrix` |
| Deployment URL | **none** — no release candidate was deployed for this run |
| Provider mode (`APP_MODE`) | unset, defaults to `live` |
| Provider credentials configured | none |
| Platform | linux x64 (WSL2) |
| Node | v24.18.0 |
| Rust / Cargo | 1.85.0 |
| Stellar CLI | not installed |

The absence of a deployment URL and provider credentials is the single largest
limitation of this run and the reason so many cases are `not_run`.

## Automated results

Machine-readable evidence, including every command, exit code, duration and
output tail: `docs/acceptance/evidence.json`.

| Id | Case | Result |
|---|---|---|
| A1 | Deploy readiness and secret scan | **fail** |
| A2 | Stellar configuration check | **pass** |
| A3 | Agent fixture and property suite | **fail** |
| A4 | Lint | **pass** |
| A5 | Production build | **fail** |
| A6 | Soroban contract tests | **fail** |
| A7 | EVM contract compile | **pass** |

Four of the seven fail. Every one of them fails on `main` itself, with this
branch's changes limited to two documentation files and a script — so these are
findings about the release candidate, not about the branch that reported them.

### A1 — secret scan trips on merged code

```
deploy-readiness: possible secret-like value found in
  frontend/src/server/observability/observations.ts: sk-c
  frontend/src/server/transactions/adapters/evm.ts: 0x0000…0001
  frontend/src/server/types.ts: sk-c
```

These read as false positives: `sk-c` appears to be a redaction fixture and the
hex value a placeholder constant. That does not make the failure benign — the
secret scan is a release gate, and a gate nobody can pass is a gate that gets
ignored. Either the values or the pattern in `scripts/check-deploy-readiness.mjs`
need adjusting so a real leak would still be caught.

### A3 — server-only module reaches a client path

```
Error: This module cannot be imported from a Client Component module.
It should only be used from a Server Component.
  at frontend/src/server/stellar/trustline.ts:173
```

A `server-only` import is being pulled in through a client module path. This
blocks the entire agent fixture suite, which is the automated proxy for the
Agent DoD — so **no agent behaviour is currently verified on `main`**.

### A6 — Soroban contract tests do not compile

```
error: could not compile `cryptara-risk-registry` (lib test)
       due to 16 previous errors
```

Sixteen type errors in the risk-registry test module: `no method named is_ok
found for unit type ()`, `this method takes 2 arguments but 3 were supplied`,
and similar. The test file and the library have drifted apart — the signatures
the tests call no longer exist in the shapes they expect.

### A5 — production build failure

```
> next build
Bus error (core dumped)
exit code 135
```

`SIGBUS` is a native crash, not a compile error: `next build` produced no
diagnostics before dying. The same failure reproduces on unmodified `main` in
this environment, so it is **not** caused by any branch under review.

It is reported as `fail` rather than explained away because this runner records
outcomes, not theories. What is known:

- It reproduces on a clean checkout of `main`.
- `npx tsc --noEmit` type-checks the project without error, so the TypeScript is
  sound.
- The most likely cause is the WSL2 environment rather than the repository.

**This must be re-run in CI or on a supported platform before V1 is declared
complete.** A green build elsewhere would resolve A5; nothing in this report
should be read as evidence that the build is broken for everyone.

## Cases not run

Nothing below was executed. None of it may be reported as passing.

### Needs a deployed release candidate and a browser

| Id | Case |
|---|---|
| M1 | Contract-address input flow, desktop |
| M2 | DexScreener link input flow, desktop |
| M3 | Native XLM input |
| M4 | Classic Stellar asset input |
| M5 | Soroban contract asset input |
| M7 | EVM wallet disconnected |
| M9 | Stellar wallet disconnected |
| M10 | Report comprehension review |
| M11 | Mobile viewport acceptance |
| M16 | Smoke suite against the deployment URL |

### Needs a real wallet and user signatures

| Id | Case |
|---|---|
| M6 | EVM wallet connected |
| M8 | Stellar wallet connected |

### Needs the x402 route deployed with a facilitator

| Id | Case |
|---|---|
| M12 | Payment required (402) |
| M13 | Verified payment |
| M14 | Failed payment |
| M15 | Duplicate payment |

M13 additionally needs a funded wallet on the payment network. All four states
are required by the acceptance criteria; recording only M12 and M13 would
misrepresent coverage.

### Blocked by open issues

| Id | Case | Blocked by |
|---|---|---|
| M17 | Supabase migration on a clean database | #1 |
| M18 | No production path returns mock data | #1, #4 |

On M18: A3 proves the guard exists — `assertNoMockSourcesInLive` throws when a
live response carries a mock source. It does **not** prove the guard is never
tripped in production, which needs live credentials. The two claims are recorded
separately on purpose.

## Definition of Done coverage

Against the V1 Definition of Done in `PROJECT_ROADMAP.md`:

| Section | Covered by this run |
|---|---|
| Product DoD | none — every item needs the UI on a deployed build |
| Agent DoD | **none** — A3 does not run, so nothing is verified |
| Execution DoD | **none** — these assertions live in A3, which does not run |
| Storage DoD | none — the production adapter is #1 |
| Test DoD | **not met**: agent fixture tests fail (A3), Soroban tests do not compile (A6), build fails (A5), secret scan fails (A1). Lint and EVM compile pass. Smoke not run; migration not applied |
| Release DoD | none — no production environment, no provider keys, no deployment |

## Known limitations

1. No release candidate was deployed, so no user-facing behaviour was observed.
2. No provider credentials were configured; every agent result in this
   environment comes from the no-provider path.
3. The production build could not be verified (A5).
4. The Stellar CLI is not installed, so no WASM artifact was built or hashed.
5. The storage adapter is in-memory on `main`; persistence claims are untested.
6. **Manual-review rate: not measured.** It needs a live run over a real token
   sample and must not be estimated.

## Rollback procedure

Recorded for completeness; not exercised in this run.

1. Vercel keeps prior production deployments. Roll back by promoting the last
   known-good deployment from the dashboard.
2. The contracts under `soroban/` and `backend/contracts/` are not upgradeable
   and are not on the V1 critical path — the app functions with them absent.
3. Storage is in-memory on `main`; there is no data migration to reverse. Once
   #1 lands, this section must be rewritten against the real schema.
4. After any rollback, re-run `SMOKE_BASE_URL=… npm run smoke` (M16) and record
   the result here.

## Maintainer sign-off

Not signed, and not signable from this run. The checkpoints below are listed so
the remaining work is explicit; a contributor must not mark any of them.

- [ ] Product DoD reviewed against recorded evidence
- [ ] Agent DoD reviewed
- [ ] Execution DoD reviewed
- [ ] Storage DoD reviewed
- [ ] Test DoD reviewed
- [ ] Release DoD reviewed
- [ ] Known limitations accepted
- [ ] V1 declared complete

Signed: _______________  Date: _______________

## What has to happen next

`main` itself must go green before acceptance can proceed. In priority order:

0. **Repair `main`.** A3, A6 and A1 are all regressions in merged code, not
   environment problems, and they block the Agent, Execution and Test DoD
   sections outright:
   - fix the `server-only` import path reaching a client module (A3),
   - reconcile the risk-registry test module with its library (A6),
   - resolve the secret-scan hits, in the fixtures or in the pattern (A1).
1. Land #1, #2, #3 and #4.
2. Resolve A5 on a supported platform or in CI.
3. Deploy a release candidate and record its URL and commit SHA.
4. Configure provider credentials and confirm live mode returns no mock data.
5. Re-run `node scripts/acceptance-matrix.mjs`, then work the manual cases on
   desktop and mobile with screenshots.
6. Run all four x402 states against the deployed route.
7. Measure the manual-review rate over a real token sample.
8. Update this report from that run and take it to a maintainer for sign-off.
