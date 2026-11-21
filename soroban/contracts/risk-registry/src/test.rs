extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger, MockAuth, MockAuthInvoke},
    vec, Address, BytesN, Env, IntoVal, String, Symbol,
};

fn setup() -> (Env, RiskRegistryClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    let contract_id = env.register(RiskRegistry, ());
    let client = RiskRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let publisher = Address::generate(&env);
    client.initialize(&admin, &vec![&env, publisher.clone()]);
    (env, client, admin, publisher)
}

fn make_asset_id(env: &Env, fill: u8) -> BytesN<32> {
    BytesN::from_array(env, &[fill; 32])
}

fn make_report_hash(env: &Env, fill: u8) -> BytesN<32> {
    BytesN::from_array(env, &[fill; 32])
}

fn make_input(
    env: &Env,
    asset_fill: u8,
    hash_fill: u8,
    score: u32,
    confidence_bps: u32,
) -> RiskRecordInput {
    RiskRecordInput {
        asset_id: make_asset_id(env, asset_fill),
        network: Symbol::new(env, "testnet"),
        asset_label: String::from_str(env, "XLM"),
        score,
        confidence_bps,
        risk_level: Symbol::new(env, "watch"),
        report_hash: make_report_hash(env, hash_fill),
        report_uri: String::from_str(env, "ipfs://"),
        observed_at: 1_700_000_000,
    }
}

// ─── Initialization ─────────────────────────────────────────────────

#[test]
fn initializes_with_admin_and_publishers() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    let contract_id = env.register(RiskRegistry, ());
    let client = RiskRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let publisher = Address::generate(&env);

    client.initialize(&admin, &vec![&env, publisher.clone()]);

    assert_eq!(client.admin(), admin);
    assert!(client.is_publisher(&publisher));
    assert_eq!(client.contract_version(), 2);
}

#[test]
fn rejects_double_initialization() {
    let (_env, client, _admin, _publisher) = setup();
    let other_admin = Address::generate(&_env);
    let result = client.try_initialize(&other_admin, &vec![&_env]);
    assert_eq!(result, Err(Ok(RegistryError::AlreadyInitialized)));
}

#[test]
fn uninitialized_contract_rejects_calls() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_700_000_000);
    let contract_id = env.register(RiskRegistry, ());
    let client = RiskRegistryClient::new(&env, &contract_id);

    let asset_id = make_asset_id(&env, 1);
    let report_hash = make_report_hash(&env, 2);
    let network = Symbol::new(&env, "testnet");

    let result = client.try_publish_risk(
        &Address::generate(&env),
        &asset_id,
        &network,
        &String::from_str(&env, "XLM"),
        &50,
        &10_000,
        &Symbol::new(&env, "watch"),
        &report_hash,
        &String::from_str(&env, "ipfs://"),
        &1_700_000_000,
    );
    assert_eq!(result, Err(Ok(RegistryError::NotInitialized)));
}

// ─── Authorization ──────────────────────────────────────────────────

#[test]
fn unauthorized_publisher_cannot_publish() {
    let (_env, client, _admin, _publisher) = setup();
    let unknown = Address::generate(&_env);
    let asset_id = make_asset_id(&_env, 1);
    let report_hash = make_report_hash(&_env, 2);
    let network = Symbol::new(&_env, "testnet");

    let result = client.try_publish_risk(
        &unknown,
        &asset_id,
        &network,
        &String::from_str(&_env, "XLM"),
        &50,
        &10_000,
        &Symbol::new(&_env, "watch"),
        &report_hash,
        &String::from_str(&_env, "ipfs://"),
        &1_700_000_000,
    );
    assert_eq!(result, Err(Ok(RegistryError::UnauthorizedPublisher)));
}

#[test]
fn admin_can_authorize_and_revoke_publisher() {
    let (_env, client, _admin, publisher) = setup();
    assert!(client.is_publisher(&publisher));

    client.set_publisher(&publisher, &false);
    assert!(!client.is_publisher(&publisher));

    client.set_publisher(&publisher, &true);
    assert!(client.is_publisher(&publisher));
}

#[test]
fn non_admin_cannot_set_publisher() {
    let env = Env::default();
    env.ledger().set_timestamp(1_700_000_000);
    let contract_id = env.register(RiskRegistry, ());
    let client = RiskRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let publisher = Address::generate(&env);
    let stranger = Address::generate(&env);

    let publishers = vec![&env, publisher.clone()];
    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize",
                args: (&admin, &publishers).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .initialize(&admin, &publishers);

    // Stranger tries to set publisher without auth — should fail
    let replacement = Address::generate(&env);
    let result = client
        .mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_publisher",
                args: (&replacement, &true).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_set_publisher(&replacement, &true);
    assert!(
        result.is_err(),
        "Non-admin must not be able to set publishers"
    );
}

#[test]
fn non_admin_cannot_set_contract_version() {
    let env = Env::default();
    env.ledger().set_timestamp(1_700_000_000);
    let contract_id = env.register(RiskRegistry, ());
    let client = RiskRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let publisher = Address::generate(&env);

    let publishers = vec![&env, publisher];
    client
        .mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize",
                args: (&admin, &publishers).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .initialize(&admin, &publishers);

    // Stranger tries to set contract version without auth
    let stranger = Address::generate(&env);
    // No auth mock for stranger
    let result = client
        .mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_contract_version",
                args: (2u32,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_set_contract_version(&2);
    assert!(
        result.is_err(),
        "Non-admin must not be able to set contract version"
    );
}

// ─── Bounds ─────────────────────────────────────────────────────────

#[test]
fn rejects_invalid_score() {
    let (_env, client, _admin, publisher) = setup();
    let asset_id = make_asset_id(&_env, 1);
    let report_hash = make_report_hash(&_env, 2);
    let network = Symbol::new(&_env, "testnet");

    let result = client.try_publish_risk(
        &publisher,
        &asset_id,
        &network,
        &String::from_str(&_env, "XLM"),
        &101,
        &10_000,
        &Symbol::new(&_env, "watch"),
        &report_hash,
        &String::from_str(&_env, "ipfs://"),
        &1_700_000_000,
    );
    assert_eq!(result, Err(Ok(RegistryError::InvalidScore)));
}

#[test]
fn rejects_invalid_confidence() {
    let (_env, client, _admin, publisher) = setup();
    let asset_id = make_asset_id(&_env, 1);
    let report_hash = make_report_hash(&_env, 2);
    let network = Symbol::new(&_env, "testnet");

    let result = client.try_publish_risk(
        &publisher,
        &asset_id,
        &network,
        &String::from_str(&_env, "XLM"),
        &50,
        &10_001,
        &Symbol::new(&_env, "watch"),
        &report_hash,
        &String::from_str(&_env, "ipfs://"),
        &1_700_000_000,
    );
    assert_eq!(result, Err(Ok(RegistryError::InvalidConfidence)));
}

#[test]
fn rejects_long_asset_label() {
    let (_env, client, _admin, publisher) = setup();
    let asset_id = make_asset_id(&_env, 1);
    let report_hash = make_report_hash(&_env, 2);
    let network = Symbol::new(&_env, "testnet");

    let long_label = String::from_str(&_env, &"A".repeat(65));
    let result = client.try_publish_risk(
        &publisher,
        &asset_id,
        &network,
        &long_label,
        &50,
        &10_000,
        &Symbol::new(&_env, "watch"),
        &report_hash,
        &String::from_str(&_env, "ipfs://"),
        &1_700_000_000,
    );
    assert_eq!(result, Err(Ok(RegistryError::AssetLabelTooLong)));
}

// ─── Revision chaining ──────────────────────────────────────────────

#[test]
fn genesis_record_has_zero_prev_hash_and_revision_one() {
    let (env, client, _admin, publisher) = setup();
    let asset_id = make_asset_id(&env, 1);
    let report_hash = make_report_hash(&env, 2);
    let network = Symbol::new(&env, "testnet");

    client.publish_risk(
        &publisher,
        &asset_id,
        &network,
        &String::from_str(&env, "XLM"),
        &50,
        &10_000,
        &Symbol::new(&env, "watch"),
        &report_hash,
        &String::from_str(&env, "ipfs://"),
        &1_700_000_000,
    );

    let record = client.get_risk(&asset_id, &network).unwrap();
    assert_eq!(record.revision, 1);
    assert_eq!(record.prev_report_hash, BytesN::from_array(&env, &[0u8; 32]));
    assert_eq!(record.report_hash, report_hash);
}

#[test]
fn subsequent_record_links_prev_hash_and_increments_revision() {
    let (env, client, _admin, publisher) = setup();
    let asset_id = make_asset_id(&env, 1);
    let network = Symbol::new(&env, "testnet");
    let first_hash = make_report_hash(&env, 2);
    let second_hash = make_report_hash(&env, 3);

    client.publish_risk(
        &publisher,
        &asset_id,
        &network,
        &String::from_str(&env, "XLM"),
        &50,
        &10_000,
        &Symbol::new(&env, "watch"),
        &first_hash,
        &String::from_str(&env, "ipfs://"),
        &1_700_000_000,
    );
    client.publish_risk(
        &publisher,
        &asset_id,
        &network,
        &String::from_str(&env, "XLM"),
        &60,
        &9_000,
        &Symbol::new(&env, "watch"),
        &second_hash,
        &String::from_str(&env, "ipfs://"),
        &1_700_000_000,
    );

    let record = client.get_risk(&asset_id, &network).unwrap();
    assert_eq!(record.revision, 2);
    assert_eq!(record.prev_report_hash, first_hash);
    assert_eq!(record.report_hash, second_hash);
}

// ─── Batch publish ──────────────────────────────────────────────────

#[test]
fn publish_batch_publishes_multiple_records() {
    let (env, client, _admin, publisher) = setup();
    let records = vec![
        &env,
        make_input(&env, 1, 10, 50, 10_000),
        make_input(&env, 2, 20, 60, 9_000),
    ];

    client.publish_batch(&publisher, &records);

    let network = Symbol::new(&env, "testnet");
    let r1 = client.get_risk(&make_asset_id(&env, 1), &network).unwrap();
    let r2 = client.get_risk(&make_asset_id(&env, 2), &network).unwrap();
    assert_eq!(r1.revision, 1);
    assert_eq!(r2.revision, 1);
    assert_eq!(r1.report_hash, make_report_hash(&env, 10));
    assert_eq!(r2.report_hash, make_report_hash(&env, 20));
}

#[test]
fn publish_batch_rejects_oversized_batch() {
    let (env, client, _admin, publisher) = setup();
    let mut records = vec![&env];
    for i in 0..11u8 {
        records.push_back(make_input(&env, i, i, 50, 10_000));
    }

    let result = client.try_publish_batch(&publisher, &records);
    assert_eq!(result, Err(Ok(RegistryError::BatchTooLarge)));
}

#[test]
fn publish_batch_rolls_back_on_invalid_score() {
    let (env, client, _admin, publisher) = setup();
    let records = vec![
        &env,
        make_input(&env, 1, 10, 50, 10_000),
        make_input(&env, 2, 20, 101, 10_000),
    ];

    let result = client.try_publish_batch(&publisher, &records);
    assert_eq!(result, Err(Ok(RegistryError::InvalidScore)));

    let network = Symbol::new(&env, "testnet");
    assert!(client.get_risk(&make_asset_id(&env, 1), &network).is_none());
    assert!(client.get_risk(&make_asset_id(&env, 2), &network).is_none());
}

#[test]
fn publish_batch_rolls_back_on_invalid_confidence() {
    let (env, client, _admin, publisher) = setup();
    let records = vec![
        &env,
        make_input(&env, 1, 10, 50, 10_000),
        make_input(&env, 2, 20, 50, 10_001),
    ];

    let result = client.try_publish_batch(&publisher, &records);
    assert_eq!(result, Err(Ok(RegistryError::InvalidConfidence)));

    let network = Symbol::new(&env, "testnet");
    assert!(client.get_risk(&make_asset_id(&env, 1), &network).is_none());
}

#[test]
fn publish_batch_chains_revisions_across_calls() {
    let (env, client, _admin, publisher) = setup();
    let network = Symbol::new(&env, "testnet");

    let first = vec![&env, make_input(&env, 1, 10, 50, 10_000)];
    client.publish_batch(&publisher, &first);

    let second = vec![&env, make_input(&env, 1, 11, 55, 9_500)];
    client.publish_batch(&publisher, &second);

    let record = client.get_risk(&make_asset_id(&env, 1), &network).unwrap();
    assert_eq!(record.revision, 2);
    assert_eq!(record.prev_report_hash, make_report_hash(&env, 10));
    assert_eq!(record.report_hash, make_report_hash(&env, 11));
}
