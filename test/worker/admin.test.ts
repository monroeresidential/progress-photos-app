import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import type { AdminPhoto, FeedPage, ProjectSummary } from "../../src/shared/types";
import { harness, listKeys, seedPhoto, seedProject, TEST_BASE } from "./helpers";

const json = (body: unknown) => ({ method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function seedWithObjects(slug: string) {
  const id = await seedPhoto(slug);
  for (const w of [480, 960, 1920]) await env.PHOTOS.put(`${slug}/${id}-${w}w.webp`, new Uint8Array([w % 256]));
  return id;
}

describe("admin routes", () => {
  it("lists projects", async () => {
    const slug = await seedProject({ name: "Birken Lofts" });
    const res = await harness().admin("/api/admin/projects");
    const list = (await res.json()) as ProjectSummary[];
    expect(list).toContainEqual({ slug, name: "Birken Lofts", siteUrl: `https://${slug}.example/progress/` });
  });

  it("lists photos including hidden ones, flagged", async () => {
    const slug = await seedProject();
    const visible = await seedPhoto(slug, { takenAt: "2026-10-06T10:00:00-05:00" });
    const hidden = await seedPhoto(slug, { takenAt: "2026-10-06T09:00:00-05:00", hidden: true });
    const page = (await (await harness().admin(`/api/admin/photos?project=${slug}`)).json()) as FeedPage<AdminPhoto>;
    expect(page.photos.map((p) => [p.id, p.hidden])).toEqual([[visible, false], [hidden, true]]);
  });

  it("requires a known project for the photo list", async () => {
    expect((await harness().admin("/api/admin/photos")).status).toBe(400);
    expect((await harness().admin("/api/admin/photos?project=nope")).status).toBe(404);
  });

  it("edits the caption and hides/unhides", async () => {
    const slug = await seedProject();
    const id = await seedPhoto(slug);
    const h = harness();
    const a = (await (await h.admin(`/api/admin/photos/${id}`, json({ caption: " New caption " }))).json()) as AdminPhoto;
    expect(a).toMatchObject({ id, caption: "New caption", hidden: false });
    const b = (await (await h.admin(`/api/admin/photos/${id}`, json({ hidden: true }))).json()) as AdminPhoto;
    expect(b).toMatchObject({ caption: "New caption", hidden: true });
    const c = (await (await h.admin(`/api/admin/photos/${id}`, json({ caption: null, hidden: false }))).json()) as AdminPhoto;
    expect(c).toMatchObject({ caption: null, hidden: false });
  });

  it.each([
    ["an empty body", {}],
    ["a long caption", { caption: "x".repeat(281) }],
    ["a non-boolean hidden", { hidden: "yes" }],
    ["a non-object", [1]],
  ])("400s on PATCH with %s", async (_name, body) => {
    const slug = await seedProject();
    const id = await seedPhoto(slug);
    expect((await harness().admin(`/api/admin/photos/${id}`, json(body))).status).toBe(400);
  });

  it("404s on PATCH/DELETE of an unknown photo", async () => {
    const h = harness();
    expect((await h.admin("/api/admin/photos/01J9Z3K5Q8W2E4R6T8Y0V2X4Z6", json({ hidden: true }))).status).toBe(404);
    expect((await h.admin("/api/admin/photos/01J9Z3K5Q8W2E4R6T8Y0V2X4Z6", { method: "DELETE" })).status).toBe(404);
  });

  it("deletes the row and objects, then purges image and first-page feed URLs", async () => {
    const slug = await seedProject();
    const id = await seedWithObjects(slug);
    const h = harness({ env: { CF_PURGE_TOKEN: "purge-token" } });
    const res = await h.admin(`/api/admin/photos/${id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await env.DB.prepare("SELECT id FROM photos WHERE id = ?").bind(id).first()).toBeNull();
    expect(await listKeys(`${slug}/`)).toEqual([]);

    const purge = h.fetchCalls.find((r) => r.url.startsWith("https://api.cloudflare.com/"))!;
    expect(purge.url).toBe("https://api.cloudflare.com/client/v4/zones/zone123/purge_cache");
    expect(purge.headers.get("Authorization")).toBe("Bearer purge-token");
    expect(await purge.json()).toEqual({
      files: [
        `${TEST_BASE}/img/${slug}/${id}-480w.webp`,
        `${TEST_BASE}/img/${slug}/${id}-960w.webp`,
        `${TEST_BASE}/img/${slug}/${id}-1920w.webp`,
        `${TEST_BASE}/api/feed/${slug}`,
      ],
    });
  });

  it("keeps the delete and reports purged:false when the purge fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const slug = await seedProject();
      const id = await seedWithObjects(slug);
      const res = await harness({ env: { CF_PURGE_TOKEN: "t" }, purge: "fail" }).admin(`/api/admin/photos/${id}`, { method: "DELETE" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ purged: false });
      expect(await listKeys(`${slug}/`)).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("reports purged:false without calling the API when no purge token is set", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const slug = await seedProject();
      const id = await seedWithObjects(slug);
      const h = harness();
      const res = await h.admin(`/api/admin/photos/${id}`, { method: "DELETE" });
      expect(await res.json()).toEqual({ purged: false });
      expect(h.fetchCalls.some((r) => r.url.startsWith("https://api.cloudflare.com/"))).toBe(false);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
