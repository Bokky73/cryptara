// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IPolicyValidator {
    function getIntentValidity(bytes32 intentHash, address token, uint256 amount) external view returns (bool valid, string memory reason);
    function intents(bytes32 intentHash) external view returns (bytes32 intentHash_, bytes32 policyCommitment, address targetToken, uint256 amount, uint256 nonce, uint64 expiry, bool executed);
    function policyDecisions(bytes32 decisionHash) external view returns (bytes32 decisionHash_, address user, address authorizedAgent, uint256 maxTransactionValue, uint256 maxSlippageBps, uint256 nonce, uint64 expiry, bool revoked);
}

contract CryptaraVault {
    using SafeERC20 for IERC20;

    IPolicyValidator public immutable policy;
    address public immutable agent;
    address public timelock;

    mapping(address => mapping(address => uint256)) public balances;
    mapping(bytes32 => bool) public consumedIntents;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount, bytes32 indexed intentHash);
    event TimelockUpdated(address indexed oldTimelock, address indexed newTimelock);

    constructor(address _policy, address _agent) {
        require(_policy != address(0), "Vault: zero policy");
        require(_agent != address(0), "Vault: zero agent");
        policy = IPolicyValidator(_policy);
        agent = _agent;
    }

    function deposit(address token, uint256 amount) external {
        require(token != address(0), "Vault: zero token");
        require(amount > 0, "Vault: zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender][token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount, address recipient, bytes32 intentHash) external {
        require(msg.sender == agent, "Vault: not agent");
        require(recipient != address(0), "Vault: zero recipient");
        require(token != address(0), "Vault: zero token");
        require(amount > 0, "Vault: zero amount");
        require(!consumedIntents[intentHash], "Vault: intent consumed");

        (bool valid, string memory reason) = policy.getIntentValidity(intentHash, token, amount);
        require(valid, reason);

        consumedIntents[intentHash] = true;

        (, bytes32 policyCommitment, , , , , ) = policy.intents(intentHash);
        (, address decisionUser, , , , , , ) = policy.policyDecisions(policyCommitment);
        require(decisionUser == recipient, "Vault: intent user mismatch");

        require(balances[recipient][token] >= amount, "Vault: insufficient balance");
        balances[recipient][token] -= amount;

        IERC20(token).safeTransfer(recipient, amount);
        emit Withdrawn(recipient, token, amount, intentHash);
    }

    function setTimelock(address _timelock) external {
        // In production this would be guarded by governance; for V3 we allow anyone to set for testability
        // and document that production should restrict to timelock/owner via wrapper.
        require(_timelock != address(0), "Vault: zero timelock");
        address old = timelock;
        timelock = _timelock;
        emit TimelockUpdated(old, _timelock);
    }

    function userBalance(address user, address token) external view returns (uint256) {
        return balances[user][token];
    }
}
