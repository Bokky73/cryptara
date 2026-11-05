#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    vec, Address, BytesN, Env, FromVal, IntoVal, String, Symbol, Val, Vec as SorobanVec,
};

const INSTANCE_TTL_THRESHOLD: u32 = 30 * 24 * 60 * 60 / 5;
const INSTANCE_TTL_EXTEND_TO: u32 = 120 * 24 * 60 * 60 / 5;

const LEDGER_TTL_THRESHOLD: u32 = 60 * 24 * 60 * 60 / 5;
const LEDGER_TTL_EXTEND_TO: u32 = 365 * 24 * 60 * 60 / 5;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Policy,
    Agent,
    ConsumedIntent(BytesN<32>),
    Balance(Address, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VaultError {
    NotAgent = 1,
    ZeroAmount = 2,
    ZeroRecipient = 3,
    IntentInvalid = 4,
    PolicyCallFailed = 5,
    IntentAlreadyConsumed = 6,
    UserMismatch = 7,
    InsufficientBalance = 8,
}

#[contractevent]
pub struct Withdrawn {
    #[topic]
    pub user: Address,
    #[topic]
    pub token: Address,
    pub amount: i128,
    #[topic]
    pub intent_hash: BytesN<32>,
}

#[contractevent]
pub struct Deposited {
    #[topic]
    pub user: Address,
    #[topic]
    pub token: Address,
    pub amount: i128,
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

fn extend_entry(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, LEDGER_TTL_THRESHOLD, LEDGER_TTL_EXTEND_TO);
}

fn get_intent_validity(
    env: &Env,
    policy: &Address,
    intent_hash: BytesN<32>,
    token: Address,
    amount: i128,
) -> bool {
    let args: SorobanVec<Val> = vec![
        env,
        intent_hash.into_val(env),
        token.into_val(env),
        amount.into_val(env),
    ];
    let result: Val = env.invoke_contract(policy, &Symbol::new(env, "get_intent_validity"), args);
    let tuple: (bool, String) = <(bool, String)>::from_val(env, &result);
    tuple.0
}

fn get_intent_user(env: &Env, policy: &Address, intent_hash: BytesN<32>) -> Address {
    let args: SorobanVec<Val> = vec![env, intent_hash.into_val(env)];
    let result: Val = env.invoke_contract(policy, &Symbol::new(env, "get_intent_user"), args);
    <Address>::from_val(env, &result)
}

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    pub fn initialize(env: Env, policy: Address, agent: Address) {
        if env.storage().instance().has(&DataKey::Policy) {
            panic_with_error!(&env, VaultError::NotAgent);
        }
        env.storage().instance().set(&DataKey::Policy, &policy);
        env.storage().instance().set(&DataKey::Agent, &agent);
        bump_instance(&env);
    }

    pub fn deposit(env: Env, user: Address, token: Address, amount: i128) {
        user.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }

        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&user, &contract, &amount);

        let balance_key = DataKey::Balance(user.clone(), token.clone());
        let balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        env.storage()
            .persistent()
            .set(&balance_key, &(balance + amount));
        extend_entry(&env, &balance_key);

        Deposited {
            user,
            token,
            amount,
        }
        .publish(&env);
        bump_instance(&env);
    }

    pub fn withdraw(
        env: Env,
        token: Address,
        amount: i128,
        recipient: Address,
        intent_hash: BytesN<32>,
    ) {
        let agent: Address = env.storage().instance().get(&DataKey::Agent).unwrap();
        agent.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, VaultError::ZeroAmount);
        }

        let consumed_key = DataKey::ConsumedIntent(intent_hash.clone());
        if env.storage().persistent().has(&consumed_key) {
            panic_with_error!(&env, VaultError::IntentAlreadyConsumed);
        }

        let policy: Address = env.storage().instance().get(&DataKey::Policy).unwrap();
        if !get_intent_validity(&env, &policy, intent_hash.clone(), token.clone(), amount) {
            panic_with_error!(&env, VaultError::IntentInvalid);
        }

        env.storage().persistent().set(&consumed_key, &true);
        extend_entry(&env, &consumed_key);

        let decision_user = get_intent_user(&env, &policy, intent_hash.clone());
        if decision_user != recipient {
            panic_with_error!(&env, VaultError::UserMismatch);
        }

        let balance_key = DataKey::Balance(recipient.clone(), token.clone());
        let balance: i128 = env.storage().persistent().get(&balance_key).unwrap_or(0);
        if balance < amount {
            panic_with_error!(&env, VaultError::InsufficientBalance);
        }
        env.storage()
            .persistent()
            .set(&balance_key, &(balance - amount));
        extend_entry(&env, &balance_key);

        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&contract, &recipient, &amount);

        Withdrawn {
            user: recipient,
            token,
            amount,
            intent_hash,
        }
        .publish(&env);
        bump_instance(&env);
    }

    pub fn user_balance(env: Env, user: Address, token: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(user, token))
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use cryptara_policy::PolicyContract;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Env,
    };

    fn setup() -> (
        Env,
        VaultContractClient<'static>,
        Address,
        Address,
        Address,
        Address,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1_700_000_000);

        let policy_id = env.register(PolicyContract, ());
        let policy_client = cryptara_policy::PolicyContractClient::new(&env, &policy_id);

        let owner = Address::generate(&env);
        let agent = Address::generate(&env);
        let user = Address::generate(&env);

        policy_client.initialize(&owner, &owner, &agent);
        policy_client.set_limits(&10_000_000_000i128, &100, &5_000_000_000i128);

        let stellar = env.register_stellar_asset_contract_v2(agent.clone());
        let token = stellar.address();
        policy_client.allow_asset(&token);

        let vault_id = env.register(VaultContract, ());
        let vault_client = VaultContractClient::new(&env, &vault_id);
        vault_client.initialize(&policy_id, &agent);

        let token_client = StellarAssetClient::new(&env, &token);
        token_client.mint(&user, &1_000_000_000i128);

        (env, vault_client, agent, user, token, policy_id)
    }

    #[test]
    fn deposit_and_withdraw() {
        let (_env, vault, _agent, user, token, _policy) = setup();

        vault.deposit(&user, &token, &100_000_000i128);

        let policy_client = cryptara_policy::PolicyContractClient::new(&_env, &_policy);
        let decision = policy_client.apply_policy(&user, &100_000_000i128, &50, &1_703_600_000);
        let intent =
            policy_client.create_intent(&decision, &token, &100_000_000i128, &1_701_800_000, &50);

        vault.withdraw(&token, &50_000_000i128, &user, &intent);

        assert_eq!(vault.user_balance(&user, &token), 50_000_000);
    }

    #[test]
    fn reject_reused_intent() {
        let (_env, vault, _agent, user, token, _policy) = setup();

        vault.deposit(&user, &token, &100_000_000i128);

        let policy_client = cryptara_policy::PolicyContractClient::new(&_env, &_policy);
        let decision = policy_client.apply_policy(&user, &100_000_000i128, &50, &1_703_600_000);
        let intent =
            policy_client.create_intent(&decision, &token, &100_000_000i128, &1_701_800_000, &50);

        vault.withdraw(&token, &50_000_000i128, &user, &intent);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            vault.withdraw(&token, &10_000_000i128, &user, &intent);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn reject_user_mismatch() {
        let (_env, vault, _agent, user, token, _policy) = setup();

        vault.deposit(&user, &token, &100_000_000i128);

        let policy_client = cryptara_policy::PolicyContractClient::new(&_env, &_policy);
        let decision = policy_client.apply_policy(&user, &100_000_000i128, &50, &1_703_600_000);
        let intent =
            policy_client.create_intent(&decision, &token, &100_000_000i128, &1_701_800_000, &50);

        let other = Address::generate(&_env);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            vault.withdraw(&token, &10_000_000i128, &other, &intent);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn reject_insufficient_balance() {
        let (_env, vault, _agent, user, token, _policy) = setup();

        vault.deposit(&user, &token, &100_000_000i128);

        let policy_client = cryptara_policy::PolicyContractClient::new(&_env, &_policy);
        let decision = policy_client.apply_policy(&user, &1_000_000_000i128, &50, &1_703_600_000);
        let intent =
            policy_client.create_intent(&decision, &token, &1_000_000_000i128, &1_701_800_000, &50);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            vault.withdraw(&token, &500_000_000i128, &user, &intent);
        }));
        assert!(result.is_err());
    }
}
