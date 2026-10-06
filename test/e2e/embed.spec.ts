import { expect, test } from "@playwright/test";
import { openHost } from "./host";

const feed = (page: import("@playwright/test").Page) => page.locator("progress-feed");

test("embed.js is cacheable and CORS-enabled", async ({ request }) => {
  const res = await request.get("/embed.js");
  expect(res.status()).toBe(200);
  expect(res.headers()["access-control-allow-origin"]).toBe("*");
  expect(res.headers()["cache-control"]).toBe("public, max-age=300");
});

test("groups photos under date headings and scrolls to the end marker", async ({ page }) => {
  await openHost(page, { project: "e2e-feed" });
  await expect(feed(page).locator(".day-heading").first()).toHaveText("September 30, 2026");
  await expect(feed(page).locator(".photo").first()).toBeVisible();

  for (let i = 0; i < 20 && !(await feed(page).locator(".end").isVisible()); i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); // mouse.wheel is unsupported in mobile WebKit
    await page.waitForTimeout(150);
  }
  await expect(feed(page).locator(".end")).toHaveText("That's the beginning");
  await expect(feed(page).locator(".photo")).toHaveCount(60);
  await expect(feed(page).locator(".day-heading")).toHaveText([
    "September 30, 2026",
    "September 29, 2026",
    "September 28, 2026",
    "September 27, 2026",
    "September 26, 2026",
  ]);
});

test("renders captions as text", async ({ page }) => {
  await openHost(page, { project: "e2e-feed" });
  await expect(feed(page).locator(".caption").first()).toHaveText(`<img src=x onerror="window.__xss=1">`);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("viewer: open, arrow keys, Escape, focus returns", async ({ page, browserName }) => {
  // macOS WebKit only tabs to buttons with Option held.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await openHost(page, { project: "e2e-feed" });
  const second = feed(page).locator(".open").nth(1);
  await second.click();
  const overlay = feed(page).locator(".overlay");
  await expect(overlay).toBeVisible();
  await expect(feed(page).locator(".close")).toBeFocused();
  const img = feed(page).locator(".viewer-img");
  const before = await img.getAttribute("src");
  await page.keyboard.press("ArrowRight");
  await expect(img).not.toHaveAttribute("src", before!);
  await page.keyboard.press("ArrowLeft");
  await expect(img).toHaveAttribute("src", before!);
  await page.keyboard.press(tab);
  await page.keyboard.press(tab);
  await page.keyboard.press(tab);
  await expect(overlay.locator("button:focus")).toHaveCount(1); // focus stays inside the viewer
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await expect(second).toBeFocused();
});

test("viewer: swipe moves between photos", async ({ page }) => {
  await openHost(page, { project: "e2e-feed" });
  await feed(page).locator(".open").first().click();
  const img = feed(page).locator(".viewer-img");
  const first = await img.getAttribute("src");
  const box = (await feed(page).locator(".overlay").boundingBox())!;
  await page.mouse.move(box.width * 0.8, box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.width * 0.2, box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(img).not.toHaveAttribute("src", first!);
});

test("no layout shift while images load", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await openHost(page, { project: "e2e-feed", delayImages: gate });
  const heading = feed(page).locator(".day-heading").nth(1);
  await expect(heading).toBeAttached();
  const before = (await heading.boundingBox())!.y;
  release();
  await page.waitForFunction(() => {
    const root = document.querySelector("progress-feed")!.shadowRoot!;
    return [...root.querySelectorAll("img")].slice(0, 4).every((i) => i.complete && i.naturalWidth > 0);
  });
  expect((await heading.boundingBox())!.y).toBe(before);
});

test("error state with Retry", async ({ page }) => {
  let fail = true;
  await page.route("**/api/feed/**", (route) => (fail ? route.fulfill({ status: 500, body: "{}" }) : route.continue()));
  await openHost(page, { project: "e2e-feed" });
  await expect(feed(page).locator(".status")).toContainText("Couldn't load photos");
  fail = false;
  await feed(page).getByRole("button", { name: "Retry" }).click();
  await expect(feed(page).locator(".photo").first()).toBeVisible();
});

test("empty state", async ({ page }) => {
  await openHost(page, { project: "e2e-empty" });
  await expect(feed(page).locator(".status")).toHaveText("No photos yet.");
});

test("theming custom properties apply", async ({ page }) => {
  await openHost(page, { project: "e2e-feed", style: "--pf-gap: 20px; --pf-radius: 12px; --pf-heading-transform: uppercase" });
  await expect(feed(page).locator(".grid").first()).toHaveCSS("column-gap", "20px");
  await expect(feed(page).locator(".open img").first()).toHaveCSS("border-radius", "12px");
  await expect(feed(page).locator(".day-heading").first()).toHaveCSS("text-transform", "uppercase");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("shows the host's fallback content", async ({ page }) => {
    await openHost(page, { project: "e2e-feed", fallback: "<p>Photos need JavaScript.</p>" });
    await expect(page.getByText("Photos need JavaScript.")).toBeVisible();
  });
});
