import { execSync } from "node:child_process";
import fs from "node:fs";

console.log("=> Bootstrapping Cryptara environment...");

const nodeVersion = process.version;
if (!nodeVersion.startsWith("v22.")) {
  console.error(`[ERROR] Expected Node.js v22.x, found ${nodeVersion}`);
  process.exit(1);
}

try {
  console.log("=> Installing root dependencies (locked)...");
  execSync("npm ci", { stdio: "inherit" });

  console.log("=> Installing frontend dependencies (locked)...");
  execSync("npm ci --prefix frontend", { stdio: "inherit" });

  if (!fs.existsSync("frontend/.env")) {
    console.log("=> Copying frontend/.env.example to frontend/.env...");
    fs.copyFileSync("frontend/.env.example", "frontend/.env");
  }

  console.log("=> Bootstrap complete! You can now run `npm run doctor` to verify environment readiness.");
} catch (error) {
  console.error("[ERROR] Bootstrap failed.");
  process.exit(1);
}
