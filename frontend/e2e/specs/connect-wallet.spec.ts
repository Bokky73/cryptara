import { test, expect } from "../fixtures/test";
import { installMockEvmWallet, mockEvmWalletSession } from "../fixtures/mockEvmWallet";
import { installMockStellarWallet } from "../fixtures/mockStellarWallet";
import { EVM_WALLET } from "../fixtures/tokens";

test.describe("Connect wallet journey", () => {
  test("loads landing page with branding", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cryptara" })).toBeVisible();
  });

  test("shows connect wallet button on dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator('button:has-text("Connect Wallet")').first()).toBeVisible();
  });

  test("opens wallet choice modal with EVM and Stellar options", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator('button:has-text("Connect Wallet")').first().click();

    await expect(page.locator("text=Select wallet")).toBeVisible();
    await expect(page.locator("text=EVM wallet")).toBeVisible();
    await expect(page.locator("text=All Stellar wallets")).toBeVisible();
  });

  test("mock EVM wallet session API responds without secrets", async ({ page }) => {
    await installMockEvmWallet(page);
    await mockEvmWalletSession(page);
    const response = await page.request.post("/api/wallet-session/nonce", {
      data: { family: "evm", walletAddress: EVM_WALLET },
    });
    expect(response.ok()).toBeTruthy();
  });

  test("dashboard requires wallet to show portfolio when disconnected", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Connect your wallet" })).toBeVisible();
    await expect(page.locator("text=Wallet required")).toBeVisible();
  });
});

test.describe("Stellar wallet connect", () => {
  test("restored Stellar address appears in wallet selector", async ({ page }) => {
    await installMockStellarWallet(page);
    await page.goto("/dashboard");
    const walletButton = page.getByRole("banner").getByRole("button", { name: /GDXHOK/i });
    await expect(walletButton).toBeVisible();
    await walletButton.click();
    await expect(page.getByText("Wallet session")).toBeVisible();
    await expect(page.getByText("Display only — reconnect")).toBeVisible();
  });
});
