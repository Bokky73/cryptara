#!/usr/bin/env node

/**
 * scripts/doctor.mjs
 *
 * Environment doctor verifying local runtime prerequisites for Cryptara:
 * - Node.js >= 22
 * - npm >= 10
 * - Rust & cargo (optional warning if missing)
 * - Stellar CLI (optional warning if missing)
 */

import { execSync } from 'child_process';

console.log('Cryptara Environment Doctor\n============================');

let allPassed = true;

// 1. Node.js Check
const nodeVer = process.version;
const major = parseInt(nodeVer.slice(1).split('.')[0], 10);
if (major >= 22) {
  console.log(`[PASS] Node.js version ${nodeVer} satisfies >= v22.0.0`);
} else {
  console.log(`[FAIL] Node.js version ${nodeVer} is below required v22.0.0`);
  allPassed = false;
}

// 2. npm Check
try {
  const npmVer = execSync('npm -v', { encoding: 'utf8' }).trim();
  console.log(`[PASS] npm version ${npmVer} detected`);
} catch (e) {
  console.log(`[FAIL] npm executable not found`);
  allPassed = false;
}

// 3. Rust Check
try {
  const rustVer = execSync('rustc --version', { encoding: 'utf8' }).trim();
  console.log(`[PASS] Rust compiler detected: ${rustVer}`);
} catch (e) {
  console.log(`[WARN] Rust compiler not found (required for Soroban contract builds)`);
}

// 4. Stellar CLI Check
try {
  const stellarVer = execSync('stellar --version', { encoding: 'utf8' }).trim();
  console.log(`[PASS] Stellar CLI detected: ${stellarVer}`);
} catch (e) {
  console.log(`[WARN] Stellar CLI not found (required for Soroban deployment/archival)`);
// 3. Docker availability
try {
  const dockerVersion = execSync("docker --version 2>&1").toString().trim();
  report("OK", `Docker found: ${dockerVersion}`);

  // Check Docker daemon is reachable
  try {
    execSync("docker info --format '{{.ServerVersion}}' 2>&1", { timeout: 5000 });
    report("OK", "Docker daemon is running");
  } catch {
    report("WARN", "Docker is installed but the daemon is not running",
      "Start Docker Desktop or run `sudo systemctl start docker`");
  }
} catch {
  report("WARN", "Docker not found — containerized local stack unavailable",
    "Install Docker from https://docs.docker.com/get-docker/ then run `docker compose up -d postgres`");
}

// 4. Postgres connectivity (port 5432 on localhost)
await new Promise((resolve) => {
  const socket = new net.Socket();
  const timeout = 2000;
  socket.setTimeout(timeout);
  socket.on("connect", () => {
    socket.destroy();
    report("OK", "Postgres port 5432 is reachable on localhost");
    resolve();
  });
  socket.on("timeout", () => {
    socket.destroy();
    report("WARN", "Postgres port 5432 is not reachable on localhost",
      "Run `docker compose up -d postgres` or start a local Postgres 16 instance");
    resolve();
  });
  socket.on("error", () => {
    socket.destroy();
    report("WARN", "Postgres port 5432 is not reachable on localhost",
      "Run `docker compose up -d postgres` or start a local Postgres 16 instance");
    resolve();
  });
  socket.connect(5432, "127.0.0.1");
});

// 5. Environment Config
if (!fs.existsSync("frontend/.env")) {
  report("FAIL", "frontend/.env is missing", "Copy frontend/.env.example to frontend/.env");
} else {
  report("OK", "frontend/.env exists");
  
  const envContent = fs.readFileSync("frontend/.env", "utf8");
  if (!envContent.includes("DATABASE_URL")) {
    report("WARN", "DATABASE_URL is missing in .env", "Add connection string to enable durable storage (or use in-memory dev mode)");
  }
}

console.log('\n============================');
if (allPassed) {
  console.log('✓ Environment ready for Cryptara development!');
  process.exit(0);
} else {
  console.log('✗ Missing required prerequisites.');
  process.exit(1);
}
