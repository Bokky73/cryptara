import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "fs";
import { join } from "path";

const POLICY = ethers.keccak256(ethers.toUtf8Bytes("policy-v1"));
const OTHER_POLICY = ethers.keccak256(ethers.toUtf8Bytes("policy-v2"));
const DECISION_ID = ethers.keccak256(ethers.toUtf8Bytes("decision-1"));
const DECISION_HASH = ethers.keccak256(ethers.toUtf8Bytes("decision-payload-1"));
const INTENT_ID = ethers.keccak256(ethers.toUtf8Bytes("intent-1"));
const INTENT_HASH = ethers.keccak256(ethers.toUtf8Bytes("intent-payload-1"));
const ZERO_HASH = ethers.ZeroHash;

const MAX_AUTHORIZATION_WINDOW = 365 * 24 * 60 * 60;
const MAX_INTENT_WINDOW = 60 * 60;

async function deploy() {
  const [user, agent, stranger] = await ethers.getSigners();
  const factory = await ethers.getContractFactory("CryptaraAudit");
  const audit = await factory.deploy();

  await audit.waitForDeployment();

  return { audit, user, agent, stranger };
}

/** Deploy with `agent` authorized for `user` for one day. */
async function deployAuthorized() {
  const context = await deploy();
  const expiresAt = (await time.latest()) + 86_400;

  await context.audit.connect(context.user).setPolicy(POLICY);
  await context.audit.connect(context.user).authorizeAgent(context.agent.address, POLICY, expiresAt);

  return { ...context, expiresAt };
}

describe("CryptaraAudit", () => {
  describe("version and policy", () => {
    it("reports its interface version", async () => {
      const { audit } = await deploy();

      expect(await audit.VERSION()).to.equal(1);
    });

    it("exposes the parity boundary constants", async () => {
      const { audit } = await deploy();

      expect(await audit.MAX_AUTHORIZATION_WINDOW()).to.equal(MAX_AUTHORIZATION_WINDOW);
      expect(await audit.MAX_INTENT_WINDOW()).to.equal(MAX_INTENT_WINDOW);
    });

    it("records a policy hash and emits PolicyUpdated", async () => {
      const { audit, user } = await deploy();

      await expect(audit.connect(user).setPolicy(POLICY))
        .to.emit(audit, "PolicyUpdated")
        .withArgs(user.address, POLICY, anyUint());

      expect(await audit.policyHashOf(user.address)).to.equal(POLICY);
    });

    it("rejects a zero policy hash", async () => {
      const { audit, user } = await deploy();

      await expect(audit.connect(user).setPolicy(ZERO_HASH)).to.be.revertedWithCustomError(audit, "ZeroHash");
    });
  });

  describe("authorization", () => {
    it("authorizes an agent and emits AgentAuthorized", async () => {
      const { audit, user, agent } = await deploy();
      const expiresAt = (await time.latest()) + 3_600;

      await audit.connect(user).setPolicy(POLICY);

      await expect(audit.connect(user).authorizeAgent(agent.address, POLICY, expiresAt))
        .to.emit(audit, "AgentAuthorized")
        .withArgs(user.address, agent.address, POLICY, expiresAt);

      const [policyHash, storedExpiry, active] = await audit.authorizationOf(user.address, agent.address);
      expect(policyHash).to.equal(POLICY);
      expect(storedExpiry).to.equal(expiresAt);
      expect(active).to.equal(true);
      expect(await audit.isAgentLive(user.address, agent.address)).to.equal(true);
    });

    it("refuses a zero agent address", async () => {
      const { audit, user } = await deploy();
      const expiresAt = (await time.latest()) + 3_600;

      await audit.connect(user).setPolicy(POLICY);

      await expect(
        audit.connect(user).authorizeAgent(ethers.ZeroAddress, POLICY, expiresAt),
      ).to.be.revertedWithCustomError(audit, "ZeroAddress");
    });

    it("refuses a policy the user has not committed to", async () => {
      const { audit, user, agent } = await deploy();
      const expiresAt = (await time.latest()) + 3_600;

      await audit.connect(user).setPolicy(POLICY);

      await expect(
        audit.connect(user).authorizeAgent(agent.address, OTHER_POLICY, expiresAt),
      ).to.be.revertedWithCustomError(audit, "PolicyMismatch");
    });

    it("refuses an expiry in the past or an over-long window", async () => {
      const { audit, user, agent } = await deploy();
      const now = await time.latest();

      await audit.connect(user).setPolicy(POLICY);

      await expect(audit.connect(user).authorizeAgent(agent.address, POLICY, now)).to.be.revertedWithCustomError(
        audit,
        "ExpiryInPast",
      );

      const tooLong = now + 366 * 24 * 60 * 60;
      await expect(
        audit.connect(user).authorizeAgent(agent.address, POLICY, tooLong),
      ).to.be.revertedWithCustomError(audit, "WindowTooLong");
    });

    it("accepts the exact MAX_AUTHORIZATION_WINDOW boundary", async () => {
      const { audit, user, agent } = await deploy();
      const now = await time.latest();

      await audit.connect(user).setPolicy(POLICY);

      const boundary = now + MAX_AUTHORIZATION_WINDOW;
      await audit.connect(user).authorizeAgent(agent.address, POLICY, boundary);
      expect(await audit.isAgentLive(user.address, agent.address)).to.equal(true);

      await expect(
        audit.connect(user).authorizeAgent(agent.address, POLICY, boundary + 1),
      ).to.be.revertedWithCustomError(audit, "WindowTooLong");
    });
  });

  describe("decisions", () => {
    it("lets a live agent log a decision", async () => {
      const { audit, user, agent } = await deployAuthorized();

      await expect(audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 74))
        .to.emit(audit, "DecisionLogged")
        .withArgs(user.address, agent.address, DECISION_ID, DECISION_HASH, 74, anyUint());
    });

    it("rejects an unauthorized caller", async () => {
      const { audit, user, stranger } = await deployAuthorized();

      await expect(
        audit.connect(stranger).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 10),
      ).to.be.revertedWithCustomError(audit, "NotAuthorized");
    });

    it("rejects a revoked agent immediately", async () => {
      const { audit, user, agent } = await deployAuthorized();

      await expect(audit.connect(user).revokeAgent(agent.address))
        .to.emit(audit, "AgentRevoked")
        .withArgs(user.address, agent.address, anyUint());

      expect(await audit.isAgentLive(user.address, agent.address)).to.equal(false);
      await expect(
        audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 10),
      ).to.be.revertedWithCustomError(audit, "NotAuthorized");
    });

    it("rejects an expired agent without any revocation", async () => {
      const { audit, user, agent, expiresAt } = await deployAuthorized();

      await time.increaseTo(expiresAt + 1);

      expect(await audit.isAgentLive(user.address, agent.address)).to.equal(false);
      await expect(
        audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 10),
      ).to.be.revertedWithCustomError(audit, "AuthorizationExpired");
    });

    it("treats expiresAt == now as expired (parity boundary)", async () => {
      const { audit, user, agent } = await deploy();
      const now = await time.latest();

      await audit.connect(user).setPolicy(POLICY);
      await audit.connect(user).authorizeAgent(agent.address, POLICY, now + 3_600);

      await time.increaseTo(now + 3_600);

      expect(await audit.isAgentLive(user.address, agent.address)).to.equal(false);
      await expect(
        audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 10),
      ).to.be.revertedWithCustomError(audit, "AuthorizationExpired");
    });

    it("rejects work computed against a policy the user has replaced", async () => {
      const { audit, user, agent } = await deployAuthorized();

      await audit.connect(user).setPolicy(OTHER_POLICY);

      await expect(
        audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 10),
      ).to.be.revertedWithCustomError(audit, "PolicyMismatch");

      await expect(
        audit.connect(agent).logDecision(user.address, OTHER_POLICY, DECISION_ID, DECISION_HASH, 10),
      ).to.be.revertedWithCustomError(audit, "PolicyMismatch");
    });

    it("rejects zero hashes and out-of-range risk", async () => {
      const { audit, user, agent } = await deployAuthorized();

      await expect(
        audit.connect(agent).logDecision(user.address, POLICY, ZERO_HASH, DECISION_HASH, 10),
      ).to.be.revertedWithCustomError(audit, "ZeroHash");
      await expect(
        audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, ZERO_HASH, 10),
      ).to.be.revertedWithCustomError(audit, "ZeroHash");
      await expect(
        audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 101),
      ).to.be.revertedWithCustomError(audit, "InvalidBuyRisk");

      // The bounds themselves are valid.
      await audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 0);
      await audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 100);
    });
  });

  describe("execution intents", () => {
    it("records an intent once", async () => {
      const { audit, user, agent } = await deployAuthorized();
      const expiresAt = (await time.latest()) + 300;

      expect(await audit.intentUsed(user.address, INTENT_ID)).to.equal(false);

      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, expiresAt),
      )
        .to.emit(audit, "IntentRecorded")
        .withArgs(user.address, agent.address, INTENT_ID, DECISION_ID, INTENT_HASH, expiresAt, anyUint());

      expect(await audit.intentUsed(user.address, INTENT_ID)).to.equal(true);
    });

    it("rejects a replayed intent", async () => {
      const { audit, user, agent } = await deployAuthorized();
      const expiresAt = (await time.latest()) + 300;

      await audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, expiresAt);

      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, expiresAt),
      ).to.be.revertedWithCustomError(audit, "IntentAlreadyUsed");
    });

    it("rejects an intent whose expiry is not in the future", async () => {
      const { audit, user, agent } = await deployAuthorized();
      const now = await time.latest();

      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, now),
      ).to.be.revertedWithCustomError(audit, "ExpiryInPast");
    });

    it("accepts the exact MAX_INTENT_WINDOW boundary and rejects beyond it", async () => {
      const { audit, user, agent } = await deployAuthorized();
      const now = await time.latest();

      const boundary = now + MAX_INTENT_WINDOW;
      await audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, boundary);
      expect(await audit.intentUsed(user.address, INTENT_ID)).to.equal(true);

      const otherIntent = ethers.keccak256(ethers.toUtf8Bytes("intent-2"));
      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, otherIntent, DECISION_ID, INTENT_HASH, boundary + 1),
      ).to.be.revertedWithCustomError(audit, "WindowTooLong");
    });
  });

  describe("emergency pause", () => {
    it("blocks agent logging while still permitting revocation", async () => {
      const { audit, user, agent } = await deployAuthorized();

      await expect(audit.connect(user).setEmergencyPause(true))
        .to.emit(audit, "EmergencyPauseUpdated")
        .withArgs(user.address, true, anyUint());

      expect(await audit.emergencyPaused(user.address)).to.equal(true);

      await expect(
        audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 10),
      ).to.be.revertedWithCustomError(audit, "EmergencyPaused");

      // Revocation must remain available while paused.
      await expect(audit.connect(user).revokeAgent(agent.address))
        .to.emit(audit, "AgentRevoked")
        .withArgs(user.address, agent.address, anyUint());

      await audit.connect(user).setEmergencyPause(false);
      expect(await audit.emergencyPaused(user.address)).to.equal(false);
    });
  });

  describe("non-custodial invariants (static)", () => {
    it("CryptaraAudit.sol has no payable functions or token transfer imports", () => {
      const source = readFileSync(join(__dirname, "..", "contracts", "CryptaraAudit.sol"), "utf8");

      expect(source).to.not.match(/\bpayable\b/);
      expect(source).to.not.match(/IERC20|ERC20|SafeERC20|transferFrom|safeTransfer/);
    });
  });
});

function anyUint() {
  return (value: unknown) => typeof value === "bigint";
}
