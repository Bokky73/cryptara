# Database migrations

Cryptara runs two parallel migration systems, each serving a different scope:

| System | Directory | Runner | Purpose |
|---|---|---|---|
| Core app schema | `db/migrations/` | `node scripts/migrate.mjs` | Tables owned by the Node API layer (`tokens`, `risk_reports`, `migration_history`) |
| Feature migrations | `frontend/src/server/storage/migrations/` | `psql` / `node scripts/migrate.mjs` | Additive changes to the Supabase-backed storage contract defined in `frontend/src/server/storage/schema.sql` |

The two systems share a `migration_history` tracking table and the same checksum-idempotency contract. Apply the core schema first on a fresh database.

---

## File naming convention

### Core migrations (`db/migrations/`)

```
<NNN>_<description>.sql        # forward migration
<NNN>_<description>.down.sql   # rollback
```

`NNN` is a zero-padded sequence number (`0001`, `0002`, …). Numbers must be monotonically increasing. The runner sorts files lexicographically, so gaps are allowed but reordering applied migrations is not.

Example:
```
db/migrations/0001_init.sql
db/migrations/0001_init.down.sql
```

### Feature migrations (`frontend/src/server/storage/migrations/`)

```
<YYYYMMDD>_<description>.sql           # forward migration
<YYYYMMDD>_<description>.rollback.sql  # rollback
<YYYYMMDD>_<description>.validate.sql  # post-apply validation queries
```

The date prefix orders migrations chronologically. Two migrations on the same date must include a disambiguating suffix (e.g. `20261001_add_index.sql`, `20261001_drop_column.sql`).

---

## Authoring a migration

### 1. Create the forward migration

Write idempotent DDL. Use `IF NOT EXISTS` / `IF EXISTS` guards so the script is safe to replay:

```sql
-- frontend/src/server/storage/migrations/20261001_add_alert_channel.sql
begin;

alter table user_rules
  add column if not exists alert_channel text;

create index if not exists idx_user_rules_alert_channel
  on user_rules (alert_channel)
  where alert_channel is not null;

commit;
```

### 2. Create the rollback file

Rollback must be idempotent and must abort (or be a no-op) when the change to be undone is not present:

```sql
-- frontend/src/server/storage/migrations/20261001_add_alert_channel.rollback.sql
begin;

alter table user_rules
  drop column if exists alert_channel;

commit;
```

### 3. Create the validate file

Validation queries expose data-quality issues that DDL alone cannot catch. They print named result sets and must exit non-zero when any check fails (use `ASSERT` or `RAISE EXCEPTION` where needed):

```sql
-- frontend/src/server/storage/migrations/20261001_add_alert_channel.validate.sql
do $$
begin
  if exists (
    select 1 from user_rules
    where alert_channel is not null
      and alert_channel not in ('email', 'webhook', 'push')
  ) then
    raise exception 'validate: user_rules.alert_channel contains unrecognised values';
  end if;
end $$;

select 'alert_channel_values_ok' as check_name, count(*) as affected_rows
from user_rules
where alert_channel is not null;
```

### 4. Synchronise `schema.sql`

After every accepted feature migration, update `frontend/src/server/storage/schema.sql` to reflect the final column/index set. The file is the authoritative snapshot of the production schema; it must stay in sync so `schema-drift-check` and a fresh `CREATE DATABASE` both produce the same result.

---

## Running migrations locally

Requires a Postgres 16 database reachable via `DATABASE_URL`.

```sh
# Apply all pending core migrations
node scripts/migrate.mjs

# Apply a feature migration directly (psql, with error-stop)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f frontend/src/server/storage/migrations/20261001_add_alert_channel.sql

# Run the validation queries for the same migration
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f frontend/src/server/storage/migrations/20261001_add_alert_channel.validate.sql
```

The runner (`scripts/migrate.mjs`) records each applied migration in `migration_history` with a SHA-256 checksum. Re-running a migration that is already recorded is a no-op; running a modified version of an already-recorded migration is a hard error.

---

## Rolling back

Take a database snapshot before applying any migration. Rollback is not guaranteed to be lossless if rows were written against the new schema between forward apply and rollback.

```sh
# Roll back a feature migration
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f frontend/src/server/storage/migrations/20261001_add_alert_channel.rollback.sql
```

After a successful rollback:

1. Deploy the previous application version.
2. Verify the API's `/api/health` storage check reports healthy.
3. Remove the forward migration file from the branch before merging.

---

## Checking schema drift

`scripts/schema-drift-check.mjs` compares the live database structure against `frontend/src/server/storage/schema.sql` and reports columns, tables, or indexes present in one but not the other.

```sh
node scripts/schema-drift-check.mjs
```

Run this after applying migrations in staging to confirm the live schema matches the committed snapshot before promoting to production. A non-zero exit means `schema.sql` is out of date or the wrong migration was applied.

---

## Zero-downtime DDL rules

Postgres 16 acquires an `AccessExclusiveLock` for most DDL. On a table with active traffic, that lock blocks reads and writes until it is granted. Follow these rules so migrations do not cause downtime.

### Safe operations (no long locks)

- `ADD COLUMN` with a default that is a volatile expression — in Postgres 11+, adding a column with a non-volatile default is a metadata-only change.
- `ADD COLUMN … DEFAULT NULL` — always safe and instant.
- `CREATE TABLE`, `CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`.
- `CREATE TABLE IF NOT EXISTS`, any `IF NOT EXISTS` DDL.

### Unsafe operations — use the expand-and-contract pattern

**Adding `NOT NULL` to an existing column**

Never add `NOT NULL` without a default on a large table in a single migration; it rewrites every row.

Do this across two migrations instead:

```sql
-- Migration 1 (expand): add nullable, backfill, add check constraint
alter table orders add column if not exists status text;
update orders set status = 'pending' where status is null;
alter table orders add constraint orders_status_not_null
  check (status is not null) not valid;
alter table orders validate constraint orders_status_not_null;
```

```sql
-- Migration 2 (contract): once application code always writes the column
alter table orders alter column status set not null;
alter table orders drop constraint if exists orders_status_not_null;
```

**Creating an index on a large table**

Always use `CONCURRENTLY`. Note: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block.

```sql
-- Do not wrap in BEGIN/COMMIT
create index concurrently if not exists idx_orders_status on orders (status);
```

**Renaming a column**

Rename breaks existing queries immediately. Add the new column, dual-write in application code, backfill, then drop the old column in a follow-up migration.

**Dropping a column**

Mark the column ignored in application code first (deploy), then drop it in a subsequent migration window.

---

## Concrete walkthrough — chain-aware identity

The chain-aware identity migration (`20260728_chain_aware_identity`) is the reference example for a production additive migration. It:

- Adds nullable `chain_family` / `network` columns to multiple tables with `ADD COLUMN IF NOT EXISTS` (safe, instant).
- Backfills existing EVM rows without touching Stellar identifiers.
- Runs a named validation report (`chain_identity_migration_report`) that returns non-zero rows for any invalid wallet address, unresolved asset, or duplicate scoped transaction.
- Provides an idempotent rollback that aborts if post-migration uniqueness constraints would collide under the old schema.

Full apply, validate, and rollback commands are documented in [docs/CHAIN_AWARE_IDENTITY_MIGRATION.md](CHAIN_AWARE_IDENTITY_MIGRATION.md).
