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

    assert!(cpu > 0, "execute_proposal should consume CPU instructions");
    assert!(cpu < 50_000_000, "execute_proposal CPU budget exceeded: {cpu}");
    assert!(mem < 5_000_000, "execute_proposal memory budget exceeded: {mem}");
}
