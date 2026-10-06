import { expect, test, type Page } from "@playwright/test";

test.skip(({ browserName }) => browserName !== "chromium", "upload flow runs once, in Chromium");

async function makeJpeg(page: Page, seed: string): Promise<Buffer> {
  const b64 = await page.evaluate(async (text) => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 900;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#a33";
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = "#fff";
    ctx.font = "48px sans-serif";
    ctx.fillText(text, 40, 100);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.9));
    let s = "";
    for (const x of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(x);
    return btoa(s);
  }, seed);
  return Buffer.from(b64, "base64");
}

test("uploads a photo, flags a re-upload as duplicate, and manages it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Project").selectOption("e2e-upload");
  const jpeg = await makeJpeg(page, `photo ${Date.now()}`);
  const pick = page.locator('input[type="file"]');

  await pick.setInputFiles({ name: "site.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await page.getByLabel("Caption for this batch").fill("<b>E2E</b> slab pour");
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.locator(".status-text").first()).toHaveText("Done", { timeout: 60_000 });
  await expect(page.getByRole("link", { name: "View on site" })).toHaveAttribute("href", "http://host.test/progress/");

  await pick.setInputFiles({ name: "site-again.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.locator(".status-text").last()).toHaveText("Duplicate (already uploaded)", { timeout: 60_000 });

  // The stored 960w variant is a real WebP the Worker accepted.
  const feed = await (await page.request.get("/api/feed/e2e-upload")).json();
  expect(feed.photos).toHaveLength(1);
  expect(feed.photos[0]).toMatchObject({ caption: "<b>E2E</b> slab pour", width: 960, height: 720 });
  const img = await page.request.get(feed.photos[0].srcset["960"]);
  expect(img.headers()["content-type"]).toBe("image/webp");
  expect((await img.body()).subarray(8, 12).toString("ascii")).toBe("WEBP");

  await page.getByRole("tab", { name: "Manage" }).click();
  const caption = page.getByRole("textbox", { name: "Caption" }).first();
  await expect(caption).toHaveValue("<b>E2E</b> slab pour");
  await caption.fill("Edited caption");
  await page.getByRole("button", { name: "Save" }).first().click();
  await expect(page.getByText("Saved")).toBeVisible(); // the PATCH has completed before Hide fires another
  await expect(page.getByText("Saved")).toBeVisible(); // the PATCH has completed before Hide fires another
  await page.getByRole("button", { name: "Hide" }).first().click();
  await expect(page.getByRole("button", { name: "Unhide" }).first()).toBeVisible();
  // Check via the admin list: the public feed is edge-cached for 60 s, so it may still show the photo.
  const admin = await (await page.request.get("/api/admin/photos?project=e2e-upload")).json();
  expect(admin.photos[0]).toMatchObject({ caption: "Edited caption", hidden: true });

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByText("No photos yet.")).toBeVisible();
});
