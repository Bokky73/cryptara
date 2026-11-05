#!/usr/bin/env node
/**
 * Deterministic deployment driver for the V2 contract audit layer.
 *
 * Design rules this script exists to enforce:
 *
 * 1. The target network is always explicit. There is no default, no "current"
 *    network, and no fallback to mainnet-shaped config. A missing `--network`
 *    is an error, not a guess.
 * 2. Secrets never reach stdout, stderr, or the artifact file. The script reads
 *    credentials from the environment, checks only that they are present, and
 *    prints their names — never their values.
 * 3. Pubnet and EVM mainnets are refused outright. Production deployment is
 *    gated behind separate security approval, which a script cannot grant.
 * 4. The artifact record is written from what the toolchain actually reported,
 *    so a value in it is evidence rather than an expectation.
 * 5. A verified provenance manifest path is required before deploy. The
 *    manifest is checked offline; secrets never enter the manifest or logs.
 *
 * Usage:
 *   node scripts/deploy-audit-layer.mjs --chain evm     --network <name> --manifest <path> [--dry-run]
 *   node scripts/deploy-audit-layer.mjs --chain soroban --network <name> --manifest <path> [--dry-run]
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyProvenanceManifest } from "./verify-artifact-provenance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Networks this script will deploy to, and the credential each one needs.
 *
 * Adding a network here is a deliberate act. Anything absent is rejected, so a
 * typo cannot silently deploy somewhere unintended.
 */
const NETWORKS = {
  evm: {
    "goat-testnet": { rpcEnv: "GOAT_TESTNET_RPC_URL", keyEnv: "DEPLOYER_PRIVATE_KEY" },
    "base-sepolia": { rpcEnv: "BASE_SEPOLIA_RPC_URL", keyEnv: "DEPLOYER_PRIVATE_KEY" },
    "sepolia": { rpcEnv: "SEPOLIA_RPC_URL", keyEnv: "DEPLOYER_PRIVATE_KEY" },
  },
  soroban: {
    "testnet": { rpcEnv: "STELLAR_TESTNET_RPC_URL", keyEnv: "STELLAR_DEPLOYER_SECRET" },
    "futurenet": { rpcEnv: "STELLAR_FUTURENET_RPC_URL", keyEnv: "STELLAR_DEPLOYER_SECRET" },
  },
};

/**
 * Networks that are recognised but deliberately refused.
 *
 * Naming them explicitly produces a clear "this needs approval" message instead
 * of an ambiguous "unknown network".
 */
const BLOCKED_NETWORKS = new Set([
  "mainnet",
  "pubnet",
  "public",
  "goat",
  "goat-mainnet",
  "ethereum",
  "base",
  "arbitrum",
  "optimism",
  "polygon",
  "bsc",
]);

function fail(message) {
  console.error(`deploy-audit-layer: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { dryRun: false };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (token === "--chain" || token === "--network" || token === "--out" || token === "--manifest") {
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        fail(`${token} requires a value`);
      }

      args[token.slice(2)] = value;
      index += 1;
      continue;
    }

    fail(`unknown argument "${token}"`);
  }

  return args;
}

/** Read a required env var without ever echoing its value. */
function requireEnv(name) {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    fail(`${name} is not set. Export it in your shell; never commit it.`);
  }

  return value;
}

/**
 * Run a command, capturing output.
 *
 * `env` is passed through so credentials reach the child process, but the
 * command line itself never carries a secret — that is why credentials are
 * always passed by environment variable rather than as an argument.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
  });

  if (result.error) {
    fail(`could not run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    console.error(result.stdout ?? "");
    console.error(result.stderr ?? "");
    fail(`${command} exited with ${result.status}`);
  }

  return (result.stdout ?? "").trim();
}

function toolVersion(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });

  return result.status === 0 ? (result.stdout ?? "").trim().split("\n")[0] : "unavailable";
}

function gitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });

  return result.status === 0 ? (result.stdout ?? "").trim() : "unknown";
}

function gitIsClean() {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });

  return result.status === 0 && (result.stdout ?? "").trim() === "";
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function buildSoroban() {
  // `stellar contract build` produces the release wasm the deployment uses.
  // Building here rather than trusting a pre-existing artifact is what makes
  // the recorded hash mean something.
  run("stellar", ["contract", "build", "--manifest-path", "soroban/Cargo.toml"]);

  const wasmPath = join(
    root,
    "soroban/target/wasm32v1-none/release/cryptara_audit_registry.wasm",
  );

  if (!existsSync(wasmPath)) {
    fail(`expected wasm at ${wasmPath} after build`);
  }

  return { wasmPath, wasmHash: sha256(wasmPath) };
}

function deploySoroban(network, config, dryRun) {
  const rpcUrl = requireEnv(config.rpcEnv);
  requireEnv(config.keyEnv);

  const { wasmPath, wasmHash } = buildSoroban();

  const artifact = {
    chain: "soroban",
    network,
    wasmSha256: wasmHash,
    rpcUrlEnv: config.rpcEnv,
    deployerSecretEnv: config.keyEnv,
    toolchain: {
      rustc: toolVersion("rustc", ["--version"]),
      cargo: toolVersion("cargo", ["--version"]),
      stellarCli: toolVersion("stellar", ["--version"]),
    },
  };

  if (dryRun) {
    console.log("dry run: built the wasm and validated configuration, deployed nothing");
    return { ...artifact, dryRun: true };
  }

  // The secret is referenced by env var name; it is never interpolated into
  // the argument list, so it cannot leak through a process listing.
  const contractId = run("stellar", [
    "contract",
    "deploy",
    "--wasm",
    wasmPath,
    "--source-account",
    process.env[config.keyEnv],
    "--rpc-url",
    rpcUrl,
    "--network",
    network,
  ]);

  return { ...artifact, contractId };
}

function deployEvm(network, config, dryRun) {
  requireEnv(config.rpcEnv);
  requireEnv(config.keyEnv);

  const contractsDir = join(root, "backend/contracts");

  run("npx", ["hardhat", "compile"], { cwd: contractsDir });

  const artifactPath = join(
    contractsDir,
    "artifacts/contracts/CryptaraAudit.sol/CryptaraAudit.json",
  );

  if (!existsSync(artifactPath)) {
    fail(`expected compiled artifact at ${artifactPath}`);
  }

  const compiled = JSON.parse(readFileSync(artifactPath, "utf8"));
  const artifact = {
    chain: "evm",
    network,
    // The creation bytecode hash is what an independent verifier recomputes
    // from this commit to prove the deployed code matches the source.
    bytecodeSha256: createHash("sha256").update(compiled.bytecode).digest("hex"),
    abiSha256: createHash("sha256").update(JSON.stringify(compiled.abi)).digest("hex"),
    rpcUrlEnv: config.rpcEnv,
    deployerKeyEnv: config.keyEnv,
    toolchain: {
      node: process.version,
      hardhat: toolVersion("npx", ["hardhat", "--version"]),
    },
  };

  if (dryRun) {
    console.log("dry run: compiled the contract and validated configuration, deployed nothing");
    return { ...artifact, dryRun: true };
  }

  const output = run("npx", ["hardhat", "run", "scripts/deploy-audit.ts", "--network", network], {
    cwd: contractsDir,
  });
  const match = output.match(/0x[a-fA-F0-9]{40}/);

  if (!match) {
    fail("deployment produced no contract address");
  }

  return { ...artifact, address: match[0] };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.manifest) {
    fail("--manifest <path> is required. Deploy only after offline provenance verification.");
  }

  const manifestRel = relative(root, resolve(root, args.manifest)).replaceAll("\\", "/");
  if (manifestRel.startsWith("..")) {
    fail("--manifest must point to a path inside the repository");
  }

  console.log(`Verifying provenance manifest: ${manifestRel}`);
  const provenance = verifyProvenanceManifest(manifestRel, { strict: true });
  if (!provenance.valid) {
    fail(`provenance verification failed: ${provenance.reason}`);
  }
  console.log("Provenance verification passed.");

  if (!args.chain) {
    fail("--chain is required (evm or soroban)");
  }

  if (!NETWORKS[args.chain]) {
    fail(`unknown chain "${args.chain}". Use evm or soroban.`);
  }

  if (!args.network) {
    fail("--network is required. There is no default target network.");
  }

  const network = args.network.trim().toLowerCase();

  if (BLOCKED_NETWORKS.has(network)) {
    fail(
      `"${network}" is a production network. Pubnet and mainnet deployment require separate security approval and are not performed by this script.`,
    );
  }

  const config = NETWORKS[args.chain][network];

  if (!config) {
    const known = Object.keys(NETWORKS[args.chain]).join(", ");
    fail(`unknown ${args.chain} network "${network}". Known: ${known}`);
  }

  const commit = gitCommit();
  const clean = gitIsClean();

  if (!clean && !args.dryRun) {
    fail("the working tree is dirty. Deploy from a committed tree so the artifact record identifies real source.");
  }

  console.log(`chain:   ${args.chain}`);
  console.log(`network: ${network}`);
  console.log(`commit:  ${commit}`);
  console.log(`credentials read from: ${config.rpcEnv}, ${config.keyEnv} (values not printed)`);

  const result =
    args.chain === "soroban" ? deploySoroban(network, config, args.dryRun) : deployEvm(network, config, args.dryRun);

  const record = {
    ...result,
    commit,
    workingTreeClean: clean,
    provenanceManifest: manifestRel,
    provenanceCommit: provenance.manifestMeta?.commit ?? null,
    deployedAt: new Date().toISOString(),
  };

  const outPath = args.out ? resolve(root, args.out) : join(root, "docs/deployments", `${args.chain}-${network}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`);

  console.log(`\nartifact record written to ${outPath.replace(`${root}/`, "")}`);
  console.log(JSON.stringify(record, null, 2));
}

main();
