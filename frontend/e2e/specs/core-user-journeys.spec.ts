import { expect, test } from "../fixtures/test";
import { setWalletSessionCookie } from "../fixtures/auth";
import { installMockEvmWallet } from "../fixtures/mockEvmWallet";
import { evmTokens, EVM_WALLET } from "../fixtures/tokens";
import { mockPortfolioSnapshot, mockTokenScanResult } from "../fixtures/mock-data";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

test.describe("Core user journeys (issue #22)", () => {
  test.describe.configure({ mode: "serial" });

  test("1) token scan submission -> risk report rendering -> agent detail expansion", async ({ page }) => {
    await page.route("**/api/scan/token", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(mockTokenScanResult()),
      });
    });

    await page.goto("/scan");
    await page.getByPlaceholder("DexScreener URL or contract address").fill(evmTokens.meme.address);
    await page.getByRole("button", { name: "Run token agents" }).click();

    await expect(page.getByText("AI Risk Report")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "MEME" })).toBeVisible();
    await expect(page.getByText("Buy risk")).toBeVisible();
    await expect(page.getByText("Top reasons")).toBeVisible();

    await page.locator("summary", { hasText: "Agent details" }).click();
    await expect(page.getByText("Decision Agent")).toBeVisible();
    await expect(page.getByText("Onchain Agent")).toBeVisible();
  });

  test("2) watchlist add, filter, CSV export, and remove", async ({ page, context, request }) => {
    await setWalletSessionCookie(context, BASE_URL, EVM_WALLET);
    await request.post(`${BASE_URL}/api/dev/reset`);

    // Seed two entries via API for deterministic filter/export/remove.
    const add = async (payload: Record<string, unknown>) => {
      const res = await request.post(`${BASE_URL}/api/watchlist`, {
        headers: { "Content-Type": "application/json", Cookie: `gr_wallet_session=${(await context.cookies()).find(c=>c.name==="gr_wallet_session")?.value ?? ""}` },
        data: payload,
      });
      expect(res.ok()).toBeTruthy();
    };

    await add({ action: "add", walletAddress: EVM_WALLET, chain: "base", contractAddress: "0x1234567890abcdef1234567890abcdef12345678", symbol: "MEME", tokenName: "Meme Token", assetType: "contract", source: "manual" });
    await add({ action: "add", walletAddress: EVM_WALLET, chain: "stellar-public", assetType: "native", symbol: "XLM", assetKey: "native", source: "manual" });

    let exportRequested = false;
    await page.route("**/api/watchlist/export**", async (route) => {
      exportRequested = true;
      await route.fulfill({
        status: 200,
        contentType: "text/csv; charset=utf-8",
        headers: { "content-disposition": 'attachment; filename="watchlist.csv"' },
        body: "version,chain,symbol\n1.0.0,base,MEME\n",
      });
    });

    await page.goto(`/watchlist?wallet=${encodeURIComponent(EVM_WALLET)}`);
    await expect(page.getByRole("heading", { name: "Chain-aware watchlist" })).toBeVisible();
    await expect(page.getByText("MEME").first()).toBeVisible();
    await expect(page.getByText("XLM").first()).toBeVisible();

    // Add via UI
    await page.getByLabel("Contract address / CODE:ISSUER / Contract ID / native").fill("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    await page.locator("#chain").selectOption("base");
    await page.getByLabel("Symbol (optional)").fill("NEW");
    await page.getByRole("button", { name: "Add to watchlist" }).click();
    await page.waitForURL(/added=1/);
    await expect(page.getByText("NEW").first()).toBeVisible();

    // Filter - EVM Tokens should show MEME/NEW, hide XLM
    await page.getByRole("button", { name: /EVM Tokens/ }).click();
    await expect(page.getByText("XLM")).toHaveCount(0);
    await expect(page.getByText("MEME").first()).toBeVisible();

    // CSV export
    await page.getByRole("button", { name: "All" }).click();
    await page.getByRole("link", { name: "Export CSV" }).first().click();
    await expect.poll(() => exportRequested).toBe(true);

    // Remove
    const removeButtons = page.getByRole("button", { name: "Remove" });
    await expect(removeButtons.first()).toBeVisible();
    await removeButtons.first().click();
    await page.waitForURL(/removed=1/);
  });

  test("3) user rule creation, preset switching, and validation errors", async ({ page, context }) => {
    await installMockEvmWallet(page);
    await setWalletSessionCookie(context, BASE_URL, EVM_WALLET);

    let savedPayload: Record<string, unknown> | null = null;
    await page.route("**/api/rules", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          status: 200, contentType: "application/json",
          body: JSON.stringify({
            walletAddress: EVM_WALLET, profileId: "balanced", presetVersion: 1, maxBuyRisk: 55, maxTradePercent: 10,
            maxTradeValueUsd: 1000, maxDailyValueUsd: 5000, minLiquidityUsd: 25000, maxSingleTokenExposurePercent: 20,
            minStableReservePercent: 15, maxMemeExposurePercent: 5, maxSlippageBps: 100, allowedChains: ["base", "ethereum"],
            blockedAssets: [], blockedCategories: [], autoExecute: false, version: 1,
          }),
        });
        return;
      }
      if (method === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        savedPayload = body;
        if (Number(body.maxBuyRisk) > 100) {
          await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Request validation failed.", issues: [{ field: "maxBuyRisk", message: "Must be <= 100" }] }) });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rule: { ...body, version: 2 } }) });
        return;
      }
      await route.continue();
    });

    await page.goto("/strategy");
    await expect(page.getByRole("heading", { name: "Risk rules and auto mode" })).toBeVisible();

    await page.getByRole("radio", { name: /Conservative/ }).click();
    await expect(page.getByText("Active profile:")).toContainText("conservative");

    const maxBuyRisk = page.getByLabel("Max Buy Risk");
    await maxBuyRisk.fill("101");
    await page.getByRole("button", { name: "Save strategy" }).click();
    await expect(page.getByText("Must be <= 100")).toBeVisible();

    await maxBuyRisk.fill("45");
    await page.getByRole("button", { name: "Save strategy" }).click();
    await expect(page.getByText("Saved")).toBeVisible();
    expect(savedPayload?.maxBuyRisk).toBe(45);
  });

  test("4) approval-only execution preview -> reject flow (no auto-submit)", async ({ page, context }) => {
    await installMockEvmWallet(page);
    await setWalletSessionCookie(context, BASE_URL, EVM_WALLET);

    const submitBodies: string[] = [];
    let rejectCalled = false;

    await page.route("**/api/portfolio**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockPortfolioSnapshot()) });
    });
    await page.route("**/api/agents/**", async (route) => {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ agent: "decision", score: 42, confidence: 0.8, verdict: "caution", summary: "Mock", recommendedAction: "reduce_exposure", factors: [], dataQuality: { mode: "live", connectedSources: 1, unavailableSources: 0, mockSources: 0, detail: "ok" } }),
      });
    });
    await page.route("**/api/execute/prepare", async (route) => {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ lifecycle: { idempotencyKey: "e2e-approval-key" }, action: "reduce_exposure", network: "base", quote: { status: "ready" }, simulation: { status: "passed" }, payload: { kind: "evm", chainId: 8453, to: "0x1234567890abcdef1234567890abcdef12345678", data: "0x", value: "0" } }),
      });
    });
    await page.route("**/api/execute/approve", async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "reject") {
        rejectCalled = true;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, status: "user_rejected" }) });
        return;
      }
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ allowed: true, walletOk: true, networkOk: true, expired: false, actionSafe: true, payload: { kind: "evm", chainId: 8453, to: "0x1234567890abcdef1234567890abcdef12345678", data: "0x", value: "0" } }),
      });
    });
    await page.route("**/api/execute/submit", async (route) => {
      submitBodies.push(route.request().postData() ?? "");
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "should not be called" }) });
    });

    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Run agents" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Run agents" }).click();
    await expect(page.getByRole("button", { name: "Prepare & sign transaction" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Prepare & sign transaction" }).click();

    await expect(page.getByRole("heading", { name: "Execution Review" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Approval-Only: Cryptara never signs for you.")).toBeVisible();
    await page.getByRole("button", { name: "Reject" }).click();

    await expect.poll(() => rejectCalled).toBe(true);
    expect(submitBodies.length).toBe(0);
  });

  test("5) offline mode banner and blocked write actions", async ({ page, context }) => {
    await installMockEvmWallet(page);
    await page.goto("/scan");
    await expect(page.getByRole("button", { name: "Run token agents" })).toBeEnabled();

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    await expect(page.getByText("Offline read-only mode")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Run token agents" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Run deep scan agents" })).toBeDisabled();

    await context.setOffline(false);
  });
});
