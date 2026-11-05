import { test, expect } from "./fixtures/test";

test.describe("Landing page", () => {
  test("loads with correct title and branding", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Cryptara" })).toBeVisible();
    await expect(page.locator("text=Multi-agent portfolio intelligence")).toBeVisible();
    await expect(page.locator("text=GOAT Network AI Guardian MVP")).toBeVisible();
  });

  test("displays hero section with key features", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("h1:has-text('Cryptara')")).toBeVisible();
    await expect(page.locator("text=Open Dashboard")).toBeVisible();
    await expect(page.locator("text=View Agents")).toBeVisible();
  });

  test('navigates to dashboard via "Go Dashboard" link', async ({ page }) => {
    await page.goto("/");

    await page.locator('a:has-text("Go Dashboard")').first().click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('navigates to dashboard via "Open Dashboard" button', async ({ page }) => {
    await page.goto("/");

    await page.locator('a:has-text("Open Dashboard")').click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('navigates to agents via "View Agents" link', async ({ page }) => {
    await page.goto("/");

    await page.locator('a:has-text("View Agents")').click();
    await expect(page).toHaveURL(/\/agents/);
  });
});
