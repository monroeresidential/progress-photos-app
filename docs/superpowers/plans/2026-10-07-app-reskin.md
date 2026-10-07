# Upload App Reskin ("Journal") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the upload PWA (`src/app/`) to the Journal design and add Take photo, area tags, a day-grouped Manage list, a full-screen admin viewer and bulk Select mode, with `area` stored as real data.

**Architecture:**
- **Backend:** a nullable `photos.area` column and a `normalizeArea` validator, wired into upload and PATCH, plus a new `/api/admin/projects/:slug/areas` endpoint.
- **App:** split into focused vanilla-TS modules on the existing `h()` builder (`header`, `upload`, `manage`, `viewer`, `select`, `sheet`, `icons`), with pure, unit-tested helpers (`days.ts`, `bulk.ts`, `readCaptureTime`).
- **Embed:** the public feed and embed are untouched.

**Tech Stack:** TypeScript, Hono Worker, D1, Vite, Vitest (unit and `@cloudflare/vitest-pool-workers`), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-app-reskin-design.md`. Design reference: `design_handoff_progress_photos/README.md` and `screens/1a-*.png`.

## Global Constraints

- **Branch:** `feat/app-reskin`. Never push or merge from a task.
- **Dependencies:** none new. Icons are inline Lucide paths in `icons.ts`.
- **Public feed and embed:** `GET /api/feed/:project`, `FeedPhoto`, `src/embed/**` and `src/app/public/embed/*` must not change. `area` never appears in the public feed.
- **Area:** optional, one per photo; trimmed; empty means `null`; at most 40 characters (counted in code points), otherwise `400 { error: "bad_request", message: "Area must be 40 characters or fewer" }`.
- **`GET /api/admin/projects/:slug/areas`:**
  - returns `[{ area, count }]`;
  - covers all the project's photos including hidden ones, where `area IS NOT NULL`;
  - is ordered by `count DESC, area ASC`, with at most 20 entries;
  - returns 404 `unknown_project` for an unknown slug.
- **Light tokens:**
  - `--brand #00051B`, `--brand-100 #e8eaf1`, `--bg #f5f6f8`, `--surface #ffffff`, `--text #0b0f1f`;
  - `--fill #e9ebf0`, `--divider rgba(11,15,31,.12)`, `--danger #b42318`.
- **Dark tokens:**
  - `--bg #00051B`, `--surface #0f1530`, `--text #f2f4fa`, `--fill #161d3a`;
  - `--divider rgba(242,244,250,.18)`, `--brand #9fb3ff`, `--brand-100 #1a2350`.
- **Type:** `-apple-system, BlinkMacSystemFont, system-ui, sans-serif`; 17px with line-height 1.35; tabular numerals for times and counts.
- **Radii:** 8 (segmented option), 10 (inputs, segmented track, thumbnails), 12 (buttons), 14 (cards and photos), 999 (pills).
- **Buttons:** weight 600, a hit target of at least 44px, and a focus ring of 2px `--brand` with offset 2.
- **Viewer colors (always dark):** background `#00051B`, text `#f2f4fa`, top border `rgba(242,244,250,.15)`, caption field `#0f1530`, buttons `#161d3a`, Save `#f2f4fa` with `#00051B` text, "Live on site" tag `#1a2350` / `#dde3ff`.
- **Motion:** segmented switch 150ms; viewer fade-in 200ms; Done rows fade out. Nothing else animates, and `prefers-reduced-motion` disables all of it.
- **Kept behavior:**
  - one-at-a-time processing;
  - the 60 s upload stall timeout and Retry;
  - Duplicate detection;
  - on an expired sign-in, the queue stops with "Your sign-in expired. **Sign in again** If Retry still fails, close and reopen the app.";
  - the batch caption is captured when Upload is tapped and clears when the batch finishes, while the area stays selected;
  - the project picker is locked while uploading;
  - the last-used project is remembered (`localStorage` key `progress-photos:last-project`).
- **Copy:**
  - status labels: "Ready", "Uploading…", "Done", "Duplicate (already uploaded)", "Can't read this photo", "Failed", "Sign-in expired — sign in again, then Retry";
  - "Live on site", "Hidden", "Hidden from site";
  - "Delete this photo? This can't be undone.", "Delete N photos? This can't be undone.".
- **Commits:** end each message with a blank line and a `Co-Authored-By:` trailer naming the model that wrote it.

## Rulings made while planning (spec silent or ambiguous)

1. **Failed upload rows show a "Retry" text button** in the status line. The spec says "tapping the row retries"; a real button is accessible and is what the existing tests and users know.
2. **Partially failed bulk actions:** the failed photos stay selected and the message is "N couldn't be updated. They're still selected — tap the action again to retry." The spec says "— Retry"; this keeps one action button rather than adding a second retry path.
3. **The post-batch "View on site" link is dropped.** The header's "Live site" pill is always visible on Upload and links to the same URL.
4. **After a batch the queue summary reads "Uploaded N" (plus "· M already uploaded")**, because Done rows fade away and the result must still be visible.
5. **Dark-mode `--danger` is `#ff7a6e`.** The spec defines `--danger` only for light mode, and `#b42318` on `#00051B` fails contrast.
6. **The viewer position shows "2 of 40+" while more pages can load**, consistent with the public embed's counter.
7. **Area entries aren't otherwise normalized** (case and inner spacing are kept). The pills reuse existing values, so typos are rare; `trim` is all the spec requires.
8. **A new `sheet.ts`** provides the "⋯" action sheet and the bulk-caption prompt. The spec names both behaviors but no file for them.
9. **A new `bulk.ts`** holds the pure concurrency helper so it can be unit-tested without the DOM.

## Review Focus

1. **Typing an area with trailing spaces, or one that differs only in case from an existing pill:** expect the trimmed value to be stored and shown exactly as typed, with no server error. Test: Task 1, "trims area on upload".
2. **The project picker changes while area pills are loading:** expect the old project's areas never to appear for the new project. Test: Task 6, the "areas reload per project" e2e step.
3. **A bulk action where the session expires midway:** expect nothing more to be attempted, the remaining photos to stay selected, and the sign-in message to show. Test: Task 9, the `runBulk` unit test "stops starting work after a sign-in error".
4. **Deleting the last photo in the viewer, or the only photo:** expect the viewer to close (or move to the previous photo) without errors, and the list to update. Test: Task 8, "deleting the last photo closes the viewer".
5. **Photos taken just after midnight with a `-05:00` offset:** expect them grouped under their own local day, not the UTC day. Test: Task 4, the "groups by the photo's own calendar day" unit test.

---

## File structure

```
migrations/0002_area.sql            area column + index
src/worker/areas.ts                 normalizeArea, MAX_AREA, listAreas
src/worker/photos.ts                PhotoRow.area, NewPhoto.area, updatePhoto(area), toAdminPhoto(area)
src/worker/routes/upload.ts         reads `area` form field
src/worker/routes/admin.ts          PATCH area; GET /api/admin/projects/:slug/areas
src/shared/types.ts                 AdminPhoto.area, AreaCount
scripts/seed-e2e.ts                 applies every migration; adds project e2e-manage
src/app/theme.css                   tokens + components (replaces style.css)
src/app/icons.ts                    icon(name, size)
src/app/days.ts                     groupByDay, dayLabel, shortDayLabel, dayCounts, timeLabel, timeRange
src/app/bulk.ts                     runBulk (pure)
src/app/sheet.ts                    openSheet, promptSheet
src/app/header.ts                   mountHeader, safeHttp, Tab, SelectState
src/app/upload.ts                   Upload tab (rewritten)
src/app/manage.ts                   Manage tab (rewritten)
src/app/viewer.ts                   admin viewer
src/app/select.ts                   mountSelectFooter
src/app/api.ts                      areas(), area on patch/uploadPhoto, deleteNote()
src/app/lib/jpeg-meta.ts            + readCaptureTime
src/app/main.ts                     shell
src/app/index.html, public/manifest.webmanifest   theme colors
test/worker/areas.test.ts, upload.test.ts, admin.test.ts, helpers.ts
test/unit/app-days.test.ts, bulk.test.ts, jpeg-meta.test.ts, api.test.ts
test/e2e/admin-api.ts, app-shell.spec.ts, upload.spec.ts, manage.spec.ts, viewer.spec.ts, select.spec.ts, visual.spec.ts
docs/iphone-checklist.md, CLAUDE.md
```

---

### Task 1: `area` on photos — column, upload, PATCH, admin list

**Files:**
- Create: `migrations/0002_area.sql`, `src/worker/areas.ts`
- Modify: `src/worker/photos.ts`, `src/worker/routes/upload.ts`, `src/worker/routes/admin.ts`, `src/shared/types.ts`, `scripts/seed-e2e.ts`, `test/worker/helpers.ts`
- Test: `test/worker/upload.test.ts`, `test/worker/admin.test.ts`, `test/worker/feed.test.ts`

**Interfaces:**
- Produces:
  - `MAX_AREA = 40`;
  - `normalizeArea(s: string | null | undefined): string | null`, which throws `HttpError(400, "bad_request")`;
  - `PhotoRow.area: string | null`; `NewPhoto.area: string | null`;
  - `updatePhoto(db, id, { caption?, hidden?, area? })`;
  - `AdminPhoto.area: string | null`;
  - `AreaCount { area: string; count: number }` (used in Task 2);
  - test helpers: `seedPhoto(slug, { …, area?: string | null })` and `uploadForm({ …, area?: string })`.

- [ ] **Step 1: Migration and types**

`migrations/0002_area.sql`:
```sql
ALTER TABLE photos ADD COLUMN area TEXT;
CREATE INDEX photos_area ON photos (project_slug, area);
```

In `src/shared/types.ts`, replace the `AdminPhoto` interface and add `AreaCount`:
```ts
export interface AdminPhoto extends FeedPhoto {
  hidden: boolean;
  area: string | null;
}

export interface AreaCount {
  area: string;
  count: number;
}
```

`scripts/seed-e2e.ts` currently executes only `migrations/0001_init.sql`. Replace that single call so it applies every migration in order, and add the `e2e-manage` project that Tasks 7–9 use:
```ts
import { readdirSync } from "node:fs";
// …
for (const m of readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort()) {
  execFileSync("npx", [...d1, `migrations/${m}`], { stdio: "inherit" });
}
```
Add the project next to the existing `projectInsertSql` lines:
```ts
  projectInsertSql({ slug: "e2e-manage", name: "E2E Manage", siteUrl: "http://host.test/progress/", origins: ORIGINS }, now),
```

- [ ] **Step 2: Extend the test helpers**

In `test/worker/helpers.ts`, change `seedPhoto` to accept and insert `area`:
```ts
export async function seedPhoto(
  slug: string,
  o: { id?: string; takenAt?: string; hidden?: boolean; caption?: string | null; fingerprint?: string; widths?: number[]; area?: string | null } = {},
): Promise<string> {
  const id = o.id ?? ulid();
  const takenAt = o.takenAt ?? "2026-10-01T12:00:00-05:00";
  await env.DB.prepare(
    "INSERT INTO photos (id, project_slug, taken_at, taken_utc, uploaded_at, uploaded_by, caption, width, height, widths, fingerprint, hidden, area) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, slug, takenAt, new Date(takenAt).toISOString(), new Date().toISOString(), "seed@example.com", o.caption ?? null, 1920, 1440, JSON.stringify(o.widths ?? [480, 960, 1920]), o.fingerprint ?? randomHex(), o.hidden ? 1 : 0, o.area ?? null)
    .run();
  return id;
}
```
In `uploadForm`, add `area?: string` to the options type and, after the caption line, `if (o.area !== undefined) f.set("area", o.area);`.

- [ ] **Step 3: Write the failing tests**

Append to the `describe` in `test/worker/upload.test.ts`:
```ts
  it("stores the area, trimmed, with each photo", async () => {
    const slug = await seedProject();
    const res = await harness().admin("/api/admin/photos", { method: "POST", body: uploadForm({ project: slug, area: "  4th floor  " }) });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const row = await env.DB.prepare("SELECT area FROM photos WHERE id = ?").bind(id).first<{ area: string | null }>();
    expect(row?.area).toBe("4th floor");
  });

  it("stores no area when the field is empty or missing", async () => {
    const slug = await seedProject();
    for (const area of ["", "   ", undefined]) {
      const res = await harness().admin("/api/admin/photos", { method: "POST", body: uploadForm({ project: slug, area }) });
      const { id } = (await res.json()) as { id: string };
      const row = await env.DB.prepare("SELECT area FROM photos WHERE id = ?").bind(id).first<{ area: string | null }>();
      expect(row?.area).toBeNull();
    }
  });

  it("rejects an area over 40 characters", async () => {
    const slug = await seedProject();
    const res = await harness().admin("/api/admin/photos", { method: "POST", body: uploadForm({ project: slug, area: "x".repeat(41) }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request", message: "Area must be 40 characters or fewer" });
  });

  it("keeps the original area on a duplicate upload", async () => {
    const slug = await seedProject();
    const fingerprint = randomHex();
    const first = await harness().admin("/api/admin/photos", { method: "POST", body: uploadForm({ project: slug, fingerprint, area: "Lobby" }) });
    const { id } = (await first.json()) as { id: string };
    const again = await harness().admin("/api/admin/photos", { method: "POST", body: uploadForm({ project: slug, fingerprint, area: "Roof" }) });
    expect(await again.json()).toEqual({ id, duplicate: true });
    const row = await env.DB.prepare("SELECT area FROM photos WHERE id = ?").bind(id).first<{ area: string }>();
    expect(row?.area).toBe("Lobby");
  });
```
Make sure `env` (from `cloudflare:workers`) and `randomHex` are imported at the top of `upload.test.ts`. Add whichever is missing.

Append to the `describe` in `test/worker/admin.test.ts`:
```ts
  it("includes area in the admin list", async () => {
    const slug = await seedProject();
    await seedPhoto(slug, { area: "Roof" });
    const page = (await (await harness().admin(`/api/admin/photos?project=${slug}`)).json()) as FeedPage<AdminPhoto>;
    expect(page.photos[0]?.area).toBe("Roof");
  });

  it("PATCH sets, clears and validates area", async () => {
    const slug = await seedProject();
    const id = await seedPhoto(slug);
    const h = harness();
    const set = (await (await h.admin(`/api/admin/photos/${id}`, json({ area: " Lobby " }))).json()) as AdminPhoto;
    expect(set.area).toBe("Lobby");
    const cleared = (await (await h.admin(`/api/admin/photos/${id}`, json({ area: null }))).json()) as AdminPhoto;
    expect(cleared.area).toBeNull();
    expect((await h.admin(`/api/admin/photos/${id}`, json({ area: "x".repeat(41) }))).status).toBe(400);
    expect((await h.admin(`/api/admin/photos/${id}`, json({ area: 5 }))).status).toBe(400);
  });
```

Append to the `describe` in `test/worker/feed.test.ts`:
```ts
  it("never exposes area in the public feed", async () => {
    const slug = await seedProject();
    await seedPhoto(slug, { area: "Roof" });
    const body = (await (await harness().call(`/api/feed/${slug}`)).json()) as { photos: Record<string, unknown>[] };
    expect(body.photos[0]).not.toHaveProperty("area");
  });
```
(Use the imports `feed.test.ts` already has for `harness`, `seedProject` and `seedPhoto`, adding any that are missing.)

- [ ] **Step 4: Run them to verify they fail**

Run: `npm run test:worker`
Expected: FAIL. The area assertions fail (`area` is undefined or the column is missing). The feed test may already pass; that's fine, it's a regression guard.

- [ ] **Step 5: Implement**

`src/worker/areas.ts`:
```ts
import type { AreaCount } from "../shared/types";
import { badRequest } from "./http";

export const MAX_AREA = 40;

export function normalizeArea(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  if (t === "") return null;
  if ([...t].length > MAX_AREA) throw badRequest(`Area must be ${MAX_AREA} characters or fewer`);
  return t;
}

/** The project's areas, most-used first; hidden photos count too. */
export async function listAreas(db: D1Database, slug: string): Promise<AreaCount[]> {
  const { results } = await db
    .prepare("SELECT area, COUNT(*) AS count FROM photos WHERE project_slug = ? AND area IS NOT NULL GROUP BY area ORDER BY count DESC, area ASC LIMIT 20")
    .bind(slug)
    .all<AreaCount>();
  return results;
}
```

In `src/worker/photos.ts`:
- Add `area: string | null;` to `PhotoRow` and to `NewPhoto`.
- In `insertPhoto`, add `area` to the column list, add one more `?`, and add `p.area` at the end of `.bind(...)`.
- Change the `updatePhoto` signature to `patch: { caption?: string | null; hidden?: boolean; area?: string | null }`, and add before `if (sets.length === 0)`:
  ```ts
  if (patch.area !== undefined) {
    sets.push("area = ?");
    params.push(patch.area);
  }
  ```
- Change `toAdminPhoto` to:
  ```ts
  export function toAdminPhoto(row: PhotoRow, base: string): AdminPhoto {
    return { ...toFeedPhoto(row, base), hidden: row.hidden === 1, area: row.area ?? null };
  }
  ```

In `src/worker/routes/upload.ts`:
- Import `normalizeArea` from `"../areas"`.
- After `const caption = normalizeCaption(...)`, add `const area = normalizeArea(field("area"));`.
- In the `insertPhoto({...})` object, add `area,`.

In `src/worker/routes/admin.ts`, extend `parsePatch`:
```ts
function parsePatch(body: unknown): { caption?: string | null; hidden?: boolean; area?: string | null } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest("Expected a JSON object");
  const b = body as Record<string, unknown>;
  const patch: { caption?: string | null; hidden?: boolean; area?: string | null } = {};
  if ("caption" in b) {
    if (b.caption === null) patch.caption = null;
    else if (typeof b.caption === "string") patch.caption = normalizeCaption(b.caption);
    else throw badRequest("caption must be a string or null");
  }
  if ("hidden" in b) {
    if (typeof b.hidden !== "boolean") throw badRequest("hidden must be true or false");
    patch.hidden = b.hidden;
  }
  if ("area" in b) {
    if (b.area === null) patch.area = null;
    else if (typeof b.area === "string") patch.area = normalizeArea(b.area);
    else throw badRequest("area must be a string or null");
  }
  if (patch.caption === undefined && patch.hidden === undefined && patch.area === undefined) throw badRequest("Nothing to update");
  return patch;
}
```
Also add `import { normalizeArea } from "../areas";`.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npm run test:worker && npm run typecheck`
Expected: all pass. The existing tests are unaffected because they compare with `toMatchObject` or per-field.

- [ ] **Step 7: Commit**

```bash
git add migrations/0002_area.sql src/worker src/shared/types.ts scripts/seed-e2e.ts test/worker
git commit -m "feat: store an optional area on each photo"
```

---

### Task 2: `GET /api/admin/projects/:slug/areas`

**Files:**
- Modify: `src/worker/routes/admin.ts`
- Test: `test/worker/areas.test.ts` (new)

**Interfaces:**
- Consumes: `listAreas(db, slug)` from Task 1, `getProject`.
- Produces: `GET /api/admin/projects/:slug/areas` → `AreaCount[]`.

- [ ] **Step 1: Write the failing test**

`test/worker/areas.test.ts`:
```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --config vitest.worker.config.ts test/worker/areas.test.ts`
Expected: FAIL. The route doesn't exist (404 JSON for the valid project).

- [ ] **Step 3: Implement**

In `src/worker/routes/admin.ts`, add `listAreas` to the `"../areas"` import. Then, inside `registerAdmin`, after the `/api/admin/projects` route:
```ts
  app.get("/api/admin/projects/:slug/areas", async (c) => {
    const project = await getProject(c.env.DB, c.req.param("slug"));
    if (!project) throw new HttpError(404, "unknown_project", "No such project");
    return c.json(await listAreas(c.env.DB, project.slug));
  });
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:worker && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/worker/routes/admin.ts test/worker/areas.test.ts
git commit -m "feat: list a project's areas for the upload tags"
```

---

### Task 3: Theme, icons and theme colors

**Files:**
- Create: `src/app/theme.css`, `src/app/icons.ts`
- Delete: `src/app/style.css`
- Modify: `src/app/main.ts` (import line only), `src/app/index.html`, `src/app/public/manifest.webmanifest`

**Interfaces:**
- Produces: `type IconName`, `icon(name: IconName, size?: number): SVGSVGElement`, and the CSS classes used by Tasks 5–9. The CSS below defines every class those tasks reference.

- [ ] **Step 1: `src/app/icons.ts`**

```ts
const SVG_NS = "http://www.w3.org/2000/svg";

/** Lucide icon paths (circles and rects written as paths), 24×24, drawn with stroke. */
const ICONS = {
  camera: ["M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z", "M9 13a3 3 0 1 0 6 0a3 3 0 1 0-6 0"],
  image: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M7 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0", "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "external-link": ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  "eye-off": [
    "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
    "M14.084 14.158a3 3 0 0 1-4.242-4.242",
    "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
    "m2 2 20 20",
  ],
  eye: ["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0"],
  "more-horizontal": ["M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0", "M18 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0", "M4 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0"],
  "trash-2": ["M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", "M10 11v6", "M14 11v6"],
  pencil: [
    "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    "m15 5 4 4",
  ],
  check: ["M20 6 9 17l-5-5"],
  plus: ["M5 12h14", "M12 5v14"],
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const attrs: Record<string, string> = {
    viewBox: "0 0 24 24",
    width: String(size),
    height: String(size),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: "icon",
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const d of ICONS[name]) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
```

- [ ] **Step 2: `src/app/theme.css`**

```css
:root {
  --brand: #00051B; --brand-100: #e8eaf1; --on-brand: #ffffff;
  --bg: #f5f6f8; --surface: #ffffff; --text: #0b0f1f; --fill: #e9ebf0;
  --divider: rgba(11, 15, 31, .12); --danger: #b42318;
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  font-size: 17px; line-height: 1.35;
  -webkit-text-size-adjust: 100%;
}
@media (prefers-color-scheme: dark) {
  :root {
    --brand: #9fb3ff; --brand-100: #1a2350; --on-brand: #00051B;
    --bg: #00051B; --surface: #0f1530; --text: #f2f4fa; --fill: #161d3a;
    --divider: rgba(242, 244, 250, .18); --danger: #ff7a6e;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); }
body { min-height: 100dvh; -webkit-tap-highlight-color: transparent; }
[hidden] { display: none !important; }
button, input, select { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.tabular { font-variant-numeric: tabular-nums; }
.muted { opacity: .6; }

/* Header */
.app-header { display: flex; flex-direction: column; gap: 12px; padding: max(16px, env(safe-area-inset-top)) 20px 0; }
.app-title { margin: 0; height: 44px; display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 600; color: var(--brand); text-align: center; }
.project-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; }
.project-picker { position: relative; display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 22px; font-weight: 700; letter-spacing: -.01em; }
.project-picker .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.project-picker .icon { flex: none; opacity: .6; }
.project-picker select { position: absolute; inset: 0; width: 100%; opacity: 0; font-size: 16px; cursor: pointer; }
.project-picker:has(select:disabled) { opacity: .5; }
.project-picker:has(select:focus-visible) { outline: 2px solid var(--brand); outline-offset: 2px; border-radius: 6px; }
.select-title { font-size: 17px; font-weight: 600; }
.seg { display: flex; background: var(--fill); border-radius: 10px; padding: 3px; }
.seg [role="tab"] { flex: 1; height: 40px; border: 0; border-radius: 8px; background: transparent; font-size: 15px; font-weight: 600; opacity: .65; cursor: pointer; transition: background-color .15s ease, box-shadow .15s ease, opacity .15s ease; }
.seg [aria-selected="true"] { background: var(--surface); opacity: 1; box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }

/* Buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 16px; border: 0; border-radius: 12px; font-weight: 600; cursor: pointer; text-decoration: none; }
.btn:disabled { opacity: .4; cursor: default; }
.btn-primary { background: var(--brand); color: var(--on-brand); }
.btn-secondary { background: var(--fill); color: var(--text); }
.btn-ghost { background: transparent; color: var(--brand); }
.btn-danger { color: var(--danger); }
.btn-sm { min-height: 36px; padding: 0 14px; font-size: 14px; }
.btn-ghost.btn-sm { min-height: 44px; }
.icon-btn { width: 44px; height: 44px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 12px; background: transparent; color: var(--text); cursor: pointer; }
.icon-btn .icon { opacity: .6; }
.link-btn { border: 0; background: none; padding: 0; color: var(--brand); font-weight: 600; font-size: 12px; cursor: pointer; }

/* Fields */
.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { font-size: 13px; font-weight: 600; opacity: .6; }
.input { width: 100%; min-height: 44px; padding: 10px 12px; border: 0; border-radius: 10px; background: var(--fill); font-size: 17px; }
.input::placeholder { color: color-mix(in srgb, var(--text) 45%, transparent); }
.pills { display: flex; flex-wrap: wrap; gap: 8px; }
.pill { height: 32px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--divider); background: transparent; font-size: 13px; cursor: pointer; }
.pill[aria-pressed="true"] { background: var(--brand-100); color: var(--brand); border-color: transparent; }
.pill-add { border-style: dashed; opacity: .7; }
.pill-input { height: 32px; width: 160px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--brand); background: var(--surface); font-size: 13px; }
.hairline { height: 1px; margin: 0; border: 0; background: var(--divider); }

/* Upload */
.tab-body { display: flex; flex-direction: column; gap: 18px; padding: 18px 20px 24px; }
.action-row { display: flex; gap: 12px; }
.action-row .btn { height: 56px; font-size: 16px; }
.action-row .btn-primary { flex: 1.4; }
.action-row .btn-secondary { flex: 1; }
.queue-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; min-height: 18px; }
.queue-summary { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; opacity: .6; }
.queue-range { font-size: 12px; opacity: .6; }
.queue { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.queue-row { display: grid; grid-template-columns: 72px 1fr 44px; gap: 12px; align-items: center; transition: opacity .3s ease; }
.queue-row.is-leaving { opacity: 0; }
.thumb { width: 72px; height: 72px; object-fit: cover; border-radius: 10px; background: var(--fill); }
.row-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.row-main .input { min-height: 40px; padding: 8px 12px; font-size: 14px; }
.row-status { display: flex; align-items: center; gap: 10px; min-height: 16px; font-size: 12px; }
.status-text { opacity: .6; }
.status-text.is-active { color: var(--brand); opacity: 1; }
.status-text.is-error { color: var(--danger); opacity: 1; }
.progress { flex: 1; height: 2px; overflow: hidden; border-radius: 1px; background: var(--divider); }
.progress-fill { width: 0; height: 100%; background: var(--brand); }
.notice { margin: 0; font-size: 14px; color: var(--danger); }
.notice a { color: inherit; font-weight: 600; }
.sticky-footer { position: sticky; bottom: 0; z-index: 5; padding: 16px 20px max(16px, env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--divider); }
.sticky-footer .btn-primary { width: 100%; height: 52px; font-size: 17px; }

/* Manage */
.manage-body { display: flex; flex-direction: column; gap: 28px; padding: 22px 20px 24px; }
.day-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-bottom: 8px; margin-bottom: 14px; border-bottom: 1px solid var(--divider); }
.day-title { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
.day-counts { font-size: 12px; opacity: .6; }
.cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
.card { display: flex; flex-direction: column; gap: 6px; }
.card-photo { position: relative; display: block; width: 100%; padding: 0; border: 0; border-radius: 14px; overflow: hidden; aspect-ratio: 4 / 3; background: var(--fill); cursor: pointer; }
.card-photo img { display: block; width: 100%; height: 100%; object-fit: cover; }
.card-info { display: grid; grid-template-columns: 1fr 44px; align-items: center; }
.card-caption { font-size: 15px; overflow-wrap: anywhere; }
.card-meta { font-size: 12px; opacity: .55; }
.card.is-hidden .card-photo img, .card.is-hidden .card-caption { opacity: .4; }
.hidden-tag { position: absolute; top: 14px; left: 14px; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; font-size: 12px; color: var(--text); background: var(--fill); border: 1px solid var(--divider); border-radius: 999px; }
.check { position: absolute; top: 12px; right: 12px; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid #fff; background: rgba(0, 0, 0, .25); color: var(--on-brand); }
.card.is-selected .card-photo { outline: 2px solid var(--brand); outline-offset: 2px; }
.card.is-selected .check { background: var(--brand); border-color: var(--brand); }
.manage-status { margin: 0; padding: 0 20px; font-size: 14px; text-align: center; }
.manage-more { align-self: center; margin: 0 20px 60px; }
.select-footer { display: flex; gap: 10px; }
.select-footer .btn { flex: 1; height: 52px; }
.select-progress { margin: 0 0 10px; font-size: 13px; text-align: center; opacity: .7; }
.select-progress:empty { display: none; }

/* Sheets */
.sheet-backdrop { position: fixed; inset: 0; z-index: 40; display: flex; align-items: flex-end; background: rgba(0, 0, 0, .4); }
.sheet, .sheet-form { width: 100%; display: flex; flex-direction: column; gap: 8px; }
.sheet { padding: 12px 20px max(20px, env(safe-area-inset-bottom)); background: var(--surface); border-radius: 14px 14px 0 0; }
.sheet .btn { width: 100%; height: 52px; font-size: 17px; }
.sheet-title { margin: 4px 0; font-size: 15px; font-weight: 600; text-align: center; }

/* Viewer — always dark */
.viewer { position: fixed; inset: 0; z-index: 30; display: flex; flex-direction: column; background: #00051B; color: #f2f4fa; animation: viewer-in .2s ease; touch-action: pan-y; }
@keyframes viewer-in { from { opacity: 0; } }
.viewer :focus-visible { outline-color: #f2f4fa; }
.viewer-top { display: grid; grid-template-columns: 44px 1fr 44px; align-items: center; padding: max(12px, env(safe-area-inset-top)) 12px 0; }
.viewer-top .icon-btn { color: #f2f4fa; }
.viewer-top .icon-btn .icon { opacity: 1; }
.viewer-pos { font-size: 13px; text-align: center; opacity: .7; }
.viewer-stage { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.viewer-stage img { width: 100%; height: 100%; object-fit: contain; transition: opacity .15s; }
.viewer-stage.loading img { opacity: 0; transition: none; }
.viewer-sheet { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px max(20px, env(safe-area-inset-bottom)); background: #00051B; border-top: 1px solid rgba(242, 244, 250, .15); }
.viewer-meta { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12px; }
.viewer-meta .when { opacity: .6; }
.status-tag { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 11px; background: #1a2350; color: #dde3ff; }
.status-tag.is-hidden { background: #161d3a; color: #f2f4fa; }
.viewer-caption { width: 100%; min-height: 44px; padding: 8px 12px; border: 0; border-radius: 10px; font-size: 15px; background: #0f1530; color: #f2f4fa; }
.viewer-actions { display: flex; gap: 10px; }
.viewer-actions .btn { flex: 1; height: 48px; font-size: 15px; background: #161d3a; color: #f2f4fa; }
.viewer-actions .btn-save { flex: 1.3; background: #f2f4fa; color: #00051B; }
.viewer-note { margin: 0; font-size: 13px; opacity: .8; }
.viewer-note:empty { display: none; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 3: Wire up the stylesheet and theme colors**

- In `src/app/main.ts`, change `import "./style.css";` to `import "./theme.css";`, then `git rm src/app/style.css`.
- In `src/app/index.html`, replace the single `theme-color` meta with:
  ```html
  <meta name="theme-color" content="#f5f6f8" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#00051B" media="(prefers-color-scheme: dark)" />
  ```
- In `src/app/public/manifest.webmanifest`, set `"theme_color": "#00051B"` and `"background_color": "#f5f6f8"`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build && npm run test:e2e`
Expected: the typecheck and build succeed, and the existing e2e suite still passes, because the old markup keeps working with the new stylesheet. If any existing upload e2e test fails only because the new CSS changes visibility, report it; Task 6 rewrites that spec.

- [ ] **Step 5: Commit**

```bash
git add src/app
git commit -m "feat(app): Journal theme tokens, components and Lucide icons"
```

---

### Task 4: Pure helpers — days, capture time, bulk runner, delete messages

**Files:**
- Create: `src/app/days.ts`, `src/app/bulk.ts`
- Modify: `src/app/lib/jpeg-meta.ts` (add `readCaptureTime`), `src/app/api.ts` (add `deleteNote`)
- Test: `test/unit/app-days.test.ts` (new), `test/unit/bulk.test.ts` (new), `test/unit/jpeg-meta.test.ts`, `test/unit/api.test.ts`

**Interfaces:**
- Produces:
  - **`days.ts`:**
    - `interface DayGroup { key: string; photos: AdminPhoto[] }`
    - `groupByDay(photos: AdminPhoto[]): DayGroup[]`, newest day first, keeping order within a day
    - `dayLabel(key: string, locale?: string): string` → "Sunday, October 5"
    - `shortDayLabel(key: string, locale?: string): string` → "Sunday, Oct 5"
    - `dayCounts(photos: { hidden: boolean }[]): string` → "4 photos · 3 live"
    - `timeLabel(takenAt: string, withSeconds?: boolean): string` → "8:52 AM" / "8:51:57 AM"
    - `timeRange(takenAts: string[], locale?: string): string` → "Oct 5, 8:51–8:52 AM"
    - re-exports `dayKey`
  - **`bulk.ts`:**
    - `interface BulkResult<T> { ok: { id: string; value: T }[]; failed: { id: string; error: unknown }[] }`
    - `runBulk<T>(ids: string[], limit: number, fn: (id: string) => Promise<T>, onProgress?: (done: number, total: number) => void): Promise<BulkResult<T>>`
  - **`jpeg-meta.ts`:** `readCaptureTime(buf: ArrayBuffer): string | null` (ISO 8601 with offset)
  - **`api.ts`:** `deleteNote(res: { purged?: boolean; objectsDeleted?: boolean } | undefined): string`

- [ ] **Step 1: Write the failing tests**

`test/unit/app-days.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { dayCounts, dayLabel, groupByDay, shortDayLabel, timeLabel, timeRange } from "../../src/app/days";
import type { AdminPhoto } from "../../src/shared/types";

const photo = (id: string, takenAt: string, hidden = false): AdminPhoto => ({ id, takenAt, hidden, area: null, caption: null, width: 1920, height: 1440, srcset: {} });

describe("groupByDay", () => {
  it("groups by the photo's own calendar day, newest day first", () => {
    const groups = groupByDay([
      photo("a", "2026-10-05T00:10:00-05:00"), // 05:10 UTC Oct 5, local Oct 5
      photo("b", "2026-10-04T23:50:00-05:00"), // 04:50 UTC Oct 5, but local Oct 4
      photo("c", "2026-10-05T08:52:00-05:00"),
    ]);
    expect(groups.map((g) => [g.key, g.photos.map((p) => p.id)])).toEqual([
      ["2026-10-05", ["a", "c"]],
      ["2026-10-04", ["b"]],
    ]);
  });
});

describe("labels", () => {
  it("formats days", () => {
    expect(dayLabel("2026-10-05", "en-US")).toBe("Monday, October 5");
    expect(shortDayLabel("2026-10-05", "en-US")).toBe("Monday, Oct 5");
  });

  it("counts photos and live ones", () => {
    expect(dayCounts([photo("a", "2026-10-05T08:00:00-05:00"), photo("b", "2026-10-05T09:00:00-05:00", true)])).toBe("2 photos · 1 live");
    expect(dayCounts([photo("a", "2026-10-05T08:00:00-05:00")])).toBe("1 photo · 1 live");
  });

  it("formats the wall-clock time from the photo's own offset", () => {
    expect(timeLabel("2026-10-05T08:52:07-05:00")).toBe("8:52 AM");
    expect(timeLabel("2026-10-05T08:51:57-05:00", true)).toBe("8:51:57 AM");
    expect(timeLabel("2026-10-05T00:05:00+02:00")).toBe("12:05 AM");
    expect(timeLabel("2026-10-05T12:30:00-05:00")).toBe("12:30 PM");
  });
});

describe("timeRange", () => {
  it("handles one time, one day, and several days", () => {
    expect(timeRange([], "en-US")).toBe("");
    expect(timeRange(["2026-10-05T08:51:00-05:00"], "en-US")).toBe("Oct 5, 8:51 AM");
    expect(timeRange(["2026-10-05T08:52:00-05:00", "2026-10-05T08:51:00-05:00"], "en-US")).toBe("Oct 5, 8:51–8:52 AM");
    expect(timeRange(["2026-10-05T11:50:00-05:00", "2026-10-05T12:10:00-05:00"], "en-US")).toBe("Oct 5, 11:50 AM–12:10 PM");
    expect(timeRange(["2026-10-04T09:10:00-05:00", "2026-10-05T08:52:00-05:00"], "en-US")).toBe("Oct 4, 9:10 AM – Oct 5, 8:52 AM");
  });
});
```
(2026-10-05 is a Monday; the handoff mock's "Sunday" was illustrative.)

`test/unit/bulk.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/app/api";
import { runBulk } from "../../src/app/bulk";

describe("runBulk", () => {
  it("runs at most `limit` at a time and reports progress", async () => {
    let active = 0;
    let peak = 0;
    const progress: number[] = [];
    const res = await runBulk(["a", "b", "c", "d", "e", "f"], 4, async (id) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return id.toUpperCase();
    }, (done) => progress.push(done));
    expect(peak).toBeLessThanOrEqual(4);
    expect(res.ok.map((o) => o.value).sort()).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(res.failed).toEqual([]);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("collects failures without stopping the rest", async () => {
    const res = await runBulk(["a", "b", "c"], 2, async (id) => {
      if (id === "b") throw new Error("nope");
      return id;
    });
    expect(res.ok.map((o) => o.id).sort()).toEqual(["a", "c"]);
    expect(res.failed.map((f) => f.id)).toEqual(["b"]);
  });

  it("stops starting work after a sign-in error and reports the untried ids as failed", async () => {
    const tried: string[] = [];
    const res = await runBulk(["a", "b", "c", "d"], 1, async (id) => {
      tried.push(id);
      if (id === "b") throw new ApiError(401, "signin_required", "Sign-in expired");
      return id;
    });
    expect(tried).toEqual(["a", "b"]);
    expect(res.ok.map((o) => o.id)).toEqual(["a"]);
    expect(res.failed.map((f) => f.id).sort()).toEqual(["b", "c", "d"]);
  });

  it("handles an empty selection", async () => {
    expect(await runBulk([], 4, async () => 1)).toEqual({ ok: [], failed: [] });
  });
});
```

Append to `test/unit/jpeg-meta.test.ts`, and add `readCaptureTime` to its existing import from `../../src/app/lib/jpeg-meta`:
```ts
describe("readCaptureTime", () => {
  it("reads DateTimeOriginal with its offset from just the start of the file", () => {
    const jpeg = fakeJpeg({ width: 4032, height: 3024, dateTimeOriginal: "2026:10:05 08:51:57", offsetTimeOriginal: "-05:00" });
    expect(readCaptureTime(jpeg)).toBe("2026-10-05T08:51:57-05:00");
  });

  it("returns null without EXIF or for non-JPEG bytes", () => {
    expect(readCaptureTime(fakeJpeg({ width: 10, height: 10 }))).toBeNull();
    expect(readCaptureTime(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull();
  });
});
```

Append to `test/unit/api.test.ts`, adding `deleteNote` to its import from `../../src/app/api`:
```ts
describe("deleteNote", () => {
  it("explains a partial delete, and says nothing for a clean one", () => {
    expect(deleteNote(undefined)).toBe("");
    expect(deleteNote({ purged: false })).toBe("Deleted. Cached copies may take a minute to disappear.");
    expect(deleteNote({ purged: true, objectsDeleted: false })).toBe(
      "Removed from the feed, but the image files couldn't be deleted and may still be reachable by direct link. Tell the site admin.",
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run test:unit`
Expected: FAIL. The modules or exports don't exist yet.

- [ ] **Step 3: Implement**

`src/app/days.ts`:
```ts
import { dayKey } from "../embed/days";
import type { AdminPhoto } from "../shared/types";

export { dayKey };

export interface DayGroup {
  key: string;
  photos: AdminPhoto[];
}

/** Groups by the calendar day in each photo's own offset; newest day first, order within a day kept. */
export function groupByDay(photos: AdminPhoto[]): DayGroup[] {
  const groups = new Map<string, AdminPhoto[]>();
  for (const p of photos) {
    const key = dayKey(p.takenAt);
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  return [...groups].map(([key, list]) => ({ key, photos: list })).sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

const asUtcDate = (key: string) => new Date(`${key}T00:00:00Z`);

export function dayLabel(key: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(asUtcDate(key));
}

export function shortDayLabel(key: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(asUtcDate(key));
}

function monthDay(key: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(asUtcDate(key));
}

export function dayCounts(photos: { hidden: boolean }[]): string {
  const live = photos.filter((p) => !p.hidden).length;
  return `${photos.length} ${photos.length === 1 ? "photo" : "photos"} · ${live} live`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hourOf = (takenAt: string) => Number(takenAt.slice(11, 13));
const meridiem = (h: number) => (h < 12 ? "AM" : "PM");

/** Wall-clock time where the photo was taken (from the offset in takenAt, not the viewer's zone). */
export function timeLabel(takenAt: string, withSeconds = false): string {
  const h = hourOf(takenAt);
  const m = Number(takenAt.slice(14, 16));
  const s = Number(takenAt.slice(17, 19)) || 0;
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)}${withSeconds ? `:${pad(s)}` : ""} ${meridiem(h)}`;
}

export function timeRange(takenAts: string[], locale?: string): string {
  if (takenAts.length === 0) return "";
  const sorted = [...takenAts].sort((a, b) => Date.parse(a) - Date.parse(b));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const d1 = dayKey(first);
  const d2 = dayKey(last);
  const t1 = timeLabel(first);
  const t2 = timeLabel(last);
  if (d1 !== d2) return `${monthDay(d1, locale)}, ${t1} – ${monthDay(d2, locale)}, ${t2}`;
  if (t1 === t2) return `${monthDay(d1, locale)}, ${t1}`;
  const left = meridiem(hourOf(first)) === meridiem(hourOf(last)) ? t1.replace(/ [AP]M$/, "") : t1;
  return `${monthDay(d1, locale)}, ${left}–${t2}`;
}
```

`src/app/bulk.ts`:
```ts
import { ApiError } from "./api";

export interface BulkResult<T> {
  ok: { id: string; value: T }[];
  failed: { id: string; error: unknown }[];
}

const isSignin = (e: unknown) => e instanceof ApiError && e.code === "signin_required";

/** Runs fn for each id, at most `limit` at a time. Never rejects; stops starting work after a sign-in error. */
export async function runBulk<T>(
  ids: string[],
  limit: number,
  fn: (id: string) => Promise<T>,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResult<T>> {
  const result: BulkResult<T> = { ok: [], failed: [] };
  let next = 0;
  let done = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < ids.length) {
      const id = ids[next++]!;
      try {
        result.ok.push({ id, value: await fn(id) });
      } catch (error) {
        result.failed.push({ id, error });
        if (isSignin(error)) stopped = true;
      }
      onProgress?.(++done, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
  for (const id of ids.slice(next)) result.failed.push({ id, error: new ApiError(401, "signin_required", "Sign-in expired") });
  return result;
}
```

`src/app/lib/jpeg-meta.ts`: add `import { exifToIso } from "../../shared/time";` at the top, and append:
```ts
/** EXIF capture time (ISO 8601 with offset) from the start of a JPEG; the APP1 segment precedes the image data. */
export function readCaptureTime(buf: ArrayBuffer): string | null {
  const v = new DataView(buf);
  try {
    if (v.getUint16(0) !== 0xffd8) return null;
    for (let o = 2; o + 4 <= v.byteLength; ) {
      if (v.getUint8(o) !== 0xff) return null;
      const marker = v.getUint8(o + 1);
      if (marker === 0xff) {
        o++;
        continue;
      }
      if (marker === 0xda) return null;
      const len = v.getUint16(o + 2);
      if (marker === 0xe1 && len >= 8 && ascii(v, o + 4, 6) === "Exif\0\0") {
        const meta: JpegMeta = { width: 0, height: 0, orientation: 1, dateTimeOriginal: null, offsetTimeOriginal: null };
        readExif(v, o + 10, meta);
        return meta.dateTimeOriginal ? exifToIso(meta.dateTimeOriginal, meta.offsetTimeOriginal) : null;
      }
      o += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}
```
(`ascii`, `readExif` and `JpegMeta` already exist in this file. If `exifToIso` is already imported, don't import it twice.)

`src/app/api.ts`: append
```ts
export function deleteNote(res: { purged?: boolean; objectsDeleted?: boolean } | undefined): string {
  if (res?.objectsDeleted === false) {
    return "Removed from the feed, but the image files couldn't be deleted and may still be reachable by direct link. Tell the site admin.";
  }
  if (res?.purged === false) return "Deleted. Cached copies may take a minute to disappear.";
  return "";
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/days.ts src/app/bulk.ts src/app/lib/jpeg-meta.ts src/app/api.ts test/unit
git commit -m "feat(app): day grouping, capture time, bulk runner and delete messages"
```

---

### Task 5: App shell — header, segmented control, API client additions

**Files:**
- Create: `src/app/header.ts`
- Modify: `src/app/api.ts`, `src/app/main.ts`
- Test: `test/e2e/app-shell.spec.ts` (new)

**Interfaces:**
- Consumes: `icon` (Task 3).
- Produces:
  - `type Tab = "upload" | "manage"`
  - `interface SelectState { count: number; allSelected: boolean }`
  - `safeHttp(url: string): boolean`
  - `mountHeader(o: HeaderOptions): Header`, where `Header = { element: HTMLElement; setTab(tab: Tab): void; setLocked(locked: boolean): void; setSelect(state: SelectState | null): void }`
  - `api.areas(slug): Promise<AreaCount[]>`
  - `api.patch(id, { caption?, hidden?, area? })`
  - `uploadPhoto(project: string, p: Processed, meta: { caption: string; area: string | null }, onProgress: (f: number) => void)`
  - Tasks 6–7 must provide: `mountUpload(container, getProject, onRunningChange) → { projectChanged(): void }` and `mountManage(container, { getProject, onSelectChange }) → { reload(): void; startSelect(): void; cancelSelect(): void; toggleAll(): void }`.

This task changes `main.ts` to the final shell. Until Tasks 6 and 7 land, it calls the old `mountUpload`/`mountManage` through small adapters, given below, so the app keeps working.

- [ ] **Step 1: API client additions**

In `src/app/api.ts`:
- Import `AreaCount` alongside the other types.
- In the `api` object, add `areas: (slug: string) => request<AreaCount[]>(\`/api/admin/projects/${encodeURIComponent(slug)}/areas\`),`.
- Change `patch` to `(id: string, body: { caption?: string | null; hidden?: boolean; area?: string | null }) => …` (same body as now).
- Change the `uploadPhoto` signature and the form fields:
  ```ts
  export function uploadPhoto(
    project: string,
    p: Processed,
    meta: { caption: string; area: string | null },
    onProgress: (fraction: number) => void,
  ): Promise<{ id: string; duplicate?: boolean }> {
    const form = new FormData();
    form.set("project", project);
    form.set("fingerprint", p.fingerprint);
    form.set("takenAt", p.takenAt);
    if (meta.caption) form.set("caption", meta.caption);
    if (meta.area) form.set("area", meta.area);
    // … rest unchanged
  ```
- In the current `src/app/upload.ts`, update the one call site to `uploadPhoto(project.slug, item.processed, { caption, area: null }, (f) => …)`. Task 6 replaces this file.

- [ ] **Step 2: Write the failing e2e test**

`test/e2e/app-shell.spec.ts`:
```ts
import { expect, test } from "@playwright/test";

test.skip(({ browserName }) => browserName !== "chromium", "app tests run in Chromium");

test("header: project title, Live site link, and tab switching", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Monroe Residential Progress Photos" })).toBeVisible();
  await page.getByLabel("Project").selectOption("e2e-upload");
  await expect(page.locator(".project-picker .name")).toHaveText("E2E Upload");
  await expect(page.getByRole("link", { name: "Live site" })).toHaveAttribute("href", "http://host.test/progress/");

  await page.getByRole("tab", { name: "Manage" }).click();
  await expect(page.getByRole("tab", { name: "Manage" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Select" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Live site" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Upload" }).click();
  await expect(page.getByRole("link", { name: "Live site" })).toBeVisible();
});

test("remembers the last project", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Project").selectOption("e2e-manage");
  await page.reload();
  await expect(page.getByLabel("Project")).toHaveValue("e2e-manage");
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx playwright test test/e2e/app-shell.spec.ts --project chromium`
Expected: FAIL. There's no heading named "Monroe Residential Progress Photos" yet.

- [ ] **Step 4: `src/app/header.ts`**

```ts
import type { ProjectSummary } from "../shared/types";
import { h } from "./dom";
import { icon } from "./icons";

export type Tab = "upload" | "manage";

export interface SelectState {
  count: number;
  allSelected: boolean;
}

export interface HeaderOptions {
  projects: ProjectSummary[];
  initial: ProjectSummary;
  onProject(p: ProjectSummary): void;
  onTab(tab: Tab): void;
  onSelectStart(): void;
  onSelectCancel(): void;
  onSelectAll(): void;
}

export interface Header {
  element: HTMLElement;
  setTab(tab: Tab): void;
  setLocked(locked: boolean): void;
  setSelect(state: SelectState | null): void;
}

export function safeHttp(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

export function mountHeader(o: HeaderOptions): Header {
  let current = o.initial;
  let tab: Tab = "upload";

  const name = h("span", { class: "name" }, current.name);
  const picker = h(
    "select",
    {
      "aria-label": "Project",
      onchange: () => {
        current = o.projects.find((p) => p.slug === picker.value)!;
        name.textContent = current.name;
        renderRight();
        o.onProject(current);
      },
    },
    ...o.projects.map((p) => h("option", { value: p.slug, selected: p.slug === current.slug }, p.name)),
  );
  const right = h("div", { class: "header-right" });
  const projectRow = h("div", { class: "project-row" }, h("label", { class: "project-picker" }, name, icon("chevron-down", 18), picker), right);
  const selectRow = h("div", { class: "project-row", hidden: true });
  const uploadTab = h("button", { type: "button", role: "tab", "aria-selected": "true", onclick: () => o.onTab("upload") }, "Upload");
  const manageTab = h("button", { type: "button", role: "tab", "aria-selected": "false", onclick: () => o.onTab("manage") }, "Manage");
  const element = h(
    "header",
    { class: "app-header" },
    h("h1", { class: "app-title" }, "Monroe Residential Progress Photos"),
    projectRow,
    selectRow,
    h("div", { class: "seg", role: "tablist" }, uploadTab, manageTab),
  );

  function renderRight(): void {
    if (tab === "manage") {
      right.replaceChildren(h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => o.onSelectStart() }, "Select"));
    } else if (safeHttp(current.siteUrl)) {
      right.replaceChildren(h("a", { class: "btn btn-secondary btn-sm", href: current.siteUrl, target: "_blank", rel: "noopener" }, "Live site", icon("external-link", 16)));
    } else {
      right.replaceChildren();
    }
  }
  renderRight();

  return {
    element,
    setTab(t) {
      tab = t;
      uploadTab.setAttribute("aria-selected", String(t === "upload"));
      manageTab.setAttribute("aria-selected", String(t === "manage"));
      renderRight();
    },
    setLocked(locked) {
      picker.disabled = locked;
    },
    setSelect(state) {
      projectRow.hidden = state !== null;
      selectRow.hidden = state === null;
      if (!state) return selectRow.replaceChildren();
      selectRow.replaceChildren(
        h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => o.onSelectCancel() }, "Cancel"),
        h("span", { class: "select-title tabular", role: "status" }, `${state.count} selected`),
        h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => o.onSelectAll() }, state.allSelected ? "None" : "All"),
      );
    },
  };
}
```

- [ ] **Step 5: `src/app/main.ts` (final shell)**

```ts
import "./theme.css";
import type { ProjectSummary } from "../shared/types";
import { api, errorMessage } from "./api";
import { h } from "./dom";
import { mountHeader, type Tab } from "./header";
import { mountManage } from "./manage";
import { mountUpload } from "./upload";

const LAST_PROJECT = "progress-photos:last-project";
const root = document.getElementById("app")!;

const remembered = () => {
  try {
    return localStorage.getItem(LAST_PROJECT);
  } catch {
    return null;
  }
};
const remember = (slug: string) => {
  try {
    localStorage.setItem(LAST_PROJECT, slug);
  } catch {
    // private mode: not remembered
  }
};

async function start(): Promise<void> {
  root.replaceChildren(h("p", { class: "manage-status" }, "Loading projects…"));
  let projects: ProjectSummary[];
  try {
    projects = await api.projects();
  } catch (err) {
    root.replaceChildren(h("p", { class: "manage-status" }, errorMessage(err)), h("button", { class: "btn btn-secondary manage-more", onclick: () => location.reload() }, "Reload"));
    return;
  }
  if (projects.length === 0) {
    root.replaceChildren(h("p", { class: "manage-status" }, "No projects yet. Add one with npm run project:add."));
    return;
  }

  let current = projects.find((p) => p.slug === remembered()) ?? projects[0]!;
  const uploadPane = h("section", { role: "tabpanel" });
  const managePane = h("section", { role: "tabpanel", hidden: true });

  const header = mountHeader({
    projects,
    initial: current,
    onProject: (p) => {
      current = p;
      remember(p.slug);
      upload.projectChanged();
      manage.cancelSelect();
      if (!managePane.hidden) manage.reload();
    },
    onTab: (t) => show(t),
    onSelectStart: () => manage.startSelect(),
    onSelectCancel: () => manage.cancelSelect(),
    onSelectAll: () => manage.toggleAll(),
  });
  const upload = mountUpload(uploadPane, () => current, (running) => header.setLocked(running));
  const manage = mountManage(managePane, { getProject: () => current, onSelectChange: (s) => header.setSelect(s) });

  function show(t: Tab): void {
    if (t === "upload") manage.cancelSelect();
    uploadPane.hidden = t !== "upload";
    managePane.hidden = t !== "manage";
    header.setTab(t);
    if (t === "manage") manage.reload();
  }

  root.replaceChildren(header.element, uploadPane, managePane);
}

void start();
```

- [ ] **Step 6: Interim adapters**

Tasks 6 and 7 replace these files, but this task leaves the app working.

- In the current `src/app/upload.ts`, make `mountUpload` return `{ projectChanged() {} }`. Change its return type from `void` to `{ projectChanged(): void }`, and add that `return` at the end of the function.
- In the current `src/app/manage.ts`, change the signature to accept `(container: HTMLElement, o: { getProject: () => ProjectSummary; onSelectChange: (s: unknown) => void })`, and use `o.getProject()` where it used `getProject()`. Return `{ reload: () => void load(true), startSelect() {}, cancelSelect() {}, toggleAll() {} }`.

- [ ] **Step 7: Run the tests**

Run: `npm run typecheck && npx playwright test test/e2e/app-shell.spec.ts --project chromium`
Expected: PASS. Then run `npm run test:e2e`. The embed specs pass. If `upload.spec.ts` fails only on old markup (for example `getByRole("button", { name: "Upload" })` now also matches the Upload tab), note it in the report: Task 6 rewrites that spec.

- [ ] **Step 8: Commit**

```bash
git add src/app test/e2e/app-shell.spec.ts
git commit -m "feat(app): Journal header with project title, Live site and segmented tabs"
```

---

### Task 6: Upload tab

**Files:**
- Rewrite: `src/app/upload.ts`
- Create: `test/e2e/admin-api.ts`
- Rewrite: `test/e2e/upload.spec.ts`

**Interfaces:**
- Consumes:
  - `api.areas`, `uploadPhoto(project, p, { caption, area }, onProgress)` and `errorMessage` (Task 5)
  - `timeRange` (Task 4) and `readCaptureTime` (Task 4)
  - `icon` (Task 3)
  - `processPhoto`, `makeThumb` and `UnreadablePhotoError` (existing `lib/process.ts`)
- Produces:
  - `mountUpload(container: HTMLElement, getProject: () => ProjectSummary, onRunningChange?: (running: boolean) => void): { projectChanged(): void }`
  - e2e helpers: `fakeWebp(width, height)`, `addPhoto(request, project, o)`, `clearProject(request, project)`, `jpegFromPage(page, text)`

- [ ] **Step 1: e2e helpers — `test/e2e/admin-api.ts`**

```ts
import { randomBytes } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";

/** Minimal lossy-WebP header the Worker accepts (it validates headers, not pixels). */
export function fakeWebp(width: number, height: number): Buffer {
  const b = Buffer.alloc(64);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8 ", 12, "ascii");
  b.writeUInt32LE(b.length - 20, 16);
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  b.writeUInt16LE(width & 0x3fff, 26);
  b.writeUInt16LE(height & 0x3fff, 28);
  return b;
}

/** Adds a photo straight through the admin API (DEV_AUTH_EMAIL on localhost; no Origin, so the CSRF guard passes). */
export async function addPhoto(
  request: APIRequestContext,
  project: string,
  o: { takenAt: string; caption?: string; area?: string; hidden?: boolean },
): Promise<string> {
  const res = await request.post("/api/admin/photos", {
    multipart: {
      project,
      fingerprint: randomBytes(32).toString("hex"),
      takenAt: o.takenAt,
      ...(o.caption ? { caption: o.caption } : {}),
      ...(o.area ? { area: o.area } : {}),
      width: "480",
      height: "360",
      w480: { name: "w480.webp", mimeType: "image/webp", buffer: fakeWebp(480, 360) },
    },
  });
  if (res.status() !== 201) throw new Error(`addPhoto: ${res.status()} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  if (o.hidden) await request.patch(`/api/admin/photos/${id}`, { data: { hidden: true } });
  return id;
}

export async function clearProject(request: APIRequestContext, project: string): Promise<void> {
  for (;;) {
    const page = (await (await request.get(`/api/admin/photos?project=${project}`)).json()) as { photos: { id: string }[] };
    if (page.photos.length === 0) return;
    for (const p of page.photos) await request.delete(`/api/admin/photos/${p.id}`);
  }
}

export async function adminPhotos(request: APIRequestContext, project: string) {
  return ((await (await request.get(`/api/admin/photos?project=${project}`)).json()) as {
    photos: { id: string; caption: string | null; area: string | null; hidden: boolean }[];
  }).photos;
}

/** A real JPEG drawn in the page, so the upload pipeline (decode, resize, WASM WebP) runs for real. */
export async function jpegFromPage(page: Page, text: string): Promise<Buffer> {
  const b64 = await page.evaluate(async (t) => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 900;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#a33";
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = "#fff";
    ctx.font = "48px sans-serif";
    ctx.fillText(t, 40, 100);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.9));
    let s = "";
    for (const x of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(x);
    return btoa(s);
  }, text);
  return Buffer.from(b64, "base64");
}
```

- [ ] **Step 2: Rewrite `test/e2e/upload.spec.ts` (failing)**

```ts
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx playwright test test/e2e/upload.spec.ts --project chromium`
Expected: FAIL. There's no "+ Add" button or `.queue-summary` yet.

- [ ] **Step 4: Rewrite `src/app/upload.ts`**

```ts
import { toOffsetIso } from "../shared/time";
import type { ProjectSummary } from "../shared/types";
import { api, ApiError, errorMessage, uploadPhoto } from "./api";
import { timeRange } from "./days";
import { h } from "./dom";
import { icon } from "./icons";
import { readCaptureTime } from "./lib/jpeg-meta";
import { makeThumb, processPhoto, UnreadablePhotoError, type Processed } from "./lib/process";

type Status = "ready" | "working" | "done" | "duplicate" | "unreadable" | "failed" | "signin";

const LABEL: Record<Status, string> = {
  ready: "Ready",
  working: "Uploading…",
  done: "Done",
  duplicate: "Duplicate (already uploaded)",
  unreadable: "Can't read this photo",
  failed: "Failed",
  signin: "Sign-in expired — sign in again, then Retry",
};
/** How long a finished row shows its status before fading out. */
const LEAVE_AFTER_MS = 700;
const FADE_MS = 300;
/** EXIF sits in the first few KB; never read a whole 48 MP file just for the time. */
const HEADER_BYTES = 256 * 1024;

interface Item {
  file: File;
  takenAt: string;
  status: Status;
  processed?: Processed;
  row: HTMLLIElement;
  thumb: HTMLImageElement;
  caption: HTMLInputElement;
  statusText: HTMLSpanElement;
  progress: HTMLDivElement;
  fill: HTMLDivElement;
  retry: HTMLButtonElement;
  remove: HTMLButtonElement;
}

export interface UploadTab {
  projectChanged(): void;
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

async function captureTime(file: File): Promise<string> {
  try {
    const t = readCaptureTime(await file.slice(0, HEADER_BYTES).arrayBuffer());
    if (t) return t;
  } catch {
    // fall through to lastModified
  }
  return toOffsetIso(new Date(file.lastModified));
}

export function mountUpload(container: HTMLElement, getProject: () => ProjectSummary, onRunningChange?: (running: boolean) => void): UploadTab {
  const items: Item[] = [];
  let running = false;
  let area: string | null = null;
  let areas: string[] = [];
  let finished = { done: 0, duplicate: 0 };
  let areaRequest = 0;

  const cameraInput = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, onchange: () => void addFiles(cameraInput) });
  const libraryInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: () => void addFiles(libraryInput) });
  const batchCaption = h("input", { class: "input", type: "text", id: "batch-caption", maxLength: 280, placeholder: "Optional" });
  const pills = h("div", { class: "pills", role: "group", "aria-label": "Area" });
  const summary = h("span", { class: "queue-summary tabular", role: "status" });
  const range = h("span", { class: "queue-range tabular" });
  const queue = h("ul", { class: "queue" });
  const notice = h(
    "p",
    { class: "notice", hidden: true },
    "Your sign-in expired. ",
    h("a", { href: "/", target: "_blank", rel: "noopener" }, "Sign in again"),
    " If Retry still fails, close and reopen the app.",
  );
  const uploadBtn = h("button", { type: "button", class: "btn btn-primary", disabled: true, onclick: () => void runQueue() }, "Upload");

  container.replaceChildren(
    h(
      "div",
      { class: "tab-body" },
      h(
        "div",
        { class: "action-row" },
        h("button", { type: "button", class: "btn btn-primary", onclick: () => cameraInput.click() }, icon("camera"), "Take photo"),
        h("button", { type: "button", class: "btn btn-secondary", onclick: () => libraryInput.click() }, icon("image"), "Library"),
        cameraInput,
        libraryInput,
      ),
      h("div", { class: "field" }, h("label", { class: "field-label", for: "batch-caption" }, "Caption for this batch"), batchCaption),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Area"), pills),
      h("hr", { class: "hairline" }),
      h("div", { class: "queue-head" }, summary, range),
      notice,
      queue,
    ),
    h("div", { class: "sticky-footer" }, uploadBtn),
  );

  window.addEventListener("beforeunload", (e) => {
    if (items.some((i) => i.status === "ready" || i.status === "working")) e.preventDefault();
  });

  function renderPills(): void {
    const all = area && !areas.includes(area) ? [area, ...areas] : areas;
    pills.replaceChildren(
      ...all.map((a) =>
        h("button", {
          type: "button",
          class: "pill",
          "aria-pressed": String(a === area),
          onclick: () => {
            area = a === area ? null : a;
            renderPills();
          },
        }, a),
      ),
      h("button", { type: "button", class: "pill pill-add", onclick: () => startAdd() }, "+ Add"),
    );
  }

  function startAdd(): void {
    const input = h("input", { class: "pill-input", type: "text", maxLength: 40, "aria-label": "New area", enterKeyHint: "done" });
    let closed = false;
    const finish = (save: boolean) => {
      if (closed) return;
      closed = true;
      const v = input.value.trim();
      if (save && v) area = v;
      renderPills();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    pills.lastElementChild?.replaceWith(input);
    input.focus();
  }

  async function loadAreas(): Promise<void> {
    const mine = ++areaRequest;
    const slug = getProject().slug;
    let list: string[] = [];
    try {
      list = (await api.areas(slug)).map((a) => a.area);
    } catch {
      // the pills fall back to "+ Add"; uploading still works
    }
    if (mine !== areaRequest) return; // a newer project's request superseded this one
    areas = list;
    renderPills();
  }

  function batchFinished(): boolean {
    return items.length > 0 && items.every((i) => i.status === "done" || i.status === "duplicate" || i.status === "unreadable");
  }

  function refresh(): void {
    const ready = items.filter((i) => i.status === "ready").length;
    uploadBtn.disabled = running || ready === 0;
    uploadBtn.textContent = ready === 0 ? "Upload" : `Upload ${plural(ready, "photo")}`;
    const shown = items.filter((i) => i.row.isConnected);
    const uploading = items.filter((i) => i.status === "working").length;
    if (shown.length > 0) {
      summary.textContent = `${plural(shown.length, "photo")}${uploading ? ` · ${uploading} uploading` : ""}`;
      range.textContent = timeRange(shown.map((i) => i.takenAt));
    } else if (finished.done + finished.duplicate > 0) {
      summary.textContent = `Uploaded ${finished.done}${finished.duplicate ? ` · ${finished.duplicate} already uploaded` : ""}`;
      range.textContent = "";
    } else {
      summary.textContent = "";
      range.textContent = "";
    }
  }

  function leave(item: Item): void {
    setTimeout(() => {
      item.row.classList.add("is-leaving");
      setTimeout(() => {
        item.row.remove();
        refresh();
      }, reducedMotion() ? 0 : FADE_MS);
    }, LEAVE_AFTER_MS);
  }

  function setStatus(item: Item, status: Status, detail?: string): void {
    item.status = status;
    item.statusText.textContent = detail ? `${LABEL[status]} — ${detail}` : LABEL[status];
    const error = status === "failed" || status === "unreadable" || status === "signin";
    item.statusText.className = `status-text${error ? " is-error" : status === "working" ? " is-active" : ""}`;
    item.progress.hidden = status !== "working";
    item.retry.hidden = status !== "failed" && status !== "signin";
    item.remove.hidden = status === "working" || status === "done" || status === "duplicate";
    if (status === "done") finished.done++;
    if (status === "duplicate") finished.duplicate++;
    if (status === "done" || status === "duplicate") leave(item);
    refresh();
  }

  function newItem(file: File): Item {
    const thumb = h("img", { class: "thumb", alt: "" });
    const caption = h("input", { class: "input", type: "text", maxLength: 280, placeholder: "Caption (overrides batch)", "aria-label": "Photo caption" });
    const statusText = h("span", { class: "status-text" });
    const fill = h("div", { class: "progress-fill" });
    const progress = h("div", { class: "progress", hidden: true }, fill);
    const retry = h("button", { type: "button", class: "link-btn", hidden: true }, "Retry");
    const remove = h("button", { type: "button", class: "icon-btn", "aria-label": "Remove photo" }, icon("x", 18));
    const row = h("li", { class: "queue-row" }, thumb, h("div", { class: "row-main" }, caption, h("div", { class: "row-status" }, statusText, progress, retry)), remove);
    const item: Item = { file, takenAt: toOffsetIso(new Date(file.lastModified)), status: "ready", row, thumb, caption, statusText, progress, fill, retry, remove };
    retry.addEventListener("click", () => {
      setStatus(item, "ready");
      void runQueue();
    });
    remove.addEventListener("click", () => {
      items.splice(items.indexOf(item), 1);
      row.remove();
      refresh();
    });
    queue.append(row);
    setStatus(item, "ready");
    return item;
  }

  async function addFiles(input: HTMLInputElement): Promise<void> {
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length === 0) return;
    if (batchFinished()) {
      // Start a new batch: drop the finished one so its rows and counts don't carry over.
      for (const item of items) item.row.remove();
      items.length = 0;
      finished = { done: 0, duplicate: 0 };
    }
    const added = files.map((file) => newItem(file));
    items.push(...added);
    refresh();
    for (const item of added) {
      // One at a time keeps iOS memory down.
      item.takenAt = await captureTime(item.file);
      refresh();
      const url = await makeThumb(item.file);
      if (url) item.thumb.src = url;
    }
  }

  async function uploadOne(item: Item, project: ProjectSummary, batch: { caption: string; area: string | null }): Promise<void> {
    setStatus(item, "working");
    item.fill.style.width = "0%";
    try {
      item.processed ??= await processPhoto(item.file);
      item.takenAt = item.processed.takenAt;
      const caption = item.caption.value.trim() || batch.caption;
      const res = await uploadPhoto(project.slug, item.processed, { caption, area: batch.area }, (f) => (item.fill.style.width = `${Math.round(f * 100)}%`));
      item.processed = undefined;
      setStatus(item, res.duplicate ? "duplicate" : "done");
    } catch (err) {
      if (err instanceof UnreadablePhotoError) setStatus(item, "unreadable");
      else if (err instanceof ApiError && err.code === "signin_required") setStatus(item, "signin");
      else setStatus(item, "failed", errorMessage(err));
    }
  }

  async function runQueue(): Promise<void> {
    if (running) return;
    running = true;
    notice.hidden = true;
    onRunningChange?.(true);
    refresh();
    const project = getProject();
    const batch = { caption: batchCaption.value.trim(), area }; // fixed for this run
    let next: Item | undefined;
    while ((next = items.find((i) => i.status === "ready"))) {
      await uploadOne(next, project, batch);
      if (next.status === "signin") {
        notice.hidden = false;
        break;
      }
    }
    running = false;
    onRunningChange?.(false);
    if (batchFinished()) batchCaption.value = "";
    refresh();
    void loadAreas();
  }

  renderPills();
  void loadAreas();
  refresh();

  return {
    projectChanged() {
      area = null;
      areas = [];
      renderPills();
      void loadAreas();
    },
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npm run typecheck && npx playwright test test/e2e/upload.spec.ts test/e2e/app-shell.spec.ts --project chromium`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/upload.ts test/e2e/admin-api.ts test/e2e/upload.spec.ts
git commit -m "feat(app): Journal upload tab with Take photo, area tags and a fading queue"
```

---

### Task 7: Manage tab (with the "⋯" sheet)

**Files:**
- Create: `src/app/sheet.ts`
- Rewrite: `src/app/manage.ts`
- Test: `test/e2e/manage.spec.ts` (new)

**Interfaces:**
- Consumes:
  - `groupByDay`, `dayLabel`, `dayCounts` and `timeLabel` (Task 4)
  - `deleteNote`, `api` and `errorMessage` (Tasks 4 and 5)
  - `icon` (Task 3)
  - `SelectState` (Task 5)
- Produces:
  - `interface SheetAction { label: string; icon?: IconName; danger?: boolean; onSelect(): void }`
  - `openSheet(actions: SheetAction[]): void`
  - `promptSheet(o: { title: string; confirm: string; initial?: string }): Promise<string | null>`
  - `mountManage(container, o: { getProject(): ProjectSummary; onSelectChange(s: SelectState | null): void }): { reload(): void; startSelect(): void; cancelSelect(): void; toggleAll(): void }`
  - **Viewer hook** (filled in by Task 8): `manage.ts` calls `openViewer(...)` from `./viewer`. In this task, `src/app/viewer.ts` is a one-line stub: `export function openViewer(_: unknown): void {}`.
  - **Select hooks** (filled in by Task 9): `startSelect`, `cancelSelect` and `toggleAll` are implemented here; the bulk footer arrives in Task 9.

- [ ] **Step 1: Write the failing e2e test**

`test/e2e/manage.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { addPhoto, adminPhotos, clearProject } from "./admin-api";

test.skip(({ browserName }) => browserName !== "chromium", "app tests run in Chromium");

test.beforeEach(async ({ page, request }) => {
  await clearProject(request, "e2e-manage");
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:52:00-05:00", caption: "4th floor post demolition", area: "4th floor" });
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:51:00-05:00", caption: "Hidden one", hidden: true });
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-04T15:00:00-05:00", caption: "Day before" });
  await page.goto("/");
  await page.getByLabel("Project").selectOption("e2e-manage");
  await page.getByRole("tab", { name: "Manage" }).click();
});

test("groups photos by day with counts, time · area, and a hidden tag", async ({ page }) => {
  await expect(page.locator(".day-title")).toHaveText(["Monday, October 5", "Sunday, October 4"]);
  await expect(page.locator(".day-counts").first()).toHaveText("2 photos · 1 live");
  const first = page.locator(".card").first();
  await expect(first.locator(".card-caption")).toHaveText("4th floor post demolition");
  await expect(first.locator(".card-meta")).toHaveText("8:52 AM · 4th floor");
  await expect(page.locator(".card.is-hidden")).toHaveCount(1);
  await expect(page.locator(".card.is-hidden .hidden-tag")).toHaveText("Hidden from site");
});

test("the ⋯ sheet hides a photo in place", async ({ page, request }) => {
  await page.locator(".card").first().getByRole("button", { name: "More actions" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Hide" }).click();
  await expect(page.locator(".day-counts").first()).toHaveText("2 photos · 0 live");
  expect((await adminPhotos(request, "e2e-manage")).find((p) => p.caption === "4th floor post demolition")?.hidden).toBe(true);
});

test("the ⋯ sheet deletes after confirmation", async ({ page, request }) => {
  page.once("dialog", (d) => void d.accept());
  await page.locator(".card").last().getByRole("button", { name: "More actions" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".day-title")).toHaveText(["Monday, October 5"]);
  expect(await adminPhotos(request, "e2e-manage")).toHaveLength(2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test test/e2e/manage.spec.ts --project chromium`
Expected: FAIL. There's no `.day-title` yet.

- [ ] **Step 3: `src/app/sheet.ts`**

```ts
import { h } from "./dom";
import { icon, type IconName } from "./icons";

export interface SheetAction {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect(): void;
}

function present(content: HTMLElement[], onClose?: () => void): () => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, ...content);
  const backdrop = h("div", { class: "sheet-backdrop" }, sheet);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    opener?.focus();
    onClose?.();
  }
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  sheet.querySelector<HTMLElement>("input, button")?.focus();
  return close;
}

export function openSheet(actions: SheetAction[]): void {
  const buttons = actions.map((a) =>
    h("button", { type: "button", class: `btn btn-secondary${a.danger ? " btn-danger" : ""}` }, a.icon ? icon(a.icon, 18) : null, a.label),
  );
  const cancel = h("button", { type: "button", class: "btn btn-ghost" }, "Cancel");
  const close = present([...buttons, cancel]);
  buttons.forEach((b, i) =>
    b.addEventListener("click", () => {
      close();
      actions[i]!.onSelect();
    }),
  );
  cancel.addEventListener("click", () => close());
}

export function promptSheet(o: { title: string; confirm: string; initial?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const input = h("input", { class: "input", type: "text", maxLength: 280, value: o.initial ?? "", "aria-label": o.title });
    const cancel = h("button", { type: "button", class: "btn btn-ghost" }, "Cancel");
    const form = h(
      "form",
      { class: "sheet-form" },
      h("p", { class: "sheet-title" }, o.title),
      input,
      h("button", { type: "submit", class: "btn btn-primary" }, o.confirm),
      cancel,
    );
    const close = present([form], () => resolve(result));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      result = input.value;
      close();
    });
    cancel.addEventListener("click", () => close());
  });
}
```

- [ ] **Step 4: Viewer stub**

`src/app/viewer.ts` (replaced in Task 8):
```ts
export function openViewer(_: unknown): void {}
```

- [ ] **Step 5: Rewrite `src/app/manage.ts`**

```ts
import { smallestSrc, srcsetAttr } from "../shared/srcset";
import type { AdminPhoto, ProjectSummary } from "../shared/types";
import { api, deleteNote, errorMessage } from "./api";
import { dayCounts, dayLabel, groupByDay, timeLabel } from "./days";
import { h } from "./dom";
import type { SelectState } from "./header";
import { icon } from "./icons";
import { openSheet } from "./sheet";
import { openViewer } from "./viewer";

export interface ManageOptions {
  getProject(): ProjectSummary;
  onSelectChange(state: SelectState | null): void;
}

export interface ManageTab {
  reload(): void;
  startSelect(): void;
  cancelSelect(): void;
  toggleAll(): void;
}

export function mountManage(container: HTMLElement, o: ManageOptions): ManageTab {
  let photos: AdminPhoto[] = [];
  /** Photos in display order (by day group), which is also the viewer's order. */
  let ordered: AdminPhoto[] = [];
  let cursor: string | null = null;
  let generation = 0;
  let loading = false;
  let selecting = false;
  const selection = new Set<string>();

  const body = h("div", { class: "manage-body" });
  const status = h("p", { class: "manage-status", role: "status" });
  const retry = h("button", { type: "button", class: "btn btn-secondary manage-more", hidden: true, onclick: () => void load(photos.length === 0) }, "Retry");
  const more = h("button", { type: "button", class: "btn btn-secondary manage-more", hidden: true, onclick: () => void load(false) }, "Load more");
  const footerSlot = h("div");
  container.replaceChildren(body, status, retry, more, footerSlot);

  function emitSelect(): void {
    o.onSelectChange(selecting ? { count: selection.size, allSelected: photos.length > 0 && selection.size === photos.length } : null);
  }

  function card(p: AdminPhoto, index: number): HTMLLIElement {
    const selected = selection.has(p.id);
    const img = h("img", { alt: p.caption ?? "Progress photo", loading: "lazy", decoding: "async" });
    img.sizes = "(min-width: 600px) 560px, 100vw";
    img.srcset = srcsetAttr(p.srcset);
    img.src = smallestSrc(p.srcset);
    const photoBtn = h(
      "button",
      {
        type: "button",
        class: "card-photo",
        "aria-label": selecting ? `${selected ? "Deselect" : "Select"} photo taken ${timeLabel(p.takenAt)}` : `Open photo taken ${timeLabel(p.takenAt)}`,
        onclick: () => (selecting ? toggle(p.id) : view(index)),
      },
      img,
      p.hidden ? h("span", { class: "hidden-tag" }, icon("eye-off", 14), "Hidden from site") : null,
      selecting ? h("span", { class: "check", "aria-hidden": "true" }, selected ? icon("check", 14) : null) : null,
    );
    if (selecting) photoBtn.setAttribute("aria-pressed", String(selected));
    const meta = [timeLabel(p.takenAt), p.area].filter(Boolean).join(" · ");
    return h(
      "li",
      { class: `card${p.hidden ? " is-hidden" : ""}${selected ? " is-selected" : ""}`, "data-id": p.id },
      photoBtn,
      h(
        "div",
        { class: "card-info" },
        h("div", {}, h("div", { class: "card-caption" }, p.caption ?? ""), h("div", { class: "card-meta tabular" }, meta)),
        selecting ? h("span") : h("button", { type: "button", class: "icon-btn", "aria-label": "More actions", onclick: () => actions(p, index) }, icon("more-horizontal", 20)),
      ),
    );
  }

  function render(): void {
    const groups = groupByDay(photos);
    ordered = groups.flatMap((g) => g.photos);
    let i = 0;
    body.replaceChildren(
      ...groups.map((g) =>
        h(
          "section",
          { class: "day" },
          h("div", { class: "day-head" }, h("h2", { class: "day-title" }, dayLabel(g.key)), h("span", { class: "day-counts tabular" }, dayCounts(g.photos))),
          h("ul", { class: "cards" }, ...g.photos.map((p) => card(p, i++))),
        ),
      ),
    );
    if (!loading && photos.length === 0 && !status.textContent) status.textContent = "No photos yet.";
    if (photos.length > 0 && status.textContent === "No photos yet.") status.textContent = "";
  }

  async function load(reset: boolean): Promise<void> {
    const mine = reset ? ++generation : generation;
    if (reset) {
      photos = [];
      cursor = null;
      selection.clear();
    }
    loading = true;
    more.hidden = true;
    retry.hidden = true;
    status.textContent = "Loading…";
    render();
    try {
      const page = await api.photos(o.getProject().slug, cursor ?? undefined);
      if (mine !== generation) return;
      photos = [...photos, ...page.photos];
      cursor = page.nextCursor;
      status.textContent = "";
    } catch (err) {
      if (mine !== generation) return;
      status.textContent = errorMessage(err);
      retry.hidden = false;
    } finally {
      if (mine === generation) {
        loading = false;
        more.hidden = cursor === null;
        render();
        emitSelect();
      }
    }
  }

  function replace(p: AdminPhoto): void {
    photos = photos.map((x) => (x.id === p.id ? p : x));
    render();
  }

  function removePhoto(id: string): void {
    photos = photos.filter((x) => x.id !== id);
    selection.delete(id);
    render();
    emitSelect();
  }

  /** Shows a message without hiding the empty-list state. */
  function showNote(note: string): void {
    const empty = photos.length === 0 && cursor === null ? "No photos yet." : "";
    status.textContent = [note, empty].filter(Boolean).join(" ");
  }

  async function run(fn: () => Promise<void>): Promise<void> {
    status.textContent = "";
    try {
      await fn();
    } catch (err) {
      status.textContent = errorMessage(err);
    }
  }

  function view(index: number): void {
    openViewer({
      photos: () => ordered,
      index,
      hasMore: () => cursor !== null,
      loadMore: () => load(false),
      onUpdate: replace,
      onDelete: (id: string, note: string) => {
        removePhoto(id);
        showNote(note);
      },
      returnFocus: (id: string) => body.querySelector<HTMLElement>(`[data-id="${id}"] .card-photo`),
    });
  }

  function actions(p: AdminPhoto, index: number): void {
    openSheet([
      { label: "Edit caption", icon: "pencil", onSelect: () => view(index) },
      {
        label: p.hidden ? "Unhide" : "Hide",
        icon: p.hidden ? "eye" : "eye-off",
        onSelect: () => void run(async () => replace(await api.patch(p.id, { hidden: !p.hidden }))),
      },
      {
        label: "Delete",
        icon: "trash-2",
        danger: true,
        onSelect: () =>
          void run(async () => {
            if (!confirm("Delete this photo? This can't be undone.")) return;
            const res = await api.remove(p.id);
            removePhoto(p.id);
            showNote(deleteNote(res));
          }),
      },
    ]);
  }

  function toggle(id: string): void {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    render();
    emitSelect();
  }

  return {
    reload: () => void load(true),
    startSelect() {
      selecting = true;
      selection.clear();
      render();
      emitSelect();
    },
    cancelSelect() {
      if (!selecting) return;
      selecting = false;
      selection.clear();
      render();
      emitSelect();
    },
    toggleAll() {
      if (selection.size === photos.length) selection.clear();
      else for (const p of photos) selection.add(p.id);
      render();
      emitSelect();
    },
  };
}
```
(`footerSlot` is where Task 9 mounts the bulk footer.)

- [ ] **Step 6: Run the tests**

Run: `npm run typecheck && npx playwright test test/e2e/manage.spec.ts test/e2e/app-shell.spec.ts --project chromium`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/sheet.ts src/app/manage.ts src/app/viewer.ts test/e2e/manage.spec.ts
git commit -m "feat(app): Manage grouped by day with large cards, hidden tags and an action sheet"
```

---

### Task 8: Admin viewer

**Files:**
- Rewrite: `src/app/viewer.ts`
- Test: `test/e2e/viewer.spec.ts` (new)

**Interfaces:**
- Consumes:
  - `api`, `deleteNote` and `errorMessage` (Tasks 4 and 5)
  - `dayKey`, `shortDayLabel` and `timeLabel` (Task 4)
  - `icon` (Task 3)
  - `srcsetAttr` and `largestSrc` (shared)
- Produces: `interface ViewerOptions { photos(): AdminPhoto[]; index: number; hasMore(): boolean; loadMore(): Promise<void>; onUpdate(p: AdminPhoto): void; onDelete(id: string, note: string): void; returnFocus(id: string): HTMLElement | null }` and `openViewer(o: ViewerOptions): void`. This matches the call in `manage.ts` from Task 7.

- [ ] **Step 1: Write the failing e2e test**

`test/e2e/viewer.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { addPhoto, adminPhotos, clearProject } from "./admin-api";

test.skip(({ browserName }) => browserName !== "chromium", "app tests run in Chromium");

test.beforeEach(async ({ page, request }) => {
  await clearProject(request, "e2e-manage");
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:52:00-05:00", caption: "First", area: "4th floor" });
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:51:57-05:00", caption: "Second" });
  await addPhoto(request, "e2e-manage", { takenAt: "2026-10-04T15:00:00-05:00", caption: "Third" });
  await page.goto("/");
  await page.getByLabel("Project").selectOption("e2e-manage");
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.locator(".card-photo").first().click();
});

const viewer = (page: import("@playwright/test").Page) => page.getByRole("dialog", { name: "Photo" });

test("shows position, time · area and status; saves a caption", async ({ page, request }) => {
  await expect(viewer(page).locator(".viewer-pos")).toHaveText("1 of 3 · Monday, Oct 5");
  await expect(viewer(page).locator(".when")).toHaveText("8:52:00 AM · 4th floor");
  await expect(viewer(page).locator(".status-tag")).toHaveText("Live on site");
  const save = viewer(page).getByRole("button", { name: "Save caption" });
  await expect(save).toBeDisabled();
  await viewer(page).getByLabel("Caption").fill("Edited in viewer");
  await save.click();
  await expect(viewer(page).getByRole("button", { name: "Saved" })).toBeVisible();
  expect((await adminPhotos(request, "e2e-manage")).some((p) => p.caption === "Edited in viewer")).toBe(true);
});

test("hide/unhide updates the tag and the list", async ({ page }) => {
  await viewer(page).getByRole("button", { name: "Hide" }).click();
  await expect(viewer(page).locator(".status-tag")).toHaveText("Hidden");
  await page.keyboard.press("Escape");
  await expect(page.locator(".card").first()).toHaveClass(/is-hidden/);
  await expect(page.locator(".card-photo").first()).toBeFocused();
});

test("arrow keys move between photos across days", async ({ page }) => {
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(viewer(page).locator(".viewer-pos")).toHaveText("3 of 3 · Sunday, Oct 4");
  await page.keyboard.press("ArrowLeft");
  await expect(viewer(page).locator(".viewer-pos")).toHaveText("2 of 3 · Monday, Oct 5");
});

test("deleting moves on, and deleting the last photo closes the viewer", async ({ page, request }) => {
  page.on("dialog", (d) => void d.accept());
  await viewer(page).getByRole("button", { name: "Delete" }).click();
  await expect(viewer(page).locator(".viewer-pos")).toHaveText("1 of 2 · Monday, Oct 5");
  await viewer(page).getByRole("button", { name: "Delete" }).click();
  await viewer(page).getByRole("button", { name: "Delete" }).click();
  await expect(viewer(page)).toHaveCount(0);
  await expect(page.locator(".manage-status")).toHaveText(/No photos yet\./);
  expect(await adminPhotos(request, "e2e-manage")).toHaveLength(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test test/e2e/viewer.spec.ts --project chromium`
Expected: FAIL. No dialog opens, because the viewer is still a stub.

- [ ] **Step 3: Write `src/app/viewer.ts`**

```ts
import { largestSrc, srcsetAttr } from "../shared/srcset";
import type { AdminPhoto } from "../shared/types";
import { api, deleteNote, errorMessage } from "./api";
import { dayKey, shortDayLabel, timeLabel } from "./days";
import { h } from "./dom";
import { icon } from "./icons";

export interface ViewerOptions {
  photos(): AdminPhoto[];
  index: number;
  hasMore(): boolean;
  loadMore(): Promise<void>;
  onUpdate(p: AdminPhoto): void;
  onDelete(id: string, note: string): void;
  returnFocus(id: string): HTMLElement | null;
}

const SWIPE_PX = 50;

export function openViewer(o: ViewerOptions): void {
  let index = o.index;
  let renderId = 0;
  let startX: number | null = null;
  let preloads: HTMLImageElement[] = [];
  let lastId = o.photos()[index]?.id ?? "";

  const pos = h("div", { class: "viewer-pos tabular", "aria-live": "polite" });
  const img = h("img", { alt: "" });
  const stage = h("div", { class: "viewer-stage loading" }, img);
  const when = h("span", { class: "when tabular" });
  const tag = h("span", { class: "status-tag" });
  const caption = h("input", { class: "viewer-caption", type: "text", maxLength: 280, placeholder: "Add a caption", "aria-label": "Caption" });
  const hideBtn = h("button", { type: "button", class: "btn" });
  const deleteBtn = h("button", { type: "button", class: "btn" }, icon("trash-2", 18), "Delete");
  const saveBtn = h("button", { type: "button", class: "btn btn-save", disabled: true }, "Save caption");
  const note = h("p", { class: "viewer-note", role: "status" });
  const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Close" }, icon("x", 22));
  const el = h(
    "div",
    { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": "Photo", tabIndex: -1 },
    h("div", { class: "viewer-top" }, closeBtn, pos, h("span")),
    stage,
    h("div", { class: "viewer-sheet" }, h("div", { class: "viewer-meta" }, when, tag), caption, h("div", { class: "viewer-actions" }, hideBtn, deleteBtn, saveBtn), note),
  );

  const savedOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  document.body.append(el);

  const current = () => o.photos()[index];
  const captionChanged = () => caption.value.trim() !== (current()?.caption ?? "");

  /** Text and buttons only; doesn't touch the image. */
  function renderInfo(): void {
    const p = current();
    if (!p) return;
    lastId = p.id;
    pos.textContent = `${index + 1} of ${o.photos().length}${o.hasMore() ? "+" : ""} · ${shortDayLabel(dayKey(p.takenAt))}`;
    when.textContent = [timeLabel(p.takenAt, true), p.area].filter(Boolean).join(" · ");
    tag.className = `status-tag${p.hidden ? " is-hidden" : ""}`;
    tag.replaceChildren(icon(p.hidden ? "eye-off" : "check", 12), p.hidden ? "Hidden" : "Live on site");
    hideBtn.replaceChildren(icon(p.hidden ? "eye" : "eye-off", 18), p.hidden ? "Unhide" : "Hide");
  }

  function render(): void {
    const p = current();
    if (!p) return close();
    const id = ++renderId;
    // Hide first: the previous photo must never show while this one loads.
    stage.classList.add("loading");
    img.removeAttribute("srcset");
    img.alt = p.caption ?? "Progress photo";
    img.sizes = "100vw";
    img.srcset = srcsetAttr(p.srcset);
    img.src = largestSrc(p.srcset);
    const reveal = () => {
      if (id === renderId) stage.classList.remove("loading");
    };
    img.decode().then(reveal, reveal);
    preloads = [index - 1, index + 1].flatMap((i) => {
      const q = o.photos()[i];
      if (!q) return [];
      const pre = new Image();
      pre.sizes = "100vw";
      pre.srcset = srcsetAttr(q.srcset);
      pre.src = largestSrc(q.srcset);
      return [pre];
    });
    caption.value = p.caption ?? "";
    saveBtn.disabled = true;
    saveBtn.textContent = "Save caption";
    note.textContent = "";
    renderInfo();
  }

  async function act(fn: () => Promise<void>): Promise<void> {
    for (const b of [hideBtn, deleteBtn, saveBtn]) b.disabled = true;
    note.textContent = "";
    try {
      await fn();
    } catch (err) {
      note.textContent = errorMessage(err);
    } finally {
      hideBtn.disabled = false;
      deleteBtn.disabled = false;
      if (saveBtn.textContent !== "Saved") saveBtn.disabled = !captionChanged();
    }
  }

  caption.addEventListener("input", () => {
    saveBtn.textContent = "Save caption";
    saveBtn.disabled = !captionChanged();
  });
  saveBtn.addEventListener("click", () =>
    void act(async () => {
      const updated = await api.patch(current()!.id, { caption: caption.value.trim() || null });
      o.onUpdate(updated);
      caption.value = updated.caption ?? "";
      renderInfo();
      saveBtn.textContent = "Saved";
      saveBtn.disabled = true;
    }),
  );
  hideBtn.addEventListener("click", () =>
    void act(async () => {
      const p = current()!;
      o.onUpdate(await api.patch(p.id, { hidden: !p.hidden }));
      renderInfo();
    }),
  );
  deleteBtn.addEventListener("click", () =>
    void act(async () => {
      const p = current()!;
      if (!confirm("Delete this photo? This can't be undone.")) return;
      const res = await api.remove(p.id);
      const message = deleteNote(res);
      o.onDelete(p.id, message);
      if (o.photos().length === 0) return close();
      if (index >= o.photos().length) index = o.photos().length - 1;
      render();
      note.textContent = message;
    }),
  );
  closeBtn.addEventListener("click", () => close());

  async function step(delta: 1 | -1): Promise<void> {
    const n = index + delta;
    if (n < 0) return;
    if (n >= o.photos().length) {
      if (!o.hasMore()) return;
      await o.loadMore();
      if (!el.isConnected || n >= o.photos().length) return;
    }
    index = n;
    render();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && e.target !== caption) {
      e.preventDefault();
      void step(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "Tab") {
      const focusable = [...el.querySelectorAll<HTMLElement>("button:not(:disabled), input")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      } else if (!el.contains(document.activeElement)) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
  document.addEventListener("keydown", onKey);

  stage.addEventListener("pointerdown", (e) => (startX = e.clientX));
  stage.addEventListener("pointercancel", () => (startX = null));
  stage.addEventListener("pointerup", (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > SWIPE_PX) void step(dx < 0 ? 1 : -1);
  });

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    renderId++;
    preloads = [];
    document.removeEventListener("keydown", onKey);
    el.remove();
    document.documentElement.style.overflow = savedOverflow;
    o.returnFocus(lastId)?.focus();
  }

  render();
  closeBtn.focus();
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run typecheck && npx playwright test test/e2e/viewer.spec.ts test/e2e/manage.spec.ts --project chromium`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/viewer.ts test/e2e/viewer.spec.ts
git commit -m "feat(app): full-screen dark viewer with caption, hide and delete"
```

---

### Task 9: Select mode and bulk actions

**Files:**
- Create: `src/app/select.ts`
- Modify: `src/app/manage.ts` (mount the footer)
- Test: `test/e2e/select.spec.ts` (new)

**Interfaces:**
- Consumes:
  - `runBulk` and `BulkResult` (Task 4)
  - `promptSheet` (Task 7)
  - `api`, `ApiError`, `deleteNote` and `errorMessage`
  - `icon`
- Produces: `BULK_CONCURRENCY = 4` and `mountSelectFooter(o: SelectFooterOptions): { element: HTMLElement; refresh(): void }`, where `SelectFooterOptions = { selected(): string[]; photo(id: string): AdminPhoto | undefined; onUpdate(p: AdminPhoto): void; onRemove(id: string): void; onMessage(msg: string): void }`.

- [ ] **Step 1: Write the failing e2e test**

`test/e2e/select.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
import { addPhoto, adminPhotos, clearProject } from "./admin-api";

test.skip(({ browserName }) => browserName !== "chromium", "app tests run in Chromium");

test.beforeEach(async ({ page, request }) => {
  await clearProject(request, "e2e-manage");
  for (const [t, c] of [["08:52", "One"], ["08:51", "Two"], ["08:50", "Three"]] as const) {
    await addPhoto(request, "e2e-manage", { takenAt: `2026-10-05T${t}:00-05:00`, caption: c });
  }
  await page.goto("/");
  await page.getByLabel("Project").selectOption("e2e-manage");
  await page.getByRole("tab", { name: "Manage" }).click();
  await page.getByRole("button", { name: "Select" }).click();
});

const selectedCount = (page: import("@playwright/test").Page) => page.locator(".select-title");

test("select two, bulk hide, bulk caption, then cancel", async ({ page, request }) => {
  await expect(selectedCount(page)).toHaveText("0 selected");
  await page.locator(".card-photo").nth(0).click();
  await page.locator(".card-photo").nth(1).click();
  await expect(selectedCount(page)).toHaveText("2 selected");
  await expect(page.locator(".card.is-selected")).toHaveCount(2);

  await page.getByRole("button", { name: "Hide" }).click();
  await expect(page.locator(".day-counts")).toHaveText("3 photos · 1 live");
  await expect(selectedCount(page)).toHaveText("0 selected"); // successes are deselected

  await page.locator(".card-photo").nth(2).click();
  await page.getByRole("button", { name: "Caption" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Bulk caption");
  await page.getByRole("button", { name: "Apply to 1 photo" }).click();
  await expect(page.locator(".card-caption").nth(2)).toHaveText("Bulk caption");

  const stored = await adminPhotos(request, "e2e-manage");
  expect(stored.filter((p) => p.hidden)).toHaveLength(2);
  expect(stored.find((p) => p.caption === "Bulk caption")).toBeTruthy();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Select" })).toBeVisible();
  await expect(page.locator(".check")).toHaveCount(0);
});

test("All / None and bulk delete with one confirmation", async ({ page, request }) => {
  await page.getByRole("button", { name: "All" }).click();
  await expect(selectedCount(page)).toHaveText("3 selected");
  await page.getByRole("button", { name: "None" }).click();
  await expect(selectedCount(page)).toHaveText("0 selected");
  await page.getByRole("button", { name: "All" }).click();

  const prompts: string[] = [];
  page.on("dialog", (d) => {
    prompts.push(d.message());
    void d.accept();
  });
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".manage-status")).toHaveText(/No photos yet\./);
  expect(prompts).toEqual(["Delete 3 photos? This can't be undone."]);
  expect(await adminPhotos(request, "e2e-manage")).toHaveLength(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx playwright test test/e2e/select.spec.ts --project chromium`
Expected: FAIL. There's no Hide/Caption/Delete footer.

- [ ] **Step 3: `src/app/select.ts`**

```ts
import type { AdminPhoto } from "../shared/types";
import { api, ApiError, deleteNote, errorMessage } from "./api";
import { runBulk } from "./bulk";
import { h } from "./dom";
import { icon } from "./icons";
import { promptSheet } from "./sheet";

export const BULK_CONCURRENCY = 4;

export interface SelectFooterOptions {
  selected(): string[];
  photo(id: string): AdminPhoto | undefined;
  onUpdate(p: AdminPhoto): void;
  onRemove(id: string): void;
  onMessage(msg: string): void;
}

const plural = (n: number) => `${n} ${n === 1 ? "photo" : "photos"}`;

export function mountSelectFooter(o: SelectFooterOptions): { element: HTMLElement; refresh(): void } {
  let busy = false;
  const progress = h("p", { class: "select-progress tabular", role: "status" });
  const hideBtn = h("button", { type: "button", class: "btn btn-secondary" });
  const captionBtn = h("button", { type: "button", class: "btn btn-secondary" }, icon("pencil", 18), "Caption");
  const deleteBtn = h("button", { type: "button", class: "btn btn-secondary btn-danger" }, icon("trash-2", 18), "Delete");
  const element = h("div", { class: "sticky-footer" }, progress, h("div", { class: "select-footer" }, hideBtn, captionBtn, deleteBtn));

  const allHidden = () => {
    const ids = o.selected();
    return ids.length > 0 && ids.every((id) => o.photo(id)?.hidden);
  };

  function refresh(): void {
    const unhide = allHidden();
    hideBtn.replaceChildren(icon(unhide ? "eye" : "eye-off", 18), unhide ? "Unhide" : "Hide");
    for (const b of [hideBtn, captionBtn, deleteBtn]) b.disabled = busy || o.selected().length === 0;
  }

  async function bulk<T>(verb: string, fn: (id: string) => Promise<T>, apply: (id: string, value: T) => void): Promise<void> {
    const ids = o.selected();
    if (ids.length === 0) return;
    busy = true;
    refresh();
    progress.textContent = `${verb} 0 of ${ids.length}…`;
    const res = await runBulk(ids, BULK_CONCURRENCY, fn, (done, total) => (progress.textContent = `${verb} ${done} of ${total}…`));
    busy = false;
    progress.textContent = "";
    for (const { id, value } of res.ok) apply(id, value);
    if (res.failed.length > 0) {
      const signin = res.failed.some((f) => f.error instanceof ApiError && f.error.code === "signin_required");
      o.onMessage(
        signin
          ? errorMessage(new ApiError(401, "signin_required", "Sign-in expired"))
          : `${res.failed.length} couldn't be updated. They're still selected — tap the action again to retry.`,
      );
    }
    refresh();
  }

  hideBtn.addEventListener("click", () => {
    const target = !allHidden();
    void bulk(target ? "Hiding" : "Unhiding", (id) => api.patch(id, { hidden: target }), (_, p) => o.onUpdate(p));
  });
  captionBtn.addEventListener("click", async () => {
    const n = o.selected().length;
    const text = await promptSheet({ title: `Caption for ${plural(n)}`, confirm: `Apply to ${plural(n)}` });
    if (text === null) return;
    void bulk("Updating", (id) => api.patch(id, { caption: text.trim() || null }), (_, p) => o.onUpdate(p));
  });
  deleteBtn.addEventListener("click", () => {
    const n = o.selected().length;
    if (!confirm(`Delete ${plural(n)}? This can't be undone.`)) return;
    const notes = new Set<string>();
    void bulk(
      "Deleting",
      (id) => api.remove(id),
      (id, res) => {
        o.onRemove(id);
        const note = deleteNote(res);
        if (note) notes.add(note);
      },
    ).then(() => {
      if (notes.size > 0) o.onMessage([...notes].join(" "));
    });
  });

  refresh();
  return { element, refresh };
}
```

- [ ] **Step 4: Mount the footer in `src/app/manage.ts`**

- Add `import { mountSelectFooter } from "./select";`.
- After `container.replaceChildren(...)`, add:
  ```ts
  const footer = mountSelectFooter({
    selected: () => [...selection],
    photo: (id) => photos.find((p) => p.id === id),
    onUpdate: (p) => {
      selection.delete(p.id); // successes leave the selection; failures stay for a retry
      replace(p);
      emitSelect();
    },
    onRemove: (id) => removePhoto(id),
    onMessage: (msg) => showNote(msg),
  });
  footer.element.hidden = true;
  footerSlot.replaceChildren(footer.element);
  ```
- At the end of `emitSelect()`, add `footer.element.hidden = !selecting; footer.refresh();`. `footer` is used before its declaration only inside functions that run later, which is fine. Move the `footer` declaration above `emitSelect` if TypeScript complains.

- [ ] **Step 5: Run the tests**

Run: `npm run typecheck && npm run test:unit && npx playwright test test/e2e/select.spec.ts test/e2e/manage.spec.ts test/e2e/viewer.spec.ts --project chromium`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/select.ts src/app/manage.ts test/e2e/select.spec.ts
git commit -m "feat(app): Select mode with bulk hide, caption and delete"
```

---

### Task 10: Dark mode, visual snapshots, docs

**Files:**
- Create: `test/e2e/visual.spec.ts`
- Modify: `test/e2e/app-shell.spec.ts`, `docs/iphone-checklist.md`, `CLAUDE.md`

- [ ] **Step 1: Dark-mode test** (append to `test/e2e/app-shell.spec.ts`)

```ts
test.describe("dark mode", () => {
  test.use({ colorScheme: "dark" });
  test("uses the navy background and light text", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 5, 27)");
    await expect(page.locator("body")).toHaveCSS("color", "rgb(242, 244, 250)");
  });
});
```
Run: `npx playwright test test/e2e/app-shell.spec.ts --project chromium`. Expected: PASS. Task 3's tokens already make this pass; the test guards against a regression.

- [ ] **Step 2: Visual snapshots for manual comparison** (`test/e2e/visual.spec.ts`)

```ts
import { test } from "@playwright/test";
import { addPhoto, clearProject } from "./admin-api";

// Manual check against design_handoff_progress_photos/screens/1a-*.png. Run: VISUAL=1 npx playwright test visual --project chromium
test.skip(!process.env.VISUAL, "visual snapshots are opt-in");

for (const colorScheme of ["light", "dark"] as const) {
  test(`screens (${colorScheme})`, async ({ browser, request }) => {
    await clearProject(request, "e2e-manage");
    await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:52:00-05:00", caption: "4th floor post demolition", area: "4th floor" });
    await addPhoto(request, "e2e-manage", { takenAt: "2026-10-05T08:51:00-05:00", caption: "Hidden one", hidden: true });
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, colorScheme, baseURL: "http://localhost:8787" });
    await page.goto("/");
    await page.getByLabel("Project").selectOption("e2e-manage");
    await page.screenshot({ path: `test-results/reskin/${colorScheme}-upload.png` });
    await page.getByRole("tab", { name: "Manage" }).click();
    await page.locator(".card").first().waitFor();
    await page.screenshot({ path: `test-results/reskin/${colorScheme}-manage.png` });
    await page.locator(".card-photo").first().click();
    await page.screenshot({ path: `test-results/reskin/${colorScheme}-viewer.png` });
    await page.close();
  });
}
```
Run: `VISUAL=1 npx playwright test test/e2e/visual.spec.ts --project chromium`. Expected: six PNGs under `test-results/reskin/`. Look at them alongside the handoff screens, and list any visible differences in the report. Don't change the code to chase pixel-exactness on placeholder images.

- [ ] **Step 3: iPhone checklist** — append to `docs/iphone-checklist.md`

```markdown
## Journal reskin

- [ ] Light and dark mode follow the phone's setting; the status bar color matches.
- [ ] **Take photo** opens the camera; **Library** opens the photo library.
- [ ] Area: "+ Add" a new area, upload — the pill appears next time; tapping the selected pill clears it.
- [ ] Queue shows the capture-time range; rows fade out on Done; the batch caption clears and the area stays.
- [ ] Manage: day headers with "N photos · M live"; hidden photos dimmed with "Hidden from site".
- [ ] Viewer: swipe between photos; Save caption; Hide/Unhide; Delete asks first and moves on.
- [ ] Select: tick several, bulk Hide, bulk Caption, bulk Delete (one confirmation).
- [ ] Project title picker opens the native picker; it's locked while uploading.
```

- [ ] **Step 4: CLAUDE.md** — under "Invariants that span multiple parts", add:

```markdown
- **`area` is admin-only.** It's stored per photo (`migrations/0002_area.sql`), returned in `AdminPhoto` and by `/api/admin/projects/:slug/areas`, and must never be added to `FeedPhoto` or the public feed — pinned embeds read that shape.
- **The upload app is vanilla TS modules on `h()`** (`src/app/`: header, upload, manage, viewer, select, sheet, icons). Pure helpers (`days.ts`, `bulk.ts`, `lib/jpeg-meta.ts#readCaptureTime`) are unit-tested; the UI is covered by Playwright specs that seed data through `test/e2e/admin-api.ts`.
```

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npm test && npm run build && node scripts/check-embed-size.ts && npm run test:e2e`
Expected: everything passes. The embed size is unchanged (embed code isn't touched).

- [ ] **Step 6: Commit**

```bash
git add test/e2e/app-shell.spec.ts test/e2e/visual.spec.ts docs/iphone-checklist.md CLAUDE.md
git commit -m "test(app): dark mode check and visual snapshots; docs for the reskin"
```
