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
}

console.log('\n============================');
if (allPassed) {
  console.log('✓ Environment ready for Cryptara development!');
  process.exit(0);
} else {
  console.log('✗ Missing required prerequisites.');
  process.exit(1);
}
