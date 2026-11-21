// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./CryptaraPolicy.sol";

contract CryptaraPolicyV2 is CryptaraPolicy {
    string public constant V2_VERSION = "2.0.0";
    address public timelock;

    event TimelockUpdated(address indexed oldTimelock, address indexed newTimelock);

    function getV2Version() external pure returns (string memory) {
        return V2_VERSION;
    }

    function upgradeMigrate() external onlyOwner {
        owner = owner;
    }

    function setTimelock(address _timelock) external onlyOwner {
        require(_timelock != address(0), "PolicyV2: zero timelock");
        address old = timelock;
        timelock = _timelock;
        emit TimelockUpdated(old, _timelock);
    }

    function getTimelock() external view returns (address) {
        return timelock;
    }

    /// @notice Atomically consume a policy intent on behalf of the registered vault/executor.
    /// @dev Enforces the per-user daily spend cap and flips `executed = true` in a single call.
    ///      Only the registered vault/executor may invoke this; reverts deterministically otherwise.
    function consumeIntent(bytes32 intentHash, address user, address token, uint256 amount)
        external
        override
    {
        require(msg.sender == vault, "PolicyV2: caller not vault");
        require(user != address(0), "PolicyV2: zero user");
        require(amount > 0, "PolicyV2: zero amount");

        Intent storage intent = intents[intentHash];
        require(intent.user == user, "PolicyV2: intent user mismatch");
        require(intent.token == token, "PolicyV2: intent token mismatch");
        require(intent.amount == amount, "PolicyV2: intent amount mismatch");
        require(!intent.executed, "PolicyV2: intent already executed");

        _rollDailySpend(user);
        uint256 newSpend = dailySpend[user] + amount;
        require(newSpend <= maxDailySpend, "PolicyV2: daily spend exceeded");

        dailySpend[user] = newSpend;
        intent.executed = true;

        emit IntentConsumed(intentHash, user, token, amount);
    }
}
