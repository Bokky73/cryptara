extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, BytesN, Env, Vec,
};

use crate::{GovernanceContract, GovernanceContractClient};

fn setup() -> (Env, GovernanceContractClient<'static>, Address, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    env.ledger().set_sequence_number(1000);

    let id = env.register(GovernanceContract, ());
    let client = GovernanceContractClient::new(&env, &id);

    let signer_a = Address::generate(&env);
    let signer_b = Address::generate(&env);
    let signer_c = Address::generate(&env);
    let emergency = Address::generate(&env);

    let mut signers = Vec::new(&env);
    signers.push_back(signer_a.clone());
    signers.push_back(signer_b.clone());
    signers.push_back(signer_c.clone());

    client.initialize(&signers, &2, &86400, &(30 * 86400), &emergency);

    (env, client, signer_a, signer_b, signer_c, emergency)
}

fn dummy_selector(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[1u8; 32])
}

fn dummy_target(env: &Env) -> Address {
    Address::generate(env)
}

#[test]
fn initialize_and_read_params() {
    let (env, client, _a, _b, _c, emergency) = setup();
    assert_eq!(client.threshold(), 2);
    assert_eq!(client.min_delay(), 86400);
    assert_eq!(client.max_delay(), 30 * 86400);
    assert_eq!(client.emergency_admin(), emergency);
    assert_eq!(client.is_paused(), false);
    assert_eq!(client.signers().len(), 3);
    let _ = env;
}

#[test]
fn propose_requires_delay_bounds() {
    let (env, client, a, _b, _c, _em) = setup();
    let target = dummy_target(&env);
    let sel = dummy_selector(&env);
    let payload = Bytes::from_slice(&env, b"set_limits:1,2,3");
    // too short
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.propose(&a, &target, &sel, &payload, &1000);
    }));
    assert!(res.is_err());

    // too long
    let res2 = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.propose(&a, &target, &sel, &payload, &(31 * 86400));
    }));
    assert!(res2.is_err());
}

#[test]
fn single_signer_cannot_schedule_alone_but_propose_succeeds_threshold_enforced_on_execute() {
    // Propose is allowed by any authenticated proposer; execution requires threshold signatures.
    // A single signer scheduling means only one signature exists, so execute must fail.
    let (env, client, a, b, _c, _em) = setup();
    let target = dummy_target(&env);
    let sel = dummy_selector(&env);
    let payload = Bytes::from_slice(&env, b"upgrade:v2");
    let pid = client.propose(&a, &target, &sel, &payload, &86400);

    // Only one signer signs
    client.sign(&a, &pid, &Bytes::from_slice(&env, b"sig-a"));

    // Try to execute before delay -> fails with not ready
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.execute(&a, &pid);
    }));
    assert!(early.is_err());

    // Advance time past delay
    env.ledger().set_timestamp(1_700_000_000 + 86401);

    // Still fails because only 1 signature, threshold is 2
    let insufficient = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.execute(&a, &pid);
    }));
    assert!(insufficient.is_err());

    // Second signer signs, now execute succeeds
    client.sign(&b, &pid, &Bytes::from_slice(&env, b"sig-b"));
    client.execute(&a, &pid);

    let proposal = client.get_proposal(&pid).unwrap();
    assert!(proposal.executed);
}

#[test]
fn execute_early_fails() {
    let (env, client, a, b, _c, _em) = setup();
    let target = dummy_target(&env);
    let sel = dummy_selector(&env);
    let payload = Bytes::from_slice(&env, b"payload");
    let pid = client.propose(&a, &target, &sel, &payload, &86400);
    client.sign(&a, &pid, &Bytes::from_slice(&env, b"s1"));
    client.sign(&b, &pid, &Bytes::from_slice(&env, b"s2"));

    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.execute(&a, &pid);
    }));
    assert!(res.is_err());

    // advance and succeed
    env.ledger().set_timestamp(1_700_000_000 + 86401);
    client.execute(&a, &pid);
}

#[test]
fn cancel_during_delay_prevents_execution() {
    let (env, client, a, b, _c, _em) = setup();
    let target = dummy_target(&env);
    let sel = dummy_selector(&env);
    let payload = Bytes::from_slice(&env, b"payload-cancel");
    let pid = client.propose(&a, &target, &sel, &payload, &86400);
    client.sign(&a, &pid, &Bytes::from_slice(&env, b"s1"));
    client.sign(&b, &pid, &Bytes::from_slice(&env, b"s2"));

    // cancel during delay by proposer
    client.cancel(&a, &pid);

    // advance time
    env.ledger().set_timestamp(1_700_000_000 + 86401);

    // execute should fail permanently
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.execute(&a, &pid);
    }));
    assert!(res.is_err());

    // also cannot sign after cancelled
    let res2 = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.sign(&b, &pid, &Bytes::from_slice(&env, b"s3"));
    }));
    assert!(res2.is_err());

    // pending queue should not contain cancelled
    let pending = client.get_pending_queue();
    assert_eq!(pending.len(), 0);
}

#[test]
fn replay_after_cancel_fails() {
    let (env, client, a, _b, _c, _em) = setup();
    let target = dummy_target(&env);
    let sel = dummy_selector(&env);
    let payload = Bytes::from_slice(&env, b"replay-cancel");
    let pid = client.propose(&a, &target, &sel, &payload, &86400);
    client.cancel(&a, &pid);

    // try to execute cancelled proposal
    env.ledger().set_timestamp(1_700_000_000 + 86401);
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.execute(&a, &pid);
    }));
    assert!(res.is_err());

    // second cancel also fails
    let res2 = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.cancel(&a, &pid);
    }));
    assert!(res2.is_err());
}

#[test]
fn pending_queue_readable_and_matches_state() {
    let (env, client, a, b, _c, _em) = setup();
    let target = dummy_target(&env);
    let sel = dummy_selector(&env);
    let p1 = Bytes::from_slice(&env, b"p1");
    let p2 = Bytes::from_slice(&env, b"p2");
    let pid1 = client.propose(&a, &target, &sel, &p1, &86400);
    let pid2 = client.propose(&b, &target, &sel, &p2, &86400);

    assert_eq!(client.get_pending_count(), 2);
    let q = client.get_pending_queue();
    assert_eq!(q.len(), 2);
    assert!(q.iter().any(|x| x.id == pid1));
    assert!(q.iter().any(|x| x.id == pid2));
    // payload hash matches
    for pending in q.iter() {
        let prop = client.get_proposal(&pending.id).unwrap();
        assert_eq!(prop.payload_hash, pending.payload_hash);
        assert_eq!(prop.effective_at, pending.effective_at);
    }

    // cancel one, queue shrinks
    client.cancel(&a, &pid1);
    assert_eq!(client.get_pending_count(), 1);
    let q2 = client.get_pending_queue();
    assert_eq!(q2.len(), 1);
    assert_eq!(q2.get(0).unwrap().id, pid2);
}

#[test]
fn emergency_pause_immediate() {
    let (env, client, a, b, _c, emergency) = setup();
    client.pause(&emergency);
    assert!(client.is_paused());

    let target = dummy_target(&env);
    let sel = dummy_selector(&env);
    let payload = Bytes::from_slice(&env, b"blocked");

    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.propose(&a, &target, &sel, &payload, &86400);
    }));
    assert!(res.is_err());

    // unpause restores
    client.unpause(&emergency);
    assert!(!client.is_paused());
    let pid = client.propose(&a, &target, &sel, &payload, &86400);
    client.sign(&a, &pid, &Bytes::from_slice(&env, b"s1"));
    client.sign(&b, &pid, &Bytes::from_slice(&env, b"s2"));
    env.ledger().set_timestamp(1_700_000_000 + 86401);
    client.execute(&a, &pid);
    assert!(client.get_proposal(&pid).unwrap().executed);
}

#[test]
fn duplicate_signer_approval_rejected() {
    // A signer cannot approve the same proposal twice to inflate signers.len().
    let (env, client, a, _b, _c, _em) = setup();
    let target = dummy_target(&env);
    let sel = dummy_selector(&env);
    let payload = Bytes::from_slice(&env, b"dup-signer");
    let pid = client.propose(&a, &target, &sel, &payload, &86400);

    client.sign(&a, &pid, &Bytes::from_slice(&env, b"s1"));

    // Second approval from the same signer must be rejected.
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.sign(&a, &pid, &Bytes::from_slice(&env, b"s1-again"));
    }));
    assert!(res.is_err());

    // Only one distinct signer recorded.
    let proposal = client.get_proposal(&pid).unwrap();
    assert_eq!(proposal.signers.len(), 1);
}

#[test]
fn non_signer_approval_rejected() {
    // An address that is not in the configured signer set cannot approve.
    let (env, client, a, _b, _c, _em) = setup();
    let target = dummy_target(&env);
    let sel = dummy_selector(&env);
    let payload = Bytes::from_slice(&env, b"non-signer");
    let pid = client.propose(&a, &target, &sel, &payload, &86400);

    let outsider = Address::generate(&env);
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.sign(&outsider, &pid, &Bytes::from_slice(&env, b"forged"));
    }));
    assert!(res.is_err());

    let proposal = client.get_proposal(&pid).unwrap();
    assert_eq!(proposal.signers.len(), 0);
}

#[test]
fn payload_hash_tampering_rejected_at_execution() {
    // Tampering with the stored payload hash must cause execution to panic.
    let (env, client, a, b, _c, _em) = setup();
    let target = dummy_target(&env);
    let sel = dummy_selector(&env);
    let payload = Bytes::from_slice(&env, b"tamper-me");
    let pid = client.propose(&a, &target, &sel, &payload, &86400);
    client.sign(&a, &pid, &Bytes::from_slice(&env, b"s1"));
    client.sign(&b, &pid, &Bytes::from_slice(&env, b"s2"));

    env.ledger().set_timestamp(1_700_000_000 + 86401);

    // Sanity: untampered execution succeeds.
    client.execute(&a, &pid);
    assert!(client.get_proposal(&pid).unwrap().executed);

    // A fresh proposal whose payload hash does not match the supplied payload
    // must fail verification at execution time.
    let payload2 = Bytes::from_slice(&env, b"original-payload");
    let pid2 = client.propose(&a, &target, &sel, &payload2, &86400);
    client.sign(&a, &pid2, &Bytes::from_slice(&env, b"s1"));
    client.sign(&b, &pid2, &Bytes::from_slice(&env, b"s2"));
    env.ledger().set_timestamp(1_700_000_000 + 2 * 86401);

    let tampered = Bytes::from_slice(&env, b"tampered-payload");
    let res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.execute_with_payload(&a, &pid2, &tampered);
    }));
    assert!(res.is_err());
}
