import { ethers, network, artifacts } from "hardhat";
import { createHash } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

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
  const txHash = deployment?.hash ?? "unknown";

  const receipt = deployment ? await deployment.wait() : null;
  const blockNumber = receipt?.blockNumber ?? null;

  const [signer] = await ethers.getSigners();
  const deployer = await signer.getAddress();

  // Deterministic bytecode hash: SHA-256 over the deployed bytecode so the
  // record can be re-verified against the on-chain code at any time.
  const artifact = await artifacts.readArtifact("CryptaraAudit");
  const bytecodeHash = createHash("sha256")
    .update(artifact.deployedBytecode)
    .digest("hex");

  const compilerVersion = artifact.sourceName
    ? (await artifacts.getBuildInfo(artifact.sourceName, artifact.contractName))
        ?.solcLongVersion ?? "unknown"
    : "unknown";

  const version = await audit.VERSION();

  // Printed for the artifact record. The deployer address is public
  // information; the key that produced it is never touched here.
  console.log(`network: ${network.name}`);
  console.log(`version: ${version}`);
  console.log(`txHash:  ${txHash}`);
  console.log(`CryptaraAudit deployed to ${address}`);

  const record = {
    contract: "CryptaraAudit",
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    address,
    txHash,
    deployer,
    blockNumber,
    compilerVersion,
    bytecodeHash,
    version: version.toString(),
    timestamp: new Date().toISOString(),
  };

  const outDir = join(__dirname, "..", "..", "..", "docs", "deployments");
  mkdirSync(outDir, { recursive: true });

  const base = `${network.name}-CryptaraAudit`;
  writeFileSync(
    join(outDir, `${base}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );

  const markdown = [
    `# CryptaraAudit — ${network.name}`,
    "",
    `- **Contract:** ${record.contract}`,
    `- **Network:** ${record.network} (chainId ${record.chainId})`,
    `- **Address:** \`${record.address}\``,
    `- **Tx Hash:** \`${record.txHash}\``,
    `- **Deployer:** \`${record.deployer}\``,
    `- **Block Number:** ${record.blockNumber ?? "unknown"}`,
    `- **Compiler Version:** ${record.compilerVersion}`,
    `- **Bytecode SHA-256:** \`${record.bytecodeHash}\``,
    `- **Version:** ${record.version}`,
    `- **Timestamp:** ${record.timestamp}`,
    "",
  ].join("\n");

  writeFileSync(join(outDir, `${base}.md`), markdown);

  console.log(`Deployment record written to docs/deployments/${base}.{json,md}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
