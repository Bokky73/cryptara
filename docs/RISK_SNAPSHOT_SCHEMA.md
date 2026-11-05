# Verifiable risk report snapshots

Cryptara risk snapshots are immutable, public, privacy-redacted artifacts. They let a user share the exact report they reviewed without exporting wallet balances, strategy rules, transaction plans, internal notes, user identifiers, or provider credentials.

## Version 1 document

Every public document is validated against `frontend/src/server/snapshots/schema.ts` and contains:

- `schemaVersion`: currently `"1"`.
- `asset`: chain family, normalized network, canonical asset identity, symbol, and optional public name.
- `scores`: buy-risk score from 0–100 and confidence from 0–1.
- `verdict`, `summary`, and `topReasons`.
- `evidence`: provider label, availability, optional check time, freshness, reliability, and a URL with credentials, query, and fragment removed.
- `missingData`: public field name and impact only; internal reasons are excluded.
- `freshness`: report generation, source check, and stale-after timestamps.
- `expiresAt`, product version, and explicit information-only/hash-scope notices.

The storage envelope adds the snapshot id, canonical SHA-256 hash, canonical identity key, creation/expiry/revocation timestamps, and a hash of the revocation token. The raw revocation token is returned only once to the creator and is never part of the public artifact. A database trigger rejects every record update except the first transition from active to revoked.

## Canonicalization and identity

Objects are serialized with Unicode NFC strings and code-point-sorted keys. Non-finite numbers and unsupported values are rejected. Evidence, missing-data entries, and source timestamps use deterministic ordering. EVM addresses are lowercased; Stellar classic asset codes and issuers and Soroban contract ids are uppercased. The identity key includes chain family, network, identity kind, and canonical id to prevent cross-network or cross-asset collisions.

The hash is `sha256:` plus the lowercase SHA-256 digest of the canonical versioned document. It proves only that the public artifact has not changed. It does not prove that upstream providers were correct.

## Fail-closed reads

The read API returns no report content when any of these checks fail:

- schema version is unknown;
- the record is expired or revoked;
- document metadata differs from its storage envelope;
- the recomputed canonical hash differs;
- the recomputed canonical asset identity differs.

Responses use `Cache-Control: no-store`. JSON downloads are served by `GET /api/snapshots/:id?download=1` with content-sniffing disabled.

## API

### Create

`POST /api/snapshots` accepts `{ "report": TokenScanResult, "expiresInSeconds"?: number }`. Input is limited to 512 KiB and rate limited. Expiry is clamped to five minutes through thirty days.

The response contains public URLs plus a one-time `revocationToken`. Clients must treat that token as a secret.

### Read and download

`GET /api/snapshots/:id` verifies the record before returning it. Add `?download=1` for the canonical public JSON envelope.

### Revoke

`POST /api/snapshots/:id/revoke` accepts `{ "revocationToken": "..." }`. Verification uses a SHA-256 token hash and timing-safe comparison. Revocation is idempotent and does not modify the hashed document.

## Verification

Run:

```bash
npm --prefix frontend run test:risk-snapshots
```

The check covers deterministic EVM, Stellar classic, and Soroban hashing; sensitive-value exclusion; material mutation detection; unknown versions; expiry; revocation; and canonical-identity collisions.
