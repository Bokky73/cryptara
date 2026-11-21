// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CryptaraPolicy {
    // ──────────────────────────────────────────────
    //  Types
    // ──────────────────────────────────────────────

    struct PolicyDecision {
        bytes32 decisionHash;
        address user;
        address authorizedAgent;
        uint256 maxTransactionValue;
        uint256 maxSlippageBps;
        uint256 nonce;
        uint64 expiry;
        bool revoked;
    }

    struct Intent {
        bytes32 intentHash;
        bytes32 policyCommitment;
        address targetToken;
        uint256 amount;
        uint256 nonce;
        uint64 expiry;
        bool executed;
    }

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    address public owner;
    address public emergencyAdmin;
    address public agent;
    address public vault;

    uint256 public maxTransactionValue;
    uint256 public maxSlippageBps;
    uint256 public maxDailySpend;

    mapping(address => uint256) public userNonce;
    mapping(address => uint256) public dailySpend;
    uint256 public lastDailyReset;

    mapping(address => bool) public allowedAssets;
    mapping(address => bool) public blockedAssets;
    address[] public allowedAssetList;
    address[] public blockedAssetList;

    mapping(bytes32 => PolicyDecision) public policyDecisions;
    mapping(bytes32 => Intent) public intents;

    bool public paused;
    uint256 private _status;

    string public constant VERSION = "1.0.0";

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);
    event EmergencyAdminSet(address indexed admin);
    event AgentSet(address indexed agent);
    event VaultSet(address indexed vault);
    event PolicyApplied(address indexed user, bytes32 indexed decisionHash);
    event IntentCreated(bytes32 indexed intentHash, bytes32 indexed policyCommitment);
    event IntentExecuted(bytes32 indexed intentHash);
    event IntentRevoked(bytes32 indexed intentHash);
    event IntentConsumed(bytes32 indexed intentHash, address indexed user, address indexed token, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event AssetAllowed(address indexed asset);
    event AssetBlocked(address indexed asset, bool blocked);
    event LimitsUpdated(uint256 maxTxValue, uint256 maxSlippageBps, uint256 maxDailySpend);
    event DailySpendReset(uint256 timestamp);

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Policy: not owner");
        _;
    }

    modifier onlyEmergencyAdmin() {
        require(msg.sender == emergencyAdmin, "Policy: not emergency admin");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent, "Policy: not agent");
        _;
    }

    modifier onlyVault() {
        require(msg.sender == vault, "Policy: not vault");
        _;
    }

    modifier onlyOwnerOrEmergency() {
        require(msg.sender == owner || msg.sender == emergencyAdmin, "Policy: not owner or emergency");
        _;
    }

    modifier nonReentrant() {
        require(_status != 1, "Policy: reentrancy");
        _status = 1;
        _;
        _status = 0;
    }

    modifier whenNotPaused() {
        require(!paused, "Policy: paused");
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
        emergencyAdmin = msg.sender;
        _status = 0;
    }

    // ──────────────────────────────────────────────
    //  Admin / Configuration
    // ──────────────────────────────────────────────

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Policy: zero owner");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnerTransferred(previousOwner, newOwner);
    }

    function setEmergencyAdmin(address admin) external onlyOwner {
        require(admin != address(0), "Policy: zero admin");
        emergencyAdmin = admin;
        emit EmergencyAdminSet(admin);
    }

    function setAgent(address newAgent) external onlyOwner {
        require(newAgent != address(0), "Policy: zero agent");
        agent = newAgent;
        emit AgentSet(newAgent);
    }

    function setVault(address newVault) external onlyOwner {
        require(newVault != address(0), "Policy: zero vault");
        vault = newVault;
        emit VaultSet(newVault);
    }

    function setLimits(uint256 _maxTransactionValue, uint256 _maxSlippageBps, uint256 _maxDailySpend) external onlyOwner {
        require(_maxSlippageBps <= 10_000, "Policy: slippage too high");
        maxTransactionValue = _maxTransactionValue;
        maxSlippageBps = _maxSlippageBps;
        maxDailySpend = _maxDailySpend;
        emit LimitsUpdated(_maxTransactionValue, _maxSlippageBps, _maxDailySpend);
    }

    function allowAsset(address asset) external onlyOwner {
        require(asset != address(0), "Policy: zero asset");
        require(!allowedAssets[asset], "Policy: already allowed");
        require(!blockedAssets[asset], "Policy: blocked asset");
        allowedAssets[asset] = true;
        allowedAssetList.push(asset);
        emit AssetAllowed(asset);
    }

    function blockAsset(address asset, bool blocked) external onlyOwner {
        require(asset != address(0), "Policy: zero asset");
        blockedAssets[asset] = blocked;
        if (blocked) {
            allowedAssets[asset] = false;
            blockedAssetList.push(asset);
        }
        emit AssetBlocked(asset, blocked);
    }

    function isAssetAllowed(address asset) public view returns (bool) {
        if (blockedAssets[asset]) return false;
        if (allowedAssets[asset]) return true;
        if (allowedAssetList.length == 0) return true;
        return false;
    }

    // ──────────────────────────────────────────────
    //  Pause / Emergency
    // ──────────────────────────────────────────────

    function pause() external onlyOwnerOrEmergency {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwnerOrEmergency {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ──────────────────────────────────────────────
    //  Commitment Hashing
    // ──────────────────────────────────────────────

    function hashPolicyDecision(
        address _user,
        address _agent,
        uint256 _maxTxValue,
        uint256 _maxSlippage,
        uint256 _nonce,
        uint64 _expiry
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked("POLICY_DECISION", _user, _agent, _maxTxValue, _maxSlippage, _nonce, _expiry, block.chainid));
    }

    function hashIntent(
        bytes32 _policyCommitment,
        address _targetToken,
        uint256 _amount,
        uint256 _nonce,
        uint64 _expiry
    ) public view returns (bytes32) {
        return keccak256(abi.encodePacked("POLICY_INTENT", _policyCommitment, _targetToken, _amount, _nonce, _expiry, block.chainid));
    }

    // ──────────────────────────────────────────────
    //  Policy Application
    // ──────────────────────────────────────────────

    function applyPolicy(
        address _user,
        uint256 _maxTxValue,
        uint256 _maxSlippage,
        uint64 _expiry
    ) external onlyAgent whenNotPaused returns (bytes32) {
        require(_user != address(0), "Policy: zero user");
        require(_expiry > block.timestamp, "Policy: expired");
        require(_maxSlippage <= 10_000, "Policy: slippage too high");

        uint256 nonce = userNonce[_user] + 1;
        userNonce[_user] = nonce;

        bytes32 decisionHash = hashPolicyDecision(_user, agent, _maxTxValue, _maxSlippage, nonce, _expiry);

        policyDecisions[decisionHash] = PolicyDecision({
            decisionHash: decisionHash,
            user: _user,
            authorizedAgent: agent,
            maxTransactionValue: _maxTxValue,
            maxSlippageBps: _maxSlippage,
            nonce: nonce,
            expiry: _expiry,
            revoked: false
        });

        emit PolicyApplied(_user, decisionHash);
        return decisionHash;
    }

    // ──────────────────────────────────────────────
    //  Intent Consumption (atomic, vault-only)
    // ──────────────────────────────────────────────

    function consumeIntent(
        bytes32 intentHash,
        address user,
        address token,
        uint256 amount
    ) external onlyVault whenNotPaused nonReentrant {
        require(user != address(0), "Policy: zero user");
        require(token != address(0), "Policy: zero token");
        require(amount > 0, "Policy: zero amount");

        Intent storage intent = intents[intentHash];
        require(intent.intentHash == intentHash, "Policy: unknown intent");
        require(!intent.executed, "Policy: intent executed");
        require(intent.targetToken == token, "Policy: token mismatch");
        require(intent.amount == amount, "Policy: amount mismatch");
        require(intent.expiry >= block.timestamp, "Policy: intent expired");

        if (lastDailyReset == 0 || block.timestamp >= lastDailyReset + 1 days) {
            lastDailyReset = block.timestamp;
            emit DailySpendReset(block.timestamp);
        }

        uint256 newSpend = dailySpend[user] + amount;
        require(maxDailySpend == 0 || newSpend <= maxDailySpend, "Policy: daily spend exceeded");
        dailySpend[user] = newSpend;

        intent.executed = true;

        emit IntentExecuted(intentHash);
        emit IntentConsumed(intentHash, user, token, amount);
    }
}
