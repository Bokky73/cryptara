#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(root, "artifacts", "sbom");
mkdirSync(outputDirectory, { recursive: true });

function generateNpmSbom(name, directory) {
  const output = join(outputDirectory, `${name}.cdx.json`);
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(directory, "package-lock.json"), "utf8"));
  const components = Object.entries(lock.packages || {})
    .filter(([path, pkg]) => path && path.includes("node_modules/") && pkg.version)
    .map(([path, pkg]) => {
      const packagePath = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      const packageName = packagePath.startsWith("@") ? packagePath.split("/").slice(0, 2).join("/") : packagePath.split("/")[0];
      const purl = `pkg:npm/${encodeURIComponent(packageName)}@${pkg.version}`;
      return {
        type: "library",
        "bom-ref": `${purl}?path=${encodeURIComponent(path)}`,
        name: packageName,
        version: pkg.version,
        purl,
        licenses: [{ expression: pkg.license || "NOASSERTION" }],
        ...(pkg.integrity ? { hashes: [{ alg: "SHA-512", content: pkg.integrity.replace(/^sha512-/, "") }] } : {}),
        properties: [
          { name: "cryptara:npm:path", value: path },
          { name: "cryptara:npm:development", value: String(pkg.dev === true) },
          { name: "cryptara:npm:optional", value: String(pkg.optional === true) }
        ]
      };
    })
    .sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
  const serial = createHash("sha256").update(`${name}:${lock.lockfileVersion}:${components.length}`).digest("hex").slice(0, 32);
  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${serial.slice(0, 8)}-${serial.slice(8, 12)}-4${serial.slice(13, 16)}-8${serial.slice(17, 20)}-${serial.slice(20)}`,
    version: 1,
    metadata: { component: { type: "application", name: manifest.name || name, version: manifest.version || "0.0.0" } },
    components
  };
  writeFileSync(output, `${JSON.stringify(bom, null, 2)}\n`);
  return output;
}

function generateCargoSbom() {
  const lockText = readFileSync(join(root, "soroban", "Cargo.lock"), "utf8");
  const packages = lockText.split("[[package]]").slice(1).map((block) => {
    const field = (name) => block.match(new RegExp(`^${name} = \\\"([^\\\"]+)\\\"`, "m"))?.[1];
    return { name: field("name"), version: field("version"), source: field("source"), checksum: field("checksum") };
  }).filter((pkg) => pkg.name && pkg.version).sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  const components = packages.map((pkg) => ({
    type: "library",
    "bom-ref": `pkg:cargo/${encodeURIComponent(pkg.name)}@${pkg.version}`,
    name: pkg.name,
    version: pkg.version,
    purl: `pkg:cargo/${encodeURIComponent(pkg.name)}@${pkg.version}`,
    licenses: [{ expression: "NOASSERTION" }],
    ...(pkg.checksum ? { hashes: [{ alg: "SHA-256", content: pkg.checksum }] } : {}),
    ...(pkg.source ? { properties: [{ name: "cryptara:cargo:source", value: pkg.source }] } : {})
  }));
  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "urn:uuid:00000000-0000-4000-8000-000000000104",
    version: 1,
    metadata: { component: { type: "application", name: "cryptara-soroban", version: "0.1.0" } },
    components
  };
  const output = join(outputDirectory, "soroban.cdx.json");
  writeFileSync(output, `${JSON.stringify(bom, null, 2)}\n`);
  return output;
}

const outputs = [
  generateNpmSbom("frontend", join(root, "frontend")),
  generateNpmSbom("evm", join(root, "backend", "contracts")),
  generateCargoSbom()
];

for (const output of outputs) {
  const parsed = JSON.parse(readFileSync(output, "utf8"));
  if (parsed.bomFormat !== "CycloneDX" || !Array.isArray(parsed.components)) {
    throw new Error(`Invalid CycloneDX output: ${output}`);
  }
  console.log(`SBOM: ${output.slice(root.length + 1)} (${parsed.components.length} components)`);
}
