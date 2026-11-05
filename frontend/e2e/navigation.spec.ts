import { test, expect } from "./fixtures/test";

test.describe("Navigation", () => {
  test.describe("Desktop navigation", () => {
    test.use({ viewport: { width: 1280, height: 832 } });

    test("displays all nav items in desktop header", async ({ page }) => {
      await page.goto("/dashboard");

      const nav = page.locator("nav:visible");
      await expect(nav.locator("text=Dashboard")).toBeVisible();
      await expect(nav.locator("text=Agents")).toBeVisible();
      await expect(nav.locator("text=Scan")).toBeVisible();
      await expect(nav.locator("text=Strategy")).toBeVisible();
      await expect(nav.locator("text=Alerts")).toBeVisible();
      await expect(nav.locator("text=History")).toBeVisible();
    });

    test("navigates between all app routes", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/dashboard/);

      await page.locator("nav:visible a:has-text('Scan')").click();
      await expect(page).toHaveURL(/\/scan/);

      await page.locator("nav:visible a:has-text('Strategy')").click();
      await expect(page).toHaveURL(/\/strategy/);

      await page.locator("nav:visible a:has-text('History')").click();
      await expect(page).toHaveURL(/\/history/);

      await page.locator("nav:visible a:has-text('Dashboard')").click();
      await expect(page).toHaveURL(/\/dashboard/);

      await page.locator("nav:visible a:has-text('Agents')").click();
      await expect(page).toHaveURL(/\/agents/);

      await page.locator("nav:visible a:has-text('Alerts')").click();
      await expect(page).toHaveURL(/\/alerts/);
    });

    test("header shows brand logo and name", async ({ page }) => {
      await page.goto("/dashboard");

      await expect(page.locator("text=CRYPTARA")).toBeVisible();
    });
  });

  test.describe("Mobile navigation", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("shows horizontal scrollable nav on mobile", async ({ page }) => {
      await page.goto("/dashboard");

      const mobileNav = page.locator("nav").last();
      await expect(mobileNav.locator("text=Dashboard")).toBeVisible();
      await expect(mobileNav.locator("text=Scan")).toBeVisible();
      await expect(mobileNav.locator("text=Strategy")).toBeVisible();
    });

    test("mobile nav links navigate correctly", async ({ page }) => {
      await page.goto("/dashboard");

      const mobileNav = page.locator("nav").last();
      await mobileNav.locator("text=History").click();
      await expect(page).toHaveURL(/\/history/);
    });
  });
});
