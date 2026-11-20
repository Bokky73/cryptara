const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";

const postJson = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const checks = [
  {
    name: "health",
    path: "/api/health",
    init: { method: "GET" },
    validate: (body) => body.ok === true && body.agentReadiness && body.mockFallbacksEnabled === false && body.storage?.schema?.tables?.includes("agent_runs"),
  },
  {
    name: "portfolio endpoint",
    path: "/api/agents/portfolio",
    init: postJson({ walletAddress: "0x0000000000000000000000000000000000000001" }),
    validate: (body) => body.agent === "portfolio" && body.recommendedAction && body.dataQuality,
  },
  {
    name: "onchain invalid address",
    path: "/api/agents/onchain",
    init: postJson({ chain: "base", contractAddress: "not-a-contract" }),
    expectedStatus: 400,
    validate: (body) => Boolean(body.error),
  },
  {
    name: "news symbol-only low confidence",
    path: "/api/agents/news",
    init: postJson({ symbol: "GOAT" }),
    validate: (body) => body.agent === "news" && body.confidence < 0.75,
  },
  {
    name: "social no provider does not mock",
    path: "/api/agents/social",
    init: postJson({ symbol: "GOAT" }),
    validate: (body) => body.agent === "social" && body.rawSignals?.providerDataAvailable === false,
  },
  {
    name: "decision no results manual review",
    path: "/api/agents/decision",
    init: postJson({ results: [] }),
    validate: (body) => body.agent === "decision" && body.recommendedAction === "manual_review",
  },
  {
    name: "execution prepare policy preview",
    path: "/api/execute/prepare",
    init: postJson({
      walletAddress: "0x0000000000000000000000000000000000000001",
      action: "manual_review",
      fromToken: "MEME",
      toToken: "USDC",
      percent: 10,
      riskScore: 60,
    }),
    validate: (body) => body.requiresApproval === false && body.policy?.autoExecute === false && body.audit?.serverCanSign === false,
  },
  {
    name: "invalid token scan does not mock",
    path: "/api/scan/token",
    init: postJson({ query: "not-a-contract", chain: "base" }),
    validate: (body) => body.dataQuality?.mode === "unavailable" && body.dataQuality?.mockSources === 0,
  },
  {
    name: "x402 premium requires payment",
    path: "/api/x402/deep-scan?query=GOAT&chain=base",
    init: { method: "GET", headers: { Accept: "application/json" } },
    expectedStatus: 402,
    validate: (_body, response) => Boolean(response.headers.get("payment-required") || response.headers.get("x-payment-required")),
  },
  {
    name: "x402 duplicate payment rejected",
    path: "/api/x402/deep-scan?query=GOAT&chain=base",
    init: { method: "GET", headers: { Accept: "application/json", "PAYMENT-SIGNATURE": "smoke-duplicate-sig" } },
    skip: !process.env.SMOKE_DUPLICATE_X402_ENABLED,
    validate: (body) => body.error === "duplicate_x402_payment",
    expectedStatus: 409,
  },
  {
    name: "x402 terms exposes payment config",
    path: "/api/x402/terms",
    init: { method: "GET", headers: { Accept: "application/json" } },
    validate: (body) => typeof body.priceUsd === "string" && typeof body.network === "string" && typeof body.payTo === "string",
  },
  {
    name: "x402 deep scan premium unlock with valid payment sig",
    path: "/api/x402/deep-scan?query=GOAT&chain=base",
    init: { method: "GET", headers: { Accept: "application/json", "PAYMENT-SIGNATURE": "smoke-valid-payment-sig-" + Date.now().toString(36) } },
    skip: !process.env.SMOKE_X402_FULL,
    expectedStatus: 200,
    validate: (body) => body.premium?.unlocked === true && body.premium?.tier === "deep_scan" && body.scan !== undefined,
  },
];

for (const check of checks) {
  if (check.skip) {
    console.log(`smoke-api: ${check.name} skipped`);
    continue;
  }

  const response = await fetch(`${baseUrl}${check.path}`, check.init);

  if (check.expectedStatus && response.status !== check.expectedStatus) {
    throw new Error(`${check.name} failed with HTTP ${response.status}, expected ${check.expectedStatus}`);
  }

  if (!check.expectedStatus && !response.ok) {
    throw new Error(`${check.name} failed with HTTP ${response.status}`);
  }

  const body = await response.json().catch(() => ({}));

  if (!check.validate(body, response)) {
    throw new Error(`${check.name} returned unexpected payload`);
  }

  console.log("=> Waiting for API to become ready...");

  if (process.env.APP_MODE === 'production') {
    console.log("Smoke test running in production mode");
  } else {
    console.log("Smoke test running in dev mode, expecting seeded environment.");
  }
}

// Security header assertions — verified on both the HTML root and the health API route.
const REQUIRED_SECURITY_HEADERS = [
  { key: "x-content-type-options", expected: "nosniff" },
  { key: "x-frame-options", expected: "DENY" },
  { key: "referrer-policy", expected: "strict-origin-when-cross-origin" },
  { key: "strict-transport-security", startsWith: "max-age=" },
  { key: "content-security-policy", contains: "default-src" },
];

const SECURITY_HEADER_PATHS = ["/", "/api/health"];

for (const path of SECURITY_HEADER_PATHS) {
  const res = await fetch(`${baseUrl}${path}`, { method: "GET" });

  for (const rule of REQUIRED_SECURITY_HEADERS) {
    const value = res.headers.get(rule.key) ?? "";

    if (rule.expected !== undefined && value.toLowerCase() !== rule.expected.toLowerCase()) {
      throw new Error(
        `security-headers [${path}]: ${rule.key} expected "${rule.expected}", got "${value}"`
      );
    }

    if (rule.startsWith !== undefined && !value.startsWith(rule.startsWith)) {
      throw new Error(
        `security-headers [${path}]: ${rule.key} expected to start with "${rule.startsWith}", got "${value}"`
      );
    }

    if (rule.contains !== undefined && !value.includes(rule.contains)) {
      throw new Error(
        `security-headers [${path}]: ${rule.key} expected to contain "${rule.contains}", got "${value}"`
      );
    }
  }

  console.log(`smoke-api: security headers OK [${path}]`);
}
