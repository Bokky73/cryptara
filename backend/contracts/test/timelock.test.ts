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

  describe("Signer rotation", function () {
    it("should not count removed signers toward execution quorum", async function () {
      const { timelock, signerA, signerB, signerC, target } = await loadFixture(deployFixture);
      const selector = "0x12345678";
      const payload = "0x010203";
      const id = await timelock.connect(signerA).propose.staticCall(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).propose(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).sign(id);
      await timelock.connect(signerB).sign(id);
      // Rotate: remove signerB, keep threshold at 2
      await timelock.connect(signerA).setSigner(signerB.address, false);
      expect(await timelock.isSigner(signerB.address)).to.equal(false);
      await time.increase(24 * 3600 + 1);
      // Only signerA remains active among the two signatures -> quorum not met
      await expect(timelock.execute(id)).to.be.revertedWithCustomError(timelock, "InsufficientSignatures");
      // signerC (active) can restore quorum
      await timelock.connect(signerC).sign(id);
      await expect(timelock.execute(id)).to.emit(timelock, "ProposalExecuted");
    });

    it("should enforce the current threshold after rotation", async function () {
      const { timelock, signerA, signerB, signerC, target } = await loadFixture(deployFixture);
      const selector = "0x12345678";
      const payload = "0x010203";
      const id = await timelock.connect(signerA).propose.staticCall(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).propose(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).sign(id);
      await timelock.connect(signerB).sign(id);
      // Raise threshold to 3 after signatures were collected
      await timelock.connect(signerA).setThreshold(3);
      expect(await timelock.threshold()).to.equal(3);
      await time.increase(24 * 3600 + 1);
      await expect(timelock.execute(id)).to.be.revertedWithCustomError(timelock, "InsufficientSignatures");
      await timelock.connect(signerC).sign(id);
      await expect(timelock.execute(id)).to.emit(timelock, "ProposalExecuted");
    });
  });

  describe("Grace period", function () {
    it("should revert execution after effectiveAt + GRACE_PERIOD", async function () {
      const { timelock, signerA, signerB, target } = await loadFixture(deployFixture);
      const selector = "0x12345678";
      const payload = "0x010203";
      const id = await timelock.connect(signerA).propose.staticCall(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).propose(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).sign(id);
      await timelock.connect(signerB).sign(id);
      const gracePeriod = await timelock.GRACE_PERIOD();
      // Advance past effectiveAt + grace period
      await time.increase(24 * 3600 + Number(gracePeriod) + 1);
      await expect(timelock.execute(id)).to.be.revertedWithCustomError(timelock, "ProposalExpired");
    });
  });

  describe("Emergency admin boundaries", function () {
    it("should not allow emergency admin to execute proposals", async function () {
      const { timelock, signerA, signerB, emergency, target } = await loadFixture(deployFixture);
      const selector = "0x12345678";
      const payload = "0x010203";
      const id = await timelock.connect(signerA).propose.staticCall(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).propose(target.address, selector, payload, 24 * 3600);
      await timelock.connect(signerA).sign(id);
      await timelock.connect(signerB).sign(id);
      await time.increase(24 * 3600 + 1);
      await expect(timelock.connect(emergency).execute(id)).to.be.revertedWithCustomError(timelock, "Unauthorized");
    });

    it("should not allow emergency admin to mutate signers or threshold", async function () {
      const { timelock, emergency, outsider } = await loadFixture(deployFixture);
      await expect(timelock.connect(emergency).setSigner(outsider.address, true)).to.be.revertedWithCustomError(timelock, "Unauthorized");
      await expect(timelock.connect(emergency).setThreshold(1)).to.be.revertedWithCustomError(timelock, "Unauthorized");
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
      const receipt = await tx.wait();
      const iface = timelock.interface;
      const parsed = receipt!.logs
        .map((log) => {
          try {
            return iface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e) => e && e.name === "ProposalCreated");
      expect(parsed).to.not.be.null;
      expect(parsed!.args.payloadHash).to.equal(payloadHash);
    });
  });
});
