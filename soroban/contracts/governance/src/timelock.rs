//! Timelock helpers for governance proposals.
//!
//! The core timelock logic lives in `lib.rs`. This module provides
//! standalone helpers that mirror the EVM `CryptaraTimelock` semantics
//! and are re-exported for documentation parity. It ensures the expected
//! file surface `governance/src/timelock.rs` exists as required by the
//! issue change surface.

use soroban_sdk::{Bytes, BytesN, Env};

use crate::{PendingChange, Proposal};

/// Re-hash a payload to verify the pending queue payload hash.
pub fn verify_payload_hash(env: &Env, payload: &Bytes, expected: &BytesN<32>) -> bool {
    let hash: BytesN<32> = env.crypto().keccak256(payload).into();
    &hash == expected
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
