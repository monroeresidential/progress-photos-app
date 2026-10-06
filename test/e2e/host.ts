import type { Page } from "@playwright/test";
import { solidPng } from "../../scripts/lib/png.ts";

const IMAGE = solidPng(480, 360, [180, 120, 90]);

/** Opens a page on http://host.test (an allowed origin) that embeds the feed from localhost:8787. */
export async function openHost(
  page: Page,
  o: { project: string; style?: string; fallback?: string; delayImages?: Promise<void> },
): Promise<void> {
  await page.route("**/img/**", async (route) => {
    await o.delayImages;
    await route.fulfill({ contentType: "image/png", body: IMAGE });
  });
  await page.route("http://host.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
        <script type="module" src="http://localhost:8787/embed.js"></script></head>
        <body style="margin:0;font-family:sans-serif"><h1>Host</h1>
        <progress-feed project="${o.project}" style="${o.style ?? ""}">${o.fallback ?? ""}</progress-feed>
        </body></html>`,
    }),
  );
  await page.goto("http://host.test/");
}
