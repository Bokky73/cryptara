// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./CryptaraPolicy.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

contract CryptaraPolicyV2 is CryptaraPolicy, EIP712 {
    string public constant V2_VERSION = "2.0.0";
    address public timelock;

    bytes32 public constant POLICY_COMMITMENT_TYPEHASH = keccak256(
        "PolicyCommitment(address user,bytes32 policyCommitment,address authorizedAgent,uint256 nonce,uint256 expiry)"
    );

    mapping(address => uint256) public nonces;

    event TimelockUpdated(address indexed oldTimelock, address indexed newTimelock);
    event PolicyCommitmentAuthorized(
        address indexed user,
        bytes32 policyCommitment,
        address indexed authorizedAgent,
        uint256 nonce,
        uint256 expiry
    );

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
        emit TimelockUpdated(old, _timelock);
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
}
