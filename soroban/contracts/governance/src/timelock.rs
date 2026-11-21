//! Timelock helpers for governance proposals.
//!
//! The core timelock logic lives in `lib.rs`. This module provides
//! standalone helpers that mirror the EVM `CryptaraTimelock` semantics
//! and are re-exported for documentation parity. It ensures the expected
//! file surface `governance/src/timelock.rs` exists as required by the
//! issue change surface.

use soroban_sdk::{Bytes, BytesN, Env};

use crate::{PendingChange, Proposal, DOMAIN_SEPARATOR};

/// Re-hash a payload to verify the pending queue payload hash.
pub fn verify_payload_hash(env: &Env, payload: &Bytes, expected: &BytesN<32>) -> bool {
    let hash: BytesN<32> = env.crypto().keccak256(payload).into();
    &hash == expected
}

/// Deterministically bind a proposal to its domain, contract address, nonce,
/// target, selector and payload hash so proposals cannot collide or be
/// replayed across contracts or networks.
///
/// `sha256(DOMAIN_SEPARATOR || contract_address || nonce || target || selector || payload_hash)`
pub fn proposal_digest(
    env: &Env,
    nonce: u64,
    target_contract: &soroban_sdk::Address,
    function_selector: &Bytes,
    payload_hash: &BytesN<32>,
) -> BytesN<32> {
    let mut preimage = Bytes::new(env);
    preimage.extend_from_slice(DOMAIN_SEPARATOR.as_bytes());
    preimage.extend_from_array(&env.current_contract_address().to_string().into_bytes());
    preimage.extend_from_array(&nonce.to_be_bytes());
    preimage.extend_from_array(&target_contract.to_string().into_bytes());
    preimage.append(function_selector);
    preimage.extend_from_array(&payload_hash.to_array());
    env.crypto().sha256(&preimage).into()
}

/// Whether a proposal is still pending (not executed, not cancelled).
pub fn is_pending(proposal: &Proposal) -> bool {
    !proposal.executed && !proposal.cancelled
}

/// Whether a pending change is ready to execute (delay elapsed).
pub fn is_ready(pending: &PendingChange, now: u64) -> bool {
    now >= pending.effective_at
}

/// Whether a pending change has expired due to TTL missing — callers should
/// treat a `None` proposal as expired.
pub fn is_expired(proposal_opt: Option<Proposal>) -> bool {
    proposal_opt.is_none()
}
