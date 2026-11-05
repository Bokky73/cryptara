-- Cryptara production storage contract.
-- Target: Supabase Postgres. This file is intentionally idempotent so the
-- MVP can apply the schema in one clean migration.

create extension if not exists pgcrypto;
-- pgcrypto is preserved for backwards compatibility with deployments that
-- still hold legacy uuid alert tables; the active alert schema now uses
-- text primary keys so that string ids minted by the storage layer
-- (e.g. "alert_…") mirror directly without an implicit cast.

create table if not exists wallets (
  id uuid primary key default gen_random_uuid(),
  address text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists token_identities (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique,
  wallet_address text,
  contract_address text,
  chain text,
  symbol text,
  token_name text,
  website_url text,
  twitter_url text,
  telegram_url text,
  coingecko_id text,
  dex_screener_pair_url text,
  confidence numeric not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  mode text check (mode in ('portfolio_review', 'token_scan', 'pre_buy_check', 'holding_review', 'execution_prepare', 'discovery_candidate')),
  input_snapshot jsonb not null default '{}'::jsonb,
  target_symbol text,
  target_name text,
  target_address text,
  target_chain text,
  target_token_data jsonb,
  status text not null check (status in ('completed', 'partial', 'failed')),
  recommendation text not null,
  decision_score integer not null,
  confidence numeric not null,
  summary text not null,
  source_statuses jsonb not null default '[]'::jsonb,
  user_action text not null default 'pending' check (user_action in ('pending', 'approved', 'rejected', 'adjusted', 'executed')),
  created_at timestamptz not null default now()
);

create table if not exists agent_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  agent text not null,
  status text not null,
  risk_score integer not null,
  risk_level text not null,
  verdict text not null,
  summary text not null,
  findings jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  data_quality jsonb not null default '{}'::jsonb,
  confidence numeric not null,
  recommended_action text not null,
  blocking_reasons jsonb not null default '[]'::jsonb,
  missing_data jsonb not null default '[]'::jsonb,
  raw_signals jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists source_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs(id) on delete cascade,
  result_id uuid references agent_results(id) on delete cascade,
  agent text not null,
  label text not null,
  url text,
  status text not null,
  checked_at timestamptz,
  latency_ms integer,
  reliability numeric,
  error text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists recommendations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references agent_runs(id) on delete set null,
  wallet_address text not null,
  action text not null,
  decision_score integer not null,
  confidence numeric not null,
  summary text not null,
  decision_explanation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  decision_id text,
  tx_hash text not null,
  network text,
  action text,
  asset text,
  value_usd numeric,
  status text not null default 'confirmed',
  auto_executed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_address text,
  decision_id text,
  decision_action text,
  tx_hash text not null unique,
  type text not null,
  asset text not null,
  value_usd numeric not null default 0,
  status text not null,
  lifecycle_status text not null check (lifecycle_status in ('prepared', 'user_rejected', 'submitted', 'confirming', 'confirmed', 'failed', 'replaced', 'reorged', 'dropped', 'manual_review', 'expired', 'pending')),
  chain_family text not null default 'evm' check (chain_family in ('evm', 'stellar')),
  source_account text,
  expected_effects jsonb not null default '[]'::jsonb,
  idempotency_key text,
  explorer_url text,
  failure_reason text,
  submitted_at timestamptz,
  terminal_at timestamptz,
  last_polled_at timestamptz,
  poll_attempts integer not null default 0,
  confirmation_count integer not null default 0,
  required_confirmations integer not null default 1,
  finality_reached boolean not null default false,
  replacement_hash text,
  last_observed_block_hash text,
  missing_observation_count integer not null default 0,
  manual_review_reason text,
  observation_count integer not null default 0,
  network text not null,
  user_approved boolean not null default false,
  simulation_status text,
  policy_status jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Migrate existing transactions table: add lifecycle columns that may not exist
alter table transactions add column if not exists lifecycle_status text;
alter table transactions add column if not exists chain_family text not null default 'evm';
alter table transactions add column if not exists source_account text;
alter table transactions add column if not exists expected_effects jsonb not null default '[]'::jsonb;
alter table transactions add column if not exists idempotency_key text;
alter table transactions add column if not exists explorer_url text;
alter table transactions add column if not exists failure_reason text;
alter table transactions add column if not exists submitted_at timestamptz;
alter table transactions add column if not exists terminal_at timestamptz;
alter table transactions add column if not exists last_polled_at timestamptz;
alter table transactions add column if not exists poll_attempts integer not null default 0;
alter table transactions add column if not exists confirmation_count integer not null default 0;
alter table transactions add column if not exists required_confirmations integer not null default 1;
alter table transactions add column if not exists finality_reached boolean not null default false;
alter table transactions add column if not exists replacement_hash text;
alter table transactions add column if not exists last_observed_block_hash text;
alter table transactions add column if not exists missing_observation_count integer not null default 0;
alter table transactions add column if not exists manual_review_reason text;
alter table transactions add column if not exists observation_count integer not null default 0;
alter table transactions add column if not exists user_approved boolean not null default false;
alter table transactions add column if not exists simulation_status text;
alter table transactions add column if not exists policy_status jsonb not null default '{}'::jsonb;
alter table transactions add column if not exists decision_action text;
alter table transactions add column if not exists decision_id text;

-- Add check constraint for lifecycle_status if the table already existed
alter table transactions drop constraint if exists transactions_lifecycle_status_check;
alter table transactions add constraint transactions_lifecycle_status_check
  check (lifecycle_status in ('prepared', 'user_rejected', 'submitted', 'confirming', 'confirmed', 'failed', 'replaced', 'reorged', 'dropped', 'manual_review', 'expired', 'pending'));

-- Backfill (idempotent): for rows that pre-date the V2 columns, lift the legacy status into
-- the lifecycle_status column. Existing rows that already carry a curated lifecycle_status
-- value are left untouched.
update transactions
   set lifecycle_status = status
 where lifecycle_status not in ('prepared', 'user_rejected', 'submitted', 'confirming', 'confirmed', 'failed', 'replaced', 'reorged', 'dropped', 'manual_review', 'expired', 'pending');

create unique index if not exists transactions_idempotency_wallet_idx
  on transactions(wallet_address, idempotency_key)
  where idempotency_key is not null;
create table if not exists transaction_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  transaction_hash text not null references transactions(tx_hash) on delete cascade,
  event text not null check (event in ('prepared', 'submitted', 'submission_failed', 'user_rejected', 'polled', 'observation_recorded', 'confirmation_progress', 'provider_disagreement', 'reorg_detected', 'replacement_detected', 'dropped_detected', 'manual_review_required', 'confirmed', 'failed', 'replaced', 'expired', 'duplicate_rejected')),
  detail jsonb not null default '{}'::jsonb,
  provider text,
  provider_url text,
  occurred_at timestamptz not null default now()
);

create index if not exists transaction_lifecycle_events_hash_occurred_idx
  on transaction_lifecycle_events(transaction_hash, occurred_at desc);

create table if not exists transaction_observations (
  id text primary key,
  transaction_hash text not null references transactions(tx_hash) on delete cascade,
  evidence_key text not null,
  chain_family text not null check (chain_family in ('evm', 'stellar')),
  network text not null,
  provider text not null,
  provider_url text,
  status text not null check (status in ('not_found', 'pending', 'included', 'confirmed', 'failed', 'replaced', 'expired', 'duplicate', 'provider_disagreement')),
  block_number bigint,
  block_hash text,
  ledger_sequence bigint,
  confirmations integer not null default 0,
  required_confirmations integer not null default 1,
  replacement_hash text,
  nonce bigint,
  detail text,
  observed_at timestamptz not null default now(),
  unique(transaction_hash, evidence_key)
);
create index if not exists transaction_observations_hash_observed_idx on transaction_observations(transaction_hash, observed_at desc);

create table if not exists x402_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  payment_header_hash text not null unique,
  wallet_address text,
  payer text,
  transaction_hash text,
  chain_family text not null default 'evm' check (chain_family in ('evm', 'stellar')),
  payer_identity jsonb not null default '{}'::jsonb,
  network text not null,
  asset text not null,
  amount text not null,
  price_usd text not null,
  pay_to text not null,
  facilitator_url text not null,
  protected_resource text not null,
  request_body_hash text not null,
  payment_expiry timestamptz,
  verification_status text not null check (verification_status in ('payment_required', 'verified', 'settled', 'failed', 'duplicate', 'expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Settlement state is kept separate from request receipts so a premium
-- response can be retried without losing the facilitator reconciliation
-- record. Raw payment payloads are never stored; payload_ref and
-- request_body_hash are content references only.
create table if not exists x402_settlement_ledger (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  request_id text not null,
  protected_resource text not null,
  request_body_hash text not null,
  payload_ref text,
  chain_family text not null check (chain_family in ('evm', 'stellar')),
  network text not null,
  canonical_asset text not null,
  amount text not null,
  pay_to text not null,
  payer_redacted text,
  transaction_hash text,
  status text not null check (status in ('required', 'submitted', 'verified', 'served', 'failed', 'expired', 'refunded')),
  failure_reason text,
  reconciliation jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists x402_settlement_ledger_status_expiry_idx
  on x402_settlement_ledger(status, expires_at);

-- Immutable, privacy-redacted public risk report snapshots. Only revoked_at
-- may change after insertion; the canonical hash covers the public document.
create table if not exists risk_snapshots (
  id text primary key,
  schema_version text not null,
  snapshot jsonb not null,
  canonical_hash text not null,
  identity_key text not null,
  revocation_token_hash text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint risk_snapshots_hash_format check (canonical_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint risk_snapshots_expiry_order check (expires_at > created_at)
);
create index if not exists risk_snapshots_hash_idx on risk_snapshots(canonical_hash);
create index if not exists risk_snapshots_identity_created_idx on risk_snapshots(identity_key, created_at desc);
create index if not exists risk_snapshots_expiry_idx on risk_snapshots(expires_at) where revoked_at is null;

create or replace function enforce_risk_snapshot_immutability()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
    or new.schema_version is distinct from old.schema_version
    or new.snapshot is distinct from old.snapshot
    or new.canonical_hash is distinct from old.canonical_hash
    or new.identity_key is distinct from old.identity_key
    or new.revocation_token_hash is distinct from old.revocation_token_hash
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
  then
    raise exception 'risk snapshots are immutable except for first revocation';
  end if;
  return new;
end;
$$;
drop trigger if exists risk_snapshots_immutable on risk_snapshots;
create trigger risk_snapshots_immutable before update on risk_snapshots
for each row execute function enforce_risk_snapshot_immutability();

-- V3 emergency pause / agent revoke / allowance / trustline recovery
create table if not exists recovery_requests (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  recovery_type text not null check (recovery_type in ('pause_agent', 'revoke_agent', 'reduce_allowance', 'revoke_allowance', 'remove_trustline')),
  asset text,
  consumer text,
  chain_id text,
  chain_family text,
  status text not null check (status in ('requested', 'prepared', 'submitted', 'confirmed', 'failed', 'stale')),
  incident_mode boolean not null default false,
  consequences jsonb not null default '[]'::jsonb,
  reserved_native_amount text,
  expected_fee text,
  policy_version text not null default 'v3.0.0',
  last_verified_ledger bigint,
  last_verified_block_number bigint,
  amount text,
  reason text,
  error text,
  requested_at timestamptz not null default now(),
  prepared_at timestamptz,
  submitted_at timestamptz,
  tx_hash text,
  confirmed_at timestamptz,
  stale_at timestamptz,
  updated_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists recovery_requests_wallet_updated_idx on recovery_requests(wallet_address, updated_at desc);
create index if not exists recovery_requests_status_idx on recovery_requests(status);
create unique index if not exists recovery_requests_active_unique on recovery_requests(wallet_address, recovery_type, coalesce(asset, E'\0'), coalesce(consumer, E'\0'))
  where status in ('requested', 'prepared');

create table if not exists user_rules (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null unique,
  max_risk_score integer not null,
  max_trade_percent numeric not null,
  max_meme_exposure_percent numeric not null,
  max_daily_transaction_value_usd numeric not null default 1000,
  max_slippage_bps integer not null default 100,
  allowed_chains jsonb not null default '[]'::jsonb,
  blocked_tokens jsonb not null default '[]'::jsonb,
  allowed_actions jsonb not null default '[]'::jsonb,
  auto_execute boolean not null default false,
  created_at timestamptz not null default now()
);

-- V3 auto-mode onboarding is deliberately isolated from mutable V2 rules.
-- Missing policy/authorization fields remain null so a migrated row can
-- never become eligible through server defaults.
create table if not exists auto_mode_policies (
  wallet_address text primary key,
  policy_version integer not null check (policy_version > 0),
  policy jsonb not null,
  policy_hash text,
  requested_enabled boolean not null default false,
  effective_enabled boolean not null default false,
  explanation_accepted_at timestamptz,
  authorization_status text not null default 'pending'
    check (authorization_status in ('pending', 'authorized', 'cancelled', 'rejected', 'expired')),
  authorization_policy_hash text,
  authorization_proof_id text,
  signed_payload_hash text,
  authorized_at timestamptz,
  authorization_expires_at timestamptz,
  allowance_usd numeric,
  contract_address text,
  contract_network text,
  contract_policy_version text,
  contract_verified boolean not null default false,
  contract_verification_id text,
  contract_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists auto_mode_authorization_events (
  id text primary key,
  wallet_address text not null references auto_mode_policies(wallet_address) on delete cascade,
  event text not null
    check (event in ('policy_saved', 'expansion_confirmed', 'authorization_requested', 'authorized', 'cancelled', 'rejected', 'expired')),
  policy_hash text,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists auto_mode_authorization_events_wallet_occurred_idx
  on auto_mode_authorization_events(wallet_address, occurred_at desc);

-- Legacy strategy rows are never an auto-mode authorization. Applying this
-- additive migration is intentionally fail-closed for all pre-V3 users.
update user_rules set auto_execute = false where auto_execute is distinct from false;

create index if not exists agent_runs_wallet_created_idx on agent_runs(wallet_address, created_at desc);
create index if not exists agent_results_run_agent_idx on agent_results(run_id, agent);
create index if not exists source_snapshots_run_agent_idx on source_snapshots(run_id, agent);
create index if not exists recommendations_wallet_created_idx on recommendations(wallet_address, created_at desc);
create index if not exists transactions_wallet_created_idx on transactions(wallet_address, created_at desc);
create index if not exists approvals_wallet_created_idx on approvals(wallet_address, created_at desc);
create index if not exists x402_payment_receipts_resource_created_idx on x402_payment_receipts(protected_resource, created_at desc);

-- Idempotent migration for the V3 alert engine. The original schema
-- declared alert_*.id as `uuid primary key default gen_random_uuid()`,
-- but the storage layer mints prefixed string ids (`alert_…`, `rule_…`)
-- for portability with downstream in-memory + Postgres parity. Existing
-- deployments created under the previous contract therefore need their
-- primary keys and the rule_id / alert_id reference columns widened
-- from `uuid` to `text` so the new mirror INSERTs succeed. The blocks
-- below are no-ops on a fresh deployment that already declares the
-- tables with text columns, because Postgres treats `text` and
-- `varchar` as already widened.
do $$
begin
  begin
    alter table alert_rules alter column id type text using id::text;
  exception when others then null;
  end;
  begin
    alter table alert_observations alter column id type text using id::text;
  exception when others then null;
  end;
  begin
    alter table alerts alter column id type text using id::text;
  exception when others then null;
  end;
  begin
    alter table alerts alter column rule_id type text using rule_id::text;
  exception when others then null;
  end;
  begin
    alter table alert_deliveries alter column id type text using id::text;
  exception when others then null;
  end;
  begin
    alter table alert_deliveries alter column alert_id type text using alert_id::text;
  exception when others then null;
  end;
  begin
    alter table transactions alter column wallet_address drop not null;
  exception when others then null;
  end;
  begin
    alter table alert_observations add column if not exists incomplete_data boolean default false;
  exception when others then null;
  end;
  -- Widen watchlist table IDs from uuid to text to match in-memory string IDs.
  -- On existing PostgreSQL deployments the base schema declared watchlist_entries.id
  -- and watchlist_scan_runs.id as uuid with foreign keys between them.  PostgreSQL
  -- rejects ALTER COLUMN TYPE on a referenced primary key unless the child foreign
  -- keys are dropped first.  We therefore drop every FK that involves a watchlist
  -- UUID column, widen all affected columns, then recreate the FKs.
  begin
    alter table watchlist_scan_runs drop constraint if exists watchlist_scan_runs_entry_id_fkey;
  exception when others then null;
  end;
  begin
    alter table watchlist_scan_runs drop constraint if exists watchlist_scan_runs_previous_run_id_fkey;
  exception when others then null;
  end;
  begin
    alter table discovery_alerts drop constraint if exists discovery_alerts_entry_id_fkey;
  exception when others then null;
  end;
  begin
    alter table discovery_alerts drop constraint if exists discovery_alerts_run_id_fkey;
  exception when others then null;
  end;
  -- Now widen all watchlist/discovery columns from uuid to text.
  begin
    alter table watchlist_entries alter column id type text using id::text;
  exception when others then null;
  end;
  begin
    alter table watchlist_entries alter column latest_scan_run_id type text using latest_scan_run_id::text;
  exception when others then null;
  end;
  begin
    alter table watchlist_scan_runs alter column id type text using id::text;
  exception when others then null;
  end;
  begin
    alter table watchlist_scan_runs alter column entry_id type text using entry_id::text;
  exception when others then null;
  end;
  begin
    alter table watchlist_scan_runs alter column previous_run_id type text using previous_run_id::text;
  exception when others then null;
  end;
  begin
    alter table discovery_alerts alter column entry_id type text using entry_id::text;
  exception when others then null;
  end;
  begin
    alter table discovery_alerts alter column run_id type text using run_id::text;
  exception when others then null;
  end;
  -- Recreate the foreign key constraints that were dropped above.
  begin
    alter table watchlist_scan_runs add constraint watchlist_scan_runs_entry_id_fkey
      foreign key (entry_id) references watchlist_entries(id) on delete cascade;
  exception when others then null;
  end;
  begin
    alter table watchlist_scan_runs add constraint watchlist_scan_runs_previous_run_id_fkey
      foreign key (previous_run_id) references watchlist_scan_runs(id) on delete set null;
  exception when others then null;
  end;
  begin
    alter table discovery_alerts add constraint discovery_alerts_entry_id_fkey
      foreign key (entry_id) references watchlist_entries(id) on delete cascade;
  exception when others then null;
  end;
  begin
    alter table discovery_alerts add constraint discovery_alerts_run_id_fkey
      foreign key (run_id) references watchlist_scan_runs(id) on delete set null;
  exception when others then null;
  end;
  -- Add columns that the base schema may not have (fresh CREATE TABLE handles these already).
  -- Existing deployments created before the V3 discovery migration need these added.
  begin
    alter table watchlist_entries add column if not exists network text;
  exception when others then null;
  end;
  begin
    alter table watchlist_entries add column if not exists latest_status text;
  exception when others then null;
  end;
  begin
    alter table watchlist_entries add column if not exists last_scanned_at timestamptz;
  exception when others then null;
  end;
  begin
    alter table watchlist_entries add column if not exists latest_classification text;
  exception when others then null;
  end;
  begin
    alter table watchlist_entries add column if not exists latest_score integer;
  exception when others then null;
  end;
  begin
    alter table watchlist_entries add column if not exists pair_address text;
  exception when others then null;
  end;
  begin
    alter table watchlist_entries add column if not exists token_name text;
  exception when others then null;
  end;
  begin
    alter table watchlist_entries add column if not exists asset_key text;
  exception when others then null;
  end;
  begin
    alter table watchlist_entries add column if not exists issuer text;
  exception when others then null;
  end;
  -- Widen the asset_type check constraint to include sac and sep41 (added in V3).
  begin
    alter table watchlist_entries drop constraint if exists watchlist_entries_asset_type_check;
    alter table watchlist_entries add constraint watchlist_entries_asset_type_check
      check (asset_type in ('native', 'classic', 'contract', 'issuer_account', 'sac', 'sep41'));
  exception when others then null;
  end;
  -- Add missing columns on watchlist_scan_runs for existing deployments.
  begin
    alter table watchlist_scan_runs add column if not exists identity_key text;
  exception when others then null;
  end;
  begin
    alter table watchlist_scan_runs add column if not exists classification_reasons jsonb not null default '[]'::jsonb;
  exception when others then null;
  end;
  begin
    alter table watchlist_scan_runs add column if not exists source_lineage jsonb not null default '[]'::jsonb;
  exception when others then null;
  end;
  begin
    alter table watchlist_scan_runs add column if not exists missing_data jsonb not null default '[]'::jsonb;
  exception when others then null;
  end;
  begin
    alter table watchlist_scan_runs add column if not exists risk_report jsonb;
  exception when others then null;
  end;
  begin
    alter table watchlist_scan_runs add column if not exists agent_run_id uuid;
  exception when others then null;
  end;
end $$;

-- V3 alert engine contract.
-- alert_rules: durable, scope-bound (wallet_address) alert definitions.
-- alert_observations: append-only typed signal observations extracted from agent runs.
-- alerts: persisted trigger/recovery lifecycle bound to a rule.
-- alert_deliveries: fan-out audit row per channel per alert (in_app, email, telegram, discord).
create table if not exists alert_rules (
  id text primary key,
  wallet_address text not null,
  trigger_type text not null check (trigger_type in (
    'critical_risk',
    'liquidity_drop',
    'holder_concentration_change',
    'tax_control_change',
    'phishing_detected',
    'exploit_news',
    'portfolio_concentration',
    'stable_reserve_change',
    'stellar_issuer_auth',
    'stellar_clawback',
    'stellar_trustline',
    'stellar_contract_ttl',
    'rpc_degradation'
  )),
  observation_key text,
  threshold numeric not null,
  hysteresis numeric not null default 0,
  cooldown_minutes integer not null default 60,
  direction text not null default 'high_is_bad' check (direction in ('high_is_bad', 'low_is_bad')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists alert_observations (
  id text primary key,
  wallet_address text not null,
  trigger_type text not null,
  observation_key text not null,
  value numeric not null,
  direction text not null check (direction in ('high_is_bad', 'low_is_bad')),
  evidence jsonb not null default '{}'::jsonb,
  incomplete_data boolean default false,
  created_at timestamptz not null default now()
);

create table if not exists alerts (
  id text primary key,
  wallet_address text not null,
  rule_id text not null references alert_rules(id) on delete cascade,
  trigger_type text not null,
  observation_key text not null,
  status text not null check (status in ('triggered', 'recovered', 'acknowledged')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  message text not null,
  before_value numeric not null,
  after_value numeric not null,
  evidence_before jsonb not null default '{}'::jsonb,
  evidence_after jsonb not null default '{}'::jsonb,
  evidence_data jsonb not null default '{}'::jsonb,
  delivery_summary jsonb not null default '{}'::jsonb,
  triggered_at timestamptz not null default now(),
  recovered_at timestamptz,
  acknowledged_at timestamptz
);

create table if not exists alert_deliveries (
  id text primary key,
  alert_id text not null references alerts(id) on delete cascade,
  wallet_address text not null,
  channel text not null check (channel in ('in_app', 'email', 'telegram', 'discord')),
  status text not null check (status in ('pending', 'delivered', 'failed', 'skipped')),
  error_detail text,
  sanitized_payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  idempotency_key text,
  provider_message_id text,
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  terminal boolean not null default false
);

alter table alert_deliveries add column if not exists idempotency_key text;
alter table alert_deliveries add column if not exists provider_message_id text;
alter table alert_deliveries add column if not exists next_retry_at timestamptz;
alter table alert_deliveries add column if not exists last_attempt_at timestamptz;
alter table alert_deliveries add column if not exists terminal boolean;
alter table alert_deliveries alter column terminal set default false;

create index if not exists alert_rules_wallet_enabled_idx on alert_rules(wallet_address, enabled);
create index if not exists alert_observations_wallet_trigger_idx on alert_observations(wallet_address, trigger_type, observation_key, created_at desc);
create index if not exists alerts_wallet_status_idx on alerts(wallet_address, status, triggered_at desc);
create index if not exists alert_deliveries_alert_idx on alert_deliveries(alert_id, channel);
create unique index if not exists alert_deliveries_idempotency_wallet_idx
  on alert_deliveries(wallet_address, idempotency_key)
  where idempotency_key is not null;

-- Notification preferences & delivery routing (issue #152).
-- One row per (wallet_address, chain_family, network) scope. The nested
-- per-channel / quiet-hours / digest shape is stored as a JSONB blob so the
-- typed model can evolve without a schema migration per field.
create table if not exists notification_preferences (
  id text primary key,
  wallet_address text not null,
  chain_family text not null default 'evm' check (chain_family in ('evm', 'stellar')),
  network text not null default 'legacy-evm',
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists notification_preferences_wallet_idx
  on notification_preferences(wallet_address, chain_family, network);

-- Watchlist & discovery tables (upstream V3 discovery).
create table if not exists watchlist_entries (
  id text primary key,
  wallet_address text not null,
  identity_key text not null,
  chain text not null,
  network text,
  contract_address text,
  pair_address text,
  symbol text,
  token_name text,
  asset_key text,
  issuer text,
  asset_type text check (asset_type in ('native', 'classic', 'contract', 'issuer_account', 'sac', 'sep41')),
  source text not null,
  note text,
  last_scanned_at timestamptz,
  latest_scan_run_id text,
  latest_classification text check (latest_classification in ('watch', 'risky', 'scam', 'early_opportunity')),
  latest_score integer,
  latest_status text check (latest_status in ('completed', 'partial', 'failed', 'stale')),
  created_at timestamptz not null default now()
);

create unique index if not exists watchlist_entries_wallet_identity_uniq on watchlist_entries(wallet_address, identity_key);
create index if not exists watchlist_entries_wallet_created_idx on watchlist_entries(wallet_address, created_at desc);

create table if not exists watchlist_scan_runs (
  id text primary key,
  entry_id text not null references watchlist_entries(id) on delete cascade,
  wallet_address text not null,
  identity_key text not null,
  agent_run_id uuid references agent_runs(id) on delete set null,
  classification text not null check (classification in ('watch', 'risky', 'scam', 'early_opportunity')),
  classification_reasons jsonb not null default '[]'::jsonb,
  confidence numeric not null,
  score integer not null,
  source_lineage jsonb not null default '[]'::jsonb,
  missing_data jsonb not null default '[]'::jsonb,
  risk_report jsonb,
  status text not null check (status in ('completed', 'partial', 'failed', 'stale')),
  previous_run_id text references watchlist_scan_runs(id) on delete set null,
  scanned_at timestamptz not null default now()
);

create index if not exists watchlist_scan_runs_entry_scanned_idx on watchlist_scan_runs(entry_id, scanned_at desc);
create index if not exists watchlist_scan_runs_wallet_scanned_idx on watchlist_scan_runs(wallet_address, scanned_at desc);

create table if not exists discovery_alerts (
  id text primary key,
  wallet_address text not null,
  entry_id text references watchlist_entries(id) on delete cascade,
  run_id text references watchlist_scan_runs(id) on delete set null,
  kind text not null check (kind in ('critical_risk', 'liquidity_drop', 'holder_concentration', 'social_phishing', 'news_incident', 'classification_change')),
  title text not null,
  detail text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  source_label text,
  acknowledged boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists discovery_alerts_wallet_created_idx on discovery_alerts(wallet_address, created_at desc);
create index if not exists discovery_alerts_entry_created_idx on discovery_alerts(entry_id, created_at desc);

-- Capability decisions are append-only and retain only a one-way subject hash.
create table if not exists authz_audit_entries (
  id text primary key,
  occurred_at timestamptz not null default now(),
  subject_hash text not null,
  subject_kind text not null check (subject_kind in ('anonymous', 'wallet')),
  capability text not null,
  resource_id text,
  chain_family text check (chain_family in ('evm', 'stellar')),
  network text,
  decision text not null check (decision in ('allow', 'deny')),
  reason text not null
);

create index if not exists authz_audit_subject_idx on authz_audit_entries(subject_hash, occurred_at desc);
-- Watchlist portability (Issue #106)
-- Bulk imports utilize the existing watchlist_entries schema.

-- ─────────────────────────────────────────────────────────────────────────────
-- Retention & Erasure — V4 Privacy Enforcement Schema
-- ─────────────────────────────────────────────────────────────────────────────

-- erasure_receipts: tamper-evident proof of wallet data erasure.
-- Contains only a one-way wallet hash (SHA-256) — never the raw address.
-- Append-only: rows are never updated after insertion.
create table if not exists erasure_receipts (
  receipt_id text primary key,
  wallet_hash text not null,           -- SHA-256(walletAddress) — not the raw address
  chain_family text not null check (chain_family in ('evm', 'stellar')),
  network text,                        -- optional network qualifier
  erased_at timestamptz not null,      -- when the erasure completed
  sha256 text not null,                -- SHA-256 of the canonical receipt body
  receipt_body jsonb not null,         -- full receipt for independent verification
  created_at timestamptz not null default now()
);

create index if not exists erasure_receipts_wallet_hash_idx on erasure_receipts(wallet_hash, created_at desc);
create index if not exists erasure_receipts_erased_at_idx on erasure_receipts(erased_at desc);

-- Immutability: only insertion is permitted after creation.
create or replace function enforce_erasure_receipt_immutability()
returns trigger language plpgsql as $$
begin
  raise exception 'erasure_receipts rows are immutable';
end;
$$;

drop trigger if exists erasure_receipts_immutable on erasure_receipts;
create trigger erasure_receipts_immutable before update on erasure_receipts
for each row execute function enforce_erasure_receipt_immutability();

-- Retention policy summary view (informational — operators may query this).
create or replace view retention_policy_summary as
select
  unnest(array[
    'wallets','agent_runs','agent_results','source_snapshots',
    'recommendations','approvals','transactions','x402_payment_receipts','x402_settlement_ledger',
    'user_rules','alert_rules','alert_observations','alerts',
    'alert_deliveries','watchlist_entries','watchlist_scan_runs',
    'discovery_alerts','recovery_requests','risk_snapshots',
    'token_identities','erasure_receipts'
  ]) as table_name,
  unnest(array[
    0,90,90,90,
    90,180,365,1095,1095,
    0,0,30,90,
    90,0,90,
    90,365,0,
    0,0
  ]::int[]) as retention_days,
  unnest(array[
    'delete','delete','delete','delete',
    'delete','delete','anonymize','anonymize',
    'delete','delete','delete','delete',
    'delete','delete','delete',
    'delete','delete','delete',
    'anonymize','delete'
  ]) as strategy;
