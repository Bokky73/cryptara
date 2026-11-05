import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("CryptaraVault", function () {
  async function deployFixture() {
    const [owner, emergency, agent, user, recipient, otherUser] = await ethers.getSigners();

    const Policy = await ethers.getContractFactory("CryptaraPolicy");
    const policy = await Policy.deploy();
    await policy.waitForDeployment();

    await policy.setEmergencyAdmin(emergency.address);
    await policy.setAgent(agent.address);
    await policy.setLimits(ethers.parseEther("1000"), 100, ethers.parseEther("500"));

    const MockToken = await ethers.getContractFactory("MockERC20");
    const token = await MockToken.deploy();
    await token.waitForDeployment();

    await policy.allowAsset(token.target);

    const Vault = await ethers.getContractFactory("CryptaraVault");
    const vault = await Vault.deploy(policy.target, agent.address);
    await vault.waitForDeployment();

    return { policy, vault, token, owner, emergency, agent, user, recipient, otherUser };
  }

  describe("Deployment", function () {
    it("should set policy and agent", async function () {
      const { vault, policy, agent } = await loadFixture(deployFixture);
      expect(await vault.policy()).to.equal(policy.target);
      expect(await vault.agent()).to.equal(agent.address);
    });
  });

  describe("Deposit", function () {
    it("should accept deposits and update balances", async function () {
      const { vault, token, user } = await loadFixture(deployFixture);

      await token.transfer(user.address, ethers.parseEther("100"));
      await token.connect(user).approve(vault.target, ethers.parseEther("50"));

      await vault.connect(user).deposit(token.target, ethers.parseEther("50"));
      expect(await vault.userBalance(user.address, token.target)).to.equal(ethers.parseEther("50"));
    });
  });

  describe("Withdraw validation", function () {
    it("should reject non-agent withdrawals", async function () {
      const { vault, user, token } = await loadFixture(deployFixture);
      await expect(
        vault.connect(user).withdraw(token.target, 1, user.address, ethers.ZeroHash),
      ).to.be.revertedWith("Vault: not agent");
    });

    it("should reject zero-amount withdraw", async function () {
      const { vault, agent, user, token } = await loadFixture(deployFixture);
      await expect(
        vault.connect(agent).withdraw(token.target, 0, user.address, ethers.ZeroHash),
      ).to.be.revertedWith("Vault: zero amount");
    });

    it("should reject zero-recipient withdraw", async function () {
      const { vault, agent, token } = await loadFixture(deployFixture);
      await expect(
        vault.connect(agent).withdraw(token.target, 1, ethers.ZeroAddress, ethers.ZeroHash),
      ).to.be.revertedWith("Vault: zero recipient");
    });

    it("should reject withdraw for unknown intent hash", async function () {
      const { vault, agent, user, token } = await loadFixture(deployFixture);
      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("nonexistent"));
      await expect(
        vault.connect(agent).withdraw(token.target, 1, user.address, fakeHash),
      ).to.be.revertedWith("unknown intent");
    });
  });

  describe("Policy integration — Finding 1 security fixes", function () {
    it("should reject intent reuse (replay protection)", async function () {
      const { vault, policy, agent, user, token } = await loadFixture(deployFixture);

      await token.transfer(user.address, ethers.parseEther("100"));
      await token.connect(user).approve(vault.target, ethers.parseEther("50"));
      await vault.connect(user).deposit(token.target, ethers.parseEther("50"));

      const expiry = await time.latest() + 3600;
      const decision = await policy.connect(agent).applyPolicy.staticCall(
        user.address, ethers.parseEther("10"), 50, expiry,
      );
      await policy.connect(agent).applyPolicy(user.address, ethers.parseEther("10"), 50, expiry);

      const intentExpiry = await time.latest() + 1800;
      const intentHash = await policy.connect(agent).createIntent.staticCall(
        decision, token.target, ethers.parseEther("5"), intentExpiry, 25,
      );
      await policy.connect(agent).createIntent(decision, token.target, ethers.parseEther("5"), intentExpiry, 25);

      await vault.connect(agent).withdraw(token.target, ethers.parseEther("3"), user.address, intentHash);

      await expect(
        vault.connect(agent).withdraw(token.target, ethers.parseEther("1"), user.address, intentHash),
      ).to.be.revertedWith("Vault: intent consumed");
    });

    it("should reject withdraw with another user's intent", async function () {
      const { vault, policy, agent, user, otherUser, token } = await loadFixture(deployFixture);

      await token.transfer(user.address, ethers.parseEther("100"));
      await token.connect(user).approve(vault.target, ethers.parseEther("50"));
      await vault.connect(user).deposit(token.target, ethers.parseEther("50"));

      const expiry = await time.latest() + 3600;
      const decision = await policy.connect(agent).applyPolicy.staticCall(
        user.address, ethers.parseEther("10"), 50, expiry,
      );
      await policy.connect(agent).applyPolicy(user.address, ethers.parseEther("10"), 50, expiry);

      const intentExpiry = await time.latest() + 1800;
      const intentHash = await policy.connect(agent).createIntent.staticCall(
        decision, token.target, ethers.parseEther("5"), intentExpiry, 25,
      );
      await policy.connect(agent).createIntent(decision, token.target, ethers.parseEther("5"), intentExpiry, 25);

      await expect(
        vault.connect(agent).withdraw(token.target, ethers.parseEther("3"), otherUser.address, intentHash),
      ).to.be.revertedWith("Vault: intent user mismatch");
    });

    it("should reject withdraw exceeding tracked balance", async function () {
      const { vault, policy, agent, user, token } = await loadFixture(deployFixture);

      await token.transfer(user.address, ethers.parseEther("100"));
      await token.connect(user).approve(vault.target, ethers.parseEther("50"));
      await vault.connect(user).deposit(token.target, ethers.parseEther("50"));

      const expiry = await time.latest() + 3600;
      const decision = await policy.connect(agent).applyPolicy.staticCall(
        user.address, ethers.parseEther("100"), 50, expiry,
      );
      await policy.connect(agent).applyPolicy(user.address, ethers.parseEther("100"), 50, expiry);

      const intentExpiry = await time.latest() + 1800;
      const intentHash = await policy.connect(agent).createIntent.staticCall(
        decision, token.target, ethers.parseEther("100"), intentExpiry, 25,
      );
      await policy.connect(agent).createIntent(decision, token.target, ethers.parseEther("100"), intentExpiry, 25);

      await expect(
        vault.connect(agent).withdraw(token.target, ethers.parseEther("100"), user.address, intentHash),
      ).to.be.revertedWith("Vault: insufficient balance");
    });

    it("should allow withdraw with valid intent and debit balance", async function () {
      const { vault, policy, agent, user, token } = await loadFixture(deployFixture);

      await token.transfer(user.address, ethers.parseEther("100"));
      await token.connect(user).approve(vault.target, ethers.parseEther("50"));
      await vault.connect(user).deposit(token.target, ethers.parseEther("50"));

      const expiry = await time.latest() + 3600;
      const decision = await policy.connect(agent).applyPolicy.staticCall(
        user.address, ethers.parseEther("10"), 50, expiry,
      );
      await policy.connect(agent).applyPolicy(user.address, ethers.parseEther("10"), 50, expiry);

      const intentExpiry = await time.latest() + 1800;
      const intentHash = await policy.connect(agent).createIntent.staticCall(
        decision, token.target, ethers.parseEther("5"), intentExpiry, 25,
      );
      await policy.connect(agent).createIntent(decision, token.target, ethers.parseEther("5"), intentExpiry, 25);

      await vault.connect(agent).withdraw(token.target, ethers.parseEther("3"), user.address, intentHash);

      expect(await token.balanceOf(user.address)).to.equal(ethers.parseEther("53"));
      expect(await vault.userBalance(user.address, token.target)).to.equal(ethers.parseEther("47"));
    });
  });
});
