#!/usr/bin/env node

/**
 * Hash-Freeze Build Script
 *
 * Produces a canonical provenance manifest for Hardhat EVM bytecode and
 * Soroban WASM release artifacts. Paths are always repo-relative.
 *
 * Usage:
 *   node scripts/hash-freeze-build.mjs [--write] [--release] [--manifest-dir ./release-manifests]
 *
 * --release refuses dirty trees, unlocked installs, incompatible settings,
 * and missing artifacts. Non-release manifests are always releaseApproved=false.
 */

import { createHash } from "node:crypto";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED = {
  solidity: "0.8.24",
  evmVersion: "paris",
  optimizerRuns: 200,
  viaIR: true,
  sorobanSdk: "=26.0.1",
  wasmTarget: "wasm32v1-none",
  stellarCliMajorMinor: "26.1",
};

const EVM_ARTIFACTS = [
  {
    name: "EVM CryptaraPolicy",
    path: "backend/contracts/artifacts/contracts/CryptaraPolicy.sol/CryptaraPolicy.json",
  },
  {
    name: "EVM CryptaraVault",
    path: "backend/contracts/artifacts/contracts/CryptaraVault.sol/CryptaraVault.json",
  },
  {
    name: "EVM CryptaraAudit",
    path: "backend/contracts/artifacts/contracts/CryptaraAudit.sol/CryptaraAudit.json",
  },
];

const SOROBAN_ARTIFACTS = [
  {
    name: "Soroban Policy WASM",
    path: "soroban/target/wasm32v1-none/release/cryptara_policy.wasm",
  },
  {
    name: "Soroban Vault WASM",
    path: "soroban/target/wasm32v1-none/release/cryptara_vault.wasm",
  },
  {
    name: "Soroban Risk Registry WASM",
    path: "soroban/target/wasm32v1-none/release/cryptara_risk_registry.wasm",
  },
  {
    name: "Soroban Audit Registry WASM",
    path: "soroban/target/wasm32v1-none/release/cryptara_audit_registry.wasm",
  },
];

const INPUT_FILES = [
  { name: "EVM Hardhat Config", path: "backend/contracts/hardhat.config.ts" },
  { name: "EVM Policy Source", path: "backend/contracts/contracts/CryptaraPolicy.sol" },
  { name: "EVM Vault Source", path: "backend/contracts/contracts/CryptaraVault.sol" },
  { name: "EVM Audit Source", path: "backend/contracts/contracts/CryptaraAudit.sol" },
  { name: "Soroban Cargo Manifest", path: "soroban/Cargo.toml" },
  { name: "Soroban Cargo Lock", path: "soroban/Cargo.lock" },
  { name: "Contracts package-lock", path: "backend/contracts/package-lock.json" },
];

function fail(message) {
  console.error(`hash-freeze-build: ${message}`);
  process.exit(1);
}

function sha256Buffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function hashFile(relPath) {
  const full = join(ROOT, relPath);
  if (!existsSync(full)) return null;
  return sha256Buffer(readFileSync(full));
}

function normalizeBytecode(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
  return Buffer.from(hex, "hex");
}

function hashEvmArtifact(relPath) {
  const full = join(ROOT, relPath);
  if (!existsSync(full)) {
    return {
      path: relPath,
      kind: "evm-bytecode",
      status: "missing",
      creationBytecodeSha256: null,
      deployedBytecodeSha256: null,
      metadataSha256: null,
      abiSha256: null,
    };
  }

  const artifact = JSON.parse(readFileSync(full, "utf8"));
  const creation = normalizeBytecode(artifact.bytecode);
  const deployed = normalizeBytecode(artifact.deployedBytecode);
  const metadata =
    typeof artifact.metadata === "string"
      ? artifact.metadata
      : artifact.metadata
        ? JSON.stringify(artifact.metadata)
        : null;

  return {
    path: relPath,
    kind: "evm-bytecode",
    status: "found",
    creationBytecodeSha256: creation ? sha256Buffer(creation) : null,
    deployedBytecodeSha256: deployed ? sha256Buffer(deployed) : null,
    metadataSha256: metadata ? sha256Buffer(Buffer.from(metadata, "utf8")) : null,
    abiSha256: sha256Buffer(Buffer.from(JSON.stringify(artifact.abi ?? []), "utf8")),
  };
}

function hashWasmArtifact(relPath) {
  const full = join(ROOT, relPath);
  if (!existsSync(full)) {
    return { path: relPath, kind: "soroban-wasm", status: "missing", sha256: null };
  }
  return {
    path: relPath,
    kind: "soroban-wasm",
    status: "found",
    sha256: sha256Buffer(readFileSync(full)),
  };
}

function gitCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return process.env.GIT_COMMIT || "unknown";
  }
}

function gitIsDirty() {
  try {
    return execSync("git status --porcelain", { cwd: ROOT, encoding: "utf8" }).trim().length > 0;
  } catch {
    return true;
  }
}

function readText(relPath) {
  return readFileSync(join(ROOT, relPath), "utf8");
}

function validateHardhatSettings() {
  const text = readText("backend/contracts/hardhat.config.ts");
  const problems = [];
  if (!text.includes('version: "0.8.24"') && !text.includes("version: '0.8.24'")) {
    problems.push("solidity version is not pinned to 0.8.24");
  }
  if (!/evmVersion:\s*["']paris["']/.test(text)) {
    problems.push('evmVersion is not pinned to "paris"');
  }
  if (!/viaIR:\s*true/.test(text)) {
    problems.push("viaIR is not enabled");
  }
  if (!/runs:\s*200/.test(text)) {
    problems.push("optimizer runs is not 200");
  }
  return problems;
}

function validateSorobanSettings() {
  const text = readText("soroban/Cargo.toml");
  const problems = [];
  if (!text.includes('soroban-sdk = "=26.0.1"') && !text.includes("soroban-sdk = '=26.0.1'")) {
    problems.push("soroban-sdk is not pinned to =26.0.1");
  }
  if (!/opt-level\s*=\s*"z"/.test(text)) {
    problems.push('release opt-level is not "z"');
  }
  if (!/lto\s*=\s*true/.test(text)) {
    problems.push("release lto is not true");
  }
  return problems;
}

function lockedInstallOk() {
  const contractsLock = existsSync(join(ROOT, "backend/contracts/package-lock.json"));
  const cargoLock = existsSync(join(ROOT, "soroban/Cargo.lock"));
  const rootLock = existsSync(join(ROOT, "package-lock.json"));
  return contractsLock && cargoLock && rootLock;
}

function stellarCliCompatible() {
  const result = spawnSync("stellar", ["--version"], { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    return { ok: false, version: null, detail: "stellar CLI unavailable" };
  }
  const line = (result.stdout || "").trim().split("\n")[0] || "";
  const match = line.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return { ok: false, version: line || null, detail: "could not parse stellar CLI version" };
  }
  const version = `${match[1]}.${match[2]}.${match[3]}`;
  const ok = `${match[1]}.${match[2]}` === EXPECTED.stellarCliMajorMinor;
  return {
    ok,
    version,
    detail: ok ? null : `expected stellar CLI ${EXPECTED.stellarCliMajorMinor}.x, found ${version}`,
  };
}

function assertNoSecrets(manifest) {
  const blob = JSON.stringify(manifest);
  const patterns = [
    /-----BEGIN[ A-Z]*PRIVATE KEY-----/,
    /["']0x[a-fA-F0-9]{64}["']/,
    /S[A-Z2-7]{55}/,
    /(api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']+["']/i,
    /https?:\/\/[^/\s]+:[^/@\s]+@/i,
    /\/Users\/[^"'\s]+/,
    /\/home\/[^"'\s]+/,
  ];
  for (const pattern of patterns) {
    if (pattern.test(blob)) {
      fail(`manifest failed secret/path scan (${pattern})`);
    }
  }
  for (const item of [...manifest.inputs, ...manifest.artifacts]) {
    if (item.path.startsWith("/") || /^[A-Za-z]:\\/.test(item.path)) {
      fail(`absolute path is not allowed in manifest: ${item.path}`);
    }
  }
}

function repoRelative(absOrRel) {
  const abs = resolve(ROOT, absOrRel);
  const rel = relative(ROOT, abs).replaceAll("\\", "/");
  if (rel.startsWith("..")) {
    fail(`path escapes repository root: ${absOrRel}`);
  }
  return rel;
}

function main() {
  const args = process.argv.slice(2);
  const shouldWrite = args.includes("--write");
  const isRelease = args.includes("--release");
  const manifestDir = args.includes("--manifest-dir")
    ? args[args.indexOf("--manifest-dir") + 1]
    : "./release-manifests";

  const isDirty = gitIsDirty();
  const hardhatProblems = validateHardhatSettings();
  const sorobanProblems = validateSorobanSettings();
  const locked = lockedInstallOk();
  const stellar = stellarCliCompatible();

  if (isRelease && isDirty) {
    fail("cannot produce a release-approved manifest from a dirty git tree");
  }
  if (isRelease && !locked) {
    fail("cannot produce a release-approved manifest without package-lock.json and Cargo.lock");
  }
  if (isRelease && hardhatProblems.length > 0) {
    fail(`incompatible Hardhat settings: ${hardhatProblems.join("; ")}`);
  }
  if (isRelease && sorobanProblems.length > 0) {
    fail(`incompatible Soroban settings: ${sorobanProblems.join("; ")}`);
  }
  if (isRelease && process.env.SKIP_STELLAR_CLI_CHECK !== "1" && !stellar.ok) {
    fail(`incompatible or missing Stellar CLI: ${stellar.detail}`);
  }

  const artifacts = [
    ...EVM_ARTIFACTS.map((item) => ({ name: item.name, ...hashEvmArtifact(item.path) })),
    ...SOROBAN_ARTIFACTS.map((item) => ({ name: item.name, ...hashWasmArtifact(item.path) })),
  ];

  if (isRelease) {
    const missing = artifacts.filter((a) => a.status === "missing");
    if (missing.length > 0) {
      fail(`release artifacts missing:\n${missing.map((m) => `  - ${m.name} (${m.path})`).join("\n")}`);
    }
    const incompleteEvm = artifacts.filter(
      (a) => a.kind === "evm-bytecode" && (!a.creationBytecodeSha256 || !a.metadataSha256),
    );
    if (incompleteEvm.length > 0) {
      fail(`EVM artifacts missing creation bytecode or metadata hash:\n${incompleteEvm.map((m) => `  - ${m.name}`).join("\n")}`);
    }
  }

  const releaseApproved =
    isRelease &&
    !isDirty &&
    locked &&
    hardhatProblems.length === 0 &&
    sorobanProblems.length === 0 &&
    (process.env.SKIP_STELLAR_CLI_CHECK === "1" || stellar.ok);

  const manifest = {
    schemaVersion: 1,
    kind: "contract-artifact-provenance",
    timestamp: new Date().toISOString(),
    commit: gitCommit(),
    isDirty,
    releaseApproved,
    networkTarget: "unspecified",
    build: {
      evmCommand: "./scripts/build-evm.sh",
      sorobanCommand: "./scripts/build-soroban.sh",
    },
    tools: {
      solidity: EXPECTED.solidity,
      evmVersion: EXPECTED.evmVersion,
      viaIR: EXPECTED.viaIR,
      optimizer: { enabled: true, runs: EXPECTED.optimizerRuns },
      sorobanSdk: EXPECTED.sorobanSdk,
      wasmTarget: EXPECTED.wasmTarget,
      stellarCli: stellar.version,
      node: process.version,
    },
    settingsChecks: {
      hardhatOk: hardhatProblems.length === 0,
      sorobanOk: sorobanProblems.length === 0,
      lockedInstall: locked,
      hardhatProblems,
      sorobanProblems,
    },
    inputs: INPUT_FILES.map((input) => ({
      name: input.name,
      path: input.path,
      sha256: hashFile(input.path),
    })),
    artifacts,
  };

  assertNoSecrets(manifest);

  const output = `${JSON.stringify(manifest, null, 2)}\n`;

  if (shouldWrite) {
    const outDir = resolve(ROOT, manifestDir);
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `build-manifest-${stamp}.json`;
    const outPath = join(outDir, filename);
    const latestPath = join(outDir, "latest.json");
    writeFileSync(outPath, output, "utf8");
    writeFileSync(latestPath, output, "utf8");
    console.log(`Manifest written to ${repoRelative(outPath)}`);
    console.log(`Latest pointer written to ${repoRelative(latestPath)}`);
    console.log(`releaseApproved=${releaseApproved}`);
  } else {
    process.stdout.write(output);
  }

  if (isRelease && !releaseApproved) {
    fail("release mode requested but manifest is not release-approved");
  }
}

main();
