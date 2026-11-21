// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CryptaraPolicy.sol";

/// @title CryptaraVault
/// @notice Custody vault for user deposits with policy-gated agent withdrawals.
contract CryptaraVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    CryptaraPolicy public immutable policy;
    address public immutable agent;

    mapping(address => mapping(address => uint256)) public balances;
    mapping(bytes32 => bool) public consumedIntents;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount, address indexed recipient);
    event UserWithdrawn(address indexed user, address indexed token, uint256 amount);

    error NotAgent();
    error ZeroAmount();
    error ZeroRecipient();
    error InsufficientBalance();
    error IntentConsumed();
    error IntentUserMismatch();
    error FeeOnTransferNotSupported();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(address _policy, address _agent) {
        policy = CryptaraPolicy(_policy);
        agent = _agent;
    }

    function userBalance(address user, address token) external view returns (uint256) {
        return balances[user][token];
    }

    function deposit(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        IERC20 erc20 = IERC20(token);
        uint256 before = erc20.balanceOf(address(this));
        erc20.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = erc20.balanceOf(address(this)) - before;

        // Reject fee-on-transfer / rebasing tokens that would create phantom balances.
        if (received != amount) revert FeeOnTransferNotSupported();

        balances[msg.sender][token] += received;
        emit Deposited(msg.sender, token, received);
    }

    /// @notice Trustless escape hatch: withdraw your own balance directly.
    /// @dev Independent of agent liveness and policy pause state.
    function userWithdraw(address token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (balances[msg.sender][token] < amount) revert InsufficientBalance();

        balances[msg.sender][token] -= amount;

        IERC20(token).safeTransfer(msg.sender, amount);
        emit UserWithdrawn(msg.sender, token, amount);
    }

    function withdraw(
        address token,
        uint256 amount,
        address recipient,
        bytes32 intentHash
    ) external onlyAgent nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroRecipient();
        if (consumedIntents[intentHash]) revert IntentConsumed();

        (address intentUser, address intentToken, uint256 intentAmount) = policy.consumeIntent(intentHash);
        if (intentToken != token) revert IntentUserMismatch();
        if (intentAmount < amount) revert InsufficientBalance();
        if (balances[intentUser][token] < amount) revert InsufficientBalance();

        consumedIntents[intentHash] = true;
        balances[intentUser][token] -= amount;

        IERC20(token).safeTransfer(recipient, amount);
        emit Withdrawn(intentUser, token, amount, recipient);
    }
}
