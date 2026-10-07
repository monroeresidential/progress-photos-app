import { test } from "@playwright/test";
import { addPhoto, clearProject } from "./admin-api";

// Manual check against design_handoff_progress_photos/screens/1a-*.png. Run: VISUAL=1 npx playwright test visual --project chromium
test.skip(!process.env.VISUAL, "visual snapshots are opt-in");

for (const colorScheme of ["light", "dark"] as const) {
  test(`screens (${colorScheme})`, async ({ browser, request }) => {
    let page;
    try {
      await clearProject(request, "e2e-manage");
      await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:52:00-05:00", caption: "4th floor post demolition", area: "4th floor" });
      await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:51:00-05:00", caption: "Hidden one", hidden: true });
      page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme, reducedMotion: "reduce", baseURL: "http://localhost:8787" });
      await page.goto("/");
      await page.getByLabel("Project").selectOption("e2e-manage");
      await page.screenshot({ path: `test-results/reskin/${colorScheme}-upload.png` });
      await page.getByRole("tab", { name: "Manage" }).click();
      await page.locator(".card").first().waitFor();
      await page.screenshot({ path: `test-results/reskin/${colorScheme}-manage.png` });
      await page.locator(".card-photo").first().click();
      await page.getByRole("dialog", { name: "Photo" }).waitFor({ state: "visible" });
      await page.screenshot({ path: `test-results/reskin/${colorScheme}-viewer.png` });
    } finally {
      if (page) await page.close();
    }
  });
}
