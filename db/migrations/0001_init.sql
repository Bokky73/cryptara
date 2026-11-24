-- 0001_init.up.sql
-- Canonical forward migration: initial schema.
-- Idempotent: safe to run on a fresh database or re-run after rollback.

CREATE TABLE IF NOT EXISTS tokens (
    address VARCHAR(255) PRIMARY KEY,
    chain VARCHAR(64) NOT NULL,
    symbol VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS risk_reports (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(255) REFERENCES tokens(address),
    buy_risk_score NUMERIC(5, 2) NOT NULL,
    confidence NUMERIC(5, 2) NOT NULL,
    verdict VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS migration_history (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) UNIQUE NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tokens_chain ON tokens(chain);
CREATE INDEX IF NOT EXISTS idx_risk_reports_token_address ON risk_reports(token_address);
CREATE INDEX IF NOT EXISTS idx_risk_reports_created_at ON risk_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_migration_history_migration_name ON migration_history(migration_name);
```

```sql
-- 0001_init.validate.sql
-- Validation for 0001_init: asserts expected tables, columns, and indexes exist.
-- Raises an exception (failing the migration) if any expectation is unmet.

DO $$
DECLARE
    missing TEXT := '';
BEGIN
    -- Tables
    IF to_regclass('public.tokens') IS NULL THEN
        missing := missing || ' table:tokens';
    END IF;
    IF to_regclass('public.risk_reports') IS NULL THEN
        missing := missing || ' table:risk_reports';
    END IF;
    IF to_regclass('public.migration_history') IS NULL THEN
        missing := missing || ' table:migration_history';
    END IF;

    -- Columns: tokens
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tokens' AND column_name = 'address'
    ) THEN missing := missing || ' column:tokens.address'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tokens' AND column_name = 'chain'
    ) THEN missing := missing || ' column:tokens.chain'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tokens' AND column_name = 'symbol'
    ) THEN missing := missing || ' column:tokens.symbol'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tokens' AND column_name = 'name'
    ) THEN missing := missing || ' column:tokens.name'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tokens' AND column_name = 'created_at'
    ) THEN missing := missing || ' column:tokens.created_at'; END IF;

    -- Columns: risk_reports
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'risk_reports' AND column_name = 'id'
    ) THEN missing := missing || ' column:risk_reports.id'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'risk_reports' AND column_name = 'token_address'
    ) THEN missing := missing || ' column:risk_reports.token_address'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'risk_reports' AND column_name = 'buy_risk_score'
    ) THEN missing := missing || ' column:risk_reports.buy_risk_score'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'risk_reports' AND column_name = 'confidence'
    ) THEN missing := missing || ' column:risk_reports.confidence'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'risk_reports' AND column_name = 'verdict'
    ) THEN missing := missing || ' column:risk_reports.verdict'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'risk_reports' AND column_name = 'payload'
    ) THEN missing := missing || ' column:risk_reports.payload'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'risk_reports' AND column_name = 'created_at'
    ) THEN missing := missing || ' column:risk_reports.created_at'; END IF;

    -- Columns: migration_history
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'migration_history' AND column_name = 'id'
    ) THEN missing := missing || ' column:migration_history.id'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'migration_history' AND column_name = 'migration_name'
    ) THEN missing := missing || ' column:migration_history.migration_name'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'migration_history' AND column_name = 'checksum'
    ) THEN missing := missing || ' column:migration_history.checksum'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'migration_history' AND column_name = 'applied_at'
    ) THEN missing := missing || ' column:migration_history.applied_at'; END IF;

    -- Indexes
    IF to_regclass('public.idx_tokens_chain') IS NULL THEN
        missing := missing || ' index:idx_tokens_chain';
    END IF;
    IF to_regclass('public.idx_risk_reports_token_address') IS NULL THEN
        missing := missing || ' index:idx_risk_reports_token_address';
    END IF;
    IF to_regclass('public.idx_risk_reports_created_at') IS NULL THEN
        missing := missing || ' index:idx_risk_reports_created_at';
    END IF;
    IF to_regclass('public.idx_migration_history_migration_name') IS NULL THEN
        missing := missing || ' index:idx_migration_history_migration_name';
    END IF;

    IF missing <> '' THEN
        RAISE EXCEPTION '0001_init validation failed; missing:%', missing;
    END IF;
END
$$;
```

```sql
-- 0001_init.down.sql
-- Rollback for 0001_init. Drops indexes and tables created by the forward migration.
-- Idempotent: safe to run even if partially applied.

DROP INDEX IF EXISTS idx_migration_history_migration_name;
DROP INDEX IF EXISTS idx_risk_reports_created_at;
DROP INDEX IF EXISTS idx_risk_reports_token_address;
DROP INDEX IF EXISTS idx_tokens_chain;

DROP TABLE IF EXISTS migration_history;
DROP TABLE IF EXISTS risk_reports;
DROP TABLE IF EXISTS tokens;