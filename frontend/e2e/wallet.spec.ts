import { test, expect } from "./fixtures/test";

test.describe("Wallet connection", () => {
  test("loads landing page with branding", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cryptara" })).toBeVisible();
  });

  test("shows connect wallet button on dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator('button:has-text("Connect Wallet")').first()).toBeVisible();
  });

  test("opens wallet choice modal on click", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator('button:has-text("Connect Wallet")').first().click();

    await expect(page.locator("text=Select network")).toBeVisible();
    await expect(page.locator("text=EVM wallet")).toBeVisible();
    await expect(page.locator("text=Stellar wallet")).toBeVisible();
  });

  test("closes wallet choice modal", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator('button:has-text("Connect Wallet")').first().click();
    await expect(page.locator("text=Select network")).toBeVisible();

    await page.locator('button[aria-label="Close wallet selector"]').click();
    await expect(page.locator("text=Select network")).not.toBeVisible();
  });

  test("dashboard requires wallet to show portfolio", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Connect your wallet" })).toBeVisible();
    await expect(page.locator("text=Wallet required")).toBeVisible();
  });
});
