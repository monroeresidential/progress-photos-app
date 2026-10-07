import { expect, test } from "@playwright/test";
import { addPhoto, adminPhotos, clearProject } from "./admin-api";

test.skip(({ browserName }) => browserName !== "chromium", "app tests run in Chromium");

test.beforeEach(async ({ page, request }) => {
  await clearProject(request, "e2e-manage");
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:52:00-05:00", caption: "4th floor post demolition", area: "4th floor" });
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:51:00-05:00", caption: "Hidden one", hidden: true });
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-04T15:00:00-05:00", caption: "Day before" });
  await page.goto("/");
  await page.getByLabel("Project").selectOption("e2e-manage");
  await page.getByRole("tab", { name: "Manage" }).click();
});

test("groups photos by day with counts, time · area, and a hidden tag", async ({ page }) => {
  await expect(page.locator(".day-title")).toHaveText(["Monday, October 5", "Sunday, October 4"]);
  await expect(page.locator(".day-counts").first()).toHaveText("2 photos · 1 live");
  const first = page.locator(".card").first();
  await expect(first.locator(".card-caption")).toHaveText("4th floor post demolition");
  await expect(first.locator(".card-meta")).toHaveText("8:52 AM · 4th floor");
  await expect(page.locator(".card.is-hidden")).toHaveCount(1);
  await expect(page.locator(".card.is-hidden .hidden-tag")).toHaveText("Hidden from site");
});

test("the ⋯ sheet hides a photo in place", async ({ page, request }) => {
  await page.locator(".card").first().getByRole("button", { name: "More actions" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Hide" }).click();
  await expect(page.locator(".day-counts").first()).toHaveText("2 photos · 0 live");
  expect((await adminPhotos(request, "e2e-manage")).find((p) => p.caption === "4th floor post demolition")?.hidden).toBe(true);
});

test("the ⋯ sheet deletes after confirmation", async ({ page, request }) => {
  page.once("dialog", (d) => void d.accept());
  await page.locator(".card").last().getByRole("button", { name: "More actions" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".day-title")).toHaveText(["Monday, October 5"]);
  expect(await adminPhotos(request, "e2e-manage")).toHaveLength(2);
});

test("focus returns to the card's More actions button after Escape and after Hide", async ({ page }) => {
  const more = () => page.locator(".card").first().getByRole("button", { name: "More actions" });
  await more().click();
  await page.keyboard.press("Escape");
  await expect(more()).toBeFocused();
  await more().click();
  await page.getByRole("dialog").getByRole("button", { name: "Hide" }).click();
  await expect(page.locator(".day-counts").first()).toHaveText("2 photos · 0 live");
  await expect(more()).toBeFocused();
});

test("cards carry project – area – caption alt text", async ({ page }) => {
  await expect(page.locator(".card-photo img").first()).toHaveAttribute("alt", "E2E Manage – 4th floor post demolition");
});
