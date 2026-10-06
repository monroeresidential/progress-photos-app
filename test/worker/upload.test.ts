import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIND_BY_FINGERPRINT } from "../../src/worker/photos";
import { fakeWebp, harness, listKeys, randomHex, seedPhoto, seedProject, uploadForm } from "./helpers";

const post = (h: ReturnType<typeof harness>, form: FormData) => h.admin("/api/admin/photos", { method: "POST", body: form });

afterEach(() => vi.restoreAllMocks());

describe("POST /api/admin/photos", () => {
  it("stores every width in R2 and the row in D1", async () => {
    const slug = await seedProject();
    const res = await post(harness(), uploadForm({ project: slug, caption: "  Slab pour  " }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await listKeys(`${slug}/`)).toEqual([`${slug}/${id}-1920w.webp`, `${slug}/${id}-480w.webp`, `${slug}/${id}-960w.webp`]);
    const row = await env.DB.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      project_slug: slug,
      taken_at: "2026-10-06T14:12:00-05:00",
      taken_utc: "2026-10-06T19:12:00.000Z",
      uploaded_by: "uploader@example.com",
      caption: "Slab pour",
      width: 1920,
      height: 1440,
      widths: "[480,960,1920]",
      hidden: 0,
    });
  });

  it("stores a sub-480 original once at its own width", async () => {
    const slug = await seedProject();
    const res = await post(harness(), uploadForm({ project: slug, width: 400, height: 300, files: { w400: fakeWebp(400, 300) } }));
    expect(res.status).toBe(201);
    expect(await listKeys(`${slug}/`)).toHaveLength(1);
  });

  it("returns the existing id for a repeated fingerprint and stores nothing new", async () => {
    const slug = await seedProject();
    const fingerprint = randomHex();
    const first = (await (await post(harness(), uploadForm({ project: slug, fingerprint }))).json()) as { id: string };
    const res = await post(harness(), uploadForm({ project: slug, fingerprint }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: first.id, duplicate: true });
    expect(await listKeys(`${slug}/`)).toHaveLength(3);
  });

  it("404s for an unknown project", async () => {
    const res = await post(harness(), uploadForm({ project: "no-such-project" }));
    expect(res.status).toBe(404);
  });

  it.each([
    ["non-WebP bytes", { files: { w480: new TextEncoder().encode("x".repeat(64)), w960: fakeWebp(960, 720), w1920: fakeWebp(1920, 1440) } }],
    ["a width that doesn't match its field", { files: { w480: fakeWebp(480, 360), w960: fakeWebp(900, 675), w1920: fakeWebp(1920, 1440) } }],
    ["a height that doesn't match the aspect ratio", { files: { w480: fakeWebp(480, 300), w960: fakeWebp(960, 720), w1920: fakeWebp(1920, 1440) } }],
    ["a missing width", { files: { w480: fakeWebp(480, 360), w960: fakeWebp(960, 720) } }],
    ["an unexpected extra width", { width: 960, height: 720, files: { w480: fakeWebp(480, 360), w960: fakeWebp(960, 720), w1920: fakeWebp(1920, 1440) } }],
    ["a declared width that isn't a stored width", { width: 1500, height: 1125 }],
    ["a 281-character caption", { caption: "x".repeat(281) }],
    ["takenAt more than a day in the future", { takenAt: new Date(Date.now() + 26 * 3600_000).toISOString() }],
    ["takenAt without an offset", { takenAt: "2026-10-06T14:12:00" }],
    ["a malformed fingerprint", { fingerprint: "abc" }],
  ])("400s and stores nothing for %s", async (_name, overrides) => {
    const slug = await seedProject();
    const res = await post(harness(), uploadForm({ project: slug, ...overrides }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_request" });
    expect(await listKeys(`${slug}/`)).toEqual([]);
  });

  it("accepts a 280-character caption and takenAt within a day ahead", async () => {
    const slug = await seedProject();
    const res = await post(harness(), uploadForm({ project: slug, caption: "x".repeat(280), takenAt: new Date(Date.now() + 12 * 3600_000).toISOString() }));
    expect(res.status).toBe(201);
  });

  it("413s for a file over its size limit", async () => {
    const slug = await seedProject();
    const files = { w480: fakeWebp(480, 360, 150 * 1024 + 1), w960: fakeWebp(960, 720), w1920: fakeWebp(1920, 1440) };
    const res = await post(harness(), uploadForm({ project: slug, files }));
    expect(res.status).toBe(413);
    expect(await listKeys(`${slug}/`)).toEqual([]);
  });

  it("deletes the R2 objects and 500s when the D1 insert fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const slug = await seedProject();
    const failingDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            if (sql.startsWith("INSERT INTO photos")) throw new Error("simulated D1 failure");
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const res = await post(harness({ env: { DB: failingDb } }), uploadForm({ project: slug }));
    expect(res.status).toBe(500);
    expect(await listKeys(`${slug}/`)).toEqual([]);
  });

  it("treats a concurrent duplicate (UNIQUE conflict on insert) as a duplicate and cleans up", async () => {
    const slug = await seedProject();
    const fingerprint = randomHex();
    const existing = await seedPhoto(slug, { fingerprint });
    let skipped = false;
    const racyDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            if (!skipped && sql === FIND_BY_FINGERPRINT) {
              skipped = true; // the first dedupe check "misses", as if the other upload hadn't committed yet
              return { bind: () => ({ first: async () => null }) } as unknown as D1PreparedStatement;
            }
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const res = await post(harness({ env: { DB: racyDb } }), uploadForm({ project: slug, fingerprint }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: existing, duplicate: true });
    expect(await listKeys(`${slug}/`)).toEqual([]);
  });

  it("keeps the R2 objects and returns 201 when the insert commits but the call throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const slug = await seedProject();
    const lossyDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare") {
          return (sql: string) => {
            const stmt = target.prepare(sql);
            if (!sql.startsWith("INSERT INTO photos")) return stmt;
            return {
              bind: (...args: unknown[]) => {
                const bound = stmt.bind(...args);
                return {
                  run: async () => {
                    await bound.run();
                    throw new Error("response lost");
                  },
                };
              },
            } as unknown as D1PreparedStatement;
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const res = await post(harness({ env: { DB: lossyDb } }), uploadForm({ project: slug }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await env.DB.prepare("SELECT id FROM photos WHERE id = ?").bind(id).first()).toEqual({ id });
    expect(await listKeys(`${slug}/`)).toHaveLength(3);
  });
});
