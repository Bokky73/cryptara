import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying CryptaraTimelock with deployer: ${deployer.address}`);

  // Example signers - in production these would be hardware-backed multisig participants
  const signers = process.env.TIMELOCK_SIGNERS
    ? process.env.TIMELOCK_SIGNERS.split(",").map((s) => s.trim())
    : [deployer.address, deployer.address, deployer.address];

  // Deduplicate for example deployment
  const uniqueSigners = [...new Set(signers)];
  while (uniqueSigners.length < 3) uniqueSigners.push(deployer.address);

  const threshold = process.env.TIMELOCK_THRESHOLD ? parseInt(process.env.TIMELOCK_THRESHOLD, 10) : 2;
  const minDelay = process.env.TIMELOCK_MIN_DELAY ? parseInt(process.env.TIMELOCK_MIN_DELAY, 10) : 24 * 3600;
  const maxDelay = process.env.TIMELOCK_MAX_DELAY ? parseInt(process.env.TIMELOCK_MAX_DELAY, 10) : 30 * 86400;
  const emergencyAdmin = process.env.TIMELOCK_EMERGENCY_ADMIN || deployer.address;

  console.log(`Signers: ${uniqueSigners.join(", ")}`);
  console.log(`Threshold: ${threshold}`);
  console.log(`Delay window: [${minDelay}, ${maxDelay}]`);
  console.log(`Emergency admin: ${emergencyAdmin}`);

  const Timelock = await ethers.getContractFactory("CryptaraTimelock");
  const timelock = await Timelock.deploy(uniqueSigners.slice(0, 3), threshold, minDelay, maxDelay, emergencyAdmin);
  await timelock.waitForDeployment();

  const address = await timelock.getAddress();
  console.log(`CryptaraTimelock deployed to ${address}`);
  console.log(`Threshold: ${await timelock.threshold()}`);
  console.log(`Min delay: ${await timelock.minDelay()}`);
  console.log(`Max delay: ${await timelock.maxDelay()}`);

  const network = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);

  // Also deploy PolicyV2 implementation for reference
  const PolicyV2 = await ethers.getContractFactory("CryptaraPolicyV2");
  const policyV2 = await PolicyV2.deploy();
  await policyV2.waitForDeployment();
  console.log(`CryptaraPolicyV2 implementation deployed to ${await policyV2.getAddress()}`);
  console.log(`V2 version: ${await policyV2.getV2Version()}`);

  console.log("Governance deployment complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
