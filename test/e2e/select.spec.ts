import { expect, test } from "@playwright/test";
import { addPhoto, adminPhotos, clearProject, routeImages } from "./admin-api";

test.skip(({ browserName }) => browserName !== "chromium", "app tests run in Chromium");

test.beforeEach(async ({ page, request }) => {
  await routeImages(page);
  await clearProject(request, "e2e-manage");
  for (const [t, c] of [["08:52", "One"], ["08:51", "Two"], ["08:50", "Three"]] as const) {
    await addPhoto(request, "e2e-manage", { takenAt: `2026-10-05T${t}:00-05:00`, caption: c });
  }
  await page.goto("/");
  await page.getByLabel("Project").selectOption("e2e-manage");
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.getByRole("button", { name: "Select" }).click();
});

const selectedCount = (page: import("@playwright/test").Page) => page.locator(".select-title");

test("select two, bulk hide, bulk caption, then cancel", async ({ page, request }) => {
  await expect(selectedCount(page)).toHaveText("0 selected");
  await page.locator(".card-photo").nth(0).click();
  await page.locator(".card-photo").nth(1).click();
  await expect(selectedCount(page)).toHaveText("2 selected");
  await expect(page.locator(".card.is-selected")).toHaveCount(2);

  await page.getByRole("button", { name: "Hide" }).click();
  await expect(page.locator(".day-counts")).toHaveText("3 photos · 1 live");
  await expect(selectedCount(page)).toHaveText("0 selected"); // successes are deselected

  await page.locator(".card-photo").nth(2).click();
  await page.getByRole("button", { name: "Caption" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Bulk caption");
  await page.getByRole("button", { name: "Apply to 1 photo" }).click();
  await expect(page.locator(".card-caption").nth(2)).toHaveText("Bulk caption");

  const stored = await adminPhotos(request, "e2e-manage");
  expect(stored.filter((p) => p.hidden)).toHaveLength(2);
  expect(stored.find((p) => p.caption === "Bulk caption")).toBeTruthy();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Select" })).toBeVisible();
  await expect(page.locator(".check")).toHaveCount(0);
});

test("All / None and bulk delete with one confirmation", async ({ page, request }) => {
  await page.getByRole("button", { name: "All" }).click();
  await expect(selectedCount(page)).toHaveText("3 selected");
  await page.getByRole("button", { name: "None" }).click();
  await expect(selectedCount(page)).toHaveText("0 selected");
  await page.getByRole("button", { name: "All" }).click();

  const prompts: string[] = [];
  page.on("dialog", (d) => {
    prompts.push(d.message());
    void d.accept();
  });
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".manage-status")).toHaveText(/No photos yet\./);
  expect(prompts).toEqual(["Delete 3 photos? This can't be undone."]);
  expect(await adminPhotos(request, "e2e-manage")).toHaveLength(0);
});

test("a failed photo stays selected with a retry message; retrying succeeds and clears it", async ({ page, request }) => {
  const stored = await adminPhotos(request, "e2e-manage");
  const failId = stored[0].id;
  await page.route("**/api/admin/photos/*", (route) => {
    if (route.request().method() === "PATCH" && route.request().url().endsWith(`/${failId}`)) {
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
    }
    return route.continue();
  });
  await page.locator(".card-photo").nth(0).click();
  await page.locator(".card-photo").nth(1).click();
  await page.getByRole("button", { name: "Hide" }).click();

  await expect(selectedCount(page)).toHaveText("1 selected");
  await expect(page.locator(".card.is-selected")).toHaveCount(1);
  await expect(page.locator(".card.is-selected")).toHaveAttribute("data-id", failId);
  await expect(page.locator(".manage-status")).toContainText("couldn't be updated");

  await page.unroute("**/api/admin/photos/*");
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(selectedCount(page)).toHaveText("0 selected");
  await expect(page.locator(".manage-status")).not.toContainText("couldn't be updated");
});

test("the bulk bar stays in the viewport on a long list", async ({ page, request }) => {
  await clearProject(request, "e2e-manage");
  for (let i = 0; i < 8; i++) {
    await addPhoto(request, "e2e-manage", { takenAt: `2026-10-05T08:${10 + i}:00-05:00`, caption: `P${i}` });
  }
  await page.reload();
  await page.getByLabel("Project").selectOption("e2e-manage");
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.getByRole("button", { name: "Select" }).click();
  await page.locator(".card-photo").first().click();
  await expect(page.getByRole("button", { name: "Hide" })).toBeInViewport();
});

test("bulk caption with an empty field asks before clearing; cancel aborts", async ({ page, request }) => {
  const prompts: string[] = [];
  page.on("dialog", (d) => {
    prompts.push(d.message());
    void d.dismiss();
  });
  await page.locator(".card-photo").nth(0).click();
  await page.getByRole("button", { name: "Caption" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("   ");
  await page.getByRole("button", { name: "Apply to 1 photo" }).click();
  await expect.poll(() => prompts).toEqual(["Clear captions on 1 photo?"]);
  expect((await adminPhotos(request, "e2e-manage")).filter((p) => p.caption)).toHaveLength(3);
});

test("retrying a bulk Hide keeps the same direction and never publishes an originally hidden photo", async ({ page, request }) => {
  await clearProject(request, "e2e-manage");
  const hiddenId = await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:52:00-05:00", caption: "A hidden", hidden: true });
  const liveId = await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:51:00-05:00", caption: "B live" });
  await page.reload();
  await page.getByLabel("Project").selectOption("e2e-manage");
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.getByRole("button", { name: "Select" }).click();
  const patched: string[] = [];
  await page.route("**/api/admin/photos/*", (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    patched.push(route.request().url().split("/").pop()!);
    if (route.request().url().endsWith(`/${liveId}`)) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
    return route.continue();
  });
  await page.locator(".card-photo").nth(0).click(); // A (hidden)
  await page.locator(".card-photo").nth(1).click(); // B (live)
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(page.locator(".manage-status")).toContainText("couldn't be updated");
  expect(patched).toEqual([liveId]); // A is skipped, no PATCH
  await expect(selectedCount(page)).toHaveText("1 selected");
  await expect(page.locator(".card.is-selected")).toHaveAttribute("data-id", liveId);
  await expect(page.getByRole("button", { name: "Hide" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Unhide" })).toHaveCount(0);

  await page.unroute("**/api/admin/photos/*");
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(selectedCount(page)).toHaveText("0 selected");
  const stored = await adminPhotos(request, "e2e-manage");
  expect(stored.find((p) => p.id === liveId)?.hidden).toBe(true);
  expect(stored.find((p) => p.id === hiddenId)?.hidden).toBe(true);
});
