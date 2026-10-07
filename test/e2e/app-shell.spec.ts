import { expect, test } from "@playwright/test";

test.skip(({ browserName }) => browserName !== "chromium", "app tests run in Chromium");

test("header: project title, Live site link, and tab switching", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Monroe Residential Progress Photos" })).toBeVisible();
  await page.getByLabel("Project").selectOption("e2e-upload");
  await expect(page.locator(".project-picker .name")).toHaveText("E2E Upload");
  await expect(page.getByRole("link", { name: "Live site" })).toHaveAttribute("href", "http://host.test/progress/");

  await page.getByRole("tab", { name: "Manage" }).click();
  await expect(page.getByRole("tab", { name: "Manage" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Select" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Live site" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Upload" }).click();
  await expect(page.getByRole("link", { name: "Live site" })).toBeVisible();
});

test("remembers the last project", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Project").selectOption("e2e-manage");
  await page.reload();
  await expect(page.getByLabel("Project")).toHaveValue("e2e-manage");
});

test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });
  test("uses the navy background and light text", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 5, 27)");
    await expect(page.locator("body")).toHaveCSS("color", "rgb(242, 244, 250)");
  });
});

test.describe("touch devices", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("pinch-zoom stays enabled and fields are at least 16px, so iOS doesn't zoom on focus", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="viewport"]')).not.toHaveAttribute("content", /maximum-scale|user-scalable/);
    await page.getByLabel("Project").selectOption("e2e-upload");
    const sizes = await page.locator("input, select, textarea").evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    expect(sizes.length).toBeGreaterThan(0);
    for (const s of sizes) expect(s).toBeGreaterThanOrEqual(16);
  });
});
