import { expect, test } from "@playwright/test";
import { adminPhotos, clearProject, jpegFromPage } from "./admin-api";

test.skip(({ browserName }) => browserName !== "chromium", "upload flow runs once, in Chromium");

const library = (page: import("@playwright/test").Page) => page.locator('input[type="file"]:not([capture])');
const uploadButton = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /^Upload( \d+ photos?)?$/ });

test.beforeEach(async ({ page, request }) => {
  await clearProject(request, "e2e-upload");
  await page.goto("/");
  await page.getByLabel("Project").selectOption("e2e-upload");
});

test("uploads with a batch caption and a new area; the row leaves; a re-upload is Duplicate", async ({ page, request }) => {
  const jpeg = await jpegFromPage(page, `photo ${Date.now()}`);
  await library(page).setInputFiles({ name: "site.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(page.locator(".queue-summary")).toHaveText("1 photo");
  await expect(uploadButton(page)).toHaveText("Upload 1 photo");

  await page.getByLabel("Caption for this batch").fill("<b>E2E</b> slab pour");
  await page.getByRole("button", { name: "+ Add" }).click();
  await page.getByLabel("New area").fill("4th floor");
  await page.getByLabel("New area").press("Enter");
  await expect(page.getByRole("button", { name: "4th floor" })).toHaveAttribute("aria-pressed", "true");

  await uploadButton(page).click();
  await expect(page.locator(".queue-summary")).toHaveText("Uploaded 1", { timeout: 60_000 });
  await expect(page.locator(".queue-row")).toHaveCount(0);
  await expect(page.getByLabel("Caption for this batch")).toHaveValue("");
  await expect(page.getByRole("button", { name: "4th floor" })).toHaveAttribute("aria-pressed", "true"); // area stays

  const [stored] = await adminPhotos(request, "e2e-upload");
  expect(stored).toMatchObject({ caption: "<b>E2E</b> slab pour", area: "4th floor", hidden: false });
  const img = await request.get(stored.srcset["960"]);
  expect(img.headers()["content-type"]).toBe("image/webp");
  expect((await img.body()).subarray(8, 12).toString("ascii")).toBe("WEBP");

  await library(page).setInputFiles({ name: "again.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await uploadButton(page).click();
  await expect(page.locator(".queue-summary")).toHaveText("Uploaded 0 · 1 already uploaded", { timeout: 60_000 });
});

test("area pills come from the project's photos and reload per project", async ({ page, request }) => {
  const jpeg = await jpegFromPage(page, `area ${Date.now()}`);
  await library(page).setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await page.getByRole("button", { name: "+ Add" }).click();
  await page.getByLabel("New area").fill("Lobby");
  await page.getByLabel("New area").press("Enter");
  await uploadButton(page).click();
  await expect(page.locator(".queue-summary")).toHaveText("Uploaded 1", { timeout: 60_000 });

  await page.reload();
  await page.getByLabel("Project").selectOption("e2e-upload");
  const pill = page.getByRole("button", { name: "Lobby" });
  await expect(pill).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("Project").selectOption("e2e-empty");
  await expect(page.getByRole("button", { name: "Lobby" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ Add" })).toBeVisible();
  expect((await adminPhotos(request, "e2e-upload"))[0]?.area).toBe("Lobby");
});

test("a per-photo caption overrides the batch caption; Remove drops a row", async ({ page, request }) => {
  await library(page).setInputFiles([
    { name: "one.jpg", mimeType: "image/jpeg", buffer: await jpegFromPage(page, `one ${Date.now()}`) },
    { name: "two.jpg", mimeType: "image/jpeg", buffer: await jpegFromPage(page, `two ${Date.now()}`) },
    { name: "three.jpg", mimeType: "image/jpeg", buffer: await jpegFromPage(page, `three ${Date.now()}`) },
  ]);
  await expect(uploadButton(page)).toHaveText("Upload 3 photos");
  await page.getByRole("button", { name: "Remove photo" }).nth(2).click();
  await expect(uploadButton(page)).toHaveText("Upload 2 photos");
  await page.getByLabel("Caption for this batch").fill("Batch");
  await page.getByLabel("Photo caption").first().fill("Own caption");
  await uploadButton(page).click();
  await expect(page.locator(".queue-summary")).toHaveText("Uploaded 2", { timeout: 60_000 });
  expect((await adminPhotos(request, "e2e-upload")).map((p) => p.caption).sort()).toEqual(["Batch", "Own caption"]);
});

test("removing the last failed row ends the batch: its caption does not carry into the next batch", async ({ page, request }) => {
  const okJpeg = await jpegFromPage(page, `ok ${Date.now()}`);
  const badJpeg = await jpegFromPage(page, `bad ${Date.now()}`);
  let posts = 0;
  await page.route("**/api/admin/photos", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    if (posts === 2) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
    return route.continue();
  });
  await library(page).setInputFiles([
    { name: "ok.jpg", mimeType: "image/jpeg", buffer: okJpeg },
    { name: "bad.jpg", mimeType: "image/jpeg", buffer: badJpeg },
  ]);
  await page.getByLabel("Caption for this batch").fill("Stale caption");
  await uploadButton(page).click();
  await expect(page.locator(".queue-row .status-text.is-error")).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByLabel("Caption for this batch")).toHaveValue("Stale caption");
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByLabel("Caption for this batch")).toHaveValue("");

  await library(page).setInputFiles({ name: "next.jpg", mimeType: "image/jpeg", buffer: await jpegFromPage(page, `next ${Date.now()}`) });
  await uploadButton(page).click();
  await expect(page.locator(".queue-summary")).toHaveText("Uploaded 1", { timeout: 60_000 });
  const stored = await adminPhotos(request, "e2e-upload");
  expect(stored).toHaveLength(2);
  expect(stored.filter((p) => p.caption === "Stale caption")).toHaveLength(1); // only the first batch's photo
});

