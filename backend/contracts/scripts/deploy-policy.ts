import { ethers, network as hardhatNetwork, artifacts } from "hardhat";
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

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

  const deployTx = policy.deploymentTransaction();
  let blockNumber: number | null = null;
  if (deployTx) {
    const receipt = await deployTx.wait();
    blockNumber = receipt?.blockNumber ?? null;
  }

  if (network.chainId !== 31337n && process.env.VERIFY_ON_DEPLOY === "true") {
    console.log("Waiting for block confirmations...");
    await policy.deploymentTransaction()?.wait(5);
    console.log("Ready for verification.");
  }

  // Deterministic deployment manifest with bytecode SHA-256 hash.
  const artifact = await artifacts.readArtifact("CryptaraPolicy");
  const bytecodeHash = createHash("sha256")
    .update(artifact.bytecode)
    .digest("hex");

  const manifest = {
    contract: "CryptaraPolicy",
    address,
    txHash: deployTx?.hash ?? null,
    deployer: deployer.address,
    blockNumber,
    chainId: Number(network.chainId),
    network: hardhatNetwork.name,
    compilerVersion: artifact.sourceName ? undefined : undefined,
    bytecodeHash,
    version: version.toString(),
    owner: await policy.owner(),
    emergencyAdmin: await policy.emergencyAdmin(),
    timestamp: new Date().toISOString(),
  };

  const outDir = join(__dirname, "..", "..", "..", "docs", "deployments");
  mkdirSync(outDir, { recursive: true });
  const baseName = `cryptara-policy-${hardhatNetwork.name}-${network.chainId}`;
  writeFileSync(
    join(outDir, `${baseName}.json`),
    JSON.stringify(manifest, null, 2) + "\n"
  );

  const markdown = [
    `# CryptaraPolicy Deployment`,
    "",
    `- Network: ${hardhatNetwork.name} (chainId: ${network.chainId})`,
    `- Contract: ${address}`,
    `- Tx hash: ${manifest.txHash ?? "n/a"}`,
    `- Deployer: ${deployer.address}`,
    `- Block number: ${blockNumber ?? "n/a"}`,
    `- Version: ${manifest.version}`,
    `- Bytecode SHA-256: ${bytecodeHash}`,
    `- Timestamp: ${manifest.timestamp}`,
    "",
  ].join("\n");
  writeFileSync(join(outDir, `${baseName}.md`), markdown);

  console.log(`Deployment manifest written to docs/deployments/${baseName}.{json,md}`);
  console.log("Deployment complete. No secrets in output.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
