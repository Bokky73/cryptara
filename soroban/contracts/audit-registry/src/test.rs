extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env,
};

const NOW: u64 = 1_700_000_000;

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn zero_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

/// Deploy the contract with a user who has committed to a policy and authorized
/// one agent for an hour.
fn setup() -> (
    Env,
    AuditRegistryClient<'static>,
    Address,
    Address,
    BytesN<32>,
) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(NOW);

    let contract_id = env.register(AuditRegistry, ());
    let client = AuditRegistryClient::new(&env, &contract_id);
    let user = Address::generate(&env);
    let agent = Address::generate(&env);
    let policy = hash(&env, 1);

    client.set_policy(&user, &policy);
    client.authorize_agent(&user, &agent, &policy, &(NOW + 3_600));

    (env, client, user, agent, policy)
}

// ---------------------------------------------------------------------------
// Version and non-custody
// ---------------------------------------------------------------------------

#[test]
fn reports_its_interface_version() {
    let (_env, client, _, _, _) = setup();
    assert_eq!(client.version(), VERSION);
}

// ---------------------------------------------------------------------------
// Policy and authorization
// ---------------------------------------------------------------------------

#[test]
fn records_policy_and_authorization() {
    let (env, client, user, agent, policy) = setup();

    assert_eq!(client.policy_of(&user), Some(policy.clone()));
    assert!(client.is_agent_live(&user, &agent));

    let authorization = client.authorization_of(&user, &agent).unwrap();
    assert_eq!(authorization.policy_hash, policy);
    assert_eq!(authorization.expires_at, NOW + 3_600);
    assert!(authorization.active);

    // An agent that was never authorized is not live.
    let stranger = Address::generate(&env);
    assert!(!client.is_agent_live(&user, &stranger));
    assert_eq!(client.authorization_of(&user, &stranger), None);
}

#[test]
fn rejects_zero_hashes() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(NOW);
    let client = AuditRegistryClient::new(&env, &env.register(AuditRegistry, ()));
    let user = Address::generate(&env);
    let agent = Address::generate(&env);

    assert_eq!(
        client.try_set_policy(&user, &zero_hash(&env)),
        Err(Ok(AuditError::ZeroHash))
    );

    client.set_policy(&user, &hash(&env, 1));
    assert_eq!(
        client.try_authorize_agent(&user, &agent, &zero_hash(&env), &(NOW + 60)),
        Err(Ok(AuditError::ZeroHash))
    );
}

#[test]
fn authorization_requires_a_committed_policy() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(NOW);
    let client = AuditRegistryClient::new(&env, &env.register(AuditRegistry, ()));
    let user = Address::generate(&env);
    let agent = Address::generate(&env);

    // No policy set at all.
    assert_eq!(
        client.try_authorize_agent(&user, &agent, &hash(&env, 1), &(NOW + 60)),
        Err(Ok(AuditError::PolicyNotSet))
    );

    // A policy that is not the one the user committed to.
    client.set_policy(&user, &hash(&env, 1));
    assert_eq!(
        client.try_authorize_agent(&user, &agent, &hash(&env, 2), &(NOW + 60)),
        Err(Ok(AuditError::PolicyMismatch))
    );
}

#[test]
fn rejects_bad_authorization_windows() {
    let (env, client, user, _, policy) = setup();
    let agent = Address::generate(&env);

    assert_eq!(
        client.try_authorize_agent(&user, &agent, &policy, &NOW),
        Err(Ok(AuditError::ExpiryInPast))
    );
    assert_eq!(
        client.try_authorize_agent(&user, &agent, &policy, &(NOW - 1)),
        Err(Ok(AuditError::ExpiryInPast))
    );
    assert_eq!(
        client.try_authorize_agent(
            &user,
            &agent,
            &policy,
            &(NOW + MAX_AUTHORIZATION_WINDOW + 1)
        ),
        Err(Ok(AuditError::WindowTooLong))
    );

    // The boundary itself is allowed.
    client.authorize_agent(&user, &agent, &policy, &(NOW + MAX_AUTHORIZATION_WINDOW));
    assert!(client.is_agent_live(&user, &agent));
}

// ---------------------------------------------------------------------------
// Decision logging
// ---------------------------------------------------------------------------

#[test]
fn authorized_agent_can_log_a_decision() {
    let (env, client, user, agent, policy) = setup();

    client.log_decision(
        &user,
        &agent,
        &policy,
        &hash(&env, 10),
        &hash(&env, 11),
        &74,
    );
}

#[test]
fn unauthorized_actions_fail() {
    let (env, client, user, agent, policy) = setup();
    let stranger = Address::generate(&env);

    // Never authorized.
    assert_eq!(
        client.try_log_decision(
            &user,
            &stranger,
            &policy,
            &hash(&env, 10),
            &hash(&env, 11),
            &50
        ),
        Err(Ok(AuditError::NotAuthorized))
    );

    // Revoked.
    client.revoke_agent(&user, &agent);
    assert!(!client.is_agent_live(&user, &agent));
    assert_eq!(
        client.try_log_decision(
            &user,
            &agent,
            &policy,
            &hash(&env, 10),
            &hash(&env, 11),
            &50
        ),
        Err(Ok(AuditError::NotAuthorized))
    );

    // The record is retained so a reader can tell revoked from never-authorized.
    let authorization = client.authorization_of(&user, &agent).unwrap();
    assert!(!authorization.active);
}

#[test]
fn expired_authorization_fails_without_revocation() {
    let (env, client, user, agent, policy) = setup();

    env.ledger().set_timestamp(NOW + 3_601);

    assert!(!client.is_agent_live(&user, &agent));
    assert_eq!(
        client.try_log_decision(
            &user,
            &agent,
            &policy,
            &hash(&env, 10),
            &hash(&env, 11),
            &50
        ),
        Err(Ok(AuditError::AuthorizationExpired))
    );
}

#[test]
fn rotating_the_policy_invalidates_work_computed_against_the_old_one() {
    let (env, client, user, agent, policy) = setup();

    // The user adopts a new policy without touching the authorization.
    client.set_policy(&user, &hash(&env, 2));

    // The agent's old policy no longer matches the authorization it holds.
    assert_eq!(
        client.try_log_decision(
            &user,
            &agent,
            &policy,
            &hash(&env, 10),
            &hash(&env, 11),
            &50
        ),
        Err(Ok(AuditError::PolicyMismatch))
    );

    // Presenting the new policy also fails, because the grant was issued under
    // the old one — the user must re-authorize deliberately.
    assert_eq!(
        client.try_log_decision(
            &user,
            &agent,
            &hash(&env, 2),
            &hash(&env, 10),
            &hash(&env, 11),
            &50
        ),
        Err(Ok(AuditError::PolicyMismatch))
    );

    client.authorize_agent(&user, &agent, &hash(&env, 2), &(NOW + 3_600));
    client.log_decision(
        &user,
        &agent,
        &hash(&env, 2),
        &hash(&env, 10),
        &hash(&env, 11),
        &50,
    );
}

#[test]
fn rejects_invalid_decision_bounds_and_hashes() {
    let (env, client, user, agent, policy) = setup();

    assert_eq!(
        client.try_log_decision(
            &user,
            &agent,
            &policy,
            &hash(&env, 10),
            &hash(&env, 11),
            &101
        ),
        Err(Ok(AuditError::InvalidBuyRisk))
    );
    assert_eq!(
        client.try_log_decision(
            &user,
            &agent,
            &policy,
            &zero_hash(&env),
            &hash(&env, 11),
            &50
        ),
        Err(Ok(AuditError::ZeroHash))
    );
    assert_eq!(
        client.try_log_decision(
            &user,
            &agent,
            &policy,
            &hash(&env, 10),
            &zero_hash(&env),
            &50
        ),
        Err(Ok(AuditError::ZeroHash))
    );
}

// ---------------------------------------------------------------------------
// TTL extension and expiration
// ---------------------------------------------------------------------------

#[test]
fn instance_ttl_extends_on_read_and_write() {
    let (env, client, user, agent, policy) = setup();

    // Advance the ledger far enough that the instance TTL drops below its
    // threshold, then touch the contract to force a bump.
    env.ledger().set_sequence_number(env.ledger().sequence() + LEDGER_TTL_THRESHOLD + 1);
    assert!(client.is_agent_live(&user, &agent));

    // A subsequent write must also keep the instance alive.
    env.ledger().set_sequence_number(env.ledger().sequence() + LEDGER_TTL_THRESHOLD + 1);
    client.log_decision(
        &user,
        &agent,
        &policy,
        &hash(&env, 10),
        &hash(&env, 11),
        &50,
    );
}

#[test]
fn active_authorization_survives_180_day_ledger_progression() {
    let (env, client, user, agent, policy) = setup();

    // 180 days at ~5s per ledger is roughly 3.1M ledgers. Advance in chunks so
    // each read/write path gets a chance to bump the persistent entries.
    let total_ledgers: u32 = 3_110_400;
    let chunk: u32 = 500_000;
    let mut advanced: u32 = 0;
    while advanced < total_ledgers {
        let step = core::cmp::min(chunk, total_ledgers - advanced);
        env.ledger().set_sequence_number(env.ledger().sequence() + step);
        advanced += step;
        // Touch the authorization so its persistent TTL is extended.
        let _ = client.authorization_of(&user, &agent);
    }

    // The authorization is still live and usable after the long progression.
    assert!(client.is_agent_live(&user, &agent));
    client.log_decision(
        &user,
        &agent,
        &policy,
        &hash(&env, 10),
        &hash(&env, 11),
        &50,
    );
}

#[test]
fn consumed_intent_expires_cleanly_after_expires_at() {
    let (env, client, user, agent, policy) = setup();

    let intent = hash(&env, 20);
    let expires_at = NOW + 60;
    client.consume_intent(&user, &agent, &policy, &intent, &expires_at);

    // The intent is recorded as consumed while live.
    assert!(client.is_intent_consumed(&intent));

    // Advance past the intent's expiry and well beyond the temporary TTL
    // threshold; the temporary entry should be gone without blocking storage.
    env.ledger().set_timestamp(expires_at + 1);
    env.ledger().set_sequence_number(env.ledger().sequence() + ENTRY_TTL_THRESHOLD + 1);

    // The consumed-intent lookup no longer reports it as live, and a fresh
    // intent can still be consumed (storage is not blocked).
    assert!(!client.is_intent_consumed(&intent));
    let fresh = hash(&env, 21);
    client.consume_intent(&user, &agent, &policy, &fresh, &(expires_at + 120));
    assert!(client.is_intent_consumed(&fresh));
}
