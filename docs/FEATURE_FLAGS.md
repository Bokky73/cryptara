# Feature flags

Cryptara uses a typed, server-side feature-flag system to gate network
and execution capabilities. Flags are **not** client-controlled: client-side
`NEXT_PUBLIC_*` values are presentation-only, and every gate is enforced in the
server route handler.

## Registry

Flags are defined once in `frontend/src/server/features/registry.ts`. Each flag
records:

- `owner` — the team responsible for the flag.
- `purpose` — a short description.
- `safeDefault` — the value used when the flag is unconfigured. Dangerous
  capabilities (execution, auto-mode, payment-gated endpoints) default to
  `false` so an unconfigured deployment fails closed.
- `scope` — `network` or `execution`.
- `environments` — which environments the flag may run in.
- `dependencies` — other flags that must be enabled first.
- `reviewDate` / `removalDate` — re-review and auto-expiry dates.

## Configuration

Flags are configured with `FEATURE_<KEY>` environment variables. Accepted
values:

| Value | Meaning |
|-------|---------|
| `on` / `1` / `true` | Explicitly enabled |
| `off` / `0` / `false` | Explicitly disabled |
| `rollout:<0-100>` | Stable anonymous percentage rollout |
| *(unset)* | `safeDefault` |

Unknown `FEATURE_*` variables and invalid values are reported as configuration
issues and fail closed.

## Evaluation

`frontend/src/server/features/evaluator.ts` evaluates a flag to a decision.
Evaluation fails closed on expired flags, disabled dependencies, environment
mismatch, and invalid configuration. Rollout bucketing hashes a one-way
identifier (SHA-256) — the raw wallet address is never logged or used directly.

## Enforcement

Each protected route calls `gateFeature(...)` at the top of its handler and
returns a `403 feature_disabled` response when the flag is off. Audit events are
emitted for every evaluation via the shared execution audit sink.

## Verification

```sh
npm run test:feature-flags --prefix frontend
```

The verification script checks that configuration is valid and that dangerous
capabilities default off, so a bad deploy or an accidental rollback that would
re-enable a dangerous capability fails CI.
