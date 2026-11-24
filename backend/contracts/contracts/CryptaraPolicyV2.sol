// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./CryptaraPolicy.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract CryptaraPolicyV2 is CryptaraPolicy, EIP712 {
    using EnumerableSet for EnumerableSet.AddressSet;

    string public constant V2_VERSION = "2.0.0";
    address public timelock;
    address public pendingTimelock;

    // Bounded asset tracking: O(1) add/remove via EnumerableSet, capped size.
    uint256 public constant MAX_TRACKED_ASSETS = 256;

    EnumerableSet.AddressSet private _allowedAssets;
    EnumerableSet.AddressSet private _blockedAssets;

    bytes32 public constant POLICY_COMMITMENT_TYPEHASH = keccak256(
        "PolicyCommitment(address user,bytes32 policyCommitment,address authorizedAgent,uint256 nonce,uint256 expiry)"
    );

    mapping(address => uint256) public nonces;

    event TimelockUpdated(address indexed oldTimelock, address indexed newTimelock);
    event TimelockTransferProposed(address indexed currentTimelock, address indexed pendingTimelock);
    event TimelockTransferAccepted(address indexed oldTimelock, address indexed newTimelock);
    event TimelockTransferCancelled(address indexed cancelledTimelock);
    event PolicyCommitmentAuthorized(
        address indexed user,
        bytes32 policyCommitment,
        address indexed authorizedAgent,
        uint256 nonce,
        uint256 expiry
    );
    event AssetAllowStatusUpdated(address indexed asset, bool allowed);
    event AssetBlockStatusUpdated(address indexed asset, bool blocked);

    constructor() EIP712("CryptaraPolicy", "2") {}

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

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function hashPolicyCommitment(
        address user,
        bytes32 policyCommitment,
        address authorizedAgent,
        uint256 nonce,
        uint256 expiry
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    POLICY_COMMITMENT_TYPEHASH,
                    user,
                    policyCommitment,
                    authorizedAgent,
                    nonce,
                    expiry
                )
            )
        );
    }

    function authorizePolicyCommitment(
        bytes32 policyCommitment,
        address authorizedAgent,
        uint256 expiry,
        bytes calldata signature
    ) external returns (bool) {
        require(block.timestamp <= expiry, "PolicyV2: signature expired");

        uint256 nonce = nonces[msg.sender];
        bytes32 digest = hashPolicyCommitment(
            msg.sender,
            policyCommitment,
            authorizedAgent,
            nonce,
            expiry
        );

        require(
            SignatureChecker.isValidSignatureNow(msg.sender, digest, signature),
            "PolicyV2: invalid signature"
        );

        nonces[msg.sender] = nonce + 1;

        emit PolicyCommitmentAuthorized(
            msg.sender,
            policyCommitment,
            authorizedAgent,
            nonce,
            expiry
        );
        return true;
    }

    // --- Bounded asset allowlist/blocklist (O(1) add/remove) ---

    function setAssetAllowed(address asset, bool allowed) external onlyOwner {
        if (allowed) {
            require(
                _allowedAssets.length() < MAX_TRACKED_ASSETS,
                "PolicyV2: allowlist cap reached"
            );
            _allowedAssets.add(asset);
        } else {
            _allowedAssets.remove(asset);
        }
        emit AssetAllowStatusUpdated(asset, allowed);
    }

    function setAssetBlocked(address asset, bool blocked) external onlyOwner {
        if (blocked) {
            require(
                _blockedAssets.length() < MAX_TRACKED_ASSETS,
                "PolicyV2: blocklist cap reached"
            );
            _blockedAssets.add(asset);
        } else {
            _blockedAssets.remove(asset);
        }
        emit AssetBlockStatusUpdated(asset, blocked);
    }

    function isAssetAllowed(address asset) external view returns (bool) {
        return _allowedAssets.contains(asset);
    }

    function isAssetBlocked(address asset) external view returns (bool) {
        return _blockedAssets.contains(asset);
    }

    function allowedAssetCount() external view returns (uint256) {
        return _allowedAssets.length();
    }

    function blockedAssetCount() external view returns (uint256) {
        return _blockedAssets.length();
    }

    function allowedAssetAt(uint256 index) external view returns (address) {
        return _allowedAssets.at(index);
    }

    function blockedAssetAt(uint256 index) external view returns (address) {
        return _blockedAssets.at(index);
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
