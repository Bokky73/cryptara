import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const POLICY = ethers.keccak256(ethers.toUtf8Bytes("policy-v1"));
const OTHER_POLICY = ethers.keccak256(ethers.toUtf8Bytes("policy-v2"));
const DECISION_ID = ethers.keccak256(ethers.toUtf8Bytes("decision-1"));
const DECISION_HASH = ethers.keccak256(ethers.toUtf8Bytes("decision-payload-1"));
const INTENT_ID = ethers.keccak256(ethers.toUtf8Bytes("intent-1"));
const INTENT_HASH = ethers.keccak256(ethers.toUtf8Bytes("intent-payload-1"));
const ZERO_HASH = ethers.ZeroHash;

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
        .withArgs(user.address, agent.address, INTENT_ID, DECISION_ID, INTENT_HASH, expiresAt);

      expect(await audit.intentUsed(user.address, INTENT_ID)).to.equal(true);
    });

    it("rejects a replayed intent id", async () => {
      const { audit, user, agent } = await deployAuthorized();
      const expiresAt = (await time.latest()) + 300;

      await audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, expiresAt);

      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, expiresAt),
      ).to.be.revertedWithCustomError(audit, "IntentReplayed");
    });

    it("scopes intent ids per user", async () => {
      const { audit, user, agent, stranger } = await deployAuthorized();
      const expiresAt = (await time.latest()) + 300;

      await audit.connect(stranger).setPolicy(OTHER_POLICY);
      await audit.connect(stranger).authorizeAgent(agent.address, OTHER_POLICY, expiresAt + 1_000);

      await audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, expiresAt);

      // The same id belonging to a different user is a different intent.
      expect(await audit.intentUsed(stranger.address, INTENT_ID)).to.equal(false);
      await audit
        .connect(agent)
        .recordIntent(stranger.address, OTHER_POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, expiresAt);
    });

    it("rejects a stale intent", async () => {
      const { audit, user, agent } = await deployAuthorized();
      const now = await time.latest();

      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, now),
      ).to.be.revertedWithCustomError(audit, "IntentStale");
    });

    it("rejects an intent whose window has passed since it was prepared", async () => {
      const { audit, user, agent } = await deployAuthorized();
      const expiresAt = (await time.latest()) + 300;

      await time.increaseTo(expiresAt + 1);

      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, expiresAt),
      ).to.be.revertedWithCustomError(audit, "IntentStale");
    });

    it("rejects an over-long intent window", async () => {
      const { audit, user, agent } = await deployAuthorized();
      const tooLong = (await time.latest()) + 2 * 60 * 60;

      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, tooLong),
      ).to.be.revertedWithCustomError(audit, "WindowTooLong");
    });

    it("rejects zero hashes", async () => {
      const { audit, user, agent } = await deployAuthorized();
      const expiresAt = (await time.latest()) + 300;

      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, ZERO_HASH, DECISION_ID, INTENT_HASH, expiresAt),
      ).to.be.revertedWithCustomError(audit, "ZeroHash");
      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, ZERO_HASH, INTENT_HASH, expiresAt),
      ).to.be.revertedWithCustomError(audit, "ZeroHash");
      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, ZERO_HASH, expiresAt),
      ).to.be.revertedWithCustomError(audit, "ZeroHash");
    });
  });

  describe("pause", () => {
    it("blocks logging while paused and resumes after", async () => {
      const { audit, user, agent } = await deployAuthorized();
      const expiresAt = (await time.latest()) + 300;

      await expect(audit.connect(user).setPaused(true))
        .to.emit(audit, "PauseChanged")
        .withArgs(user.address, true, anyUint());

      expect(await audit.paused(user.address)).to.equal(true);
      expect(await audit.isAgentLive(user.address, agent.address)).to.equal(false);

      await expect(
        audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 10),
      ).to.be.revertedWithCustomError(audit, "ContractPaused");
      await expect(
        audit.connect(agent).recordIntent(user.address, POLICY, INTENT_ID, DECISION_ID, INTENT_HASH, expiresAt),
      ).to.be.revertedWithCustomError(audit, "ContractPaused");

      // Reads stay available while paused.
      expect(await audit.policyHashOf(user.address)).to.equal(POLICY);
      expect(await audit.VERSION()).to.equal(1);

      await audit.connect(user).setPaused(false);
      expect(await audit.isAgentLive(user.address, agent.address)).to.equal(true);
      await audit.connect(agent).logDecision(user.address, POLICY, DECISION_ID, DECISION_HASH, 10);
    });

    it("scopes the pause to one user", async () => {
      const { audit, user, agent, stranger } = await deployAuthorized();
      const expiresAt = (await time.latest()) + 3_600;

      await audit.connect(stranger).setPolicy(OTHER_POLICY);
      await audit.connect(stranger).authorizeAgent(agent.address, OTHER_POLICY, expiresAt);

      await audit.connect(user).setPaused(true);

      expect(await audit.isAgentLive(user.address, agent.address)).to.equal(false);
      expect(await audit.isAgentLive(stranger.address, agent.address)).to.equal(true);
      await audit.connect(agent).logDecision(stranger.address, OTHER_POLICY, DECISION_ID, DECISION_HASH, 10);
    });
  });

  describe("non-custodial guarantees", () => {
    it("has no payable function and rejects a plain transfer", async () => {
      const { audit, user } = await deploy();
      const address = await audit.getAddress();

      // There is no receive or fallback, so value sent to the contract reverts
      // rather than being held.
      await expect(user.sendTransaction({ to: address, value: 1n })).to.be.reverted;
      expect(await ethers.provider.getBalance(address)).to.equal(0n);
    });

    it("exposes no value-moving function in its ABI", async () => {
      const factory = await ethers.getContractFactory("CryptaraAudit");
      const fragments = factory.interface.fragments.filter((fragment) => fragment.type === "function");

      // A contract that cannot custody funds has no payable entry point and no
      // transfer-shaped function. Asserting on the ABI keeps that true as the
      // contract evolves.
      for (const fragment of fragments) {
        const item = fragment as unknown as { name: string; payable?: boolean; stateMutability: string };
        expect(item.stateMutability, `${item.name} must not be payable`).to.not.equal("payable");
        expect(
          /transfer|withdraw|approve|deposit|sweep|send/i.test(item.name),
          `${item.name} looks like a value-moving function`,
        ).to.equal(false);
      }
    });
  });

  describe("idempotent revocation", () => {
    it("does not revert when revoking twice or revoking an unknown agent", async () => {
      const { audit, user, agent, stranger } = await deployAuthorized();

      await audit.connect(user).revokeAgent(stranger.address);
      await audit.connect(user).revokeAgent(agent.address);
      await audit.connect(user).revokeAgent(agent.address);

      expect(await audit.isAgentLive(user.address, agent.address)).to.equal(false);
    });

    it("refuses to revoke the zero address", async () => {
      const { audit, user } = await deploy();

      await expect(audit.connect(user).revokeAgent(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        audit,
        "ZeroAddress",
      );
    });
  });
});

/** Matches any uint argument in an event assertion. */
function anyUint() {
  return (value: bigint) => typeof value === "bigint" && value >= 0n;
}
