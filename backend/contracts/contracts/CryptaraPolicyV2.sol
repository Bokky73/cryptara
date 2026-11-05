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
}
