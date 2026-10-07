import { expect, test } from "@playwright/test";
import { addPhoto, adminPhotos, clearProject } from "./admin-api";

test.skip(({ browserName }) => browserName !== "chromium", "app tests run in Chromium");

test.beforeEach(async ({ page, request }) => {
  await clearProject(request, "e2e-manage");
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:52:00-05:00", caption: "First", area: "4th floor" });
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:51:57-05:00", caption: "Second" });
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-04T15:00:00-05:00", caption: "Third" });
  await page.goto("/");
  await page.getByLabel("Project").selectOption("e2e-manage");
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.locator(".card-photo").first().click();
});

const viewer = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Photo" });

test("shows position, time · area and status; saves a caption", async ({ page, request }) => {
  await expect(viewer(page).locator(".viewer-pos")).toHaveText("1 of 3 · Monday, Oct 5");
  await expect(viewer(page).locator(".when")).toHaveText("8:52:00 AM · 4th floor");
  await expect(viewer(page).locator(".status-tag")).toHaveText("Live on site");
  const save = viewer(page).getByRole("button", { name: "Save caption" });
  await expect(save).toBeDisabled();
  await viewer(page).getByLabel("Caption").fill("Edited in viewer");
  await save.click();
  await expect(viewer(page).getByRole("button", { name: "Saved" })).toBeVisible();
  expect((await adminPhotos(request, "e2e-manage")).some((p) => p.caption === "Edited in viewer")).toBe(true);
});

test("hide/unhide updates the tag and the list", async ({ page }) => {
  await viewer(page).getByRole("button", { name: "Hide" }).click();
  await expect(viewer(page).locator(".status-tag")).toHaveText("Hidden");
  await page.keyboard.press("Escape");
  await expect(page.locator(".card").first()).toHaveClass(/is-hidden/);
  await expect(page.locator(".card-photo").first()).toBeFocused();
});

test("arrow keys move between photos across days", async ({ page }) => {
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(viewer(page).locator(".viewer-pos")).toHaveText("3 of 3 · Sunday, Oct 4");
  await page.keyboard.press("ArrowLeft");
  await expect(viewer(page).locator(".viewer-pos")).toHaveText("2 of 3 · Monday, Oct 5");
});

test("deleting moves on, and deleting the last photo closes the viewer", async ({ page, request }) => {
  page.on("dialog", (d) => void d.accept());
  await viewer(page).getByRole("button", { name: "Delete" }).click();
  await expect(viewer(page).locator(".viewer-pos")).toHaveText("1 of 2 · Monday, Oct 5");
  await viewer(page).getByRole("button", { name: "Delete" }).click();
  await viewer(page).getByRole("button", { name: "Delete" }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(page.locator(".manage-status")).toHaveText(/No photos yet\./);
  expect(await adminPhotos(request, "e2e-manage")).toHaveLength(0);
});

test("navigating during an in-flight save does not leak the edit into the next photo", async ({ page, request }) => {
  await page.route("**/api/**", async (route) => {
    if (route.request().method() === "PATCH") await new Promise((r) => setTimeout(r, 400));
    await route.continue();
  });
  await viewer(page).getByLabel("Caption").fill("Edited in viewer");
  await viewer(page).getByRole("button", { name: "Save caption" }).click();
  await page.keyboard.press("ArrowRight");
  await expect(viewer(page).getByRole("button", { name: "Saved" })).toBeVisible();
  await expect(viewer(page).locator(".viewer-pos")).toHaveText("1 of 3 · Monday, Oct 5");
  await expect(viewer(page).getByLabel("Caption")).toHaveValue("Edited in viewer");
  await page.keyboard.press("ArrowRight");
  await expect(viewer(page).locator(".viewer-pos")).toHaveText("2 of 3 · Monday, Oct 5");
  await expect(viewer(page).getByLabel("Caption")).toHaveValue("Second");
  const photos = await adminPhotos(request, "e2e-manage");
  expect(photos.some((p) => p.caption === "Edited in viewer")).toBe(true);
  expect(photos.some((p) => p.caption === "Second")).toBe(true);
});

test("the viewer image has project – area – caption alt text", async ({ page }) => {
  await expect(viewer(page).locator(".viewer-stage img")).toHaveAttribute("alt", "E2E Manage – 4th floor – First");
});
