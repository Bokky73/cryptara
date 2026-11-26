import { readFile } from "node:fs/promises";

const requiredRoutes = [
  "src/app/api/watchlist/route.ts",
  "src/app/api/watchlist/[id]/route.ts",
  "src/app/api/rules/route.ts",
  "src/app/api/execute/prepare/route.ts",
  "src/app/api/execute/submit/route.ts",
  "src/app/api/auto-mode/authorization/route.ts",
  "src/app/api/recovery/route.ts",
  // Issue #36: revoke is a mutating wallet-session endpoint that must
  // require an authenticated session; listed here so coverage-check
  // catches any regression that removes the session guard.
  "src/app/api/wallet-session/revoke/route.ts",
];

const root = new URL("../", import.meta.url);
const missing: string[] = [];
async function main() {
  for (const relative of requiredRoutes) {
    try {
      const source = await readFile(new URL(relative, root), "utf8");
      // Routes must declare a capability constant AND call a capability or
      // session-enforcement function. `resolveWalletSession` / `readWalletSessionCookie`
      // are accepted for session-scoped routes (e.g. wallet-session/revoke) that
      // authenticate via the HttpOnly cookie rather than a named capability.
      const hasCapabilityDecl = /AUTHZ_CAPABILITY\s*=/.test(source);
      const hasCapabilityEnforcement = /withCapability|evaluateCapability|resolveWalletSession|readWalletSessionCookie/.test(source);
      if (!hasCapabilityDecl || !hasCapabilityEnforcement) missing.push(relative);
    } catch {
      missing.push(relative);
    }
  }

  if (missing.length > 0) {
    console.error(`Authorization declarations missing:\n${missing.join("\n")}`);
    process.exit(1);
  }
  console.log(`Authorization coverage OK (${requiredRoutes.length} wallet/mutating routes).`);
}

void main();
