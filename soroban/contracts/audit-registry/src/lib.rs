#![no_std]

//! Non-custodial authorization and audit layer for the Cryptara agent
//! pipeline, on Soroban.
//!
//! This is the Stellar half of the V2 audit layer described in issue #16. It
//! mirrors the EVM `CryptaraAudit` contract: it records *who may act*,
//! *under what policy*, and *what they decided*, and it never custodies value.
//! There is no token client, no transfer, and no balance anywhere in this file.
//! Executing a trade stays a wallet-signed operation elsewhere.
//!
//! Differences from the EVM contract, forced by the platform:
//!
//! - Authorization is proved with `require_auth` on an `Address` rather than
//!   inferred from `msg.sender`.
//! - Every persistent entry carries an explicit TTL bump, because Soroban
//!   entries expire. Authorizations and consumed intent ids are extended on
//!   write and on read so an active grant does not silently vanish.
//! - Consumed intent ids are stored in temporary storage keyed to the intent's
//!   own expiry. An intent cannot be replayed while it could still be executed,
//!   and the entry is not paid for forever after it stops mattering.
//!
//! Until the issue #16 specification is formally approved this surface should
//! be treated as proposed. `VERSION` must be bumped on any change to it.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
};

/// Interface version. Bump on any externally visible change.
const VERSION: u32 = 1;

// Ledgers are ~5 seconds, so these convert a wall-clock duration to ledgers.
const INSTANCE_TTL_THRESHOLD: u32 = 30 * 24 * 60 * 60 / 5;
const INSTANCE_TTL_EXTEND_TO: u32 = 120 * 24 * 60 * 60 / 5;
const ENTRY_TTL_THRESHOLD: u32 = 60 * 24 * 60 * 60 / 5;
const ENTRY_TTL_EXTEND_TO: u32 = 365 * 24 * 60 * 60 / 5;

/// Longest authorization window a user may grant in one call, in seconds.
const MAX_AUTHORIZATION_WINDOW: u64 = 365 * 24 * 60 * 60;
/// Longest lifetime an execution intent may declare, in seconds.
const MAX_INTENT_WINDOW: u64 = 60 * 60;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Policy hash a user has committed to.
    Policy(Address),
    /// Authorization record for (user, agent).
    Authorization(Address, Address),
    /// Consumed execution-intent id for (user, intent_id).
    Intent(Address, BytesN<32>),
    /// Per-user emergency pause flag.
    Paused(Address),
    Governance,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Authorization {
    pub policy_hash: BytesN<32>,
    /// Unix timestamp after which the authorization is inert.
    pub expires_at: u64,
    /// False once revoked. Retained rather than removed so a reader can tell
    /// "revoked" apart from "never authorized".
    pub active: bool,
}

#[contractevent]
pub struct PolicyUpdated {
    #[topic]
    pub user: Address,
    #[topic]
    pub policy_hash: BytesN<32>,
    pub timestamp: u64,
}

#[contractevent]
pub struct AgentAuthorized {
    #[topic]
    pub user: Address,
    #[topic]
    pub agent: Address,
    pub policy_hash: BytesN<32>,
    pub expires_at: u64,
}

#[contractevent]
pub struct AgentRevoked {
    #[topic]
    pub user: Address,
    #[topic]
    pub agent: Address,
    pub timestamp: u64,
}

#[contractevent]
pub struct DecisionLogged {
    #[topic]
    pub user: Address,
    #[topic]
    pub agent: Address,
    #[topic]
    pub decision_id: BytesN<32>,
    pub decision_hash: BytesN<32>,
    pub buy_risk: u32,
    pub timestamp: u64,
}

#[contractevent]
pub struct IntentRecorded {
    #[topic]
    pub user: Address,
    #[topic]
    pub agent: Address,
    #[topic]
    pub intent_id: BytesN<32>,
    pub decision_id: BytesN<32>,
    pub intent_hash: BytesN<32>,
    pub expires_at: u64,
}

#[contractevent]
pub struct PauseChanged {
    #[topic]
    pub user: Address,
    pub paused: bool,
    pub timestamp: u64,
}

#[contractevent]
pub struct GovernanceUpdated {
    #[topic]
    pub old_governance: Address,
    #[topic]
    pub new_governance: Address,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AuditError {
    ZeroHash = 1,
    NotAuthorized = 2,
    AuthorizationExpired = 3,
    WindowTooLong = 4,
    ExpiryInPast = 5,
    IntentReplayed = 6,
    IntentStale = 7,
    ContractPaused = 8,
    InvalidBuyRisk = 9,
    PolicyMismatch = 10,
    PolicyNotSet = 11,
}

#[contract]
pub struct AuditRegistry;

fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

fn bump_entry_ttl(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, ENTRY_TTL_THRESHOLD, ENTRY_TTL_EXTEND_TO);
}

/// A hash of all zero bytes is never a real commitment, and accepting one would
/// let a caller log an entry that references nothing.
fn require_non_zero_hash(env: &Env, hash: &BytesN<32>) -> Result<(), AuditError> {
    if *hash == BytesN::from_array(env, &[0u8; 32]) {
        return Err(AuditError::ZeroHash);
    }

    Ok(())
}

fn read_policy(env: &Env, user: &Address) -> Option<BytesN<32>> {
    let key = DataKey::Policy(user.clone());
    let value: Option<BytesN<32>> = env.storage().persistent().get(&key);

    if value.is_some() {
        bump_entry_ttl(env, &key);
    }

    value
}

fn is_paused(env: &Env, user: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Paused(user.clone()))
        .unwrap_or(false)
}

/// Assert that `agent` may currently act for `user` under `policy_hash`.
///
/// Combines the four ways an agent can be inert: paused, never authorized,
/// revoked, and expired — plus the policy check that stops an agent acting on
/// work computed against a policy the user has since replaced.
fn require_live_agent(
    env: &Env,
    user: &Address,
    agent: &Address,
    policy_hash: &BytesN<32>,
) -> Result<(), AuditError> {
    if is_paused(env, user) {
        return Err(AuditError::ContractPaused);
    }

    let key = DataKey::Authorization(user.clone(), agent.clone());
    let authorization: Authorization = env
        .storage()
        .persistent()
        .get(&key)
        .ok_or(AuditError::NotAuthorized)?;

    if !authorization.active {
        return Err(AuditError::NotAuthorized);
    }

    if authorization.expires_at <= env.ledger().timestamp() {
        return Err(AuditError::AuthorizationExpired);
    }

    if authorization.policy_hash != *policy_hash {
        return Err(AuditError::PolicyMismatch);
    }

    match read_policy(env, user) {
        Some(current) if current == *policy_hash => {}
        Some(_) => return Err(AuditError::PolicyMismatch),
        None => return Err(AuditError::PolicyNotSet),
    }

    bump_entry_ttl(env, &key);

    Ok(())
}

#[contractimpl]
impl AuditRegistry {
    /// Interface version, for clients and indexers.
    pub fn version(_env: Env) -> u32 {
        VERSION
    }

    /// Commit to a user policy hash.
    ///
    /// Only the hash is stored; the policy itself stays off chain, so no user
    /// strategy is published on a public ledger.
    pub fn set_policy(env: Env, user: Address, policy_hash: BytesN<32>) -> Result<(), AuditError> {
        user.require_auth();
        require_non_zero_hash(&env, &policy_hash)?;

        let key = DataKey::Policy(user.clone());
        env.storage().persistent().set(&key, &policy_hash);
        bump_entry_ttl(&env, &key);
        bump_instance_ttl(&env);

        PolicyUpdated {
            user,
            policy_hash,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        Ok(())
    }

    /// Authorize `agent` to log decisions and intents for `user`.
    ///
    /// The user must already have committed to `policy_hash`, so an
    /// authorization can never reference a policy they have not adopted.
    pub fn authorize_agent(
        env: Env,
        user: Address,
        agent: Address,
        policy_hash: BytesN<32>,
        expires_at: u64,
    ) -> Result<(), AuditError> {
        user.require_auth();
        require_non_zero_hash(&env, &policy_hash)?;

        match read_policy(&env, &user) {
            Some(current) if current == policy_hash => {}
            Some(_) => return Err(AuditError::PolicyMismatch),
            None => return Err(AuditError::PolicyNotSet),
        }

        let now = env.ledger().timestamp();

        if expires_at <= now {
            return Err(AuditError::ExpiryInPast);
        }

        if expires_at - now > MAX_AUTHORIZATION_WINDOW {
            return Err(AuditError::WindowTooLong);
        }

        let key = DataKey::Authorization(user.clone(), agent.clone());
        env.storage().persistent().set(
            &key,
            &Authorization {
                policy_hash: policy_hash.clone(),
                expires_at,
                active: true,
            },
        );
        bump_entry_ttl(&env, &key);
        bump_instance_ttl(&env);

        AgentAuthorized {
            user,
            agent,
            policy_hash,
            expires_at,
        }
        .publish(&env);

        Ok(())
    }

    /// Revoke an agent immediately.
    ///
    /// Idempotent: revoking an agent that was never authorized, or is already
    /// revoked, succeeds. A user reacting to an incident must never be blocked
    /// by a revert.
    pub fn revoke_agent(env: Env, user: Address, agent: Address) -> Result<(), AuditError> {
        user.require_auth();

        let key = DataKey::Authorization(user.clone(), agent.clone());
        let existing: Option<Authorization> = env.storage().persistent().get(&key);

        if let Some(authorization) = existing {
            env.storage().persistent().set(
                &key,
                &Authorization {
                    active: false,
                    ..authorization
                },
            );
            bump_entry_ttl(&env, &key);
        }

        bump_instance_ttl(&env);

        AgentRevoked {
            user,
            agent,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        Ok(())
    }

    /// Halt or resume all logging for `user`.
    pub fn set_paused(env: Env, user: Address, paused: bool) -> Result<(), AuditError> {
        user.require_auth();

        let key = DataKey::Paused(user.clone());
        env.storage().persistent().set(&key, &paused);
        bump_entry_ttl(&env, &key);
        bump_instance_ttl(&env);

        PauseChanged {
            user,
            paused,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        Ok(())
    }

    /// Record an agent decision for `user`.
    ///
    /// `buy_risk` is a 0-100 score; anything higher is rejected rather than
    /// clamped, because a clamped score would misreport what the agent decided.
    pub fn log_decision(
        env: Env,
        user: Address,
        agent: Address,
        policy_hash: BytesN<32>,
        decision_id: BytesN<32>,
        decision_hash: BytesN<32>,
        buy_risk: u32,
    ) -> Result<(), AuditError> {
        agent.require_auth();
        require_live_agent(&env, &user, &agent, &policy_hash)?;
        require_non_zero_hash(&env, &decision_id)?;
        require_non_zero_hash(&env, &decision_hash)?;

        if buy_risk > 100 {
            return Err(AuditError::InvalidBuyRisk);
        }

        bump_instance_ttl(&env);

        DecisionLogged {
            user,
            agent,
            decision_id,
            decision_hash,
            buy_risk,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        Ok(())
    }

    /// Record an execution intent for `user`.
    ///
    /// `intent_id` is consumed on first use, so a replay fails. `expires_at`
    /// must be in the future and within `MAX_INTENT_WINDOW`, so a plan that was
    /// prepared against a stale quote cannot be revived later.
    ///
    /// Recording an intent authorizes nothing: the resulting transaction is
    /// still signed by the user's wallet.
    #[allow(clippy::too_many_arguments)]
    pub fn record_intent(
        env: Env,
        user: Address,
        agent: Address,
        policy_hash: BytesN<32>,
        intent_id: BytesN<32>,
        decision_id: BytesN<32>,
        intent_hash: BytesN<32>,
        expires_at: u64,
    ) -> Result<(), AuditError> {
        agent.require_auth();
        require_live_agent(&env, &user, &agent, &policy_hash)?;
        require_non_zero_hash(&env, &intent_id)?;
        require_non_zero_hash(&env, &decision_id)?;
        require_non_zero_hash(&env, &intent_hash)?;

        let now = env.ledger().timestamp();

        if expires_at <= now {
            return Err(AuditError::IntentStale);
        }

        if expires_at - now > MAX_INTENT_WINDOW {
            return Err(AuditError::WindowTooLong);
        }

        let key = DataKey::Intent(user.clone(), intent_id.clone());

        if env.storage().temporary().has(&key) {
            return Err(AuditError::IntentReplayed);
        }

        // The consumed marker only needs to outlive the intent itself: once the
        // intent is stale it is rejected on staleness anyway, so paying rent
        // beyond that point buys nothing.
        let live_ledgers = ((expires_at - now) / 5).max(1) as u32;
        env.storage().temporary().set(&key, &true);
        env.storage()
            .temporary()
            .extend_ttl(&key, live_ledgers, live_ledgers);

        bump_instance_ttl(&env);

        IntentRecorded {
            user,
            agent,
            intent_id,
            decision_id,
            intent_hash,
            expires_at,
        }
        .publish(&env);

        Ok(())
    }

    /// Read an authorization record, if one exists.
    pub fn authorization_of(env: Env, user: Address, agent: Address) -> Option<Authorization> {
        let key = DataKey::Authorization(user, agent);
        let value: Option<Authorization> = env.storage().persistent().get(&key);

        if value.is_some() {
            bump_entry_ttl(&env, &key);
        }

        value
    }

    /// Policy hash `user` has committed to, if any.
    pub fn policy_of(env: Env, user: Address) -> Option<BytesN<32>> {
        read_policy(&env, &user)
    }

    /// Whether `user` has paused logging.
    pub fn is_paused(env: Env, user: Address) -> bool {
        is_paused(&env, &user)
    }

    /// Whether `agent` may currently act for `user`.
    ///
    /// Answers the single question a caller has, rather than making them
    /// reassemble it from revocation, expiry and pause.
    pub fn is_agent_live(env: Env, user: Address, agent: Address) -> bool {
        if is_paused(&env, &user) {
            return false;
        }

        match env
            .storage()
            .persistent()
            .get::<DataKey, Authorization>(&DataKey::Authorization(user, agent))
        {
            Some(authorization) => {
                authorization.active && authorization.expires_at > env.ledger().timestamp()
            }
            None => false,
        }
    }

    /// Whether an intent id has already been consumed for `user`.
    pub fn is_intent_used(env: Env, user: Address, intent_id: BytesN<32>) -> bool {
        env.storage()
            .temporary()
            .has(&DataKey::Intent(user, intent_id))
    }

    pub fn set_governance(env: Env, governance: Address) {
        // Simple governance setter - in production would be restricted to governance timelock
        env.storage().instance().set(&DataKey::Governance, &governance);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
        GovernanceUpdated {
            old_governance: governance.clone(),
            new_governance: governance,
        }
        .publish(&env);
    }

    pub fn governance(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Governance)
    }
}

#[cfg(test)]
mod test;
