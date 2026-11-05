# OpenAPI compatibility policy

This document defines how the Cryptara HTTP API's OpenAPI contract
(`docs/openapi/v1/openapi.json`) is versioned, what counts as a breaking
change, and how routes migrate to the stable error contract.

## Versioning

- The contract lives at `docs/openapi/v1/openapi.json`. The `v1` path
  segment is the contract version, independent of `info.version` inside the
  document (which tracks incremental revisions within `v1`).
- A new breaking revision of the contract is published as `docs/openapi/v2/openapi.json`
  alongside `v1`, never by editing `v1` in place. `v1` is kept until every
  route it documents has migrated or the deprecation window (below) elapses.
- Non-breaking additions (see below) are made directly to the current
  version's `openapi.json` and should bump `info.version`'s patch/minor
  component.

## What counts as a breaking change

A change to `docs/openapi/v1/openapi.json` or to a route it documents is
**breaking** if it does any of the following to a field a client may already
depend on:

- Removes a response field, or a request field that a client is allowed to send.
- Renames a field, changes its JSON type, or narrows its accepted values
  (e.g. removing an enum member a route used to return).
- Changes a success status code to a different success status code, or a
  previously-optional request field to required.
- Changes the authoritative meaning of a field (e.g. a `walletAddress` field
  that used to be trusted becoming session-derived only, without a
  transition period).
- Removes or renames a path or operationId that a client may call directly.

A change is **non-breaking** (and does not require a new contract version) if it:

- Adds a new optional request field, response field, path, or operationId.
- Adds a new enum member to a field that is documented as open-ended /
  forward-compatible (all `code` fields, `error` strings, and `status`
  fields in this API are treated as open-ended).
- Adds a new stable field alongside an existing legacy field (the pattern
  used by `frontend/src/server/api/errors.ts`; see below).
- Loosens a request validation constraint (e.g. increasing a `maxLength`).
- Fixes documentation to match already-shipped runtime behavior.

## The stable error contract

Every route ultimately targets the shape defined by `components.schemas.Error`
in the spec and implemented by `frontend/src/server/api/errors.ts`:

```json
{
  "code": "validation_error",
  "message": "Request validation failed.",
  "retryable": false,
  "requestId": "req_abc123",
  "details": { "...": "optional" }
}
```

- `code` is a stable, machine-readable string. It is intentionally **not** a
  closed enum in the OpenAPI schema — existing route-local codes (e.g.
  `wallet_session_disabled`, `hash_chain_family_mismatch`) are valid and
  are not required to migrate to a generic taxonomy.
- `retryable` tells callers whether re-sending the same request without
  changes might succeed (e.g. `true` for rate limiting / provider errors,
  `false` for validation errors).
- `requestId` is opaque and exists purely for correlating a client-visible
  error with server-side logs; it must not be parsed for meaning.
- `details` is optional and, when present, machine-readable (e.g. a Zod
  `.flatten()` shape for validation errors).

### Migration strategy: dual-shape responses

Most routes predate the stable contract and return an ad hoc shape (see
`components.schemas.LegacyErrorEnvelope`), typically:

```json
{ "error": "some_code_or_object", "detail": "optional human string" }
```

Routes are migrated **additively**: `jsonError()` merges the stable fields
alongside the route's pre-existing fields, so existing clients that read
`error`/`detail` keep working unmodified, while new clients can switch to
reading `code`/`message`/`retryable`/`requestId`. A migrated response looks
like:

```json
{
  "code": "validation_error",
  "message": "Request validation failed.",
  "retryable": false,
  "requestId": "req_abc123",
  "details": { "formErrors": [], "fieldErrors": { "query": ["..."] } },
  "error": { "formErrors": [], "fieldErrors": { "query": ["..."] } }
}
```

This is documented per-route as `MigratedErrorEnvelope` (an `allOf` of
`Error` and `LegacyErrorEnvelope`) in `openapi.json`. Routes that have not
yet migrated continue to document `LegacyErrorEnvelope` only. Migrating a
route from `LegacyErrorEnvelope` to `MigratedErrorEnvelope` is a
**non-breaking** change under the rules above, because no existing field is
removed or changed — only new fields are added.

Currently migrated routes: `POST /scan/token`, `POST /agents/onchain`,
`GET|POST|DELETE /wallet-session` (see `ROUTE_COVERAGE.md` for the full
route list and status). Remaining routes are expected to migrate
incrementally; each migration should be a small, reviewable diff limited to
error-response construction.

## Deprecation policy

- A path or operationId that must be removed is first marked
  `"deprecated": true` in `openapi.json` for at least one release cycle,
  with a `description` note explaining the replacement.
- Deprecated operations continue to function until they are removed in a
  new major contract version (`v2`, etc.), never silently in `v1`.
- `frontend/scripts/openapi-check.ts` fails the build if a route file is
  removed from the codebase while still documented, or if a route's
  implemented methods drift from what is documented — this keeps `v1`
  honest for the lifetime of its support window.

## Enforcement

- `npm run test:openapi` (frontend) runs both `openapi-check.ts` (route ↔
  spec coverage) and `openapi-conformance-check.ts` (schema/fixture
  validation) and is wired into the root `quality:gate` script.
- Any PR that adds, removes, or changes the signature of a route under
  `frontend/src/app/api/**` must update `docs/openapi/v1/openapi.json` and
  `docs/openapi/ROUTE_COVERAGE.md` in the same change.
