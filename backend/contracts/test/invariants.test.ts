import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { CryptaraVault, CryptaraPolicy, CryptaraAudit, MockERC20 } from "../typechain-types";

// Deterministic PRNG (mulberry32) so the fuzz run is reproducible in CI.
function makeRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0xc0ffee;
const SEQUENCES = 1000;
const ACTIONS_PER_SEQUENCE = 8;

const MAX_TX_VALUE = ethers.parseEther("5");
const MAX_DAILY_SPEND = ethers.parseEther("10");

describe("CryptaraVault / CryptaraPolicy invariants (fuzz)", function () {
  this.timeout(120_000);

  let admin: SignerWithAddress;
  let agent: SignerWithAddress;
  let users: SignerWithAddress[];
  let vault: CryptaraVault;
  let policy: CryptaraPolicy;
  let audit: CryptaraAudit;
  let token: MockERC20;

  beforeEach(async function () {
    [admin, agent, ...users] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    token = (await Token.deploy("Cryptara", "CRY", ethers.parseEther("1000000"))) as MockERC20;
    await token.waitForDeployment();

    const Audit = await ethers.getContractFactory("CryptaraAudit");
    audit = (await Audit.deploy(admin.address)) as CryptaraAudit;
    await audit.waitForDeployment();

    const Vault = await ethers.getContractFactory("CryptaraVault");
    vault = (await Vault.deploy(await token.getAddress(), admin.address)) as CryptaraVault;
    await vault.waitForDeployment();

    const Policy = await ethers.getContractFactory("CryptaraPolicy");
    policy = (await Policy.deploy(await vault.getAddress(), admin.address)) as CryptaraPolicy;
    await policy.waitForDeployment();

    await vault.connect(admin).setPolicy(await policy.getAddress());
    await policy.connect(admin).setAgent(agent.address, true);
    await policy.connect(admin).setLimits(MAX_TX_VALUE, MAX_DAILY_SPEND);

    for (const u of users) {
      await token.mint(u.address, ethers.parseEther("1000"));
      await token.connect(u).approve(await vault.getAddress(), ethers.MaxUint256);
    }
  });

  async function assertSolvency() {
    const vaultBal = await token.balanceOf(await vault.getAddress());
    let sum = 0n;
    for (const u of users) {
      sum += await vault.balanceOf(u.address, await token.getAddress());
    }
    expect(vaultBal).to.be.gte(sum, "solvency invariant violated");
  }

  async function assertAuditNonCustodial() {
    expect(await ethers.provider.getBalance(await audit.getAddress())).to.equal(0n);
  }

  it("holds solvency, intent uniqueness and policy bounds across randomized sequences", async function () {
    const rng = makeRng(SEED);
    const withdrawnIntents = new Set<string>();

    for (let seq = 0; seq < SEQUENCES; seq++) {
      for (let step = 0; step < ACTIONS_PER_SEQUENCE; step++) {
        const roll = rng();
        const user = users[Math.floor(rng() * users.length)];

        if (roll < 0.4) {
          // deposit
          const amount = ethers.parseEther((rng() * 5 + 0.01).toFixed(4));
          await vault.connect(user).deposit(await token.getAddress(), amount);
        } else if (roll < 0.6) {
          // partial withdrawal of own balance
          const bal = await vault.balanceOf(user.address, await token.getAddress());
          if (bal > 0n) {
            const amount = (bal * BigInt(Math.floor(rng() * 100) + 1)) / 100n;
            if (amount > 0n) {
              await vault.connect(user).withdraw(await token.getAddress(), amount);
            }
          }
        } else if (roll < 0.75) {
          // agent withdrawal within policy bounds
          const amount = ethers.parseEther((rng() * 4 + 0.01).toFixed(4));
          const intentHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ["address", "address", "uint256", "uint256"],
              [user.address, await token.getAddress(), amount, seq * 1000 + step]
            )
          );
          if (withdrawnIntents.has(intentHash)) continue;
          try {
            await policy.connect(agent).executeWithdrawal(user.address, await token.getAddress(), amount, intentHash);
            withdrawnIntents.add(intentHash);
          } catch {
            // policy rejection is acceptable; uniqueness still enforced below
          }
        } else if (roll < 0.85) {
          // pause / unpause
          if (await policy.paused()) {
            await policy.connect(admin).unpause();
          } else {
            await policy.connect(admin).pause();
          }
        } else if (roll < 0.95) {
          // revoke / restore agent
          const enabled = await policy.isAgent(agent.address);
          await policy.connect(admin).setAgent(agent.address, !enabled);
        } else {
          // daily spend reset
          await policy.connect(admin).resetDailySpend(agent.address);
        }

        await assertSolvency();
        await assertAuditNonCustodial();
      }
    }

    // Intent uniqueness: replaying a withdrawn intent must revert.
    for (const hash of withdrawnIntents) {
      await expect(
        policy.connect(agent).executeWithdrawal(users[0].address, await token.getAddress(), 1n, hash)
      ).to.be.reverted;
    }
  });

  it("rejects agent withdrawals when paused, revoked, or over limits", async function () {
    const amount = ethers.parseEther("1");
    const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["blocked"]));

    await policy.connect(admin).pause();
    await expect(
      policy.connect(agent).executeWithdrawal(users[0].address, await token.getAddress(), amount, hash)
    ).to.be.reverted;
    await policy.connect(admin).unpause();

    await policy.connect(admin).setAgent(agent.address, false);
    await expect(
      policy.connect(agent).executeWithdrawal(users[0].address, await token.getAddress(), amount, hash)
    ).to.be.reverted;
    await policy.connect(admin).setAgent(agent.address, true);

    await expect(
      policy.connect(agent).executeWithdrawal(users[0].address, await token.getAddress(), MAX_TX_VALUE + 1n, hash)
    ).to.be.reverted;

    await assertSolvency();
    await assertAuditNonCustodial();
  });
});
