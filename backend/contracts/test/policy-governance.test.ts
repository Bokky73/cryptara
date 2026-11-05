import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("Policy Governance via Timelock", function () {
  async function deployFixture() {
    const [owner, emergency, agent, user, signerA, signerB, signerC] = await ethers.getSigners();
    const Policy = await ethers.getContractFactory("CryptaraPolicy");
    const policy = await Policy.deploy();
    await policy.waitForDeployment();
    await policy.setEmergencyAdmin(emergency.address);
    await policy.setAgent(agent.address);

    const Timelock = await ethers.getContractFactory("CryptaraTimelock");
    const timelock = await Timelock.deploy(
      [signerA.address, signerB.address, signerC.address],
      2,
      24 * 3600,
      30 * 86400,
      emergency.address
    );
    await timelock.waitForDeployment();

    // Transfer ownership to timelock for privileged changes
    await policy.transferOwnership(await timelock.getAddress());

    // Deploy V2 to test upgrade path
    const PolicyV2 = await ethers.getContractFactory("CryptaraPolicyV2");
    const policyV2Impl = await PolicyV2.deploy();
    await policyV2Impl.waitForDeployment();

    return { policy, policyV2Impl, timelock, owner, emergency, agent, user, signerA, signerB, signerC };
  }

  it("A privileged change cannot execute before its delay elapses", async function () {
    const { policy, timelock, signerA, signerB } = await loadFixture(deployFixture);
    const policyAddr = await policy.getAddress();
    const newLimit = ethers.parseEther("200");
    // encode setLimits call payload (without selector, timelock will prepend selector)
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint256","uint256"], [newLimit, 100, ethers.parseEther("100")]);
    const selector = policy.interface.getFunction("setLimits").selector;
    const id = await timelock.connect(signerA).propose.staticCall(policyAddr, selector, payload, 24*3600);
    await timelock.connect(signerA).propose(policyAddr, selector, payload, 24*3600);
    await timelock.connect(signerA).sign(id);
    await timelock.connect(signerB).sign(id);
    await expect(timelock.execute(id)).to.be.revertedWithCustomError(timelock, "ProposalNotReady");
    await time.increase(24*3600+1);
    await expect(timelock.execute(id)).to.emit(timelock, "ProposalExecuted");
    expect(await policy.maxTransactionValue()).to.equal(newLimit);
  });

  it("A single signer cannot schedule a privileged change alone (threshold enforcement)", async function () {
    const { policy, timelock, signerA } = await loadFixture(deployFixture);
    const policyAddr = await policy.getAddress();
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint256","uint256"], [ethers.parseEther("300"), 100, ethers.parseEther("100")]);
    const selector = policy.interface.getFunction("setLimits").selector;
    const id = await timelock.connect(signerA).propose.staticCall(policyAddr, selector, payload, 24*3600);
    await timelock.connect(signerA).propose(policyAddr, selector, payload, 24*3600);
    await timelock.connect(signerA).sign(id);
    await time.increase(24*3600+1);
    await expect(timelock.execute(id)).to.be.revertedWithCustomError(timelock, "InsufficientSignatures");
  });

  it("Cancel during the delay prevents execution permanently for that proposal", async function () {
    const { policy, timelock, signerA, signerB } = await loadFixture(deployFixture);
    const policyAddr = await policy.getAddress();
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signerA.address]);
    const selector = policy.interface.getFunction("setAgent").selector;
    const id = await timelock.connect(signerA).propose.staticCall(policyAddr, selector, payload, 24*3600);
    await timelock.connect(signerA).propose(policyAddr, selector, payload, 24*3600);
    await timelock.connect(signerA).sign(id);
    await timelock.connect(signerB).sign(id);
    await timelock.connect(signerA).cancel(id);
    await time.increase(24*3600+1);
    await expect(timelock.execute(id)).to.be.revertedWithCustomError(timelock, "ProposalAlreadyCancelled");
    // replay execute fails
    await expect(timelock.execute(id)).to.be.revertedWithCustomError(timelock, "ProposalAlreadyCancelled");
  });

  it("Emergency pause still takes effect immediately", async function () {
    const { policy, emergency } = await loadFixture(deployFixture);
    // Policy pause is immediate via owner/emergencyAdmin - timelock is owner now, but emergencyAdmin can still pause
    await policy.connect(emergency).pause();
    expect(await policy.paused()).to.equal(true);
    await policy.connect(emergency).unpause();
    expect(await policy.paused()).to.equal(false);
  });

  it("The pending queue is readable and matches the on-chain state", async function () {
    const { policy, timelock, signerA, signerB } = await loadFixture(deployFixture);
    const policyAddr = await policy.getAddress();
    const payload1 = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint256","uint256"], [ethers.parseEther("111"), 100, ethers.parseEther("10")]);
    const payload2 = ethers.AbiCoder.defaultAbiCoder().encode(["uint256","uint256","uint256"], [ethers.parseEther("222"), 100, ethers.parseEther("20")]);
    const sel = policy.interface.getFunction("setLimits").selector;
    const id1 = await timelock.connect(signerA).propose.staticCall(policyAddr, sel, payload1, 24*3600);
    await timelock.connect(signerA).propose(policyAddr, sel, payload1, 24*3600);
    const id2 = await timelock.connect(signerB).propose.staticCall(policyAddr, sel, payload2, 24*3600);
    await timelock.connect(signerB).propose(policyAddr, sel, payload2, 24*3600);
    const queue = await timelock.getPendingQueue();
    expect(queue.length).to.equal(2);
    expect(queue.map((p:any)=>p.id)).to.include(id1);
    expect(queue.map((p:any)=>p.id)).to.include(id2);
    // pending count matches
    expect(await timelock.getPendingCount()).to.equal(2);
    // hash matches
    const hash1 = ethers.keccak256(payload1);
    const q1 = queue.find((p:any)=>p.id===id1);
    expect(q1.payloadHash).to.equal(hash1);
  });
});
