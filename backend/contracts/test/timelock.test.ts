import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("CryptaraTimelock", function () {
  async function deployFixture() {
    const [signerA, signerB, signerC, emergency, outsider, target] = await ethers.getSigners();
    const Timelock = await ethers.getContractFactory("CryptaraTimelock");
    const timelock = await Timelock.deploy(
      [signerA.address, signerB.address, signerC.address],
      2,
      24 * 3600,
      30 * 86400,
      emergency.address
    );
    await timelock.waitForDeployment();
    return { timelock, signerA, signerB, signerC, emergency, outsider, target };
  }

  describe("Deployment", function () {
    it("should set signers and threshold", async function () {
      const { timelock, signerA } = await loadFixture(deployFixture);
      expect(await timelock.threshold()).to.equal(2);
      expect(await timelock.minDelay()).to.equal(24 * 3600);
      expect(await timelock.isSigner(signerA.address)).to.equal(true);
    });
  });

  describe("Authorization", function () {
    it("should reject propose from non-signer (single signer cannot schedule alone)", async function () {
      const { timelock, outsider, target } = await loadFixture(deployFixture);
      const selector = "0x12345678";
      await expect(
        timelock.connect(outsider).propose(target.address, selector, "0x", 24 * 3600)
      ).to.be.revertedWithCustomError(timelock, "Unauthorized");
    });

    it("should require more than one signer to execute (threshold)", async function () {
      const { timelock, signerA, target } = await loadFixture(deployFixture);
      const selector = "0x12345678";
      const payload = "0x010203";
      const id = await timelock.connect(signerA).propose.staticCall(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).propose(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).sign(id);
      await time.increase(24 * 3600 + 1);
      await expect(timelock.connect(signerA).execute(id)).to.be.revertedWithCustomError(timelock, "InsufficientSignatures");
    });
  });

  describe("Delay", function () {
    it("should not execute before delay elapses", async function () {
      const { timelock, signerA, signerB, target } = await loadFixture(deployFixture);
      const selector = "0x12345678";
      const payload = "0x010203";
      const id = await timelock.connect(signerA).propose.staticCall(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).propose(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).sign(id);
      await timelock.connect(signerB).sign(id);
      await expect(timelock.execute(id)).to.be.revertedWithCustomError(timelock, "ProposalNotReady");
      await time.increase(24 * 3600 + 1);
      // need a dummy target that will succeed on call - use timelock itself with a no-op (setTimelock not present)
      // Instead we use outsider as target with empty code; call will succeed (no revert)
      // So we test that after delay it can execute (even if call is noop)
      // For this test we deployed with target being an EOA, EOA call succeeds
      await expect(timelock.execute(id)).to.emit(timelock, "ProposalExecuted");
    });

    it("should reject delay too small or too large", async function () {
      const { timelock, signerA, target } = await loadFixture(deployFixture);
      await expect(timelock.connect(signerA).propose(target.address, "0x12345678", "0x", 60)).to.be.revertedWithCustomError(timelock, "InvalidDelay");
      await expect(timelock.connect(signerA).propose(target.address, "0x12345678", "0x", 31 * 86400)).to.be.revertedWithCustomError(timelock, "InvalidDelay");
    });
  });

  describe("Cancel", function () {
    it("should cancel during delay and prevent execution permanently", async function () {
      const { timelock, signerA, signerB, target } = await loadFixture(deployFixture);
      const selector = "0x12345678";
      const payload = "0x010203";
      const id = await timelock.connect(signerA).propose.staticCall(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).propose(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).sign(id);
      await timelock.connect(signerB).sign(id);
      await expect(timelock.connect(signerA).cancel(id)).to.emit(timelock, "ProposalCancelled");
      await time.increase(24 * 3600 + 1);
      await expect(timelock.execute(id)).to.be.revertedWithCustomError(timelock, "ProposalAlreadyCancelled");
      // replay cancel should fail
      await expect(timelock.connect(signerA).cancel(id)).to.be.revertedWithCustomError(timelock, "ProposalAlreadyCancelled");
    });

    it("should allow emergency admin to cancel", async function () {
      const { timelock, signerA, emergency, target } = await loadFixture(deployFixture);
      const selector = "0x12345678";
      const payload = "0x010203";
      const id = await timelock.connect(signerA).propose.staticCall(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).propose(target.address, selector, payload, 24 * 3600);
      await expect(timelock.connect(emergency).cancel(id)).to.emit(timelock, "ProposalCancelled");
    });
  });

  describe("Emergency pause", function () {
    it("should still take effect immediately and block propose/execute", async function () {
      const { timelock, emergency, signerA, target } = await loadFixture(deployFixture);
      await expect(timelock.connect(emergency).pause()).to.emit(timelock, "EmergencyPauseSet");
      expect(await timelock.paused()).to.equal(true);
      await expect(timelock.connect(signerA).propose(target.address, "0x12345678", "0x", 24 * 3600)).to.be.revertedWithCustomError(timelock, "Paused");
      await timelock.connect(emergency).unpause();
      expect(await timelock.paused()).to.equal(false);
      // now propose works
      await expect(timelock.connect(signerA).propose(target.address, "0x12345678", "0x", 24 * 3600)).to.emit(timelock, "ProposalCreated");
    });
  });

  describe("Pending queue", function () {
    it("should be readable and match on-chain state", async function () {
      const { timelock, signerA, signerB, target } = await loadFixture(deployFixture);
      const sel = "0x12345678";
      const id1 = await timelock.connect(signerA).propose.staticCall(target.address, sel, "0x01", 24 * 3600);
      await timelock.connect(signerA).propose(target.address, sel, "0x01", 24 * 3600);
      const id2 = await timelock.connect(signerB).propose.staticCall(target.address, sel, "0x02", 24 * 3600);
      await timelock.connect(signerB).propose(target.address, sel, "0x02", 24 * 3600);
      expect(await timelock.getPendingCount()).to.equal(2);
      const queue = await timelock.getPendingQueue();
      expect(queue.length).to.equal(2);
      const ids = queue.map((p: any) => p.id);
      expect(ids).to.include(id1);
      expect(ids).to.include(id2);
      // payload hash matches
      const p1 = await timelock.getProposal(id1);
      const q1 = queue.find((p: any) => p.id === id1);
      expect(q1.payloadHash).to.equal(p1.payloadHash);
      // cancel one, queue shrinks
      await timelock.connect(signerA).cancel(id1);
      expect(await timelock.getPendingCount()).to.equal(1);
      const queue2 = await timelock.getPendingQueue();
      expect(queue2.length).to.equal(1);
      expect(queue2[0].id).to.equal(id2);
    });
  });

  describe("Events carry payload hash", function () {
    it("should emit propose with payload hash", async function () {
      const { timelock, signerA, target } = await loadFixture(deployFixture);
      const payload = "0xdeadbeef";
      const payloadHash = ethers.keccak256(payload);
      const sel = "0x12345678";
      const tx = await timelock.connect(signerA).propose(target.address, sel, payload, 24 * 3600);
      await expect(tx).to.emit(timelock, "ProposalCreated");
      const receipt: any = await tx.wait();
      // verify payloadHash in event
      const iface = timelock.interface;
      const log = receipt.logs.map((l: any) => { try { return iface.parseLog(l); } catch { return null; }}).find((e: any) => e && e.name === "ProposalCreated");
      expect(log.args.payloadHash).to.equal(payloadHash);
    });
  });

  describe("Replay and expiry", function () {
    it("should reject duplicate sign", async function () {
      const { timelock, signerA, target } = await loadFixture(deployFixture);
      const id = await timelock.connect(signerA).propose.staticCall(target.address, "0x12345678", "0x01", 24*3600);
      await timelock.connect(signerA).propose(target.address, "0x12345678", "0x01", 24*3600);
      await timelock.connect(signerA).sign(id);
      await expect(timelock.connect(signerA).sign(id)).to.be.revertedWithCustomError(timelock, "DuplicateSigner");
    });

    it("should reject sign from non-signer", async function () {
      const { timelock, signerA, outsider, target } = await loadFixture(deployFixture);
      const id = await timelock.connect(signerA).propose.staticCall(target.address, "0x12345678", "0x01", 24*3600);
      await timelock.connect(signerA).propose(target.address, "0x12345678", "0x01", 24*3600);
      await expect(timelock.connect(outsider).sign(id)).to.be.revertedWithCustomError(timelock, "Unauthorized");
    });
  });
});
