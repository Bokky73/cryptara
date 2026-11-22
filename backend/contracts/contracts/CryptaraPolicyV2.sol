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

    // Asymmetric pause authority: emergencyAdmin OR governance may pause instantly,
    // but ONLY governance (timelocked multisig) may unpause.
    function pause(bytes32 reasonHash) external override {
        require(
            msg.sender == emergencyAdmin || msg.sender == owner || msg.sender == timelock,
            "PolicyV2: not authorized to pause"
        );
        require(!paused, "PolicyV2: already paused");
        paused = true;
        emit Paused(msg.sender, true, reasonHash, block.timestamp);
    }

    function unpause(bytes32 reasonHash) external override {
        require(
            msg.sender == owner || msg.sender == timelock,
            "PolicyV2: only governance can unpause"
        );
        require(paused, "PolicyV2: not paused");
        paused = false;
        emit Paused(msg.sender, false, reasonHash, block.timestamp);
    }
}
