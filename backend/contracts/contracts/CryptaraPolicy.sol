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
    //  Constants
    // ──────────────────────────────────────────────

    uint256 public constant MAX_TRACKED_ASSETS = 256;

    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    address public owner;
    address public pendingOwner;
    address public emergencyAdmin;
    address public pendingEmergencyAdmin;
    address public agent;
    address public vault;

    uint256 public maxTransactionValue;
    uint256 public maxSlippageBps;
    uint256 public maxDailySpend;

    mapping(address => uint256) public userNonce;
    // Per-user, per-day spend buckets: dailySpend[user][dayBucket]
    mapping(address => mapping(uint256 => uint256)) public dailySpend;

    mapping(address => bool) public allowedAssets;
    mapping(address => bool) public blockedAssets;

    // Index-tracked sets for O(1) add/remove (swap-and-pop).
    // Index is 1-based; 0 means "not tracked".
    address[] private _allowedAssetList;
    mapping(address => uint256) private _allowedAssetIndex;
    address[] private _blockedAssetList;
    mapping(address => uint256) private _blockedAssetIndex;

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
    event Paused(address indexed actor, bool paused, bytes32 reasonHash, uint256 timestamp);
    event Unpaused(address indexed actor, bool paused, bytes32 reasonHash, uint256 timestamp);
    event AssetAllowed(address indexed asset);
    event AssetBlocked(address indexed asset, bool blocked);
    event LimitsUpdated(uint256 maxTxValue, uint256 maxSlippageBps, uint256 maxDailySpend);
    event DailySpendReset(uint256 timestamp);
    event AdminTransferProposed(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferAccepted(address indexed previousAdmin, address indexed newAdmin);
    event AdminTransferCancelled(address indexed currentAdmin, address indexed cancelledPendingAdmin);

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
        require(msg.sender != address(0), "Policy: zero owner");
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
        pendingOwner = address(0);
        emit OwnerTransferred(previousOwner, newOwner);
    }

    function proposeAdmin(address pending) external onlyOwner {
        require(pending != address(0), "Policy: zero admin");
        require(pending != owner, "Policy: already owner");
        pendingOwner = pending;
        emit AdminTransferProposed(owner, pending);
    }

    function acceptAdmin() external {
        require(msg.sender == pendingOwner, "Policy: not pending admin");
        address previousOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit AdminTransferAccepted(previousOwner, owner);
    }

    function cancelPendingAdmin() external onlyOwner {
        address cancelled = pendingOwner;
        require(cancelled != address(0), "Policy: no pending admin");
        pendingOwner = address(0);
        emit AdminTransferCancelled(owner, cancelled);
    }

    function proposeEmergencyAdmin(address pending) external onlyOwner {
        require(pending != address(0), "Policy: zero admin");
        require(pending != emergencyAdmin, "Policy: already emergency admin");
        pendingEmergencyAdmin = pending;
        emit AdminTransferProposed(emergencyAdmin, pending);
    }

    function acceptEmergencyAdmin() external {
        require(msg.sender == pendingEmergencyAdmin, "Policy: not pending admin");
        address previousAdmin = emergencyAdmin;
        emergencyAdmin = pendingEmergencyAdmin;
        pendingEmergencyAdmin = address(0);
        emit AdminTransferAccepted(previousAdmin, emergencyAdmin);
    }

    function cancelPendingEmergencyAdmin() external onlyOwner {
        address cancelled = pendingEmergencyAdmin;
        require(cancelled != address(0), "Policy: no pending admin");
        pendingEmergencyAdmin = address(0);
        emit AdminTransferCancelled(emergencyAdmin, cancelled);
    }

    function setEmergencyAdmin(address admin) external onlyOwner {
        require(admin != address(0), "Policy: zero admin");
        emergencyAdmin = admin;
        pendingEmergencyAdmin = address(0);
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
        require(_allowedAssetList.length < MAX_TRACKED_ASSETS, "Policy: allowlist full");
        allowedAssets[asset] = true;
        _allowedAssetList.push(asset);
        _allowedAssetIndex[asset] = _allowedAssetList.length;
        emit AssetAllowed(asset);
    }

    function blockAsset(address asset, bool blocked) external onlyOwner {
        require(asset != address(0), "Policy: zero asset");
        if (blocked) {
            require(!blockedAssets[asset], "Policy: already blocked");
            require(_blockedAssetList.length < MAX_TRACKED_ASSETS, "Policy: blocklist full");
            blockedAssets[asset] = true;
            _blockedAssetList.push(asset);
            _blockedAssetIndex[asset] = _blockedAssetList.length;
            if (allowedAssets[asset]) {
                _removeAllowedAsset(asset);
            }
        } else {
            require(blockedAssets[asset], "Policy: not blocked");
            blockedAssets[asset] = false;
            _removeBlockedAsset(asset);
        }
        emit AssetBlocked(asset, blocked);
    }

    function isAssetAllowed(address asset) public view returns (bool) {
        if (blockedAssets[asset]) return false;
        if (allowedAssets[asset]) return true;
        if (_allowedAssetList.length == 0) return true;
        return false;
    }

    function allowedAssetCount() external view returns (uint256) {
        return _allowedAssetList.length;
    }

    function blockedAssetCount() external view returns (uint256) {
        return _blockedAssetList.length;
    }

    function allowedAssetAt(uint256 index) external view returns (address) {
        return _allowedAssetList[index];
    }

    function blockedAssetAt(uint256 index) external view returns (address) {
        return _blockedAssetList[index];
    }

    // ──────────────────────────────────────────────
    //  Internal set helpers (O(1) swap-and-pop)
    // ──────────────────────────────────────────────

    function _removeAllowedAsset(address asset) internal {
        uint256 idx = _allowedAssetIndex[asset];
        if (idx == 0) return;
        uint256 lastIdx = _allowedAssetList.length;
        if (idx != lastIdx) {
            address lastAsset = _allowedAssetList[lastIdx - 1];
            _allowedAssetList[idx - 1] = lastAsset;
            _allowedAssetIndex[lastAsset] = idx;
        }
        _allowedAssetList.pop();
        delete _allowedAssetIndex[asset];
        allowedAssets[asset] = false;
    }

    function _removeBlockedAsset(address asset) internal {
        uint256 idx = _blockedAssetIndex[asset];
        if (idx == 0) return;
        uint256 lastIdx = _blockedAssetList.length;
        if (idx != lastIdx) {
            address lastAsset = _blockedAssetList[lastIdx - 1];
            _blockedAssetList[idx - 1] = lastAsset;
            _blockedAssetIndex[lastAsset] = idx;
        }
        _blockedAssetList.pop();
        delete _blockedAssetIndex[asset];
    }

    // ──────────────────────────────────────────────
    //  Pause / Emergency
    // ──────────────────────────────────────────────

    /// @notice Instant circuit-breaker. Either governance (owner) or the
    ///         emergencyAdmin may pause with zero delay.
    function pause(bytes32 reasonHash) external onlyOwnerOrEmergency {
        require(!paused, "Policy: already paused");
        paused = true;
        emit Paused(msg.sender, true, reasonHash, block.timestamp);
    }

    /// @notice Only governance (owner / timelocked multisig) may unpause.
    ///         emergencyAdmin is explicitly forbidden from lifting the pause.
    function unpause(bytes32 reasonHash) external onlyOwner {
        require(paused, "Policy: not paused");
        paused = false;
        emit Unpaused(msg.sender, false, reasonHash, block.timestamp);
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
    //  Daily Spend Helpers
    // ──────────────────────────────────────────────

    function currentDayBucket() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function getDailySpend(address user) public view returns (uint256) {
        return dailySpend[user][currentDayBucket()];
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

        bytes32 decisionHash = hashPolicyDecision(_user, msg.sender, _maxTxValue, _maxSlippage, nonce, _expiry);
        policyDecisions[decisionHash] = PolicyDecision({
            decisionHash: decisionHash,
            user: _user,
            authorizedAgent: msg.sender,
            maxTransactionValue: _maxTxValue,
            maxSlippageBps: _maxSlippage,
            nonce: nonce,
            expiry: _expiry,
            revoked: false
        });

        emit PolicyApplied(_user, decisionHash);
        return decisionHash;
    }

    function revokePolicy(bytes32 decisionHash) external onlyOwnerOrEmergency {
        PolicyDecision storage decision = policyDecisions[decisionHash];
        require(decision.user != address(0), "Policy: unknown decision");
        require(!decision.revoked, "Policy: already revoked");
        decision.revoked = true;
        emit IntentRevoked(decisionHash);
    }

    // ──────────────────────────────────────────────
    //  Intent Lifecycle
    // ──────────────────────────────────────────────

    function createIntent(
        bytes32 policyCommitment,
        address targetToken,
        uint256 amount,
        uint64 expiry
    ) external whenNotPaused returns (bytes32) {
        require(targetToken != address(0), "Policy: zero token");
        require(amount > 0, "Policy: zero amount");
        require(expiry > block.timestamp, "Policy: expired");
        require(isAssetAllowed(targetToken), "Policy: asset not allowed");

        PolicyDecision storage decision = policyDecisions[policyCommitment];
        require(decision.user == msg.sender, "Policy: not decision owner");
        require(!decision.revoked, "Policy: decision revoked");
        require(decision.expiry > block.timestamp, "Policy: decision expired");
        require(amount <= decision.maxTransactionValue, "Policy: exceeds max tx value");

        uint256 nonce = userNonce[msg.sender] + 1;
        userNonce[msg.sender] = nonce;

        bytes32 intentHash = hashIntent(policyCommitment, targetToken, amount, nonce, expiry);

        intents[intentHash] = Intent({
            intentHash: intentHash,
            policyCommitment: policyCommitment,
            targetToken: targetToken,
            amount: amount,
            nonce: nonce,
            expiry: expiry,
            executed: false
        });

        emit IntentCreated(intentHash, policyCommitment);
        return intentHash;
    }

    function executeIntent(bytes32 intentHash) external whenNotPaused nonReentrant {
        Intent storage intent = intents[intentHash];
        require(intent.intentHash != bytes32(0), "Policy: unknown intent");
        require(!intent.executed, "Policy: already executed");
        require(intent.expiry > block.timestamp, "Policy: intent expired");

        PolicyDecision storage decision = policyDecisions[intent.policyCommitment];
        require(decision.user == msg.sender, "Policy: not decision owner");
        require(!decision.revoked, "Policy: decision revoked");

        if (block.timestamp >= lastDailyReset + 1 days) {
            dailySpend[msg.sender] = 0;
            lastDailyReset = block.timestamp;
            emit DailySpendReset(block.timestamp);
        }

        uint256 newSpend = dailySpend[msg.sender] + intent.amount;
        require(maxDailySpend == 0 || newSpend <= maxDailySpend, "Policy: exceeds daily spend");
        dailySpend[msg.sender] = newSpend;

        intent.executed = true;
        emit IntentExecuted(intentHash);
    }

    function revokeIntent(bytes32 intentHash) external onlyOwnerOrEmergency {
        Intent storage intent = intents[intentHash];
        require(intent.intentHash != bytes32(0), "Policy: unknown intent");
        require(!intent.executed, "Policy: already executed");
        intent.executed = true;
        emit IntentRevoked(intentHash);
    }
}
