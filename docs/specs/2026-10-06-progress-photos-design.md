# Progress Photos — Design

**Date:** 2026-10-06
**Status:** Draft, awaiting review
**Repo:** `monroeresidential/progress-photos-app`
**Service:** `https://progress.monroeresidential.com`
**First consumer:** birkenlofts.com `/progress/`

## Purpose

Monroe Residential and 3FC are building several developments. Each one's
marketing site should show a continuously updated feed of construction
progress photos, and the person on site should be able to publish a photo
from their iPhone in under a minute — without going through a developer or a
site rebuild.

This is **one shared service** for all projects, not a per-site plugin:

- One upload web app. A signed-in uploader picks a project and uploads.
- One photo store and one database, every photo tagged by project.
- Each website embeds a framework-agnostic `<progress-feed>` element that
  reads that project's photos live from the service.

### Success criteria

1. A photo taken on site is visible on the project's website within ~60 s
   of tapping Upload.
2. Adding a new development is a database row plus one embed tag on its
   site — no code change, no redeploy of the service.
3. Adding an uploader is an edit to the Zero Trust Access policy — no code
   change.
4. The feed loads fast on a phone: no full-size iPhone originals are ever
   served or stored.

### Decisions already made

| Decision | Choice |
|---|---|
| Native app vs web | **Web app** (installable to the iPhone home screen). No App Store. |
| Publish flow | **Live immediately.** Hide / delete after the fact. |
| Shared vs per-site | **Shared service**, multi-project from day one. |
| How sites get photos | **Site reads from the service at view time** (not committed into each site's repo). |
| Originals | **Not kept.** Web sizes only, resized on the phone before upload. |
| Auth | **Cloudflare Zero Trust Access**, existing org. Initial allowlist: `drew@monroeresidential.com` only. |
| Runtime | **One Cloudflare Worker** + R2 (images) + D1 (records), Workers Static Assets for the upload app. |

### Out of scope

- Migrating birkenlofts.com to Cloudflare (separate project; this service
  does not depend on it).
- Next.js → Astro (separate decision).
- Keeping full-resolution originals.
- A native iOS app; offline/background upload queues that survive closing
  the page.
- Per-site layout variants beyond CSS custom properties.
- A UI for creating projects (a CLI script is enough until it isn't).
- Moderation queue / approval workflow.

## Architecture

```
 iPhone (home-screen web app)                 Any project website
 ─────────────────────────────                ───────────────────
  pick project → choose photos                 <progress-feed project="birken-lofts">
  read date taken (EXIF)                          │  GET /api/feed/birken-lofts?cursor=…
  resize → 480/960/1920 WebP (strips EXIF)        │  GET /img/birken-lofts/<id>-960w.webp
  POST /api/admin/photos                          ▼
        │                          ┌────────────────────────────────────┐
        └── Zero Trust Access ───▶ │  Worker: progress.monroeresidential │
                                   │   /            upload app (Access) │
                                   │   /api/admin/* (Access + JWT check)│
                                   │   /api/feed/*  public, CORS/project│
                                   │   /img/*       public, immutable   │
                                   │   /embed.js    public              │
                                   └──────────┬───────────────┬─────────┘
                                              │               │
                                         R2 (WebP)       D1 (projects, photos)
```

### Routes and access

| Path | Access | Purpose |
|---|---|---|
| `/` and static upload-app assets | Zero Trust Access | Upload + manage UI (PWA) |
| `/api/admin/*` | Zero Trust Access **and** Worker-side JWT verification | Upload, list, edit, hide, delete |
| `/api/feed/:project` | Public | Paged photo list for one project |
| `/img/*` | Public | WebP files from R2 |
| `/embed.js` | Public | Defines `<progress-feed>` |

Access is configured as one Access application covering `/` and
`/api/admin/*`, with `/api/feed/*`, `/img/*` and `/embed.js` bypassed.
The Worker **independently verifies** the `Cf-Access-Jwt-Assertion` header on
every `/api/admin/*` request (signature against the team's JWKS, `aud` equal
to the application's AUD tag, not expired) and records the token's `email`
as the uploader. A misconfigured Access path therefore fails closed instead of
exposing writes. The Access policy is the single source of truth for who may
upload; the Worker keeps no separate allowlist.

### Configuration

| Name | Kind | Value |
|---|---|---|
| `ACCESS_TEAM_DOMAIN` | var | the Zero Trust team domain (`<team>.cloudflareaccess.com`) |
| `ACCESS_AUD` | var | the Access application's AUD tag |
| `PUBLIC_BASE_URL` | var | `https://progress.monroeresidential.com` |
| `CF_ZONE_ID` | var | zone of `monroeresidential.com`, for cache purge |
| `CF_PURGE_TOKEN` | **secret** | API token scoped to Cache Purge on that zone |
| `DB` | D1 binding | `progress-photos` |
| `PHOTOS` | R2 binding | `progress-photos` |

A `staging` Wrangler environment has its own D1 database, R2 bucket and
hostname (`progress-staging.monroeresidential.com`), so testing never touches
real photos.

## Data model (D1)

```sql
CREATE TABLE projects (
  slug            TEXT PRIMARY KEY,          -- 'birken-lofts'
  name            TEXT NOT NULL,             -- 'Birken Lofts'
  site_url        TEXT NOT NULL,             -- 'https://birkenlofts.com/progress/' (for "View on site")
  allowed_origins TEXT NOT NULL,             -- JSON array: ["https://birkenlofts.com"]
  created_at      TEXT NOT NULL
);

CREATE TABLE photos (
  id            TEXT PRIMARY KEY,            -- ULID
  project_slug  TEXT NOT NULL REFERENCES projects(slug),
  taken_at      TEXT NOT NULL,               -- ISO 8601, from EXIF; falls back to file lastModified
  uploaded_at   TEXT NOT NULL,
  uploaded_by   TEXT NOT NULL,               -- email from the Access JWT
  caption       TEXT,                        -- optional, <= 280 chars
  width         INTEGER NOT NULL,            -- of the largest stored variant
  height        INTEGER NOT NULL,
  widths        TEXT NOT NULL,               -- JSON array of stored widths, e.g. [480,960,1920]
  fingerprint   TEXT NOT NULL,               -- SHA-256 of the original file bytes, hex
  hidden        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_slug, fingerprint)
);

CREATE INDEX photos_feed ON photos (project_slug, hidden, taken_at DESC, id DESC);
```

Projects are created with `npm run project:add -- <slug> "<name>" <site_url> <origin>…`,
which runs a parameterised D1 insert via Wrangler.

### R2 layout

`<project_slug>/<photo_id>-<width>w.webp` — immutable once written.
A photo is never upscaled: only the standard widths ≤ the original's width
are stored. An original narrower than 480 px is stored once, at its own width.

## API

All JSON. Errors are `{ "error": "<code>", "message": "<human text>" }` with
an appropriate 4xx/5xx status.

### Public

**`GET /api/feed/:project?cursor=<opaque>`** → `200`

```json
{
  "project": { "slug": "birken-lofts", "name": "Birken Lofts" },
  "photos": [
    {
      "id": "01J…",
      "takenAt": "2026-10-06T14:12:00-05:00",
      "caption": "Fourth-floor slab pour",
      "width": 1920, "height": 1440,
      "srcset": { "480": "https://…/img/birken-lofts/01J…-480w.webp", "960": "…", "1920": "…" }
    }
  ],
  "nextCursor": "…" // null when there are no older photos
}
```

- Page size 24, ordered `taken_at DESC, id DESC`, `hidden = 0` only.
- Cursor is base64url of `taken_at|id` (keyset pagination — no gaps or
  repeats when photos are added while someone scrolls).
- CORS: `Access-Control-Allow-Origin` is echoed only when the request
  `Origin` is in that project's `allowed_origins`. This controls which sites
  can embed the feed; the images themselves are public.
- `Cache-Control: public, max-age=60`. Unknown project → `404`.

**`GET /img/:project/:file`** → WebP from R2,
`Cache-Control: public, max-age=31536000, immutable`. Missing → `404`.

### Admin (Access + JWT)

| Method & path | Body | Result |
|---|---|---|
| `GET /api/admin/projects` | — | `[{ slug, name, siteUrl }]` |
| `POST /api/admin/photos` | multipart: `project`, `fingerprint`, `takenAt`, `caption?`, `width`, `height`, and one file per stored width named `w<width>` (e.g. `w480`, `w960`, `w1920`) | `201 { id }`, or `200 { id, duplicate: true }` if `(project, fingerprint)` exists |
| `GET /api/admin/photos?project=&cursor=` | — | same shape as the feed, **including** hidden photos with `hidden: true` |
| `PATCH /api/admin/photos/:id` | `{ caption?, hidden? }` | `200` updated photo |
| `DELETE /api/admin/photos/:id` | — | `204`; deletes R2 objects + row, purges image and feed URLs |

**Upload validation** (any failure → `400`/`413`, nothing stored):
project exists; each file's magic bytes are WebP (`RIFF…WEBP`); per-file
limits 480w ≤ 150 KB, 960w ≤ 500 KB, 1920w ≤ 1.5 MB; widths match the
declared dimensions; `takenAt` parses and is not in the future by more than a
day; caption ≤ 280 chars.

**Write order:** put all R2 objects, then insert the D1 row. If the insert
fails, delete the R2 objects before returning `500`. A Worker crash between
the two can orphan objects; `npm run cleanup:orphans` lists R2 keys with no
matching row and deletes them after confirmation.

**Delete:** delete the D1 row, delete the R2 objects, then purge the image
URLs and that project's first feed page via the Cloudflare purge API, so a
photo removed for privacy disappears within seconds. (Older cached feed pages
may still list it for up to their 60 s lifetime, but its images already 404.) A purge failure is
logged and reported in the response (`{ purged: false }`) but does not undo
the delete.

## Upload app (PWA)

Static TypeScript served from Workers Static Assets; `manifest.webmanifest`
and icons so "Add to Home Screen" opens it full-screen. Two tabs:

### Upload tab

1. **Project picker** — from `/api/admin/projects`; last choice remembered
   in `localStorage`.
2. **Add photos** — `<input type="file" accept="image/*" multiple>`; iOS
   offers camera or library.
3. **Review grid** — thumbnails; one optional batch caption, and an optional
   per-photo caption that overrides it.
4. **Upload** — photos are processed **strictly one at a time** (iOS Safari
   crashes when several 48 MP images are decoded at once). For each:
   1. SHA-256 of the original bytes → `fingerprint`.
   2. Read EXIF `DateTimeOriginal` (+ `OffsetTimeOriginal`) from the original
      bytes with a small EXIF reader; fall back to `File.lastModified`.
   3. Decode with `createImageBitmap(file, { resizeWidth, resizeQuality: 'high' })`
      — decoding straight to the target width keeps canvas memory under iOS
      limits — and apply EXIF orientation.
   4. Encode each width to WebP (quality 0.8) via `OffscreenCanvas` /
      `canvas.toBlob`. Re-encoding drops all EXIF, including GPS.
   5. `POST` with per-photo progress.
5. Each photo shows **Done**, **Duplicate (already uploaded)**,
   **Can't read this photo**, or **Failed — Retry**. Failures do not stop
   the batch.
6. `beforeunload` warns while the queue is non-empty.
7. When the batch finishes: **View on site** links to the project's
   `site_url`.

### Manage tab

Recent photos for the selected project (hidden ones dimmed), each with edit
caption, hide/unhide and delete (with a confirm step).

## Embed: `<progress-feed>`

```html
<script type="module" src="https://progress.monroeresidential.com/embed.js"></script>
<progress-feed project="birken-lofts"></progress-feed>
```

- Custom element with Shadow DOM; no dependencies; target < 15 KB gzipped.
- `/embed.js` always serves the latest build (`max-age=300`). Each release is
  also published immutably at `/embed/<version>.js`; a site that wants to pin
  a version can use that URL with an `integrity` (SRI) hash. Birken Lofts
  uses the pinned form.
- Fetches the first page on connect; an `IntersectionObserver` sentinel
  near the bottom loads the next page; stops at `nextCursor: null` and shows
  an end marker ("That's the beginning").
- Photos grouped under date headings (in the viewer's locale, from
  `takenAt`), in a responsive grid; caption under the photo when present.
- `<img loading="lazy" decoding="async" srcset sizes width height>` — the
  `width`/`height` reserve space so the page never jumps.
- Tap → full-screen viewer: swipe and ←/→ to move, Esc or ✕ to close, focus
  trapped while open and returned to the photo on close.
- Error state: "Couldn't load photos" with a **Retry** button. Empty state:
  "No photos yet."
- Light DOM children render as a fallback before the element upgrades (and
  when JS is off), so each site supplies its own `<noscript>`-style message.

**Theming** (all optional; the host page sets them on `progress-feed`):

| Property | Default |
|---|---|
| `--pf-bg` | `transparent` |
| `--pf-text` | `currentColor` |
| `--pf-muted` | `color-mix(in srgb, currentColor 60%, transparent)` |
| `--pf-accent` | `currentColor` |
| `--pf-font` | `inherit` |
| `--pf-heading-font` | `inherit` |
| `--pf-heading-transform` | `none` |
| `--pf-gap` | `8px` |
| `--pf-radius` | `0` |
| `--pf-columns-min` | `280px` (grid `minmax`) |
| `--pf-overlay-bg` | `rgba(0,0,0,.92)` |

## Birken Lofts integration (in the site repo, separate change)

- New route `app/progress/page.tsx`: page heading, intro line, the script
  tag and `<progress-feed project="birken-lofts">`, themed with the site's
  tokens (`--color-*`, Big Shoulders headings, `--pf-radius: 0`).
- Add to the nav and to `app/sitemap.ts`.
- Seed the project: `birken-lofts`, `https://birkenlofts.com/progress/`,
  origins `https://birkenlofts.com`, plus `http://localhost:3000` on
  **staging only**.
- Works on GitHub Pages today and unchanged after the Cloudflare migration.

## Error handling summary

| Situation | Behaviour |
|---|---|
| No / invalid Access JWT on admin route | `401`, nothing processed |
| Unknown project | `404` |
| Non-WebP, oversized, or mismatched dimensions | `400` / `413`, nothing stored |
| Same photo uploaded twice (retry, re-select) | `200 { duplicate: true }`, no new row |
| D1 insert fails after R2 put | R2 objects deleted, `500` |
| Crash between R2 put and D1 insert | Orphans; removed by `cleanup:orphans` |
| HEIC/other decode fails on phone | That photo marked "Can't read this photo"; batch continues |
| Network drop mid-upload | That photo marked Failed with Retry; batch continues |
| Feed fetch fails | Error state with Retry button |
| Cache purge fails on delete | Delete stands; response flags `purged: false` |

## Testing

- **Worker (Vitest + `@cloudflare/vitest-pool-workers`, local D1/R2):**
  JWT missing/invalid/wrong-aud/expired → 401; upload validation (magic
  bytes, size caps, dimension mismatch, caption length, future date);
  duplicate fingerprint; R2 cleanup when the D1 insert fails; keyset
  pagination returns every photo exactly once across pages, including when
  rows are inserted between page fetches; hidden excluded from feed and
  included in admin list; CORS echoes only allowed origins; delete removes
  row + objects and calls purge.
- **Client units (Vitest):** EXIF date parsing incl. offsets and missing tag;
  width selection for small originals; cursor encode/decode.
- **Browser (Playwright, against `wrangler dev` with seeded photos):**
  infinite scroll to the end marker; date grouping; viewer open, swipe,
  keyboard, Esc, focus return; no layout shift while images load; error
  and empty states; theming properties applied.
- **Manual iPhone checklist** (Safari can't be fully automated): HEIC from
  the library, a 48 MP photo, a Live Photo, camera capture, 10-photo batch
  over cellular, airplane-mode mid-batch then Retry, Add to Home Screen,
  verify no GPS in a downloaded 1920w file.
- **Staging environment** for all of the above before production.

## Tech choices

- TypeScript throughout; **Hono** for Worker routing; **Vite** to build the
  upload app and `embed.js`; Wrangler for D1 migrations and deploys.
- ULIDs for photo ids (sortable, URL-safe).
- `jose` (or WebCrypto directly) for Access JWT verification against the
  team JWKS, cached in memory.
- GitHub Actions: test on every push; deploy staging on `main`, production
  on a manual workflow dispatch.
