#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(root, "artifacts", "provenance");
const [mode, requestedKind, ...artifactArguments] = process.argv.slice(2);
const commands = {
  evm: "./scripts/build-evm.sh",
  soroban: "./scripts/build-soroban.sh"
};

function commandVersion(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim().split("\n")[0] : "unavailable";
}

function digest(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function provenancePath(kind) {
  return join(outputDirectory, `${kind}.provenance.json`);
}

function create(kind, artifacts) {
  if (!commands[kind] || artifacts.length === 0) throw new Error("create requires evm|soroban and at least one artifact");
  mkdirSync(outputDirectory, { recursive: true });
  const git = commandVersion("git", ["rev-parse", "HEAD"]);
  const resolvedArtifacts = artifacts.map((artifact) => isAbsolute(artifact) ? artifact : resolve(process.cwd(), artifact));
  for (const artifact of resolvedArtifacts) if (!existsSync(artifact)) throw new Error(`Artifact not found: ${artifact}`);
  const statement = {
    schemaVersion: 1,
    subject: resolvedArtifacts.map((artifact) => ({ name: relative(root, artifact), digest: { sha256: digest(artifact) } })).sort((a, b) => a.name.localeCompare(b.name)),
    predicate: {
      source: { repository: "https://github.com/Drago-Labs/cryptara", revision: git },
      build: { command: commands[kind], locked: true, networkAccess: false },
      toolchain: kind === "evm"
        ? { node: process.version, npm: commandVersion("npm", ["--version"]), hardhat: commandVersion("npx", ["--no-install", "hardhat", "--version"], join(root, "backend", "contracts")) }
        : { rustc: commandVersion("rustc", ["--version"]), cargo: commandVersion("cargo", ["--version"]), sorobanSdk: "26.0.1" }
    }
  };
  writeFileSync(provenancePath(kind), `${JSON.stringify(statement, null, 2)}\n`);
  console.log(`Provenance created: ${relative(root, provenancePath(kind))}`);
}

function verify(kind) {
  const path = provenancePath(kind);
  if (!existsSync(path)) throw new Error(`Missing provenance manifest: ${path}`);
  const statement = JSON.parse(readFileSync(path, "utf8"));
  const revision = commandVersion("git", ["rev-parse", "HEAD"]);
  if (statement.schemaVersion !== 1 || statement.predicate?.build?.command !== commands[kind] || statement.predicate?.build?.locked !== true) {
    throw new Error(`Invalid ${kind} provenance predicate`);
  }
  if (statement.predicate?.source?.revision !== revision) {
    throw new Error(`${kind} provenance revision does not match checked-out source`);
  }
  for (const subject of statement.subject || []) {
    const artifact = join(root, subject.name);
    if (!existsSync(artifact) || digest(artifact) !== subject.digest?.sha256) throw new Error(`Artifact digest mismatch: ${subject.name}`);
  }
  if (!statement.subject?.length) throw new Error(`${kind} provenance has no subjects`);
  console.log(`Provenance verified: ${kind} (${statement.subject.length} artifacts)`);
}

if (mode === "create") create(requestedKind, artifactArguments);
else if (mode === "verify" && requestedKind === "all") Object.keys(commands).forEach(verify);
else if (mode === "verify" && commands[requestedKind]) verify(requestedKind);
else throw new Error("Usage: verify-build-provenance.mjs create <evm|soroban> <artifacts...> | verify <evm|soroban|all>");
