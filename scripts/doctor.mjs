import { execSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import net from "node:net";

console.log("=> Running Cryptara environment doctor...\n");

let errors = 0;
let warnings = 0;

function report(status, message, resolution = null) {
  if (status === "OK") {
    console.log(`[ OK ] ${message}`);
  } else if (status === "WARN") {
    warnings++;
    console.warn(`[WARN] ${message}`);
    if (resolution) console.warn(`       Resolution: ${resolution}`);
  } else {
    errors++;
    console.error(`[FAIL] ${message}`);
    if (resolution) console.error(`       Resolution: ${resolution}`);
  }
}

// 1. Node version
if (!process.version.startsWith("v22.")) {
  report("FAIL", `Node version is ${process.version}`, "Use NVM or install Node.js v22.x");
} else {
  report("OK", `Node version is ${process.version}`);
}

// 2. Rust & Stellar CLI
try {
  const rustc = execSync("rustc --version").toString().trim();
  report("OK", `Rust compiler found: ${rustc}`);
} catch {
  report("FAIL", "Rust compiler (rustc) not found", "Install Rust from https://rustup.rs/");
}

try {
  const stellarCli = execSync("stellar --version").toString().trim();
  report("OK", `Stellar CLI found: ${stellarCli.split("\n")[0]}`);
} catch {
  report("FAIL", "Stellar CLI not found", "Run `cargo install --locked stellar-cli`");
}

// 3. Environment Config
if (!fs.existsSync("frontend/.env")) {
  report("FAIL", "frontend/.env is missing", "Copy frontend/.env.example to frontend/.env");
} else {
  report("OK", "frontend/.env exists");
  
  const envContent = fs.readFileSync("frontend/.env", "utf8");
  if (!envContent.includes("DATABASE_URL")) {
    report("WARN", "DATABASE_URL is missing in .env", "Add connection string to enable durable storage (or use in-memory dev mode)");
  }
}

console.log("");
if (errors > 0) {
  console.error(`=> Doctor found ${errors} error(s) and ${warnings} warning(s). Environment is NOT safe.`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`=> Doctor found 0 errors and ${warnings} warning(s). Environment may be safe but degraded.`);
} else {
  console.log("=> Doctor passed! Environment looks healthy.");
}
