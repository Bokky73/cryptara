import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log(`Deploying CryptaraPolicy with account: ${deployer.address}`);

  const Policy = await ethers.getContractFactory("CryptaraPolicy");
  const policy = await Policy.deploy();

  await policy.waitForDeployment();

  const address = await policy.getAddress();
  const version = await policy.getVersion();

  console.log(`CryptaraPolicy deployed to ${address}`);
  console.log(`Contract version: ${version}`);
  console.log(`Owner: ${await policy.owner()}`);
  console.log(`Emergency admin: ${await policy.emergencyAdmin()}`);
  console.log("");

  const network = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (chainId: ${network.chainId})`);

  if (network.chainId !== 31337n && process.env.VERIFY_ON_DEPLOY === "true") {
    console.log("Waiting for block confirmations...");
    await policy.deploymentTransaction()?.wait(5);
    console.log("Ready for verification.");
  }

  console.log("Deployment complete. No secrets in output.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
