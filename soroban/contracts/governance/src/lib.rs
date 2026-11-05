#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Bytes, BytesN, Env, Map, Vec,
};
use soroban_sdk::xdr::ToXdr;

pub mod timelock;

const INSTANCE_TTL_THRESHOLD: u32 = 30 * 24 * 60 * 60 / 5;
const INSTANCE_TTL_EXTEND_TO: u32 = 120 * 24 * 60 * 60 / 5;
const ENTRY_TTL_THRESHOLD: u32 = 60 * 24 * 60 * 60 / 5;
const ENTRY_TTL_EXTEND_TO: u32 = 365 * 24 * 60 * 60 / 5;
const UPGRADE_TTL_THRESHOLD: u32 = 7 * 24 * 60 * 60 / 5;
const UPGRADE_TTL_EXTEND_TO: u32 = 60 * 24 * 60 * 60 / 5;

const MIN_DELAY_SECS: u64 = 24 * 3600;
const MAX_DELAY_SECS: u64 = 30 * 86400;
const MIN_SIGNERS: u32 = 2;
const MAX_SIGNERS: u32 = 10;

pub const DOMAIN_SEPARATOR: &str = "CRYPTARA_GOVERNANCE_V1";

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Signers,
    Threshold,
    PendingProposal(BytesN<32>),
    ProposalQueue,
    ProposalCount,
    MinDelay,
    MaxDelay,
    EmergencyAdmin,
    Paused,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub id: BytesN<32>,
    pub proposer: Address,
    pub target_contract: Address,
    pub function_selector: BytesN<32>,
    pub payload: Bytes,
    pub payload_hash: BytesN<32>,
    pub signers: Vec<Address>,
    pub signatures: Map<Address, Bytes>,
    pub created_at: u64,
    pub effective_at: u64,
    pub delay_secs: u64,
    pub executed: bool,
    pub cancelled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingChange {
    pub id: BytesN<32>,
    pub target_contract: Address,
    pub function_selector: BytesN<32>,
    pub payload_hash: BytesN<32>,
    pub proposer: Address,
    pub created_at: u64,
    pub effective_at: u64,
    pub delay_secs: u64,
    pub signers_count: u32,
    pub threshold: u32,
}

#[contractevent]
pub struct SignersUpdated {
    #[topic]
    pub signers: Vec<Address>,
    #[topic]
    pub threshold: u32,
}

#[contractevent]
pub struct ProposalCreated {
    #[topic]
    pub id: BytesN<32>,
    #[topic]
    pub target_contract: Address,
    #[topic]
    pub proposer: Address,
    pub function_selector: BytesN<32>,
    pub payload_hash: BytesN<32>,
    pub effective_at: u64,
    pub delay_secs: u64,
}

#[contractevent]
pub struct ProposalSigned {
    #[topic]
    pub id: BytesN<32>,
    #[topic]
    pub signer: Address,
    pub signatures_count: u32,
    pub threshold: u32,
}

#[contractevent]
pub struct ProposalExecuted {
    #[topic]
    pub id: BytesN<32>,
    #[topic]
    pub executor: Address,
    pub target_contract: Address,
    pub function_selector: BytesN<32>,
}

#[contractevent]
pub struct ProposalCancelled {
    #[topic]
    pub id: BytesN<32>,
    #[topic]
    pub canceller: Address,
    pub target_contract: Address,
}

#[contractevent]
pub struct DelayUpdated {
    #[topic]
    pub min_delay: u64,
    #[topic]
    pub max_delay: u64,
}

#[contractevent]
pub struct EmergencyPauseSet {
    #[topic]
    pub paused: bool,
    #[topic]
    pub by: Address,
    pub timestamp: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum GovernanceError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidThreshold = 4,
    InvalidSignerCount = 5,
    InvalidDelay = 6,
    ProposalNotFound = 7,
    ProposalAlreadyExecuted = 8,
    ProposalAlreadyCancelled = 9,
    ProposalNotReady = 10,
    ProposalExpired = 11,
    InvalidSigner = 12,
    DuplicateSigner = 13,
    InsufficientSignatures = 14,
    InvalidPayload = 15,
    ZeroAddress = 16,
    ZeroHash = 17,
    Paused = 18,
    EmergencyAdminOnly = 19,
    ContractMismatch = 20,
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

fn bump_upgrade_entry(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, UPGRADE_TTL_THRESHOLD, UPGRADE_TTL_EXTEND_TO);
}

fn require_not_paused(env: &Env) {
    if env
        .storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Paused)
        .unwrap_or(false)
    {
        panic_with_error!(env, GovernanceError::Paused);
    }
}

fn require_emergency_admin(env: &Env, caller: &Address) {
    let emergency: Address = env
        .storage()
        .instance()
        .get(&DataKey::EmergencyAdmin)
        .unwrap();
    if *caller != emergency {
        panic_with_error!(env, GovernanceError::EmergencyAdminOnly);
    }
    caller.require_auth();
}

fn vec_contains(env: &Env, vec: &Vec<Address>, item: &Address) -> bool {
    for addr in vec.iter() {
        if &addr == item {
            return true;
        }
    }
    let _ = env;
    false
}

fn hash_proposal(
    env: &Env,
    proposer: &Address,
    target: &Address,
    selector: &BytesN<32>,
    payload: &Bytes,
    delay_secs: u64,
    timestamp: u64,
) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.append(&Bytes::from_slice(env, DOMAIN_SEPARATOR.as_bytes()));
    buf.append(&Bytes::from_slice(env, b"PROPOSAL"));
    let p_xdr: Bytes = proposer.to_xdr(env).into();
    buf.append(&p_xdr);
    let t_xdr: Bytes = target.to_xdr(env).into();
    buf.append(&t_xdr);
    buf.append(&selector.clone().into());
    buf.append(payload);
    buf.append(&Bytes::from_slice(env, &delay_secs.to_be_bytes()));
    buf.append(&Bytes::from_slice(env, &timestamp.to_be_bytes()));
    env.crypto().keccak256(&buf).into()
}

fn hash_payload(env: &Env, payload: &Bytes) -> BytesN<32> {
    env.crypto().keccak256(payload).into()
}

fn get_proposal_queue(env: &Env) -> Vec<BytesN<32>> {
    env.storage()
        .instance()
        .get(&DataKey::ProposalQueue)
        .unwrap_or(Vec::new(env))
}

fn set_proposal_queue(env: &Env, queue: &Vec<BytesN<32>>) {
    env.storage().instance().set(&DataKey::ProposalQueue, queue);
    bump_instance(env);
}

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn initialize(
        env: Env,
        signers: Vec<Address>,
        threshold: u32,
        min_delay_secs: u64,
        max_delay_secs: u64,
        emergency_admin: Address,
    ) {
        if env.storage().instance().has(&DataKey::Signers) {
            panic_with_error!(&env, GovernanceError::AlreadyInitialized);
        }

        if signers.len() < MIN_SIGNERS as u32 || signers.len() > MAX_SIGNERS as u32 {
            panic_with_error!(&env, GovernanceError::InvalidSignerCount);
        }

        if threshold < MIN_SIGNERS || threshold > signers.len() {
            panic_with_error!(&env, GovernanceError::InvalidThreshold);
        }

        if min_delay_secs < MIN_DELAY_SECS || min_delay_secs > MAX_DELAY_SECS {
            panic_with_error!(&env, GovernanceError::InvalidDelay);
        }

        if max_delay_secs < MIN_DELAY_SECS || max_delay_secs > MAX_DELAY_SECS {
            panic_with_error!(&env, GovernanceError::InvalidDelay);
        }

        if min_delay_secs > max_delay_secs {
            panic_with_error!(&env, GovernanceError::InvalidDelay);
        }

        env.storage().instance().set(&DataKey::Signers, &signers);
        env.storage().instance().set(&DataKey::Threshold, &threshold);
        env.storage().instance().set(&DataKey::MinDelay, &min_delay_secs);
        env.storage().instance().set(&DataKey::MaxDelay, &max_delay_secs);
        env.storage()
            .instance()
            .set(&DataKey::EmergencyAdmin, &emergency_admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage()
            .instance()
            .set(&DataKey::ProposalQueue, &Vec::<BytesN<32>>::new(&env));
        env.storage()
            .instance()
            .set(&DataKey::ProposalCount, &0u64);

        SignersUpdated {
            signers: signers.clone(),
            threshold,
        }
        .publish(&env);

        bump_instance(&env);
    }

    pub fn propose(
        env: Env,
        proposer: Address,
        target_contract: Address,
        function_selector: BytesN<32>,
        payload: Bytes,
        delay_secs: u64,
    ) -> BytesN<32> {
        require_not_paused(&env);
        proposer.require_auth();

        let min_delay: u64 = env.storage().instance().get(&DataKey::MinDelay).unwrap();
        let max_delay: u64 = env.storage().instance().get(&DataKey::MaxDelay).unwrap();

        if delay_secs < min_delay || delay_secs > max_delay {
            panic_with_error!(&env, GovernanceError::InvalidDelay);
        }

        if function_selector == BytesN::from_array(&env, &[0u8; 32]) {
            panic_with_error!(&env, GovernanceError::ZeroHash);
        }

        let timestamp = env.ledger().timestamp();
        let effective_at = timestamp.saturating_add(delay_secs);

        let payload_hash = hash_payload(&env, &payload);
        let proposal_id = hash_proposal(
            &env,
            &proposer,
            &target_contract,
            &function_selector,
            &payload,
            delay_secs,
            timestamp,
        );

        let mut queue = get_proposal_queue(&env);
        // check duplicate by scanning queue
        for existing in queue.iter() {
            if existing == proposal_id {
                panic_with_error!(&env, GovernanceError::ProposalAlreadyExecuted);
            }
        }

        let signers: Vec<Address> = env.storage().instance().get(&DataKey::Signers).unwrap();

        let proposal = Proposal {
            id: proposal_id.clone(),
            proposer: proposer.clone(),
            target_contract: target_contract.clone(),
            function_selector: function_selector.clone(),
            payload: payload.clone(),
            payload_hash: payload_hash.clone(),
            signers: signers.clone(),
            signatures: Map::new(&env),
            created_at: timestamp,
            effective_at,
            delay_secs,
            executed: false,
            cancelled: false,
        };

        let key = DataKey::PendingProposal(proposal_id.clone());
        env.storage().persistent().set(&key, &proposal);
        bump_upgrade_entry(&env, &key);

        queue.push_back(proposal_id.clone());
        set_proposal_queue(&env, &queue);

        let count: u64 = env.storage().instance().get(&DataKey::ProposalCount).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::ProposalCount, &(count + 1));

        ProposalCreated {
            id: proposal_id.clone(),
            target_contract,
            proposer,
            function_selector,
            payload_hash,
            effective_at,
            delay_secs,
        }
        .publish(&env);

        bump_instance(&env);
        proposal_id
    }

    pub fn sign(env: Env, signer: Address, proposal_id: BytesN<32>, signature: Bytes) {
        require_not_paused(&env);
        signer.require_auth();

        let key = DataKey::PendingProposal(proposal_id.clone());
        let mut proposal: Proposal = match env.storage().persistent().get(&key) {
            Some(p) => p,
            None => panic_with_error!(&env, GovernanceError::ProposalNotFound),
        };

        if proposal.executed {
            panic_with_error!(&env, GovernanceError::ProposalAlreadyExecuted);
        }
        if proposal.cancelled {
            panic_with_error!(&env, GovernanceError::ProposalAlreadyCancelled);
        }

        if !vec_contains(&env, &proposal.signers, &signer) {
            panic_with_error!(&env, GovernanceError::InvalidSigner);
        }

        if proposal.signatures.contains_key(signer.clone()) {
            panic_with_error!(&env, GovernanceError::DuplicateSigner);
        }

        proposal.signatures.set(signer.clone(), signature);
        env.storage().persistent().set(&key, &proposal);
        bump_upgrade_entry(&env, &key);

        let threshold: u32 = env.storage().instance().get(&DataKey::Threshold).unwrap();
        let sig_count = proposal.signatures.len() as u32;

        ProposalSigned {
            id: proposal_id,
            signer,
            signatures_count: sig_count,
            threshold,
        }
        .publish(&env);

        bump_instance(&env);
    }

    pub fn execute(env: Env, executor: Address, proposal_id: BytesN<32>) {
        require_not_paused(&env);
        executor.require_auth();

        let key = DataKey::PendingProposal(proposal_id.clone());
        let mut proposal: Proposal = match env.storage().persistent().get(&key) {
            Some(p) => p,
            None => panic_with_error!(&env, GovernanceError::ProposalNotFound),
        };

        if proposal.executed {
            panic_with_error!(&env, GovernanceError::ProposalAlreadyExecuted);
        }
        if proposal.cancelled {
            panic_with_error!(&env, GovernanceError::ProposalAlreadyCancelled);
        }

        let current_time = env.ledger().timestamp();
        if current_time < proposal.effective_at {
            panic_with_error!(&env, GovernanceError::ProposalNotReady);
        }

        let threshold: u32 = env.storage().instance().get(&DataKey::Threshold).unwrap();
        if (proposal.signatures.len() as u32) < threshold {
            panic_with_error!(&env, GovernanceError::InsufficientSignatures);
        }

        proposal.executed = true;
        env.storage().persistent().set(&key, &proposal);
        bump_upgrade_entry(&env, &key);

        ProposalExecuted {
            id: proposal_id.clone(),
            executor,
            target_contract: proposal.target_contract.clone(),
            function_selector: proposal.function_selector.clone(),
        }
        .publish(&env);

        bump_instance(&env);
    }

    pub fn cancel(env: Env, canceller: Address, proposal_id: BytesN<32>) {
        require_not_paused(&env);
        canceller.require_auth();

        let key = DataKey::PendingProposal(proposal_id.clone());
        let mut proposal: Proposal = match env.storage().persistent().get(&key) {
            Some(p) => p,
            None => panic_with_error!(&env, GovernanceError::ProposalNotFound),
        };

        if proposal.executed {
            panic_with_error!(&env, GovernanceError::ProposalAlreadyExecuted);
        }
        if proposal.cancelled {
            panic_with_error!(&env, GovernanceError::ProposalAlreadyCancelled);
        }

        let is_proposer = proposal.proposer == canceller;
        let is_signer = vec_contains(&env, &proposal.signers, &canceller);
        let is_emergency = {
            let emergency: Address = env.storage().instance().get(&DataKey::EmergencyAdmin).unwrap();
            canceller == emergency
        };

        if !is_proposer && !is_signer && !is_emergency {
            panic_with_error!(&env, GovernanceError::Unauthorized);
        }

        proposal.cancelled = true;
        env.storage().persistent().set(&key, &proposal);
        bump_upgrade_entry(&env, &key);

        ProposalCancelled {
            id: proposal_id.clone(),
            canceller,
            target_contract: proposal.target_contract.clone(),
        }
        .publish(&env);

        bump_instance(&env);
    }

    pub fn get_proposal(env: Env, proposal_id: BytesN<32>) -> Option<Proposal> {
        let key = DataKey::PendingProposal(proposal_id);
        let value = env.storage().persistent().get(&key);
        if value.is_some() {
            bump_upgrade_entry(&env, &key);
        }
        value
    }

    pub fn get_pending_queue(env: Env) -> Vec<PendingChange> {
        let queue = get_proposal_queue(&env);
        let mut result = Vec::new(&env);

        for proposal_id in queue.iter() {
            let key = DataKey::PendingProposal(proposal_id.clone());
            if let Some(proposal) = env.storage().persistent().get::<DataKey, Proposal>(&key) {
                if !proposal.executed && !proposal.cancelled {
                    let threshold: u32 = env.storage().instance().get(&DataKey::Threshold).unwrap();
                    result.push_back(PendingChange {
                        id: proposal.id.clone(),
                        target_contract: proposal.target_contract.clone(),
                        function_selector: proposal.function_selector.clone(),
                        payload_hash: proposal.payload_hash.clone(),
                        proposer: proposal.proposer.clone(),
                        created_at: proposal.created_at,
                        effective_at: proposal.effective_at,
                        delay_secs: proposal.delay_secs,
                        signers_count: proposal.signers.len(),
                        threshold,
                    });
                }
            }
        }

        bump_instance(&env);
        result
    }

    pub fn get_pending_count(env: Env) -> u32 {
        let queue = get_proposal_queue(&env);
        let mut count = 0u32;
        for proposal_id in queue.iter() {
            let key = DataKey::PendingProposal(proposal_id.clone());
            if let Some(proposal) = env.storage().persistent().get::<DataKey, Proposal>(&key) {
                if !proposal.executed && !proposal.cancelled {
                    count += 1;
                }
            }
        }
        count
    }

    pub fn update_signers(env: Env, caller: Address, new_signers: Vec<Address>, new_threshold: u32) {
        require_emergency_admin(&env, &caller);

        if new_signers.len() < MIN_SIGNERS as u32 || new_signers.len() > MAX_SIGNERS as u32 {
            panic_with_error!(&env, GovernanceError::InvalidSignerCount);
        }

        if new_threshold < MIN_SIGNERS || new_threshold > new_signers.len() {
            panic_with_error!(&env, GovernanceError::InvalidThreshold);
        }

        env.storage()
            .instance()
            .set(&DataKey::Signers, &new_signers);
        env.storage()
            .instance()
            .set(&DataKey::Threshold, &new_threshold);

        SignersUpdated {
            signers: new_signers,
            threshold: new_threshold,
        }
        .publish(&env);

        bump_instance(&env);
    }

    pub fn update_delays(env: Env, caller: Address, min_delay_secs: u64, max_delay_secs: u64) {
        require_emergency_admin(&env, &caller);

        if min_delay_secs < MIN_DELAY_SECS || min_delay_secs > MAX_DELAY_SECS {
            panic_with_error!(&env, GovernanceError::InvalidDelay);
        }

        if max_delay_secs < MIN_DELAY_SECS || max_delay_secs > MAX_DELAY_SECS {
            panic_with_error!(&env, GovernanceError::InvalidDelay);
        }

        if min_delay_secs > max_delay_secs {
            panic_with_error!(&env, GovernanceError::InvalidDelay);
        }

        env.storage()
            .instance()
            .set(&DataKey::MinDelay, &min_delay_secs);
        env.storage()
            .instance()
            .set(&DataKey::MaxDelay, &max_delay_secs);

        DelayUpdated {
            min_delay: min_delay_secs,
            max_delay: max_delay_secs,
        }
        .publish(&env);

        bump_instance(&env);
    }

    pub fn pause(env: Env, caller: Address) {
        require_emergency_admin(&env, &caller);
        env.storage().instance().set(&DataKey::Paused, &true);

        EmergencyPauseSet {
            paused: true,
            by: caller,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        bump_instance(&env);
    }

    pub fn unpause(env: Env, caller: Address) {
        require_emergency_admin(&env, &caller);
        env.storage().instance().set(&DataKey::Paused, &false);

        EmergencyPauseSet {
            paused: false,
            by: caller,
            timestamp: env.ledger().timestamp(),
        }
        .publish(&env);

        bump_instance(&env);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<DataKey, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    pub fn signers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::Signers)
            .unwrap_or(Vec::new(&env))
    }

    pub fn threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Threshold)
            .unwrap_or(0)
    }

    pub fn min_delay(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MinDelay)
            .unwrap_or(MIN_DELAY_SECS)
    }

    pub fn max_delay(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MaxDelay)
            .unwrap_or(MAX_DELAY_SECS)
    }

    pub fn emergency_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::EmergencyAdmin)
            .unwrap()
    }

    pub fn total_proposals(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::ProposalCount)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
