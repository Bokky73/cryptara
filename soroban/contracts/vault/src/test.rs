#![cfg(test)]

use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env};

use crate::{VaultContract, VaultContractClient};

const DAY_IN_LEDGERS: u32 = 17_280;
const NINETY_DAYS: u32 = DAY_IN_LEDGERS * 90;
const ONE_EIGHTY_DAYS: u32 = DAY_IN_LEDGERS * 180;

fn setup<'a>() -> (Env, VaultContractClient<'a>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, VaultContract);
    let client = VaultContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_deposit_and_balance() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &1_000);
    assert_eq!(client.get_balance(&user), 1_000);
}

#[test]
fn test_withdraw_reduces_balance() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &1_000);
    client.withdraw(&user, &400);
    assert_eq!(client.get_balance(&user), 600);
}

#[test]
fn test_instance_ttl_extends_below_threshold() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &1_000);

    env.ledger().set_sequence_number(NINETY_DAYS);
    // A read/write path must bump the instance TTL back above the threshold.
    client.deposit(&user, &1);

    let ttl = env.storage().instance().get_ttl();
    assert!(ttl > 0, "instance TTL must be extended on access");
}

#[test]
fn test_balance_survives_180_day_progression() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &5_000);

    env.ledger().set_sequence_number(ONE_EIGHTY_DAYS);
    // Touch the entry so its persistent TTL is bumped before it can expire.
    client.deposit(&user, &1);

    assert_eq!(client.get_balance(&user), 5_001);
}

#[test]
fn test_authorization_survives_180_day_progression() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &2_000);
    client.authorize(&user, &1_500);

    env.ledger().set_sequence_number(ONE_EIGHTY_DAYS);
    client.deposit(&user, &1);

    assert_eq!(client.get_authorized(&user), 1_500);
}
