import { expect, test } from "@playwright/test";
import { inflateSync } from "node:zlib";
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

// Seeded ids (scripts/seed-e2e.ts): feed index i is seed n = 11 - i on the newest day.
const seedId = (n: number) => `01J9E2E00000000000000000${"0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Math.floor(n / 32)]}${"0123456789ABCDEFGHJKMNPQRSTVWXYZ"[n % 32]}`;
const PHOTO = [0, 1, 2, 3].map((i) => seedId(11 - i));

type RGB = [number, number, number];
const RED: RGB = [220, 30, 30];
const GREEN: RGB = [30, 200, 30];
const BLUE: RGB = [30, 30, 220];

/** RGB of the top-left pixel of a PNG (every PNG filter leaves the first pixel's bytes raw). */
function firstPixel(png: Buffer): RGB {
  const idat: Buffer[] = [];
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o);
    if (png.toString("ascii", o + 4, o + 8) === "IDAT") idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return [raw[1]!, raw[2]!, raw[3]!];
}

const near = (a: RGB, b: RGB) => a.every((v, i) => Math.abs(v - b[i]!) < 40);

/** Samples the screen pixel at the centre of the viewer image for `ms`; counts frames showing `color`. */
async function sightings(page: import("@playwright/test").Page, color: RGB, ms: number): Promise<number> {
  const img = page.locator("progress-feed").locator(".viewer-img");
  let seen = 0;
  for (const end = Date.now() + ms; Date.now() < end; ) {
    const box = await img.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      const shot = await page.screenshot({ clip: { x: box.x + box.width / 2, y: box.y + box.height / 2, width: 1, height: 1 } });
      if (near(firstPixel(shot), color)) seen++;
    }
    await page.waitForTimeout(40);
  }
  return seen;
}

test("viewer never shows the previous photo while the next one loads", async ({ page }) => {
  await openHost(page, {
    project: "e2e-feed",
    imageDelayMs: (url) => (url.includes(PHOTO[3]!) ? 2000 : 0),
    imageColor: (url) => (url.includes(PHOTO[0]!) ? RED : url.includes(PHOTO[3]!) ? BLUE : undefined),
  });
  await feed(page).locator(".open").nth(0).click();
  await expect.poll(() => sightings(page, RED, 100)).toBeGreaterThan(0); // photo 0 on screen
  await page.keyboard.press("Escape");

  await feed(page).locator(".open").nth(3).click();
  // Photo 3 takes 2 s to arrive; photo 0 must not be on screen at any point meanwhile.
  expect(await sightings(page, RED, 1200)).toBe(0);
  await expect.poll(() => sightings(page, BLUE, 100), { timeout: 10_000 }).toBeGreaterThan(0);
});

test("viewer: rapid steps never reveal an earlier photo over a newer one", async ({ page }) => {
  await openHost(page, {
    project: "e2e-feed",
    imageDelayMs: (url) => (url.includes(PHOTO[2]!) ? 2000 : 0),
    imageColor: (url) => (url.includes(PHOTO[1]!) ? GREEN : url.includes(PHOTO[2]!) ? BLUE : undefined),
  });
  await feed(page).locator(".open").nth(0).click();
  await expect(feed(page).locator(".viewer-stage")).not.toHaveClass(/loading/);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight"); // lands on the slow photo before the previous one is shown
  expect(await sightings(page, GREEN, 1200)).toBe(0);
  await expect.poll(() => sightings(page, BLUE, 100), { timeout: 10_000 }).toBeGreaterThan(0);
});

test("viewer: counter and large SVG arrows", async ({ page }) => {
  await openHost(page, { project: "e2e-feed" });
  await feed(page).locator(".open").first().click();
  const counter = feed(page).locator(".viewer-counter");
  await expect(counter).toHaveText(/^1 \/ \d+\+?$/);
  await page.keyboard.press("ArrowRight");
  await expect(counter).toHaveText(/^2 \/ \d+\+?$/);
  for (const cls of [".prev", ".next", ".close"]) {
    const button = feed(page).locator(`.overlay ${cls}`);
    await expect(button.locator("svg")).toBeAttached();
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(56);
    expect(box.height).toBeGreaterThanOrEqual(56);
  }
  await expect(feed(page).locator(".overlay .next")).toHaveCSS("background-color", "rgba(0, 0, 0, 0.6)");
});

test("viewer: counter shows the total once every page has loaded", async ({ page }) => {
  await openHost(page, { project: "e2e-feed" });
  for (let i = 0; i < 20 && !(await feed(page).locator(".end").isVisible()); i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
  }
  await expect(feed(page).locator(".photo")).toHaveCount(60);
  await feed(page).locator(".open").first().click();
  await expect(feed(page).locator(".viewer-counter")).toHaveText("1 / 60");
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

test("removing the element while the viewer is open restores page scrolling", async ({ page }) => {
  await openHost(page, { project: "e2e-feed" });
  await feed(page).locator(".open").first().click();
  await expect(feed(page).locator(".overlay")).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe("hidden");
  await page.evaluate(() => document.querySelector("progress-feed")!.remove());
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe("hidden");
});

test("photos carry project + caption alt text, in the grid and the viewer", async ({ page }) => {
  await openHost(page, { project: "e2e-feed" });
  const first = feed(page).locator(".open img").first();
  await expect(first).toHaveAttribute("alt", `E2E Feed – <img src=x onerror="window.__xss=1">`);
  await expect(feed(page).locator(".open img").nth(2)).toHaveAttribute("alt", "E2E Feed construction progress, September 30, 2026");
  await feed(page).locator(".open").first().click();
  await expect(feed(page).locator(".viewer-img")).toHaveAttribute("alt", `E2E Feed – <img src=x onerror="window.__xss=1">`);
});
