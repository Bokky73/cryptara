import { ethers } from "hardhat";

async function main() {
  const CryptaraVault = await ethers.getContractFactory("CryptaraVault");
  const vault = await CryptaraVault.deploy();

  await vault.waitForDeployment();

  console.log(`CryptaraVault deployed to ${await vault.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
