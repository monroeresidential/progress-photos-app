import { describe, expect, it } from "vitest";
import type { FeedPage } from "../../src/shared/types";
import { allFeedPages, harness, seedPhoto, seedProject, TEST_BASE } from "./helpers";

const minute = (i: number) => `2026-09-01T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00-05:00`;

describe("GET /api/feed/:project", () => {
  it("404s with the error shape for an unknown project", async () => {
    const res = await harness().call("/api/feed/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "unknown_project" });
  });

  it("returns visible photos newest first in the spec's shape", async () => {
    const slug = await seedProject({ name: "Birken Lofts" });
    const older = await seedPhoto(slug, { takenAt: "2026-10-05T09:00:00-05:00" });
    const newer = await seedPhoto(slug, { takenAt: "2026-10-06T14:12:00-05:00", caption: "Fourth-floor slab pour" });
    await seedPhoto(slug, { takenAt: "2026-10-06T15:00:00-05:00", hidden: true });

    const res = await harness().call(`/api/feed/${slug}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
    const body = (await res.json()) as FeedPage;
    expect(body.project).toEqual({ slug, name: "Birken Lofts" });
    expect(body.nextCursor).toBeNull();
    expect(body.photos.map((p) => p.id)).toEqual([newer, older]);
    expect(body.photos[0]).toEqual({
      id: newer,
      takenAt: "2026-10-06T14:12:00-05:00",
      caption: "Fourth-floor slab pour",
      width: 1920,
      height: 1440,
      srcset: {
        "480": `${TEST_BASE}/img/${slug}/${newer}-480w.webp`,
        "960": `${TEST_BASE}/img/${slug}/${newer}-960w.webp`,
        "1920": `${TEST_BASE}/img/${slug}/${newer}-1920w.webp`,
      },
    });
  });

  it("orders by instant, not by offset string", async () => {
    const slug = await seedProject();
    const a = await seedPhoto(slug, { takenAt: "2026-10-06T10:00:00-05:00" }); // 15:00Z — newer
    const b = await seedPhoto(slug, { takenAt: "2026-10-06T14:00:00+02:00" }); // 12:00Z — older
    const body = (await (await harness().call(`/api/feed/${slug}`)).json()) as FeedPage;
    expect(body.photos.map((p) => p.id)).toEqual([a, b]);
  });

  it("pages 24 at a time and returns every photo exactly once", async () => {
    const slug = await seedProject();
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(await seedPhoto(slug, { takenAt: minute(i) }));
    const pages = await allFeedPages(harness().call, `/api/feed/${slug}`);
    expect(pages.map((p) => p.photos.length)).toEqual([24, 24, 2]);
    const seen = pages.flatMap((p) => p.photos.map((x) => x.id));
    expect(seen).toHaveLength(50);
    expect(new Set(seen)).toEqual(ids);
  });

  it("has no gaps or repeats when photos are added between page fetches", async () => {
    const slug = await seedProject();
    const original = new Set<string>();
    for (let i = 0; i < 30; i++) original.add(await seedPhoto(slug, { takenAt: minute(60 + i) }));
    const h = harness();
    const p1 = (await (await h.call(`/api/feed/${slug}`)).json()) as FeedPage;
    await seedPhoto(slug, { takenAt: "2026-09-20T12:00:00-05:00" }); // newer than everything: belongs on a fresh page 1
    const older = await seedPhoto(slug, { takenAt: "2026-08-01T12:00:00-05:00" });
    const p2 = (await (await h.call(`/api/feed/${slug}?cursor=${p1.nextCursor}`)).json()) as FeedPage;
    const seen = [...p1.photos, ...p2.photos].map((p) => p.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(new Set([...original, older]));
    expect(p2.nextCursor).toBeNull();
  });

  it("400s on a malformed cursor", async () => {
    const slug = await seedProject();
    const res = await harness().call(`/api/feed/${slug}?cursor=garbage`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_cursor" });
  });

  it("echoes CORS only for the project's allowed origins", async () => {
    const slug = await seedProject({ origins: ["https://birkenlofts.com"] });
    const h = harness();
    const ok = await h.call(`/api/feed/${slug}`, { headers: { Origin: "https://birkenlofts.com" } });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://birkenlofts.com");
    expect(ok.headers.get("Vary")).toBe("Origin");
    const other = await h.call(`/api/feed/${slug}`, { headers: { Origin: "https://evil.example" } });
    expect(other.status).toBe(200);
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
