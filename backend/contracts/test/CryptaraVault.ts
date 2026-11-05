import { expect } from "chai";
import { ethers } from "hardhat";

describe("CryptaraVault constructor smoke checks", function () {
  async function deployVault() {
    const [, agent, user] = await ethers.getSigners();
    const Policy = await ethers.getContractFactory("CryptaraPolicy");
    const policy = await Policy.deploy();
    await policy.waitForDeployment();
    const Vault = await ethers.getContractFactory("CryptaraVault");
    const vault = await Vault.deploy(policy.target, agent.address);
    await vault.waitForDeployment();
    return { Vault, vault, policy, agent, user };
  }

  it("records the reviewed policy and agent identities", async function () {
    const { vault, policy, agent } = await deployVault();
    expect(await vault.policy()).to.equal(policy.target);
    expect(await vault.agent()).to.equal(agent.address);
  });

  it("rejects a zero policy address", async function () {
    const { Vault, agent } = await deployVault();
    await expect(Vault.deploy(ethers.ZeroAddress, agent.address)).to.be.revertedWith("Vault: zero policy");
  });

  it("rejects a zero agent address", async function () {
    const { Vault, policy } = await deployVault();
    await expect(Vault.deploy(policy.target, ethers.ZeroAddress)).to.be.revertedWith("Vault: zero agent");
  });

  it("keeps withdrawal authority immutable", async function () {
    const { vault, user } = await deployVault();
    await expect(
      vault.connect(user).withdraw(ethers.ZeroAddress, 1, user.address, ethers.ZeroHash),
    ).to.be.revertedWith("Vault: not agent");
  });

  it("starts every user and token balance at zero", async function () {
    const { vault, user } = await deployVault();
    expect(await vault.userBalance(user.address, user.address)).to.equal(0n);
  });
});
