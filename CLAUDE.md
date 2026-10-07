# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` — unit (Node) + Worker (workerd) tests. `npm run test:unit` / `npm run test:worker` for one suite.
- Single test: `npx vitest run --config vitest.worker.config.ts test/worker/feed.test.ts -t "orders by instant"` (use `vitest.unit.config.ts` for `test/unit/*`).
- `npm run typecheck` — two tsconfigs: `tsconfig.worker.json` (workers-types, no DOM) and `tsconfig.app.json` (DOM + Node, for PWA, embed, scripts, unit/e2e tests). Don't merge them; workers-types and lib.dom conflict.
- `npm run build` — PWA + embed into `dist/app` (served by Workers Static Assets).
- `npm run dev` — build, then `wrangler dev` on :8787. Put `DEV_AUTH_EMAIL=…` in `.dev.vars` to use the upload app locally (honored on localhost only).
- `npm run test:e2e` — Playwright against `npm run e2e:server` (fresh seeded local D1 in `.wrangler/e2e`).
- Operator commands (`project:add`, `cleanup:orphans`, `embed:release`), setup and local-dev gotchas are in `README.md`.
- Deploys: push to `main` → tests → staging → production waiting for approval (`.github/workflows/ci.yml` calls `deploy-production.yml`; the `production` environment requires a reviewer, and GitHub notifies them). "Deploy production" can also be run by hand to redeploy. Real iPhone checks on staging before approving: `docs/iphone-checklist.md`.

The design spec is `docs/specs/2026-10-06-progress-photos-design.md`; the implementation plan (with deliberate deviations from the spec) is `docs/superpowers/plans/2026-10-06-progress-photos.md`.

## What this is

One shared Cloudflare service (`progress.monroeresidential.com`) for
construction progress photos across all Monroe Residential / 3FC developments.
A single Worker serves:

- `/` — upload/manage PWA (Workers Static Assets), behind Zero Trust Access
- `/api/admin/*` — writes, behind Access **and** Worker-side JWT verification
- `/api/feed/:project` — public paged JSON, CORS per project
- `/img/:project/:file` — public immutable WebP from R2
- `/embed.js` (and immutable `/embed/<version>.js`) — the `<progress-feed>` custom element sites embed

Storage: D1 (`projects`, `photos`) bound as `DB`; R2 bound as `PHOTOS`, keys
`<project_slug>/<photo_id>-<width>w.webp`. A `staging` Wrangler environment has
its own D1, R2 and hostname.

Stack: TypeScript, Hono (Worker routing), Vite (upload app + `embed.js`),
Wrangler (D1 migrations, deploys), Vitest with `@cloudflare/vitest-pool-workers`,
Playwright against `wrangler dev`, ULIDs for photo ids.

## Invariants that span multiple parts

- **Image processing happens on the phone, not the Worker.** The PWA resizes
  to 480/960/1920 WebP (never upscaling), which strips EXIF/GPS. Originals are
  never uploaded or stored. The Worker only validates (WebP magic bytes,
  per-width size caps, dimensions, caption ≤ 280, `takenAt` not > 1 day in
  the future). Photos are processed strictly one at a time on the client
  (iOS Safari memory limits).
- **Auth fails closed.** Every `/api/admin/*` request verifies
  `Cf-Access-Jwt-Assertion` (JWKS signature, `aud` = `ACCESS_AUD`, expiry) and
  records the token's `email` as `uploaded_by`. The Access policy is the only
  allowlist — do not add one in the Worker.
- **Adding a project or uploader must not require code changes** — projects are
  D1 rows; uploaders are Access policy edits.
- **Write ordering:** upload = put all R2 objects, then insert D1 row (delete
  the R2 objects if the insert fails). Delete = D1 row, then R2 objects, then
  Cloudflare cache purge of image URLs + the project's first feed page; purge
  failure is reported as `purged: false`, not rolled back.
- **Dedup** is by `(project_slug, fingerprint)` where fingerprint is SHA-256 of
  the original file bytes; a repeat returns `200 { id, duplicate: true }`.
- **Feed pagination is keyset** on `taken_utc DESC, id DESC`, cursor =
  base64url of `taken_utc|id`, page size 24, `hidden = 0` only. The admin list
  uses the same shape but includes hidden photos. `taken_utc` orders;
  `taken_at` (with its own offset) displays: day headings use its local date.
- **The app is built by `createApp(deps)`** with injected `fetch` (JWKS, purge), `cache` and `now`; Worker tests call `app.fetch` directly via `test/worker/helpers.ts#harness` rather than `SELF`.
- **Feed cache key = purge URL = `feedUrl(PUBLIC_BASE_URL, slug, cursor)`.** Change one and you break delete-time purging.
- **Pinned embeds (`/embed/<version>.js`) keep calling `/api/feed`**, so the feed response shape must stay backward compatible.
- **`/api/admin/*` middleware order:** no-store, then `requireSameOrigin` (`src/worker/same-origin.ts`: non-GET with a differing `Origin`, or `Sec-Fetch-Site` cross-site/same-site → 403 `cross_origin`), then `requireAccess` (500 `auth_misconfigured` if `ACCESS_AUD` or `ACCESS_TEAM_DOMAIN` is empty).
- **`compatibility_date` stays at `2026-08-22`**, the max the test pool's workerd supports; `wrangler dev` scripts need `--local-upstream localhost:8787` for the `DEV_AUTH_EMAIL` bypass.
- **CORS** on the feed echoes `Origin` only if it is in that project's
  `allowed_origins` JSON array.
- **`area` is stored per photo** (`migrations/0002_area.sql`) and returned in `AdminPhoto`, `FeedPhoto` and `/api/admin/projects/:slug/areas`. Feed changes must stay additive — pinned embeds read that shape.
- **Alt text comes from one place:** `src/shared/alt.ts#photoAlt`, used by the embed and the uploader app.
- **The upload app is vanilla TS modules on `h()`** (`src/app/`: header, upload, manage, viewer, select, sheet, icons). Pure helpers (`days.ts`, `bulk.ts`, `lib/jpeg-meta.ts#readCaptureTime`) are unit-tested; the UI is covered by Playwright specs that seed data through `test/e2e/admin-api.ts`.
- Errors are always `{ "error": "<code>", "message": "<text>" }`.
- `<progress-feed>` uses Shadow DOM, has no dependencies (target < 15 KB
  gzipped), and is themed only via the `--pf-*` CSS custom properties listed
  in the spec.

## Out of scope (per spec)

Keeping originals, a native iOS app, persistent offline upload queues, a
project-creation UI, moderation/approval, and per-site layout variants beyond
CSS custom properties. The Birken Lofts `/progress/` page lives in the site
repo, not here.
