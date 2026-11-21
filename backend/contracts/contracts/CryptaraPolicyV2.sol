// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./CryptaraPolicy.sol";

contract CryptaraPolicyV2 is CryptaraPolicy {
    string public constant V2_VERSION = "2.0.0";
    address public timelock;
    address public pendingTimelock;

    event TimelockUpdated(address indexed oldTimelock, address indexed newTimelock);
    event TimelockTransferProposed(address indexed currentTimelock, address indexed pendingTimelock);
    event TimelockTransferAccepted(address indexed oldTimelock, address indexed newTimelock);
    event TimelockTransferCancelled(address indexed cancelledTimelock);

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
        pendingTimelock = address(0);
        emit TimelockUpdated(old, _timelock);
    }

    function proposeTimelock(address _pendingTimelock) external onlyOwner {
        require(_pendingTimelock != address(0), "PolicyV2: zero pending timelock");
        pendingTimelock = _pendingTimelock;
        emit TimelockTransferProposed(timelock, _pendingTimelock);
    }

    function acceptTimelock() external {
        require(msg.sender == pendingTimelock, "PolicyV2: not pending timelock");
        address old = timelock;
        timelock = pendingTimelock;
        pendingTimelock = address(0);
        emit TimelockTransferAccepted(old, timelock);
    }

    function cancelPendingTimelock() external onlyOwner {
        address cancelled = pendingTimelock;
        pendingTimelock = address(0);
        emit TimelockTransferCancelled(cancelled);
    }

    function getTimelock() external view returns (address) {
        return timelock;
    }
}
