-- Rollback for 0001_init
-- Reverses the initial schema created by 0001_init.up.sql.
-- Idempotent: safe to run multiple times.

DROP INDEX IF EXISTS idx_tokens_user_id;
DROP INDEX IF EXISTS idx_risk_reports_token_id;
DROP INDEX IF EXISTS idx_risk_reports_created_at;

DROP TABLE IF EXISTS migration_history;
DROP TABLE IF EXISTS risk_reports;
DROP TABLE IF EXISTS tokens;