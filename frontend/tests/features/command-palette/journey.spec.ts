import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({json:{entries:[],alerts:[]}});
    return route.continue();
  });
});
test("AppShell entry supports search, inert IME, navigation and no search persistence", async ({ page }) => {
  const mutations: string[]=[];
  page.on("request", request => { if(request.method()==="POST"&&new URL(request.url()).pathname.startsWith("/api/"))mutations.push(request.url()); });
  await page.goto("/offline");
  const trigger=page.getByRole("button",{name:"Search routes and insights",exact:true});
  await trigger.focus();await page.keyboard.press("Control+k");
  const input=page.getByRole("combobox");await expect(input).toBeFocused();
  await input.fill("unmatched-private-query");await expect(page.getByRole("option")).toHaveCount(0);
  await input.press("Escape");await expect(trigger).toBeFocused();
  await trigger.click();await input.fill("scan");
  await input.dispatchEvent("keydown",{key:"Enter",isComposing:true});await expect(page.getByRole("dialog")).toBeVisible();
  await input.press("Enter");await expect(page).toHaveURL(/\/scan$/);
  const storage=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));
  expect(storage).not.toContain("unmatched-private-query");expect(mutations).toEqual([]);
});
test("mobile modal traps focus, blocks background controls and respects reduced motion", async ({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto("/offline");const trigger=page.getByRole("button",{name:"Search routes and insights",exact:true});await trigger.click();
  const input=page.getByRole("combobox"),close=page.getByRole("button",{name:"Close search"});
  await expect(input).toBeFocused();await input.press("Shift+Tab");await expect(close).toBeFocused();await close.press("Tab");await expect(input).toBeFocused();
  await input.press("ArrowDown");await expect(input).toHaveAttribute("aria-activedescendant","command-result-1");
  const box=await page.getByRole("dialog").boundingBox();expect(box!.width).toBeLessThanOrEqual(390);expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(()=>!!document.querySelector("dialog:modal"))).toBe(true);
  await close.click();await expect(trigger).toBeFocused();
});
