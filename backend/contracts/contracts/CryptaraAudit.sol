// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CryptaraAudit
/// @notice Non-custodial authorization and audit layer for the Cryptara
///         agent pipeline.
///
/// @dev This contract records *who may act*, *what policy they act under*, and
///      *what they decided*. It deliberately holds no funds and moves no value:
///      there is no `payable` function, no token approval, no transfer, and no
///      balance accounting anywhere in this file. Execution of any trade remains
///      a wallet-signed transaction sent elsewhere; an intent recorded here is a
///      commitment to a plan, never an instruction to move money.
///
///      Authorization model
///      -------------------
///      Every user is their own admin. A user authorizes an agent under a policy
///      hash and an expiry. The agent may then log decisions and record execution
///      intents for that user, and nothing else. A user can revoke instantly, and
///      an authorization that has passed its expiry is inert without any
///      revocation transaction.
///
///      Replay and staleness
///      --------------------
///      An execution intent is identified by a caller-supplied `intentId`, which
///      is consumed on first use. A second use of the same id reverts. Each
///      intent also carries `expiresAt`, and recording after that timestamp
///      reverts, so a signed-but-unsubmitted plan cannot be revived later.
///
///      This interface is the implementation of the V2 audit layer described in
///      issue #16. Until that specification is formally approved the surface here
///      should be treated as proposed, and `VERSION` bumped on any change.
contract CryptaraAudit {
    /// @notice Interface version. Bump on any externally visible change.
    uint16 public constant VERSION = 1;

    /// @notice Longest authorization window a user may grant in one call.
    /// @dev Bounded so a mis-typed expiry cannot create a decade-long grant.
    uint64 public constant MAX_AUTHORIZATION_WINDOW = 365 days;

    /// @notice Longest lifetime an execution intent may declare.
    /// @dev Intents describe a quote-bound plan; a long-lived intent is a stale
    ///      intent by definition.
    uint64 public constant MAX_INTENT_WINDOW = 1 hours;

    struct Authorization {
        /// @dev Hash of the off-chain user policy the agent must act under.
        bytes32 policyHash;
        /// @dev Unix timestamp after which the authorization is inert.
        uint64 expiresAt;
        /// @dev False once revoked. Kept rather than deleted so history reads
        ///      can distinguish "never authorized" from "revoked".
        bool active;
    }

    /// @notice Current policy hash a user has committed to, if any.
    mapping(address => bytes32) public policyHashOf;

    /// @notice Per-user, per-agent authorization records.
    mapping(address => mapping(address => Authorization)) private _authorizations;

    /// @notice Consumed execution-intent ids, per user.
    mapping(address => mapping(bytes32 => bool)) public intentUsed;

    /// @notice Per-user emergency pause. While paused nothing may be logged.
    mapping(address => bool) public paused;

    event PolicyUpdated(address indexed user, bytes32 indexed policyHash, uint64 timestamp);
    event AgentAuthorized(
        address indexed user, address indexed agent, bytes32 indexed policyHash, uint64 expiresAt
    );
    event AgentRevoked(address indexed user, address indexed agent, uint64 timestamp);
    event DecisionLogged(
        address indexed user,
        address indexed agent,
        bytes32 indexed decisionId,
        bytes32 decisionHash,
        uint16 buyRisk,
        uint64 timestamp
    );
    event IntentRecorded(
        address indexed user,
        address indexed agent,
        bytes32 indexed intentId,
        bytes32 decisionId,
        bytes32 intentHash,
        uint64 expiresAt
    );
    event PauseChanged(address indexed user, bool pausedState, uint64 timestamp);

    error ZeroAddress();
    error ZeroHash();
    error NotAuthorized();
    error AuthorizationExpired();
    error WindowTooLong();
    error ExpiryInPast();
    error IntentReplayed();
    error IntentStale();
    error ContractPaused();
    error InvalidBuyRisk();
    error PolicyMismatch();

    /// @dev Reverts unless the caller is a live agent for `user` acting under
    ///      `user`'s current policy hash.
    modifier onlyLiveAgent(address user, bytes32 policyHash) {
        if (paused[user]) revert ContractPaused();

        Authorization memory authorization = _authorizations[user][msg.sender];

        if (!authorization.active) revert NotAuthorized();
        if (authorization.expiresAt <= block.timestamp) revert AuthorizationExpired();
        // The agent must present the policy it was authorized under. This
        // catches an agent replaying work computed against a policy the user has
        // since changed.
        if (authorization.policyHash != policyHash) revert PolicyMismatch();
        if (policyHashOf[user] != policyHash) revert PolicyMismatch();

        _;
    }

    /// @notice Commit to a user policy hash.
    /// @dev The policy itself stays off chain; only its hash is recorded, so no
    ///      user strategy is published on a public ledger.
    function setPolicy(bytes32 policyHash) external {
        if (policyHash == bytes32(0)) revert ZeroHash();

        policyHashOf[msg.sender] = policyHash;

        emit PolicyUpdated(msg.sender, policyHash, uint64(block.timestamp));
    }

    /// @notice Authorize `agent` to log decisions and intents under `policyHash`.
    /// @dev The caller must already have committed to `policyHash` via
    ///      `setPolicy`, so an authorization can never reference a policy the
    ///      user has not adopted.
    function authorizeAgent(address agent, bytes32 policyHash, uint64 expiresAt) external {
        if (agent == address(0)) revert ZeroAddress();
        if (policyHash == bytes32(0)) revert ZeroHash();
        if (policyHashOf[msg.sender] != policyHash) revert PolicyMismatch();
        if (expiresAt <= block.timestamp) revert ExpiryInPast();
        if (expiresAt - uint64(block.timestamp) > MAX_AUTHORIZATION_WINDOW) revert WindowTooLong();

        _authorizations[msg.sender][agent] =
            Authorization({policyHash: policyHash, expiresAt: expiresAt, active: true});

        emit AgentAuthorized(msg.sender, agent, policyHash, expiresAt);
    }

    /// @notice Revoke an agent immediately.
    /// @dev Idempotent by design: revoking twice is not an error, because a user
    ///      reacting to an incident should never be blocked by a revert.
    function revokeAgent(address agent) external {
        if (agent == address(0)) revert ZeroAddress();

        _authorizations[msg.sender][agent].active = false;

        emit AgentRevoked(msg.sender, agent, uint64(block.timestamp));
    }

    /// @notice Halt or resume all logging for the caller.
    function setPaused(bool pausedState) external {
        paused[msg.sender] = pausedState;

        emit PauseChanged(msg.sender, pausedState, uint64(block.timestamp));
    }

    /// @notice Record an agent decision for `user`.
    /// @param decisionId Frontend decision identifier, unique per decision.
    /// @param decisionHash Hash of the full decision payload held off chain.
    /// @param buyRisk Buy Risk score, 0-100.
    function logDecision(
        address user,
        bytes32 policyHash,
        bytes32 decisionId,
        bytes32 decisionHash,
        uint16 buyRisk
    ) external onlyLiveAgent(user, policyHash) {
        if (decisionId == bytes32(0) || decisionHash == bytes32(0)) revert ZeroHash();
        if (buyRisk > 100) revert InvalidBuyRisk();

        emit DecisionLogged(user, msg.sender, decisionId, decisionHash, buyRisk, uint64(block.timestamp));
    }

    /// @notice Record an execution intent for `user`.
    /// @dev Consumes `intentId`; a repeat reverts with `IntentReplayed`. An
    ///      `expiresAt` already in the past reverts with `IntentStale`.
    ///
    ///      Recording an intent authorizes nothing on its own — the resulting
    ///      transaction is still signed by the user's wallet.
    function recordIntent(
        address user,
        bytes32 policyHash,
        bytes32 intentId,
        bytes32 decisionId,
        bytes32 intentHash,
        uint64 expiresAt
    ) external onlyLiveAgent(user, policyHash) {
        if (intentId == bytes32(0) || intentHash == bytes32(0) || decisionId == bytes32(0)) revert ZeroHash();
        if (intentUsed[user][intentId]) revert IntentReplayed();
        if (expiresAt <= block.timestamp) revert IntentStale();
        if (expiresAt - uint64(block.timestamp) > MAX_INTENT_WINDOW) revert WindowTooLong();

        intentUsed[user][intentId] = true;

        emit IntentRecorded(user, msg.sender, intentId, decisionId, intentHash, expiresAt);
    }

    /// @notice Read an authorization record.
    function authorizationOf(address user, address agent)
        external
        view
        returns (bytes32 policyHash, uint64 expiresAt, bool active)
    {
        Authorization memory authorization = _authorizations[user][agent];

        return (authorization.policyHash, authorization.expiresAt, authorization.active);
    }

    /// @notice Whether `agent` may currently act for `user`.
    /// @dev Combines revocation, expiry and pause into the single question a
    ///      caller actually has.
    function isAgentLive(address user, address agent) external view returns (bool) {
        Authorization memory authorization = _authorizations[user][agent];

        return authorization.active && authorization.expiresAt > block.timestamp && !paused[user];
    }
}
