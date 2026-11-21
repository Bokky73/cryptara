import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = ["frontend/src/app", "frontend/src/components", "frontend/src/server"];
const roadmapFile = "PROJECT_ROADMAP.md";
const requiredFiles = [
  roadmapFile,
  "frontend/src/server/cache/strategy.ts",
  "frontend/src/server/env/validation.ts",
  "frontend/src/server/security/policy.ts",
  "frontend/src/server/security/rateLimit.ts",
  "frontend/src/server/security/inputValidation.ts",
  "frontend/src/server/security/urlSafety.ts",
  "frontend/src/server/observability/logging.ts",
  "frontend/src/server/observability/metrics.ts",
  "frontend/src/server/observability/health.ts",
  "frontend/src/server/observability/alerts.ts",
  "frontend/src/server/evaluation/goldenFixtures.ts",
  "frontend/src/server/evaluation/properties.ts",
  "frontend/src/server/evaluation/replay.ts",
  "frontend/src/server/storage/index.ts",
  "frontend/src/server/storage/schema.sql",
  "frontend/src/server/x402/config.ts",
  "frontend/src/server/x402/guards.ts",
  "frontend/src/server/x402/server.ts",
  "frontend/src/app/api/x402/deep-scan/route.ts",
  "frontend/src/server/agents/execution/policy.ts",
  "frontend/src/app/api/health/route.ts",
  "frontend/src/app/api/history/agent-runs/route.ts",
  "frontend/src/app/api/history/agent-runs/[id]/route.ts",
  "frontend/src/app/api/history/approvals/route.ts",
  "frontend/src/app/api/history/recommendations/route.ts",
  "frontend/src/app/operations/page.tsx",
  "frontend/src/server/features/types.ts",
  "frontend/src/server/features/registry.ts",
  "frontend/src/server/features/evaluator.ts",
  "frontend/src/server/features/audit.ts",
  "frontend/src/components/FeatureGateNotice.tsx",
  "frontend/scripts/feature-flag-check.ts",
  "docs/FEATURE_FLAGS.md",
];
const requiredReleaseMarkers = [
  "V1 Definition of Done",
  "Supabase",
  "Incident response",
  "Known limitations",
  "First 24",
  "Production env",
  "Smoke test",
  "Rollback",
  "V2 Definition of Done",
  "V3 Definition of Done",
];
// The `sk-` and `cqt_` prefixes are only credentials when they start a token.
// Without the lookbehind they also match inside ordinary identifiers such as
// `risk-snapshots`, `task-status` or the `rsk-mainnet` chain id.
const secretPattern =
  /(API_KEY=(?!\s|$)|(?<![A-Za-z0-9])cqt_[A-Za-z0-9]|(?<![A-Za-z0-9])sk-[A-Za-z0-9]|Bearer [A-Za-z0-9_\-]{16,}|0x[a-fA-F0-9]{64})/;
// Public constants (event topic hashes, padded word values) are indistinguishable
// from a 32-byte key by shape alone, so they opt out per line instead of
// disabling the whole file.
const secretAllowMarker = "deploy-readiness-allow-secret";
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const hostedProductionDeploy = process.env.VERCEL_ENV === "production";
const strictProductionDeploy =
  process.env.PRODUCTION_DEPLOY === "1" ||
  process.env.RELEASE_TARGET === "production" ||
  process.env.STRICT_PRODUCTION_DEPLOY === "1";

function fail(message) {
  console.error(`deploy-readiness: ${message}`);
  process.exitCode = 1;
}

function warn(message) {
  console.warn(`deploy-readiness warning: ${message}`);
}

function walk(dir) {
  const absoluteDir = join(root, dir);

  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir).flatMap((entry) => {
    const absolutePath = join(absoluteDir, entry);
    const relativePath = relative(root, absolutePath);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      return walk(relativePath);
    }

    return sourceExtensions.has(extname(entry)) ? [relativePath] : [];
  });
}

function checkRequiredFiles() {
  for (const file of requiredFiles) {
    if (!existsSync(join(root, file))) {
      fail(`required source file is missing: ${file}`);
    }
  }
}

function checkIgnoredSourceFiles() {
  const files = requiredFiles.filter((file) => existsSync(join(root, file)));

  if (files.length === 0) {
    return;
  }

  const result = spawnSync("git", ["check-ignore", ...files], {
    cwd: root,
    encoding: "utf8",
  });

  if (result.status === 0 && result.stdout.trim()) {
    fail(`required source file is ignored by git: ${result.stdout.trim().replaceAll("\n", ", ")}`);
  }
}

function checkPathAliases() {
  const files = sourceRoots.flatMap(walk);
  const importPattern = /from\s+["']@\/([^"']+)["']|import\(["']@\/([^"']+)["']\)/g;

  for (const file of files) {
    const content = readFileSync(join(root, file), "utf8");

    for (const match of content.matchAll(importPattern)) {
      const target = match[1] || match[2];
      const candidateBase = join(root, "frontend/src", target);
      const candidates = [
        candidateBase,
        `${candidateBase}.ts`,
        `${candidateBase}.tsx`,
        `${candidateBase}.js`,
        `${candidateBase}.jsx`,
        join(candidateBase, "index.ts"),
        join(candidateBase, "index.tsx"),
      ];

      if (!candidates.some(existsSync)) {
        fail(`${file} imports missing alias module @/${target}`);
      }
    }
  }
}

function checkSecrets() {
  const files = sourceRoots
    .flatMap(walk)
    .concat([roadmapFile, "package.json", "frontend/package.json"])
    .filter((file) => existsSync(join(root, file)));

  for (const file of files) {
    const lines = readFileSync(join(root, file), "utf8").split("\n");

    for (const [index, line] of lines.entries()) {
      if (line.includes(secretAllowMarker)) {
        continue;
      }

      const match = line.match(secretPattern);

      if (match) {
        fail(`possible secret-like value found in ${file}:${index + 1}: ${match[0]}`);
      }
    }
  }
}

function checkReleaseDocs() {
  const combinedDocs = existsSync(join(root, roadmapFile))
    ? readFileSync(join(root, roadmapFile), "utf8").toLowerCase()
    : "";

  for (const marker of requiredReleaseMarkers) {
    if (!combinedDocs.includes(marker.toLowerCase())) {
      fail(`release readiness docs are missing required marker: ${marker}`);
    }
  }
}

function checkVercelBuildGate() {
  const file = "vercel.json";
  if (!existsSync(join(root, file))) {
    fail(`missing Vercel config: ${file}`);
    return;
  }

  const content = readFileSync(join(root, file), "utf8");

  if (!content.includes("deploy:check")) {
    fail(`${file} buildCommand must run deploy:check before build`);
  }
}

function checkProductionEnvironment() {
  if (!hostedProductionDeploy && !strictProductionDeploy) {
    return;
  }

  const requiredEnv = [
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GOAT_RPC_URL",
  ];
  const missing = requiredEnv.filter((key) => !process.env[key]);
  const goPlusConfigured = Boolean(process.env.GOPLUS_API_KEY || (process.env.GOPLUS_APP_KEY && process.env.GOPLUS_APP_SECRET));
  const portfolioProviderConfigured = Boolean(process.env.GOAT_RPC_URL || process.env.GOLDRUSH_API_KEY || process.env.COVALENT_API_KEY || process.env.ALCHEMY_API_KEY);
  const socialProviderConfigured = Boolean(
    process.env.SOCIAL_DATA_PROVIDER_URL ||
      process.env.APIFY_TOKEN ||
      process.env.TAVILY_API_KEY ||
      process.env.X_BEARER_TOKEN,
  );
  const requiredX402Env = ["X402_PAY_TO", "X402_PRICE_USD", "X402_NETWORK", "X402_FACILITATOR_URL"];
  const missingX402 = requiredX402Env.filter((key) => !process.env[key]);
  const cdpFacilitator = process.env.X402_FACILITATOR_URL?.includes("api.cdp.coinbase.com");
  const cdpAuthConfigured = Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
  const productionFailure = hostedProductionDeploy || strictProductionDeploy;

  if (missing.length > 0) {
    const message = `production deploy env is incomplete: ${missing.join(", ")}`;

    productionFailure ? fail(message) : warn(message);
  }

  if (!goPlusConfigured) {
    const message = "production deploy requires GOPLUS_API_KEY or both GOPLUS_APP_KEY and GOPLUS_APP_SECRET for Contract Guard security checks";

    productionFailure ? fail(message) : warn(message);
  }

  if (!portfolioProviderConfigured) {
    const message = "production deploy requires GOAT_RPC_URL or at least one portfolio provider key: GOLDRUSH_API_KEY, COVALENT_API_KEY, or ALCHEMY_API_KEY";

    productionFailure ? fail(message) : warn(message);
  }

  if (!socialProviderConfigured) {
    warn("social provider key is not configured; V1 Social Agent will run in metadata-only mode and will not generate fake follower, engagement, or bot scores");
  }

  if (missingX402.length > 0) {
    const message = `production x402 env is incomplete: ${missingX402.join(", ")}`;

    productionFailure ? fail(message) : warn(message);
  }

  if (process.env.X402_NETWORK !== "eip155:8453") {
    const message = "production x402 must use Base mainnet network eip155:8453";

    productionFailure ? fail(message) : warn(message);
  }

  if (!cdpFacilitator) {
    const message = "production x402 must use the CDP facilitator at https://api.cdp.coinbase.com/platform/v2/x402";

    productionFailure ? fail(message) : warn(message);
  }

  if (!cdpAuthConfigured) {
    const message = "production CDP x402 requires CDP_API_KEY_ID and CDP_API_KEY_SECRET";

    productionFailure ? fail(message) : warn(message);
  }

  if (process.env.NEXT_PUBLIC_APP_URL?.includes("localhost")) {
    const message = "production deploy NEXT_PUBLIC_APP_URL must not point to localhost";

    productionFailure ? fail(message) : warn(message);
  }
}

/**
 * Blocks a pubnet-enabled build whose governance-approved values are absent.
 *
 * The runtime gate already refuses pubnet actions, but a build that ships
 * advertising pubnet and then refuses every action is a broken release, not a
 * safe one. This fails the build instead.
 */
function checkPubnetReadinessGate() {
  const configured = (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "").trim().toLowerCase();
  const pubnetRequested = ["stellar-pubnet", "stellar:pubnet", "pubnet"].includes(configured);

  if (!pubnetRequested) {
    return;
  }

  const approvedEnv = [
    "STELLAR_PUBNET_APPROVED_REGISTRY_WASM_HASH",
    "STELLAR_PUBNET_APPROVED_REGISTRY_ID",
    "STELLAR_PUBNET_APPROVED_POLICY_ID",
    "STELLAR_PUBNET_APPROVED_X402_PAY_TO",
    "STELLAR_PUBNET_APPROVED_USDC_CONTRACT",
    "STELLAR_PUBNET_APPROVED_FACILITATOR_ORIGIN",
  ];
  const missing = approvedEnv.filter((key) => !process.env[key]?.trim());

  if (missing.length > 0) {
    fail(
      `pubnet is enabled but the governance-approved values are missing: ${missing.join(", ")}. ` +
        "Pubnet moves real user funds and cannot be advertised unverified.",
    );
  }

  const wasmHash = process.env.STELLAR_PUBNET_APPROVED_REGISTRY_WASM_HASH?.trim() ?? "";
  if (wasmHash && !/^[0-9a-f]{64}$/i.test(wasmHash)) {
    fail("STELLAR_PUBNET_APPROVED_REGISTRY_WASM_HASH must be a 64-character SHA-256 hex digest");
  }

  const payTo = process.env.STELLAR_PUBNET_APPROVED_X402_PAY_TO?.trim() ?? "";
  if (payTo && !/^G[A-Z2-7]{55}$/.test(payTo)) {
    fail("STELLAR_PUBNET_APPROVED_X402_PAY_TO must be a valid Stellar account address");
  }

  for (const key of ["STELLAR_PUBNET_APPROVED_REGISTRY_ID", "STELLAR_PUBNET_APPROVED_POLICY_ID", "STELLAR_PUBNET_APPROVED_USDC_CONTRACT"]) {
    const value = process.env[key]?.trim() ?? "";
    if (value && !/^C[A-Z2-7]{55}$/.test(value)) {
      fail(`${key} must be a valid Stellar contract address`);
    }
  }

  const facilitator = process.env.STELLAR_PUBNET_APPROVED_FACILITATOR_ORIGIN?.trim() ?? "";
  if (facilitator && !facilitator.startsWith("https://")) {
    fail("STELLAR_PUBNET_APPROVED_FACILITATOR_ORIGIN must be an HTTPS origin");
  }
}

checkRequiredFiles();
checkIgnoredSourceFiles();
checkPathAliases();
checkSecrets();
checkReleaseDocs();
checkVercelBuildGate();
checkProductionEnvironment();
checkPubnetReadinessGate();

const schema = readFileSync(join(root, "frontend/src/server/storage/schema.sql"), "utf8");
for (const table of ["wallets", "agent_runs", "agent_results", "recommendations", "user_rules", "approvals", "transactions", "x402_payment_receipts", "token_identities", "source_snapshots"]) {
  if (!schema.includes(`create table if not exists ${table}`)) {
    fail(`storage schema is missing table contract: ${table}`);
  }
}

if (!process.exitCode) {
  console.log("deploy-readiness: ok");
}
