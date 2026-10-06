import { describe, expect, it } from "vitest";
import { harness, listKeys, seedProject, TEST_BASE, uploadForm } from "./helpers";

describe("requireSameOrigin", () => {
  it("refuses a POST from a foreign Origin and stores nothing", async () => {
    const slug = await seedProject();
    const res = await harness().admin("/api/admin/photos", { method: "POST", body: uploadForm({ project: slug }), headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "cross_origin" });
    expect(await listKeys(`${slug}/`)).toEqual([]);
  });

  it("refuses Sec-Fetch-Site: cross-site without an Origin", async () => {
    const slug = await seedProject();
    const res = await harness().admin("/api/admin/photos", { method: "POST", body: uploadForm({ project: slug }), headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(res.status).toBe(403);
  });

  it("allows the app's own Origin", async () => {
    const slug = await seedProject();
    const res = await harness().admin("/api/admin/photos", { method: "POST", body: uploadForm({ project: slug }), headers: { Origin: TEST_BASE } });
    expect(res.status).toBe(201);
  });

  it("does not affect reads", async () => {
    const res = await harness().admin("/api/admin/whoami", { headers: { Origin: "https://evil.example" } });
    expect(res.status).toBe(200);
  });
});
