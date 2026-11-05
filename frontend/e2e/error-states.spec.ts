import { test, expect } from "./fixtures/test";

test.describe("Error and edge-case states", () => {
  test("Scan API returns 500 gracefully", async ({ page }) => {
    await page.route("**/api/scan/token", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal server error" }) });
    });

    await page.goto("/scan");

    const input = page.locator('input[placeholder*="DexScreener"]');
    await input.fill("0x1234567890abcdef1234567890abcdef12345678");
    await page.locator('button:has-text("Run token agents")').first().click();
    await expect(page.getByRole("heading", { name: "Scan failed" })).toBeVisible({ timeout: 15000 });
  });

  test("history page loads with empty database", async ({ page }) => {
    await page.goto("/history");

    await expect(page.locator("h1:has-text('History')")).toBeVisible();
    await expect(page.locator("text=0 recommendations")).toBeVisible();
    await expect(page.locator("text=0 approvals")).toBeVisible();
    await expect(page.locator("text=0 transactions")).toBeVisible();
  });

  test("alerts page loads without session", async ({ page }) => {
    await page.goto("/alerts");

    await expect(page.getByRole("heading", { name: "Alert rules + history" })).toBeVisible({ timeout: 10000 });
  });

  test("operations page renders", async ({ page }) => {
    await page.goto("/operations");
    await expect(page.getByRole("heading", { name: "Production operations" })).toBeVisible({ timeout: 10000 });
  });

  test("dashboard page layout renders", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Connect your wallet" })).toBeVisible();
    await expect(page.locator('button:has-text("Connect Wallet")').first()).toBeVisible();
  });

  test("page 404 shows Not Found", async ({ page }) => {
    const response = await page.goto("/nonexistent-route");
    expect(response?.status()).toBe(404);
  });

  test("page title matches expected pattern", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.ok()).toBeTruthy();

    const title = await page.title();
    expect(title).toContain("Cryptara");
  });

  test.describe("Data quality warnings", () => {
    test("scan result with mock sources shows warning", async ({ page }) => {
      await page.route("**/api/scan/token", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: "mock-scan-warn-001",
            symbol: "TEST",
            name: "Test Token",
            chain: "base",
            overallRiskScore: 50,
            verdict: "caution",
            summary: "Test summary",
            reasons: ["Test reason"],
            normalizedInput: { query: "0x1234", chain: "base", source: "dex_screener", contractAddress: "0x1234" },
            riskBreakdown: [{ label: "Liquidity", score: 50, maxScore: 100, detail: "Moderate" }],
            riskReport: {
              buyRisk: 50,
              confidence: 0.5,
              verdict: "caution",
              summary: "Test summary",
              topReasons: ["Test reason"],
              agentCards: [],
              executionPreview: null,
            },
            analysisChecks: [
              { key: "deployed", label: "Deployed", status: "pass", score: 10, value: "Yes", reason: "Verified" },
              { key: "honeypot", label: "Honeypot", status: "pass", score: 10, value: "No", reason: "No honeypot" },
              { key: "sell_tax", label: "Sell tax", status: "pass", score: 5, value: "5%", reason: "Standard" },
              { key: "ownership", label: "Ownership", status: "warning", score: 50, value: "Moderate", reason: "Some concentration" },
              { key: "holders", label: "Holders", status: "pass", score: 20, value: "5,000", reason: "Good distribution" },
              { key: "liquidity", label: "Liquidity", status: "pass", score: 30, value: "$1M", reason: "Adequate" },
              { key: "lp_lock", label: "LP lock", status: "warning", score: 40, value: "Partial", reason: "Partially locked" },
              { key: "market", label: "Market", status: "pass", score: 25, value: "Active", reason: "Active market" },
            ],
            dataQuality: {
              mode: "mixed",
              connectedSources: 1,
              unavailableSources: 2,
              mockSources: 2,
              detail: "Some mock data present.",
            },
          }),
        });
      });

      await page.goto("/scan");

      const input = page.locator('input[placeholder*="DexScreener"]');
      await input.fill("0x1234");
      await page.locator('button:has-text("Run token agents")').first().click();
      await expect(page.locator("text=AI Risk Report")).toBeVisible({ timeout: 15000 });

      await page.locator("summary:has-text('Data quality')").click();
      const dqSection = page.locator("details").filter({ hasText: "Data quality" });
      await expect(dqSection.getByText("Mock", { exact: true })).toBeVisible();
      await expect(dqSection.getByText("Demo/mock data is present")).toBeVisible();
    });
  });
});
