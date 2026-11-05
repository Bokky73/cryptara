// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CryptaraTimelock
/// @notice Timelock controller for privileged policy contract changes.
///         Put contract upgrades and privileged parameter changes behind multi-party
///         authorization and a mandatory delay, with a published, verifiable pending-change queue.
contract CryptaraTimelock {
    struct Proposal {
        bytes32 id;
        address proposer;
        address target;
        bytes4 selector;
        bytes payload;
        bytes32 payloadHash;
        uint256 createdAt;
        uint256 effectiveAt;
        uint256 delaySecs;
        bool executed;
        bool cancelled;
        address[] signersAtCreation;
        mapping(address => bool) hasSigned;
        uint256 signatureCount;
    }

    struct PendingChange {
        bytes32 id;
        address target;
        bytes4 selector;
        bytes32 payloadHash;
        address proposer;
        uint256 createdAt;
        uint256 effectiveAt;
        uint256 delaySecs;
        uint256 signatureCount;
        uint256 threshold;
    }

    address[] public signers;
    mapping(address => bool) public isSigner;
    uint256 public threshold;
    uint256 public minDelay;
    uint256 public maxDelay;
    address public emergencyAdmin;
    bool public paused;

    uint256 public constant MIN_DELAY_SECS = 24 hours;
    uint256 public constant MAX_DELAY_SECS = 30 days;
    uint256 public constant MIN_SIGNERS = 2;

    mapping(bytes32 => Proposal) private proposals;
    bytes32[] private proposalQueue;
    uint256 public proposalCount;

    event SignersUpdated(address[] signers, uint256 threshold);
    event DelayUpdated(uint256 minDelay, uint256 maxDelay);
    event ProposalCreated(bytes32 indexed id, address indexed target, address indexed proposer, bytes4 selector, bytes32 payloadHash, uint256 effectiveAt, uint256 delaySecs);
    event ProposalSigned(bytes32 indexed id, address indexed signer, uint256 signatureCount, uint256 threshold);
    event ProposalExecuted(bytes32 indexed id, address indexed executor, address target, bytes4 selector);
    event ProposalCancelled(bytes32 indexed id, address indexed canceller, address target);
    event EmergencyPauseSet(bool paused, address indexed by, uint256 timestamp);

    error AlreadyInitialized();
    error Unauthorized();
    error InvalidThreshold();
    error InvalidSignerCount();
    error InvalidDelay();
    error ProposalNotFound();
    error ProposalAlreadyExecuted();
    error ProposalAlreadyCancelled();
    error ProposalNotReady();
    error InsufficientSignatures();
    error InvalidSigner();
    error DuplicateSigner();
    error ZeroAddress();
    error ZeroHash();
    error Paused();
    error EmergencyAdminOnly();

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier onlySigner() {
        if (!isSigner[msg.sender]) revert Unauthorized();
        _;
    }

    modifier onlyEmergencyAdmin() {
        if (msg.sender != emergencyAdmin) revert EmergencyAdminOnly();
        _;
    }

    constructor(
        address[] memory _signers,
        uint256 _threshold,
        uint256 _minDelay,
        uint256 _maxDelay,
        address _emergencyAdmin
    ) {
        if (_signers.length < MIN_SIGNERS) revert InvalidSignerCount();
        if (_threshold < MIN_SIGNERS || _threshold > _signers.length) revert InvalidThreshold();
        if (_minDelay < MIN_DELAY_SECS || _minDelay > MAX_DELAY_SECS) revert InvalidDelay();
        if (_maxDelay < MIN_DELAY_SECS || _maxDelay > MAX_DELAY_SECS) revert InvalidDelay();
        if (_minDelay > _maxDelay) revert InvalidDelay();
        if (_emergencyAdmin == address(0)) revert ZeroAddress();

        for (uint256 i = 0; i < _signers.length; i++) {
            if (_signers[i] == address(0)) revert ZeroAddress();
            isSigner[_signers[i]] = true;
        }
        signers = _signers;
        threshold = _threshold;
        minDelay = _minDelay;
        maxDelay = _maxDelay;
        emergencyAdmin = _emergencyAdmin;

        emit SignersUpdated(_signers, _threshold);
    }

    function propose(
        address target,
        bytes4 selector,
        bytes calldata payload,
        uint256 delaySecs
    ) external whenNotPaused onlySigner returns (bytes32) {
        if (target == address(0)) revert ZeroAddress();
        if (selector == bytes4(0)) revert ZeroHash();
        if (delaySecs < minDelay || delaySecs > maxDelay) revert InvalidDelay();

        bytes32 payloadHash = keccak256(payload);
        bytes32 id = keccak256(abi.encodePacked("CRYPTARA_TIMELOCK_V1", msg.sender, target, selector, payload, delaySecs, proposalCount));

        if (proposals[id].createdAt != 0) revert ProposalAlreadyExecuted();

        uint256 effectiveAt = block.timestamp + delaySecs;

        Proposal storage p = proposals[id];
        p.id = id;
        p.proposer = msg.sender;
        p.target = target;
        p.selector = selector;
        p.payload = payload;
        p.payloadHash = payloadHash;
        p.createdAt = block.timestamp;
        p.effectiveAt = effectiveAt;
        p.delaySecs = delaySecs;
        p.signersAtCreation = signers;

        proposalQueue.push(id);
        proposalCount += 1;

        emit ProposalCreated(id, target, msg.sender, selector, payloadHash, effectiveAt, delaySecs);
        return id;
    }

    function sign(bytes32 proposalId) external whenNotPaused onlySigner {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.cancelled) revert ProposalAlreadyCancelled();
        if (p.hasSigned[msg.sender]) revert DuplicateSigner();

        p.hasSigned[msg.sender] = true;
        p.signatureCount += 1;

        emit ProposalSigned(proposalId, msg.sender, p.signatureCount, threshold);
    }

    function execute(bytes32 proposalId) external whenNotPaused {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.cancelled) revert ProposalAlreadyCancelled();
        if (block.timestamp < p.effectiveAt) revert ProposalNotReady();
        if (p.signatureCount < threshold) revert InsufficientSignatures();

        p.executed = true;

        // Low-level call to target with selector + payload
        (bool success, ) = p.target.call(abi.encodePacked(p.selector, p.payload));
        require(success, "Timelock: call failed");

        emit ProposalExecuted(proposalId, msg.sender, p.target, p.selector);
    }

    function cancel(bytes32 proposalId) external whenNotPaused {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        if (p.executed) revert ProposalAlreadyExecuted();
        if (p.cancelled) revert ProposalAlreadyCancelled();

        bool isProposer = p.proposer == msg.sender;
        bool isSignerFlag = isSigner[msg.sender];
        bool isEmergency = msg.sender == emergencyAdmin;
        if (!isProposer && !isSignerFlag && !isEmergency) revert Unauthorized();

        p.cancelled = true;
        emit ProposalCancelled(proposalId, msg.sender, p.target);
    }

    function getProposal(bytes32 proposalId) external view returns (
        bytes32 id,
        address proposer,
        address target,
        bytes4 selector,
        bytes32 payloadHash,
        uint256 createdAt,
        uint256 effectiveAt,
        uint256 delaySecs,
        bool executed,
        bool cancelled,
        uint256 signatureCount
    ) {
        Proposal storage p = proposals[proposalId];
        if (p.createdAt == 0) revert ProposalNotFound();
        return (p.id, p.proposer, p.target, p.selector, p.payloadHash, p.createdAt, p.effectiveAt, p.delaySecs, p.executed, p.cancelled, p.signatureCount);
    }

    function getPendingQueue() external view returns (PendingChange[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < proposalQueue.length; i++) {
            Proposal storage p = proposals[proposalQueue[i]];
            if (p.createdAt != 0 && !p.executed && !p.cancelled) count++;
        }
        PendingChange[] memory out = new PendingChange[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < proposalQueue.length; i++) {
            Proposal storage p = proposals[proposalQueue[i]];
            if (p.createdAt != 0 && !p.executed && !p.cancelled) {
                out[idx] = PendingChange({
                    id: p.id,
                    target: p.target,
                    selector: p.selector,
                    payloadHash: p.payloadHash,
                    proposer: p.proposer,
                    createdAt: p.createdAt,
                    effectiveAt: p.effectiveAt,
                    delaySecs: p.delaySecs,
                    signatureCount: p.signatureCount,
                    threshold: threshold
                });
                idx++;
            }
        }
        return out;
    }

    function getPendingCount() external view returns (uint256) {
        uint256 c = 0;
        for (uint256 i = 0; i < proposalQueue.length; i++) {
            Proposal storage p = proposals[proposalQueue[i]];
            if (p.createdAt != 0 && !p.executed && !p.cancelled) c++;
        }
        return c;
    }

    function hasSigned(bytes32 proposalId, address signer) external view returns (bool) {
        return proposals[proposalId].hasSigned[signer];
    }

    function updateSigners(address[] calldata newSigners, uint256 newThreshold) external onlyEmergencyAdmin {
        if (newSigners.length < MIN_SIGNERS) revert InvalidSignerCount();
        if (newThreshold < MIN_SIGNERS || newThreshold > newSigners.length) revert InvalidThreshold();
        for (uint256 i = 0; i < signers.length; i++) isSigner[signers[i]] = false;
        for (uint256 i = 0; i < newSigners.length; i++) {
            if (newSigners[i] == address(0)) revert ZeroAddress();
            isSigner[newSigners[i]] = true;
        }
        signers = newSigners;
        threshold = newThreshold;
        emit SignersUpdated(newSigners, newThreshold);
    }

    function updateDelays(uint256 _minDelay, uint256 _maxDelay) external onlyEmergencyAdmin {
        if (_minDelay < MIN_DELAY_SECS || _minDelay > MAX_DELAY_SECS) revert InvalidDelay();
        if (_maxDelay < MIN_DELAY_SECS || _maxDelay > MAX_DELAY_SECS) revert InvalidDelay();
        if (_minDelay > _maxDelay) revert InvalidDelay();
        minDelay = _minDelay;
        maxDelay = _maxDelay;
        emit DelayUpdated(_minDelay, _maxDelay);
    }

    function pause() external onlyEmergencyAdmin {
        paused = true;
        emit EmergencyPauseSet(true, msg.sender, block.timestamp);
    }

    function unpause() external onlyEmergencyAdmin {
        paused = false;
        emit EmergencyPauseSet(false, msg.sender, block.timestamp);
    }

    function getSigners() external view returns (address[] memory) {
        return signers;
    }
}
