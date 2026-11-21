-- Deterministic test seed fixtures for backup/restore drill verification

INSERT INTO wallets (id, address, created_at)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '0x1111111111111111111111111111111111111111', now()),
  ('a0000000-0000-0000-0000-000000000002', '0x2222222222222222222222222222222222222222', now())
ON CONFLICT (address) DO NOTHING;

INSERT INTO token_identities (id, identity_key, wallet_address, contract_address, chain, symbol, token_name)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'evm:8453:0x123', '0x1111111111111111111111111111111111111111', '0x123', 'base', 'DEMO', 'Demo Token')
ON CONFLICT (identity_key) DO NOTHING;

INSERT INTO agent_runs (id, wallet_address, mode, status, recommendation, decision_score, confidence, summary)
VALUES
  ('c0000000-0000-0000-0000-000000000001', '0x1111111111111111111111111111111111111111', 'token_scan', 'completed', 'buy', 85, 0.95, 'Healthy scan')
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_results (id, run_id, agent, status, risk_score, risk_level, verdict, summary, confidence, recommended_action)
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'contract_guard', 'completed', 15, 'low', 'pass', 'Contract is verified and low risk', 0.95, 'allow')
ON CONFLICT (id) DO NOTHING;

INSERT INTO source_snapshots (id, run_id, result_id, agent, label, status)
VALUES
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'contract_guard', 'goplus', 'ok')
ON CONFLICT (id) DO NOTHING;

INSERT INTO recommendations (id, run_id, wallet_address, action, decision_score, confidence, summary)
VALUES
  ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '0x1111111111111111111111111111111111111111', 'buy', 85, 0.95, 'Recommendation: safe to proceed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO approvals (id, wallet_address, decision_id, tx_hash, network, action, asset, value_usd, status)
VALUES
  ('a1000000-0000-0000-0000-000000000001', '0x1111111111111111111111111111111111111111', 'c0000000-0000-0000-0000-000000000001', '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', 'base', 'buy', 'USDC', 100, 'confirmed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO transactions (id, wallet_address, tx_hash, type, asset, value_usd, status, lifecycle_status, chain_family, network)
VALUES
  ('a2000000-0000-0000-0000-000000000001', '0x1111111111111111111111111111111111111111', '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', 'swap', 'USDC', 100, 'confirmed', 'confirmed', 'evm', 'base')
ON CONFLICT (tx_hash) DO NOTHING;

INSERT INTO x402_payment_receipts (id, request_id, payment_header_hash, wallet_address, network, asset, amount, price_usd, pay_to, facilitator_url, protected_resource, request_body_hash, verification_status)
VALUES
  ('a3000000-0000-0000-0000-000000000001', 'req_123', 'hash_123', '0x1111111111111111111111111111111111111111', 'eip155:8453', 'USDC', '10000', '$0.01', '0x000000000000000000000000000000000000dEaD', 'https://x402.org/facilitator', '/api/deep-scan', 'body_hash', 'verified')
ON CONFLICT (payment_header_hash) DO NOTHING;

INSERT INTO risk_snapshots (id, schema_version, snapshot, canonical_hash, identity_key, revocation_token_hash, created_at, expires_at)
VALUES
  ('snap_1', '1.0', '{}'::jsonb, 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'evm:8453:0x123', 'rev_hash', now(), now() + interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_rules (id, wallet_address, max_risk_score, max_trade_percent, max_meme_exposure_percent)
VALUES
  ('a4000000-0000-0000-0000-000000000001', '0x1111111111111111111111111111111111111111', 50, 10, 5)
ON CONFLICT (wallet_address) DO NOTHING;

INSERT INTO alert_rules (id, wallet_address, trigger_type, threshold)
VALUES
  ('rule_1', '0x1111111111111111111111111111111111111111', 'critical_risk', 80)
ON CONFLICT (id) DO NOTHING;

INSERT INTO alerts (id, wallet_address, rule_id, trigger_type, observation_key, status, severity, message, before_value, after_value)
VALUES
  ('alert_1', '0x1111111111111111111111111111111111111111', 'rule_1', 'critical_risk', 'risk_score', 'triggered', 'high', 'Risk exceeded', 50, 85)
ON CONFLICT (id) DO NOTHING;

INSERT INTO watchlist_entries (id, wallet_address, identity_key, chain, source)
VALUES
  ('watch_1', '0x1111111111111111111111111111111111111111', 'evm:8453:0x123', 'base', 'manual')
ON CONFLICT (id) DO NOTHING;
