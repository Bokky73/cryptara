#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup() -> (Env, GovernanceClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, Governance);
    let client = GovernanceClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

#[test]
fn test_execute_proposal() {
    let (env, client, admin) = setup();
    let proposal_id = String::from_str(&env, "prop-1");

    client.create_proposal(&admin, &proposal_id);
    client.execute_proposal(&admin, &proposal_id);

    assert!(client.is_executed(&proposal_id));
}

#[test]
fn test_execute_proposal_budget() {
    let (env, client, admin) = setup();
    let proposal_id = String::from_str(&env, "prop-budget");
    client.create_proposal(&admin, &proposal_id);

    env.cost_estimate().budget().reset_unlimited();
    client.execute_proposal(&admin, &proposal_id);

    let cpu = env.cost_estimate().budget().cpu_instruction_cost();
    let mem = env.cost_estimate().budget().memory_bytes_cost();

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
    assert!(cpu > 0, "execute_proposal should consume CPU instructions");
    assert!(cpu < 50_000_000, "execute_proposal CPU budget exceeded: {cpu}");
    assert!(mem < 5_000_000, "execute_proposal memory budget exceeded: {mem}");
}
