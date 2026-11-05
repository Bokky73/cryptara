import { ethers, network } from "hardhat";

/**
 * Deploy `CryptaraAudit`.
 *
 * The network is whatever Hardhat was told on the command line, and this script
 * refuses to run against the in-process `hardhat` network, because a deployment
 * to an ephemeral chain produces an address that means nothing the moment the
 * process exits.
 *
 * Nothing here reads or prints a private key. Hardhat resolves the signer from
 * the network configuration, which reads it from the environment.
 */
async function main() {
  if (network.name === "hardhat") {
    throw new Error(
      "Refusing to deploy to the in-process hardhat network. Pass an explicit --network.",
    );
  }

  const factory = await ethers.getContractFactory("CryptaraAudit");
  const audit = await factory.deploy();

  await audit.waitForDeployment();

  const address = await audit.getAddress();
  const deployment = audit.deploymentTransaction();

  // Printed for the artifact record. The deployer address is public
  // information; the key that produced it is never touched here.
  console.log(`network: ${network.name}`);
  console.log(`version: ${await audit.VERSION()}`);
  console.log(`txHash:  ${deployment?.hash ?? "unknown"}`);
  console.log(`CryptaraAudit deployed to ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
