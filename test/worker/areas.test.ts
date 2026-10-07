import { describe, expect, it } from "vitest";
import type { AreaCount } from "../../src/shared/types";
import { harness, seedPhoto, seedProject } from "./helpers";

describe("GET /api/admin/projects/:slug/areas", () => {
  it("lists the project's areas, most-used first, including hidden photos", async () => {
    const slug = await seedProject();
    const other = await seedProject();
    await seedPhoto(slug, { area: "Lobby" });
    await seedPhoto(slug, { area: "4th floor" });
    await seedPhoto(slug, { area: "4th floor", hidden: true });
    await seedPhoto(slug, { area: "Roof" });
    await seedPhoto(slug, { area: null });
    await seedPhoto(other, { area: "Basement" });
    const res = await harness().admin(`/api/admin/projects/${slug}/areas`);
    expect(res.status).toBe(200);
    expect((await res.json()) as AreaCount[]).toEqual([
      { area: "4th floor", count: 2 },
      { area: "Lobby", count: 1 },
      { area: "Roof", count: 1 },
    ]);
  });

  it("caps the list at 20", async () => {
    const slug = await seedProject();
    for (let i = 0; i < 25; i++) await seedPhoto(slug, { area: `Area ${String(i).padStart(2, "0")}` });
    const list = (await (await harness().admin(`/api/admin/projects/${slug}/areas`)).json()) as AreaCount[];
    expect(list).toHaveLength(20);
  });

  it("404s for an unknown project and requires Access", async () => {
    expect((await harness().admin("/api/admin/projects/nope/areas")).status).toBe(404);
    expect((await harness().call("/api/admin/projects/nope/areas")).status).toBe(401);
  });
});
