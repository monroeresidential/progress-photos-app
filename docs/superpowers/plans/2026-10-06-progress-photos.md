# Progress Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared progress-photos service: one Cloudflare Worker (D1 + R2 + Static Assets) with an Access-protected upload PWA, a public paged feed API, public images, and a dependency-free `<progress-feed>` embed.

**Architecture:** A single Hono app built by `createApp(deps)` so outbound `fetch` (Access JWKS, cache purge), the edge cache and the clock are injected — production wires real ones in `src/worker/index.ts`, tests wire fakes. The upload PWA (Vite, plain TypeScript) resizes and WebP-encodes on the phone with `@jsquash/webp` (WASM) and posts one multipart request per photo. The embed is a separate Vite library build served as a static asset next to the PWA.

**Tech Stack:** TypeScript, Hono 4, jose 6, Wrangler 4, D1, R2, Workers Static Assets, Cache API, Vite 8, `@jsquash/webp` 1.5, Vitest 4.1 + `@cloudflare/vitest-pool-workers` 0.22, Playwright 1.63, Node ≥ 24 (scripts run as `.ts` via native type stripping).

**Spec:** `docs/specs/2026-10-06-progress-photos-design.md` — read it alongside this plan.

## Global Constraints

- Every photo is visible on the project's site within ~60 s of upload; feed responses are `Cache-Control: public, max-age=60`.
- Stored widths are the standard 480 / 960 / 1920 that are ≤ the original's width; an original narrower than 480 px is stored once at its own width. Never upscale.
- Per-file limits: 480w ≤ 150 KB, 960w ≤ 500 KB, 1920w ≤ 1.5 MB (KB = 1024 bytes). WebP quality 0.8 (80), stepping down only to fit a limit.
- Originals are never uploaded or stored; re-encoding strips all EXIF including GPS.
- Caption ≤ 280 characters. `takenAt` must parse and be no more than one day in the future.
- Errors are always `{ "error": "<code>", "message": "<human text>" }`.
- The Access policy is the only uploader allowlist; the Worker keeps none. Every `/api/admin/*` request verifies `Cf-Access-Jwt-Assertion` (JWKS signature, `aud` = `ACCESS_AUD`, not expired).
- Feed: page size 24, ordered newest first, `hidden = 0` only, keyset cursor, CORS echoed only for the project's `allowed_origins`, unknown project → `404`.
- Images: `Cache-Control: public, max-age=31536000, immutable`. `/embed.js`: `max-age=300`. `/embed/<version>.js`: immutable.
- `<progress-feed>`: Shadow DOM, no dependencies, < 15 KB gzipped, themed only by the `--pf-*` properties in the spec's table with those exact defaults.
- UI copy, exactly: "Done", "Duplicate (already uploaded)", "Can't read this photo", "Failed" + "Retry" button, "View on site", "Couldn't load photos" + "Retry", "No photos yet.", "That's the beginning".
- Adding a project is a D1 row; adding an uploader is an Access policy edit. Neither needs code or a redeploy.
- `staging` Wrangler environment has its own D1, R2 and hostname (`progress-staging.monroeresidential.com`).

## Deviations from the spec (decided while planning)

1. **WebP encoding uses `@jsquash/webp` (WASM).** iOS Safari's `canvas.toBlob("image/webp")` silently returns PNG. The user chose WASM over switching to JPEG on 2026-10-06.
2. **`photos.taken_utc` column added.** `taken_at` keeps the original offset (`2026-10-06T14:12:00-05:00`) for display and day grouping; ordering, the index and the cursor use `taken_utc` (`2026-10-06T19:12:00.000Z`). Sorting the offset strings would misorder photos with different offsets. Cursor = base64url of `taken_utc|id`.
3. **Edge caching via the Cache API.** Worker responses are not CDN-cached by `Cache-Control` alone, so the feed and image routes `cache.put` into `caches.default` keyed by `PUBLIC_BASE_URL` URLs. That makes the delete-time purge meaningful.
4. **DELETE returns `204` when the purge succeeds and `200 { "purged": false }` when it fails or no purge token is set** (a 204 can't carry the flag).
5. **`project:add` uses `wrangler d1 execute --file`** with strictly validated inputs and SQL-escaped literals (Wrangler's CLI has no bound parameters).
6. **`cleanup:orphans` lists R2 through the Cloudflare REST API** (Wrangler has no `r2 object list`) and never deletes objects younger than one hour.
7. **`DEV_AUTH_EMAIL`** (set only in `.dev.vars` / `--var` for local dev and e2e) bypasses Access **only** when the request hostname is `localhost` or `127.0.0.1`.
8. **`/embed.js` and `/embed/*` send `Access-Control-Allow-Origin: *`** — a cross-origin `<script type="module">` will not execute without it.

## Review Focus

1. **Photos with different UTC offsets (travel, DST change, phone set to another zone)** — the feed must still be in true chronological order. Test: Task 4 "orders by instant, not by offset string".
2. **The Access session expires mid-batch** — the uploader must see "Sign-in expired — reload to sign in", not a generic failure that Retry can never fix. Test: Task 10 `interpretProbe` tests; Task 11 maps the error to that status.
3. **`cleanup:orphans` runs while an upload is in flight** (R2 written, D1 row not yet) — those objects must not be deleted. Test: Task 7 "skips objects younger than the grace period".
4. **A project site on another origin loads `/embed.js`** — module scripts need CORS, or the feed silently never renders. Test: Task 9 "embed.js is cacheable and CORS-enabled" plus every e2e test runs from `http://host.test`.
5. **A caption containing markup** (`<img src=x onerror=…>`) — it must render as literal text in the embed and the upload app. Test: Task 9 "renders captions as text".

---

## File structure

```
package.json, tsconfig.worker.json, tsconfig.app.json, wrangler.jsonc, .gitignore, .dev.vars.example
vite.config.ts                 upload PWA build (root src/app → dist/app)
vite.embed.config.ts           embed library build (→ dist/app/embed.js)
vitest.worker.config.ts        Worker tests in workerd (pool-workers)
vitest.unit.config.ts          pure unit tests in Node (TZ pinned)
playwright.config.ts
migrations/0001_init.sql

src/shared/                    used by Worker, PWA and embed
  types.ts                     FeedPhoto, AdminPhoto, FeedPage, ProjectSummary, ApiErrorBody
  widths.ts                    STANDARD_WIDTHS, selectWidths, maxBytesFor, scaledHeight
  cursor.ts                    encodeCursor / decodeCursor
  time.ts                      parseTakenAt, exifToIso, toOffsetIso
  srcset.ts                    srcsetAttr, smallestSrc, largestSrc
src/worker/
  index.ts                     production wiring of createApp
  env.ts                       Env, Deps, AppEnv, App
  app.ts                       createApp: middleware, routes, error handling
  http.ts                      HttpError, badRequest
  access.ts                    createAccessVerifier, requireAccess
  ulid.ts                      ulid()
  urls.ts                      imageKey, imageUrl, feedUrl
  projects.ts                  getProject, listProjects, allowedOrigins
  photos.ts                    PhotoRow, listPhotos, insert/find/get/update/delete, toFeedPhoto, toAdminPhoto
  webp.ts                      readWebpSize
  captions.ts                  normalizeCaption
  purge.ts                     purgeUrls
  routes/feed.ts, routes/img.ts, routes/upload.ts, routes/admin.ts
src/app/                       upload PWA (Vite root)
  index.html, style.css, main.ts, dom.ts, api.ts, upload.ts, manage.ts
  lib/jpeg-meta.ts             readJpegMeta, orientedSize
  lib/process.ts               processPhoto, makeThumb, UnreadablePhotoError
  public/manifest.webmanifest, public/_headers, public/icons/*, public/embed/<version>.js
src/embed/
  progress-feed.ts             <progress-feed> custom element
  viewer.ts                    full-screen viewer
  days.ts                      dayKey, formatDay
  styles.ts                    STYLES
scripts/
  lib/project-args.ts, lib/orphans.ts, lib/png.ts
  project-add.ts, cleanup-orphans.ts, seed-e2e.ts, make-icons.ts, embed-release.ts, check-embed-size.ts
test/worker/  setup.ts, env.d.ts, helpers.ts, *.test.ts
test/unit/    *.test.ts, jpeg-fixture.ts
test/e2e/     host.ts, embed.spec.ts, upload.spec.ts
.github/workflows/ci.yml, .github/workflows/deploy-production.yml
docs/iphone-checklist.md, README.md, CLAUDE.md
```

---

### Task 1: Scaffold the Worker, D1 schema and test harness

**Files:**
- Create: `package.json`, `.gitignore`, `.dev.vars.example`, `tsconfig.worker.json`, `tsconfig.app.json`, `wrangler.jsonc`, `migrations/0001_init.sql`, `vitest.worker.config.ts`, `vitest.unit.config.ts`
- Create: `src/worker/env.ts`, `src/worker/http.ts`, `src/worker/app.ts`, `src/worker/index.ts`
- Create: `test/worker/env.d.ts`, `test/worker/setup.ts`, `test/worker/helpers.ts`, `test/worker/app.test.ts`
- Modify: `CLAUDE.md` (replace "Current state" with real commands)

**Interfaces:**
- Produces:
  - `interface Env { DB: D1Database; PHOTOS: R2Bucket; ASSETS: Fetcher; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; PUBLIC_BASE_URL: string; CF_ZONE_ID: string; CF_PURGE_TOKEN?: string; DEV_AUTH_EMAIL?: string }`
  - `interface Deps { fetch: typeof fetch; cache: () => Cache; now: () => number }`
  - `type AppEnv = { Bindings: Env; Variables: { email: string } }`, `type App = Hono<AppEnv>`
  - `class HttpError extends Error { status; code }`, `badRequest(message): HttpError`
  - `createApp(deps: Deps): App` — later tasks add `registerX(app, deps)` calls inside it.
  - Test helpers: `TEST_BASE`, `noCache`, `testEnv(overrides)`, `harness(opts) → { call(path, init?, base?), admin(path, init?), fetchCalls, env }`. `admin` and the JWKS/purge fakes are added in Tasks 3 and 6; this task creates `call` only.

- [ ] **Step 1: Create package.json and install dependencies**

```json
{
  "name": "progress-photos-app",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "npm run build && wrangler dev --port 8787 --var PUBLIC_BASE_URL:http://localhost:8787",
    "dev:app": "vite",
    "build": "vite build && vite build --config vite.embed.config.ts",
    "typecheck": "tsc -p tsconfig.worker.json && tsc -p tsconfig.app.json",
    "test": "npm run test:unit && npm run test:worker",
    "test:unit": "vitest run --config vitest.unit.config.ts",
    "pretest:worker": "node -e \"require('node:fs').mkdirSync('dist/app',{recursive:true})\"",
    "test:worker": "vitest run --config vitest.worker.config.ts",
    "test:e2e": "playwright test",
    "e2e:server": "npm run build && node scripts/seed-e2e.ts && wrangler dev --port 8787 --persist-to .wrangler/e2e --var PUBLIC_BASE_URL:http://localhost:8787 --var DEV_AUTH_EMAIL:e2e@example.com",
    "db:migrate:local": "wrangler d1 migrations apply progress-photos --local",
    "project:add": "node scripts/project-add.ts",
    "cleanup:orphans": "node scripts/cleanup-orphans.ts",
    "icons": "node scripts/make-icons.ts",
    "embed:release": "node scripts/embed-release.ts"
  }
}
```

Run:
```bash
npm install hono@^4.13 jose@^6.2 @jsquash/webp@^1.5
npm install -D wrangler@^4.147 vitest@~4.1 @cloudflare/vitest-pool-workers@^0.22 @cloudflare/workers-types@^5 vite@^8 typescript@^5.9 @types/node@^24 @playwright/test@^1.63
```
Expected: installs without peer-dependency errors (`vitest` must resolve to 4.1.x for the pool's `^4.1.0` peer).

- [ ] **Step 2: Create config files**

`.gitignore`:
```
node_modules/
dist/
.wrangler/
.dev.vars
test-results/
playwright-report/
```

`.dev.vars.example` (copy to `.dev.vars` for local upload-app testing; only honored on localhost):
```
DEV_AUTH_EMAIL=you@example.com
```

`tsconfig.worker.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers/types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/worker", "src/shared", "test/worker"]
}
```

`tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true
  },
  "include": ["src/app", "src/embed", "src/shared", "test/unit", "test/e2e", "scripts", "vite.config.ts", "vite.embed.config.ts", "vitest.unit.config.ts", "vitest.worker.config.ts", "playwright.config.ts"]
}
```

`wrangler.jsonc` (placeholder IDs/vars are filled in Task 13 when the real resources exist; local dev and tests work with them as-is):
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "progress-photos",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-09-01",
  "workers_dev": false,
  "preview_urls": false,
  "observability": { "enabled": true },
  "routes": [{ "pattern": "progress.monroeresidential.com", "custom_domain": true }],
  "assets": {
    "directory": "./dist/app",
    "binding": "ASSETS",
    "run_worker_first": ["/api/*", "/img/*"]
  },
  "vars": {
    "ACCESS_TEAM_DOMAIN": "SET-IN-TASK-13.cloudflareaccess.com",
    "ACCESS_AUD": "SET-IN-TASK-13",
    "PUBLIC_BASE_URL": "https://progress.monroeresidential.com",
    "CF_ZONE_ID": "SET-IN-TASK-13"
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "progress-photos", "database_id": "00000000-0000-0000-0000-000000000000", "migrations_dir": "migrations" }
  ],
  "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "progress-photos" }],
  "env": {
    "staging": {
      "routes": [{ "pattern": "progress-staging.monroeresidential.com", "custom_domain": true }],
      "vars": {
        "ACCESS_TEAM_DOMAIN": "SET-IN-TASK-13.cloudflareaccess.com",
        "ACCESS_AUD": "SET-IN-TASK-13",
        "PUBLIC_BASE_URL": "https://progress-staging.monroeresidential.com",
        "CF_ZONE_ID": "SET-IN-TASK-13"
      },
      "d1_databases": [
        { "binding": "DB", "database_name": "progress-photos-staging", "database_id": "00000000-0000-0000-0000-000000000001", "migrations_dir": "migrations" }
      ],
      "r2_buckets": [{ "binding": "PHOTOS", "bucket_name": "progress-photos-staging" }]
    }
  }
}
```

`migrations/0001_init.sql`:
```sql
CREATE TABLE projects (
  slug            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  site_url        TEXT NOT NULL,
  allowed_origins TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE photos (
  id            TEXT PRIMARY KEY,
  project_slug  TEXT NOT NULL REFERENCES projects(slug),
  taken_at      TEXT NOT NULL,            -- ISO 8601 with the photo's own offset (display, day grouping)
  taken_utc     TEXT NOT NULL,            -- same instant as UTC 'YYYY-MM-DDTHH:MM:SS.sssZ' (ordering, cursor)
  uploaded_at   TEXT NOT NULL,
  uploaded_by   TEXT NOT NULL,
  caption       TEXT,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  widths        TEXT NOT NULL,
  fingerprint   TEXT NOT NULL,
  hidden        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_slug, fingerprint)
);

CREATE INDEX photos_feed ON photos (project_slug, hidden, taken_utc DESC, id DESC);
```

`vitest.worker.config.ts`:
```ts
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        main: "./src/worker/index.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      include: ["test/worker/**/*.test.ts"],
      setupFiles: ["./test/worker/setup.ts"],
    },
  };
});
```

`vitest.unit.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
    env: { TZ: "America/Chicago" },
  },
});
```

- [ ] **Step 3: Write the failing test**

`test/worker/env.d.ts`:
```ts
import type { D1Migration } from "cloudflare:test";
import type { Env as AppEnv } from "../../src/worker/env";

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
export {};
```

`test/worker/setup.ts`:
```ts
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

`test/worker/helpers.ts`:
```ts
import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createApp } from "../../src/worker/app";
import type { Env } from "../../src/worker/env";

export const TEST_BASE = "https://progress.test";

export const noCache = {
  match: async () => undefined,
  put: async () => {},
  delete: async () => false,
} as unknown as Cache;

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(env as unknown as Env),
    ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    ACCESS_AUD: "test-aud",
    PUBLIC_BASE_URL: TEST_BASE,
    CF_ZONE_ID: "zone123",
    CF_PURGE_TOKEN: undefined,
    DEV_AUTH_EMAIL: undefined,
    ...overrides,
  };
}

export interface HarnessOptions {
  env?: Partial<Env>;
  cache?: Cache;
  now?: number;
}

export function harness(opts: HarnessOptions = {}) {
  const fetchCalls: Request[] = [];
  const upstream = async (_req: Request): Promise<Response> => new Response("unmocked", { status: 599 });
  const app = createApp({
    fetch: async (input, init) => {
      const req = new Request(input, init);
      fetchCalls.push(req.clone());
      return upstream(req);
    },
    cache: () => opts.cache ?? noCache,
    now: () => opts.now ?? Date.now(),
  });
  const e = testEnv(opts.env);
  const call = async (path: string, init?: RequestInit, base = TEST_BASE) =>
    app.fetch(new Request(base + path, init), e, createExecutionContext());
  return { call, fetchCalls, env: e };
}
```

`test/worker/app.test.ts`:
```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { harness } from "./helpers";

describe("app", () => {
  it("returns the JSON error shape for unknown routes", async () => {
    const res = await harness().call("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Not found" });
  });

  it("has the schema applied", async () => {
    const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'photos_feed'").first();
    expect(row).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:worker`
Expected: FAIL — cannot resolve `../../src/worker/app` (and `src/worker/index.ts`).

- [ ] **Step 5: Write minimal implementation**

`src/worker/env.ts`:
```ts
import type { Hono } from "hono";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  PUBLIC_BASE_URL: string;
  CF_ZONE_ID: string;
  CF_PURGE_TOKEN?: string;
  DEV_AUTH_EMAIL?: string;
}

/** Everything the app reaches outside its bindings, injected so tests can fake it. */
export interface Deps {
  fetch: typeof fetch;
  cache: () => Cache;
  now: () => number;
}

export type AppEnv = { Bindings: Env; Variables: { email: string } };
export type App = Hono<AppEnv>;
```

`src/worker/http.ts`:
```ts
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string) => new HttpError(400, "bad_request", message);
```

`src/worker/app.ts`:
```ts
import { Hono } from "hono";
import type { AppEnv, Deps } from "./env";
import { HttpError } from "./http";

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  void deps; // routes registered in later tasks use deps

  app.notFound((c) => c.json({ error: "not_found", message: "Not found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status);
    console.error(err);
    return c.json({ error: "internal", message: "Something went wrong" }, 500);
  });
  return app;
}
```

`src/worker/index.ts`:
```ts
import { createApp } from "./app";

export default createApp({
  fetch: (input, init) => fetch(input, init),
  cache: () => caches.default,
  now: () => Date.now(),
});
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm run test:worker && npx tsc -p tsconfig.worker.json`
Expected: 2 tests PASS; no type errors.

- [ ] **Step 7: Update CLAUDE.md**

Replace the "## Current state" section with:
```markdown
## Commands

- `npm test` — unit (Node) + Worker (workerd) tests. `npm run test:unit` / `npm run test:worker` for one suite.
- Single test: `npx vitest run --config vitest.worker.config.ts test/worker/feed.test.ts -t "orders by instant"` (use `vitest.unit.config.ts` for `test/unit/*`).
- `npm run typecheck` — two tsconfigs: `tsconfig.worker.json` (workers-types, no DOM) and `tsconfig.app.json` (DOM + Node, for PWA, embed, scripts, unit/e2e tests). Don't merge them; workers-types and lib.dom conflict.
- `npm run build` — PWA + embed into `dist/app` (served by Workers Static Assets).
- `npm run dev` — build, then `wrangler dev` on :8787. Put `DEV_AUTH_EMAIL=…` in `.dev.vars` to use the upload app locally (honored on localhost only).
- `npm run test:e2e` — Playwright against `npm run e2e:server` (fresh seeded local D1 in `.wrangler/e2e`).

The design spec is `docs/specs/2026-10-06-progress-photos-design.md`; the implementation plan (with deliberate deviations from the spec) is `docs/superpowers/plans/2026-10-06-progress-photos.md`.
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Worker, D1 schema and test harness"
```

---

### Task 2: Shared utilities (widths, cursor, time, srcset, types)

**Files:**
- Create: `src/shared/types.ts`, `src/shared/widths.ts`, `src/shared/cursor.ts`, `src/shared/time.ts`, `src/shared/srcset.ts`
- Test: `test/unit/widths.test.ts`, `test/unit/cursor.test.ts`, `test/unit/time.test.ts`, `test/unit/srcset.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `FeedPhoto { id; takenAt; caption: string | null; width; height; srcset: Record<string, string> }`, `AdminPhoto extends FeedPhoto { hidden: boolean }`, `FeedPage<P = FeedPhoto> { project: { slug; name }; photos: P[]; nextCursor: string | null }`, `ProjectSummary { slug; name; siteUrl }`, `ApiErrorBody { error; message }`
  - `widths.ts`: `STANDARD_WIDTHS`, `selectWidths(originalWidth): number[]`, `maxBytesFor(width): number`, `scaledHeight(width, largestWidth, largestHeight): number`
  - `cursor.ts`: `interface CursorKey { takenUtc; id }`, `encodeCursor(k): string`, `decodeCursor(s): CursorKey | null`
  - `time.ts`: `interface TakenAt { takenAt; takenUtc; ms }`, `parseTakenAt(s): TakenAt | null`, `exifToIso(dateTime, offset | null): string | null`, `toOffsetIso(d: Date): string`
  - `srcset.ts`: `srcsetAttr(srcset): string`, `smallestSrc(srcset): string`, `largestSrc(srcset): string`

- [ ] **Step 1: Write the failing tests**

`test/unit/widths.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { maxBytesFor, scaledHeight, selectWidths } from "../../src/shared/widths";

describe("selectWidths", () => {
  it("keeps every standard width at or below the original", () => {
    expect(selectWidths(4032)).toEqual([480, 960, 1920]);
    expect(selectWidths(1920)).toEqual([480, 960, 1920]);
    expect(selectWidths(1500)).toEqual([480, 960]);
    expect(selectWidths(480)).toEqual([480]);
  });

  it("stores a sub-480 original once at its own width", () => {
    expect(selectWidths(400)).toEqual([400]);
  });
});

describe("maxBytesFor", () => {
  it("uses the spec limits in KiB, and the 480 limit for small originals", () => {
    expect(maxBytesFor(480)).toBe(150 * 1024);
    expect(maxBytesFor(960)).toBe(500 * 1024);
    expect(maxBytesFor(1920)).toBe(1536 * 1024);
    expect(maxBytesFor(400)).toBe(150 * 1024);
  });
});

describe("scaledHeight", () => {
  it("keeps the aspect ratio and rounds", () => {
    expect(scaledHeight(480, 1920, 1440)).toBe(360);
    expect(scaledHeight(480, 1920, 2560)).toBe(640);
    expect(scaledHeight(960, 1920, 1081)).toBe(541);
  });
});
```

`test/unit/cursor.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/shared/cursor";

const key = { takenUtc: "2026-10-06T19:12:00.000Z", id: "01J9Z3K5Q8W2E4R6T8Y0V2X4Z6" };

describe("cursor", () => {
  it("round-trips and is URL-safe", () => {
    const c = encodeCursor(key);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c)).toEqual(key);
  });

  it("rejects garbage and malformed parts", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("!!!")).toBeNull();
    expect(decodeCursor(btoa("2026-10-06|abc"))).toBeNull();
    expect(decodeCursor(btoa(`not-a-date|${key.id}`))).toBeNull();
  });

  it("rejects ids that are not ULIDs (I, L, O and U are not Crockford base32)", () => {
    expect(decodeCursor(encodeCursor({ ...key, id: "01J9Z3K5Q8W2E4R6T8Y0U2I4O6" }))).toBeNull();
  });
});
```

`test/unit/time.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { exifToIso, parseTakenAt, toOffsetIso } from "../../src/shared/time";

describe("parseTakenAt", () => {
  it("keeps the original string and derives UTC", () => {
    expect(parseTakenAt("2026-10-06T14:12:00-05:00")).toEqual({
      takenAt: "2026-10-06T14:12:00-05:00",
      takenUtc: "2026-10-06T19:12:00.000Z",
      ms: Date.UTC(2026, 9, 6, 19, 12, 0),
    });
    expect(parseTakenAt("2026-10-06T19:12:00Z")?.takenUtc).toBe("2026-10-06T19:12:00.000Z");
  });

  it("requires an explicit offset", () => {
    expect(parseTakenAt("2026-10-06T14:12:00")).toBeNull();
    expect(parseTakenAt("yesterday")).toBeNull();
    expect(parseTakenAt("")).toBeNull();
  });
});

describe("exifToIso", () => {
  it("uses OffsetTimeOriginal when present", () => {
    expect(exifToIso("2026:10:06 14:12:00", "-05:00")).toBe("2026-10-06T14:12:00-05:00");
    expect(exifToIso("2026:10:06 14:12:00", "+02:00")).toBe("2026-10-06T14:12:00+02:00");
  });

  it("falls back to the device zone when the offset is missing (TZ=America/Chicago)", () => {
    expect(exifToIso("2026:10:06 14:12:00", null)).toBe("2026-10-06T14:12:00-05:00");
    expect(exifToIso("2026:01:15 09:00:00", null)).toBe("2026-01-15T09:00:00-06:00");
  });

  it("rejects unset or malformed dates", () => {
    expect(exifToIso("0000:00:00 00:00:00", null)).toBeNull();
    expect(exifToIso("2026-10-06 14:12:00", null)).toBeNull();
  });
});

describe("toOffsetIso", () => {
  it("formats local wall time with the local offset", () => {
    expect(toOffsetIso(new Date(Date.UTC(2026, 0, 15, 18, 0, 0)))).toBe("2026-01-15T12:00:00-06:00");
  });
});
```

`test/unit/srcset.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { largestSrc, smallestSrc, srcsetAttr } from "../../src/shared/srcset";

const s = { "1920": "https://x/c.webp", "480": "https://x/a.webp", "960": "https://x/b.webp" };

describe("srcset helpers", () => {
  it("orders numerically, not lexically", () => {
    expect(srcsetAttr(s)).toBe("https://x/a.webp 480w, https://x/b.webp 960w, https://x/c.webp 1920w");
    expect(smallestSrc(s)).toBe("https://x/a.webp");
    expect(largestSrc(s)).toBe("https://x/c.webp");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — modules under `src/shared/` not found.

- [ ] **Step 3: Implement**

`src/shared/types.ts`:
```ts
export interface FeedPhoto {
  id: string;
  takenAt: string;
  caption: string | null;
  width: number;
  height: number;
  srcset: Record<string, string>;
}

export interface AdminPhoto extends FeedPhoto {
  hidden: boolean;
}

export interface FeedPage<P = FeedPhoto> {
  project: { slug: string; name: string };
  photos: P[];
  nextCursor: string | null;
}

export interface ProjectSummary {
  slug: string;
  name: string;
  siteUrl: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
```

`src/shared/widths.ts`:
```ts
export const STANDARD_WIDTHS = [480, 960, 1920] as const;

const KiB = 1024;
const MAX_BYTES: Record<number, number> = { 480: 150 * KiB, 960: 500 * KiB, 1920: 1536 * KiB };

/** Widths to store for an image whose upright width is `originalWidth`. Never upscales. */
export function selectWidths(originalWidth: number): number[] {
  const fit = STANDARD_WIDTHS.filter((w) => w <= originalWidth);
  return fit.length > 0 ? [...fit] : [originalWidth];
}

/** Byte cap for a stored variant. A sub-480 original uses the 480w cap. */
export function maxBytesFor(width: number): number {
  return MAX_BYTES[width] ?? 150 * KiB;
}

export function scaledHeight(width: number, largestWidth: number, largestHeight: number): number {
  return Math.max(1, Math.round((largestHeight * width) / largestWidth));
}
```

`src/shared/cursor.ts`:
```ts
export interface CursorKey {
  takenUtc: string;
  id: string;
}

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function encodeCursor(k: CursorKey): string {
  return btoa(`${k.takenUtc}|${k.id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(s: string): CursorKey | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const text = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const [takenUtc, id, ...rest] = text.split("|");
    if (rest.length > 0 || !takenUtc || !id || !UTC.test(takenUtc) || !ULID.test(id)) return null;
    return { takenUtc, id };
  } catch {
    return null;
  }
}
```
(The cursor's characters are all ASCII, so `btoa`/`atob` are safe without a UTF-8 step.)

`src/shared/time.ts`:
```ts
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const OFFSET = /^[+-]\d{2}:\d{2}$/;

export interface TakenAt {
  takenAt: string;
  takenUtc: string;
  ms: number;
}

export function parseTakenAt(s: string): TakenAt | null {
  if (!ISO_WITH_OFFSET.test(s)) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  return { takenAt: s, takenUtc: new Date(ms).toISOString(), ms };
}

/** EXIF "YYYY:MM:DD HH:MM:SS" (+ optional "+HH:MM") → ISO 8601 with offset. No offset → device zone. */
export function exifToIso(dateTime: string, offset: string | null): string | null {
  const m = EXIF_DATE.exec(dateTime.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss] = m;
  if (Number(y) < 1990) return null;
  const off = offset?.trim();
  if (off && OFFSET.test(off)) {
    const iso = `${y}-${mo}-${d}T${hh}:${mi}:${ss}${off}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss));
  return Number.isNaN(local.getTime()) ? null : toOffsetIso(local);
}

export function toOffsetIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const abs = Math.abs(off);
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
```

`src/shared/srcset.ts`:
```ts
type Srcset = Record<string, string>;

const sorted = (s: Srcset) =>
  Object.entries(s)
    .map(([w, url]) => [Number(w), url] as const)
    .sort((a, b) => a[0] - b[0]);

export function srcsetAttr(s: Srcset): string {
  return sorted(s).map(([w, url]) => `${url} ${w}w`).join(", ");
}

export function smallestSrc(s: Srcset): string {
  return sorted(s)[0]?.[1] ?? "";
}

export function largestSrc(s: Srcset): string {
  const all = sorted(s);
  return all[all.length - 1]?.[1] ?? "";
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared test/unit
git commit -m "feat: shared widths, cursor, time and srcset helpers"
```

---

### Task 3: Access JWT verification for /api/admin/*

**Files:**
- Create: `src/worker/access.ts`
- Modify: `src/worker/app.ts` (admin middleware), `test/worker/helpers.ts` (JWKS fake, `accessToken`, `admin`)
- Test: `test/worker/access.test.ts`

**Interfaces:**
- Consumes: `Deps`, `AppEnv`, `HttpError` (Task 1).
- Produces:
  - `type Verify = (token: string, teamDomain: string, aud: string) => Promise<string>` (resolves to the email)
  - `createAccessVerifier(fetchFn: typeof fetch): Verify` — caches the JWKS for 10 minutes; refetches once when a token's `kid` is unknown.
  - `requireAccess(verify: Verify): MiddlewareHandler<AppEnv>` — sets `c.var.email`.
  - Test helpers: `TEAM`, `JWKS_URL`, `accessToken(opts)`, `harness().admin(path, init)`. Harness option `jwks?: JWK[]`.

- [ ] **Step 1: Extend the test helpers**

Add to `test/worker/helpers.ts`:
```ts
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";

export const TEAM = "team.cloudflareaccess.com";
export const JWKS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

const signing = await generateKeyPair("RS256", { extractable: true });
export const publicJwk: JWK = { ...(await exportJWK(signing.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

export async function accessToken(o: {
  email?: string | null;
  aud?: string;
  iss?: string;
  exp?: number | null;
  key?: CryptoKey;
  kid?: string;
} = {}): Promise<string> {
  const claims: Record<string, unknown> = {};
  if (o.email !== null) claims.email = o.email ?? "uploader@example.com";
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: o.kid ?? "k1" })
    .setIssuer(o.iss ?? `https://${TEAM}`)
    .setAudience(o.aud ?? "test-aud")
    .setIssuedAt();
  if (o.exp !== null) jwt = jwt.setExpirationTime(o.exp ?? Math.floor(Date.now() / 1000) + 600);
  return jwt.sign(o.key ?? signing.privateKey);
}
```

Change `HarnessOptions` and `harness` so the fake upstream serves the JWKS and add `admin`:
```ts
export interface HarnessOptions {
  env?: Partial<Env>;
  cache?: Cache;
  now?: number;
  jwks?: JWK[];
}

export function harness(opts: HarnessOptions = {}) {
  const fetchCalls: Request[] = [];
  const upstream = async (req: Request): Promise<Response> => {
    if (req.url === JWKS_URL) return Response.json({ keys: opts.jwks ?? [publicJwk] });
    return new Response("unmocked", { status: 599 });
  };
  const app = createApp({
    fetch: async (input, init) => {
      const req = new Request(input, init);
      fetchCalls.push(req.clone());
      return upstream(req);
    },
    cache: () => opts.cache ?? noCache,
    now: () => opts.now ?? Date.now(),
  });
  const e = testEnv(opts.env);
  const call = async (path: string, init?: RequestInit, base = TEST_BASE) =>
    app.fetch(new Request(base + path, init), e, createExecutionContext());
  const admin = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Cf-Access-Jwt-Assertion", await accessToken());
    return call(path, { ...init, headers });
  };
  return { call, admin, fetchCalls, env: e };
}
```

- [ ] **Step 2: Write the failing test**

`test/worker/access.test.ts` (uses `GET /api/admin/whoami`, a tiny route this task adds so auth is testable before the real admin routes exist):
```ts
import { generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { accessToken, harness, JWKS_URL } from "./helpers";

const withToken = (token: string) => ({ headers: { "Cf-Access-Jwt-Assertion": token } });

describe("Access verification on /api/admin/*", () => {
  it("rejects a missing token", async () => {
    const res = await harness().call("/api/admin/whoami");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it.each([
    ["garbage", () => Promise.resolve("not.a.jwt")],
    ["wrong audience", () => accessToken({ aud: "other-app" })],
    ["wrong issuer", () => accessToken({ iss: "https://evil.cloudflareaccess.com" })],
    ["expired", () => accessToken({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ["no expiry", () => accessToken({ exp: null })],
    ["no email", () => accessToken({ email: null })],
  ])("rejects a token with %s", async (_name, make) => {
    const res = await harness().call("/api/admin/whoami", withToken(await make()));
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and exposes the email", async () => {
    const res = await harness().call("/api/admin/whoami", withToken(await accessToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "uploader@example.com" });
  });

  it("caches the JWKS between requests", async () => {
    const h = harness();
    await h.call("/api/admin/whoami", withToken(await accessToken()));
    await h.call("/api/admin/whoami", withToken(await accessToken()));
    expect(h.fetchCalls.filter((r) => r.url === JWKS_URL)).toHaveLength(1);
  });

  it("refetches the JWKS once for an unknown kid, then rejects", async () => {
    const other = await generateKeyPair("RS256", { extractable: true });
    const h = harness(); // JWKS only has k1; the token below is signed by an unknown key "k2"
    await h.call("/api/admin/whoami", withToken(await accessToken()));
    const res = await h.call("/api/admin/whoami", withToken(await accessToken({ key: other.privateKey, kid: "k2" })));
    expect(res.status).toBe(401);
    expect(h.fetchCalls.filter((r) => r.url === JWKS_URL)).toHaveLength(2);
  });

  it("honors DEV_AUTH_EMAIL only on localhost", async () => {
    const h = harness({ env: { DEV_AUTH_EMAIL: "dev@example.com" } });
    expect((await h.call("/api/admin/whoami")).status).toBe(401);
    const local = await h.call("/api/admin/whoami", undefined, "http://localhost:8787");
    expect(local.status).toBe(200);
    expect(await local.json()).toEqual({ email: "dev@example.com" });
  });

  it("marks admin responses no-store", async () => {
    const res = await harness().call("/api/admin/whoami", withToken(await accessToken()));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --config vitest.worker.config.ts test/worker/access.test.ts`
Expected: FAIL — `/api/admin/whoami` returns 404.

- [ ] **Step 4: Implement**

`src/worker/access.ts`:
```ts
import type { MiddlewareHandler } from "hono";
import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from "jose";
import type { AppEnv } from "./env";
import { HttpError } from "./http";

const JWKS_TTL_MS = 10 * 60 * 1000;

export type Verify = (token: string, teamDomain: string, aud: string) => Promise<string>;

export function createAccessVerifier(fetchFn: typeof fetch): Verify {
  let cached: { domain: string; at: number; keys: ReturnType<typeof createLocalJWKSet> } | null = null;

  async function keys(domain: string, force: boolean) {
    if (!force && cached && cached.domain === domain && Date.now() - cached.at < JWKS_TTL_MS) return cached.keys;
    const res = await fetchFn(`https://${domain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    cached = { domain, at: Date.now(), keys: createLocalJWKSet((await res.json()) as JSONWebKeySet) };
    return cached.keys;
  }

  return async (token, domain, aud) => {
    const opts = { audience: aud, issuer: `https://${domain}`, algorithms: ["RS256"], requiredClaims: ["exp"] };
    let payload;
    try {
      ({ payload } = await jwtVerify(token, await keys(domain, false), opts));
    } catch (err) {
      if (!(err instanceof errors.JWKSNoMatchingKey)) throw err;
      ({ payload } = await jwtVerify(token, await keys(domain, true), opts));
    }
    if (typeof payload.email !== "string" || payload.email === "") throw new Error("Access token has no email");
    return payload.email;
  };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function requireAccess(verify: Verify): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.env.DEV_AUTH_EMAIL && LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
      c.set("email", c.env.DEV_AUTH_EMAIL);
      return next();
    }
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) throw new HttpError(401, "unauthorized", "Sign in required");
    try {
      c.set("email", await verify(token, c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD));
    } catch (err) {
      console.warn("Access token rejected:", err instanceof Error ? err.message : err);
      throw new HttpError(401, "unauthorized", "Sign in required");
    }
    await next();
  };
}
```

In `src/worker/app.ts`, add the imports and register the middleware plus `whoami` before `notFound`, and drop the `void deps;` line:
```ts
import { createAccessVerifier, requireAccess } from "./access";

  app.use("/api/admin/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("/api/admin/*", requireAccess(createAccessVerifier(deps.fetch)));
  app.get("/api/admin/whoami", (c) => c.json({ email: c.var.email }));
```

- [ ] **Step 5: Run tests**

Run: `npm run test:worker`
Expected: all PASS. If the unknown-kid test fails because jose throws `JWSSignatureVerificationFailed` instead of `JWKSNoMatchingKey`, check the `kid` in the signed header is `k2` (absent from the set) — that is what triggers the no-matching-key path.

- [ ] **Step 6: Commit**

```bash
git add src/worker test/worker
git commit -m "feat: verify Cloudflare Access JWT on admin routes"
```

---

### Task 4: Projects, photo repository, public feed and images

**Files:**
- Create: `src/worker/ulid.ts`, `src/worker/urls.ts`, `src/worker/projects.ts`, `src/worker/photos.ts`, `src/worker/routes/feed.ts`, `src/worker/routes/img.ts`
- Modify: `src/worker/app.ts`, `test/worker/helpers.ts` (`seedProject`, `seedPhoto`, `randomHex`, `allFeedPages`)
- Test: `test/worker/feed.test.ts`, `test/worker/img.test.ts`

**Interfaces:**
- Consumes: `CursorKey`, `encodeCursor`, `decodeCursor`, `FeedPage`, `FeedPhoto`, `AdminPhoto` (Task 2); `App`, `Deps`, `HttpError` (Task 1).
- Produces:
  - `ulid(now?: number): string`
  - `imageKey(slug, id, width)`, `imageUrl(base, slug, id, width)`, `feedUrl(base, slug, cursor?)`
  - `ProjectRow`, `getProject(db, slug)`, `listProjects(db)`, `allowedOrigins(row): string[]`
  - `PAGE_SIZE = 24`, `PhotoRow`, `NewPhoto`, `FIND_BY_FINGERPRINT` (SQL string), `listPhotos(db, { project, cursor, includeHidden })`, `insertPhoto(db, p)`, `findByFingerprint(db, slug, fp)`, `getPhoto(db, id)`, `updatePhoto(db, id, patch)`, `deletePhotoRow(db, id)`, `photoWidths(row)`, `toFeedPhoto(row, base)`, `toAdminPhoto(row, base)`
  - `registerFeed(app, deps)`, `registerImages(app, deps)`

- [ ] **Step 1: Add seeding helpers**

Append to `test/worker/helpers.ts` (here and in later tasks, move any new `import` lines up to the top of the file):
```ts
import { ulid } from "../../src/worker/ulid";
import type { FeedPage } from "../../src/shared/types";

export function randomHex(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function seedProject(o: { origins?: string[]; name?: string } = {}): Promise<string> {
  const slug = `p-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO projects (slug, name, site_url, allowed_origins, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(slug, o.name ?? `Project ${slug}`, `https://${slug}.example/progress/`, JSON.stringify(o.origins ?? ["https://site.example"]), new Date().toISOString())
    .run();
  return slug;
}

export async function seedPhoto(
  slug: string,
  o: { id?: string; takenAt?: string; hidden?: boolean; caption?: string | null; fingerprint?: string; widths?: number[] } = {},
): Promise<string> {
  const id = o.id ?? ulid();
  const takenAt = o.takenAt ?? "2026-10-01T12:00:00-05:00";
  await env.DB.prepare(
    "INSERT INTO photos (id, project_slug, taken_at, taken_utc, uploaded_at, uploaded_by, caption, width, height, widths, fingerprint, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, slug, takenAt, new Date(takenAt).toISOString(), new Date().toISOString(), "seed@example.com", o.caption ?? null, 1920, 1440, JSON.stringify(o.widths ?? [480, 960, 1920]), o.fingerprint ?? randomHex(), o.hidden ? 1 : 0)
    .run();
  return id;
}

export async function allFeedPages(call: (path: string) => Promise<Response>, path: string): Promise<FeedPage[]> {
  const pages: FeedPage[] = [];
  let cursor: string | null = null;
  do {
    const res = await call(cursor ? `${path}${path.includes("?") ? "&" : "?"}cursor=${cursor}` : path);
    const page = (await res.json()) as FeedPage;
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor);
  return pages;
}
```

- [ ] **Step 2: Write the failing tests**

`test/worker/feed.test.ts`:
```ts
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
```

`test/worker/img.test.ts`:
```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ulid } from "../../src/worker/ulid";
import { harness } from "./helpers";

describe("GET /img/:project/:file", () => {
  it("serves the R2 object as immutable WebP", async () => {
    const id = ulid();
    await env.PHOTOS.put(`img-test/${id}-480w.webp`, new Uint8Array([1, 2, 3]));
    const res = await harness().call(`/img/img-test/${id}-480w.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("404s for a missing object", async () => {
    expect((await harness().call(`/img/img-test/${ulid()}-480w.webp`)).status).toBe(404);
  });

  it("404s for names outside the key pattern", async () => {
    expect((await harness().call("/img/img-test/..%2Fsecret")).status).toBe(404);
    expect((await harness().call("/img/IMG/whatever.webp")).status).toBe(404);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:worker`
Expected: FAIL — `src/worker/ulid` not found / feed routes 404.

- [ ] **Step 4: Implement**

`src/worker/ulid.ts`:
```ts
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 26-char Crockford base32 ULID: 48-bit ms timestamp + 80 random bits. */
export function ulid(now = Date.now()): string {
  let time = "";
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = ALPHABET[t % 32] + time;
  let rand = "";
  for (const b of crypto.getRandomValues(new Uint8Array(16))) rand += ALPHABET[b % 32];
  return time + rand;
}
```

`src/worker/urls.ts`:
```ts
export const imageKey = (slug: string, id: string, width: number) => `${slug}/${id}-${width}w.webp`;

export const imageUrl = (base: string, slug: string, id: string, width: number) => `${base}/img/${imageKey(slug, id, width)}`;

/** Also the edge-cache key and the purge URL for a feed page, so these must stay identical. */
export const feedUrl = (base: string, slug: string, cursor?: string) =>
  `${base}/api/feed/${slug}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
```

`src/worker/projects.ts`:
```ts
export interface ProjectRow {
  slug: string;
  name: string;
  site_url: string;
  allowed_origins: string;
  created_at: string;
}

export function getProject(db: D1Database, slug: string) {
  return db.prepare("SELECT * FROM projects WHERE slug = ?").bind(slug).first<ProjectRow>();
}

export async function listProjects(db: D1Database): Promise<ProjectRow[]> {
  const { results } = await db.prepare("SELECT * FROM projects ORDER BY name").all<ProjectRow>();
  return results;
}

export function allowedOrigins(p: ProjectRow): string[] {
  try {
    const v: unknown = JSON.parse(p.allowed_origins);
    return Array.isArray(v) ? v.filter((o): o is string => typeof o === "string") : [];
  } catch {
    return [];
  }
}
```

`src/worker/photos.ts`:
```ts
import { encodeCursor, type CursorKey } from "../shared/cursor";
import type { AdminPhoto, FeedPhoto } from "../shared/types";
import { imageUrl } from "./urls";

export const PAGE_SIZE = 24;

export interface PhotoRow {
  id: string;
  project_slug: string;
  taken_at: string;
  taken_utc: string;
  uploaded_at: string;
  uploaded_by: string;
  caption: string | null;
  width: number;
  height: number;
  widths: string;
  fingerprint: string;
  hidden: number;
}

export interface NewPhoto {
  id: string;
  projectSlug: string;
  takenAt: string;
  takenUtc: string;
  uploadedAt: string;
  uploadedBy: string;
  caption: string | null;
  width: number;
  height: number;
  widths: number[];
  fingerprint: string;
}

export async function listPhotos(
  db: D1Database,
  opts: { project: string; cursor: CursorKey | null; includeHidden: boolean },
): Promise<{ rows: PhotoRow[]; nextCursor: string | null }> {
  const where = ["project_slug = ?"];
  const params: unknown[] = [opts.project];
  if (!opts.includeHidden) where.push("hidden = 0");
  if (opts.cursor) {
    where.push("(taken_utc < ? OR (taken_utc = ? AND id < ?))");
    params.push(opts.cursor.takenUtc, opts.cursor.takenUtc, opts.cursor.id);
  }
  const { results } = await db
    .prepare(`SELECT * FROM photos WHERE ${where.join(" AND ")} ORDER BY taken_utc DESC, id DESC LIMIT ?`)
    .bind(...params, PAGE_SIZE + 1)
    .all<PhotoRow>();
  const rows = results.slice(0, PAGE_SIZE);
  const last = rows[rows.length - 1];
  const nextCursor = results.length > PAGE_SIZE && last ? encodeCursor({ takenUtc: last.taken_utc, id: last.id }) : null;
  return { rows, nextCursor };
}

export async function insertPhoto(db: D1Database, p: NewPhoto): Promise<void> {
  await db
    .prepare(
      "INSERT INTO photos (id, project_slug, taken_at, taken_utc, uploaded_at, uploaded_by, caption, width, height, widths, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(p.id, p.projectSlug, p.takenAt, p.takenUtc, p.uploadedAt, p.uploadedBy, p.caption, p.width, p.height, JSON.stringify(p.widths), p.fingerprint)
    .run();
}

export const FIND_BY_FINGERPRINT = "SELECT id FROM photos WHERE project_slug = ? AND fingerprint = ?";

export function findByFingerprint(db: D1Database, slug: string, fingerprint: string) {
  return db.prepare(FIND_BY_FINGERPRINT).bind(slug, fingerprint).first<{ id: string }>();
}

export function getPhoto(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first<PhotoRow>();
}

export async function updatePhoto(db: D1Database, id: string, patch: { caption?: string | null; hidden?: boolean }): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.caption !== undefined) {
    sets.push("caption = ?");
    params.push(patch.caption);
  }
  if (patch.hidden !== undefined) {
    sets.push("hidden = ?");
    params.push(patch.hidden ? 1 : 0);
  }
  if (sets.length === 0) return;
  await db.prepare(`UPDATE photos SET ${sets.join(", ")} WHERE id = ?`).bind(...params, id).run();
}

export async function deletePhotoRow(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM photos WHERE id = ?").bind(id).run();
}

export function photoWidths(row: PhotoRow): number[] {
  return JSON.parse(row.widths) as number[];
}

export function toFeedPhoto(row: PhotoRow, base: string): FeedPhoto {
  return {
    id: row.id,
    takenAt: row.taken_at,
    caption: row.caption,
    width: row.width,
    height: row.height,
    srcset: Object.fromEntries(photoWidths(row).map((w) => [String(w), imageUrl(base, row.project_slug, row.id, w)])),
  };
}

export function toAdminPhoto(row: PhotoRow, base: string): AdminPhoto {
  return { ...toFeedPhoto(row, base), hidden: row.hidden === 1 };
}
```

`src/worker/routes/feed.ts`:
```ts
import { decodeCursor } from "../../shared/cursor";
import type { FeedPage } from "../../shared/types";
import type { App, Deps } from "../env";
import { HttpError } from "../http";
import { listPhotos, toFeedPhoto } from "../photos";
import { allowedOrigins, getProject } from "../projects";
import { feedUrl } from "../urls";

export function registerFeed(app: App, deps: Deps): void {
  app.get("/api/feed/:project", async (c) => {
    const project = await getProject(c.env.DB, c.req.param("project"));
    if (!project) throw new HttpError(404, "unknown_project", "No such project");

    const cursorParam = c.req.query("cursor");
    const cursor = cursorParam === undefined ? null : decodeCursor(cursorParam);
    if (cursorParam !== undefined && !cursor) throw new HttpError(400, "bad_cursor", "Invalid cursor");

    // Cached body is origin-independent; CORS is applied per request below.
    const cache = deps.cache();
    const cacheKey = new Request(feedUrl(c.env.PUBLIC_BASE_URL, project.slug, cursorParam));
    let res = await cache.match(cacheKey);
    if (!res) {
      const { rows, nextCursor } = await listPhotos(c.env.DB, { project: project.slug, cursor, includeHidden: false });
      const body: FeedPage = {
        project: { slug: project.slug, name: project.name },
        photos: rows.map((r) => toFeedPhoto(r, c.env.PUBLIC_BASE_URL)),
        nextCursor,
      };
      res = Response.json(body, { headers: { "Cache-Control": "public, max-age=60" } });
      c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
    }

    const out = new Response(res.body, res);
    out.headers.set("Vary", "Origin");
    const origin = c.req.header("Origin");
    if (origin && allowedOrigins(project).includes(origin)) out.headers.set("Access-Control-Allow-Origin", origin);
    return out;
  });
}
```

`src/worker/routes/img.ts`:
```ts
import type { App, Deps } from "../env";
import { HttpError } from "../http";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE = /^[0-9A-HJKMNP-TV-Z]{26}-\d{1,5}w\.webp$/;

export function registerImages(app: App, deps: Deps): void {
  app.get("/img/:project/:file", async (c) => {
    const { project, file } = c.req.param();
    if (!SLUG.test(project) || !FILE.test(file)) throw new HttpError(404, "not_found", "No such image");

    const key = `${project}/${file}`;
    const cache = deps.cache();
    const cacheKey = new Request(`${c.env.PUBLIC_BASE_URL}/img/${key}`);
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const obj = await c.env.PHOTOS.get(key);
    if (!obj) throw new HttpError(404, "not_found", "No such image");
    const res = new Response(obj.body, {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", ETag: obj.httpEtag },
    });
    c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  });
}
```

In `src/worker/app.ts`, import and register after the admin middleware:
```ts
import { registerFeed } from "./routes/feed";
import { registerImages } from "./routes/img";

  registerFeed(app, deps);
  registerImages(app, deps);
```

- [ ] **Step 5: Run tests**

Run: `npm run test:worker`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker test/worker
git commit -m "feat: public feed with keyset pagination, CORS and edge cache; image route"
```

---

### Task 5: Upload endpoint with validation, dedupe and R2 cleanup

**Files:**
- Create: `src/worker/webp.ts`, `src/worker/captions.ts`, `src/worker/routes/upload.ts`
- Modify: `src/worker/app.ts`, `test/worker/helpers.ts` (`fakeWebp`, `uploadForm`, `listKeys`)
- Test: `test/worker/webp.test.ts`, `test/worker/upload.test.ts`

**Interfaces:**
- Consumes: `selectWidths`, `maxBytesFor`, `scaledHeight` (Task 2); `parseTakenAt` (Task 2); `getProject`, `insertPhoto`, `findByFingerprint`, `FIND_BY_FINGERPRINT`, `imageKey`, `ulid` (Task 4); `c.var.email` (Task 3).
- Produces:
  - `readWebpSize(bytes: Uint8Array): { width: number; height: number } | null`
  - `normalizeCaption(s: string): string | null` — trims, `""` → `null`, throws `HttpError(400, "bad_request")` over 280 code points.
  - `POST /api/admin/photos` → `201 { id }` | `200 { id, duplicate: true }`
  - `registerUpload(app, deps)`

- [ ] **Step 1: Add fixtures**

Append to `test/worker/helpers.ts`:
```ts
/** Minimal lossy-WebP ("VP8 ") header of the given size, zero-padded to `totalBytes`. */
export function fakeWebp(width: number, height: number, totalBytes = 64): Uint8Array {
  const b = new Uint8Array(Math.max(totalBytes, 30));
  const dv = new DataView(b.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((ch, i) => (b[o + i] = ch.charCodeAt(0)));
  ascii(0, "RIFF");
  dv.setUint32(4, b.length - 8, true);
  ascii(8, "WEBP");
  ascii(12, "VP8 ");
  dv.setUint32(16, b.length - 20, true);
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  dv.setUint16(26, width & 0x3fff, true);
  dv.setUint16(28, height & 0x3fff, true);
  return b;
}

export function uploadForm(o: {
  project: string;
  fingerprint?: string;
  takenAt?: string;
  caption?: string;
  width?: number;
  height?: number;
  files?: Record<string, Uint8Array>;
}): FormData {
  const width = o.width ?? 1920;
  const height = o.height ?? 1440;
  const files = o.files ?? { w480: fakeWebp(480, 360), w960: fakeWebp(960, 720), w1920: fakeWebp(1920, 1440) };
  const f = new FormData();
  f.set("project", o.project);
  f.set("fingerprint", o.fingerprint ?? randomHex());
  f.set("takenAt", o.takenAt ?? "2026-10-06T14:12:00-05:00");
  if (o.caption !== undefined) f.set("caption", o.caption);
  f.set("width", String(width));
  f.set("height", String(height));
  for (const [name, bytes] of Object.entries(files)) f.set(name, new File([bytes], `${name}.webp`, { type: "image/webp" }));
  return f;
}

export async function listKeys(prefix: string): Promise<string[]> {
  return (await env.PHOTOS.list({ prefix })).objects.map((o) => o.key).sort();
}
```

- [ ] **Step 2: Write the failing tests**

`test/worker/webp.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { readWebpSize } from "../../src/worker/webp";
import { fakeWebp } from "./helpers";

describe("readWebpSize", () => {
  it("reads lossy VP8 dimensions", () => {
    expect(readWebpSize(fakeWebp(1920, 1440))).toEqual({ width: 1920, height: 1440 });
  });

  it("reads VP8L (lossless) dimensions", () => {
    const b = fakeWebp(1, 1);
    b.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
    b[20] = 0x2f;
    const bits = (960 - 1) | ((720 - 1) << 14);
    new DataView(b.buffer).setUint32(21, bits, true);
    expect(readWebpSize(b)).toEqual({ width: 960, height: 720 });
  });

  it("reads VP8X (extended) canvas dimensions", () => {
    const b = fakeWebp(1, 1);
    b.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
    const w = 480 - 1;
    const h = 360 - 1;
    b.set([w & 0xff, (w >> 8) & 0xff, w >> 16, h & 0xff, (h >> 8) & 0xff, h >> 16], 24);
    expect(readWebpSize(b)).toEqual({ width: 480, height: 360 });
  });

  it("rejects non-WebP bytes", () => {
    expect(readWebpSize(new TextEncoder().encode("\x89PNG\r\n\x1a\n................................"))).toBeNull();
    expect(readWebpSize(new Uint8Array(10))).toBeNull();
  });
});
```

`test/worker/upload.test.ts`:
```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { FIND_BY_FINGERPRINT } from "../../src/worker/photos";
import { fakeWebp, harness, listKeys, randomHex, seedPhoto, seedProject, uploadForm } from "./helpers";

const post = (h: ReturnType<typeof harness>, form: FormData) => h.admin("/api/admin/photos", { method: "POST", body: form });

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
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run --config vitest.worker.config.ts test/worker/webp.test.ts test/worker/upload.test.ts`
Expected: FAIL — `src/worker/webp` not found; upload route 404.

- [ ] **Step 4: Implement**

`src/worker/webp.ts`:
```ts
/** Dimensions from a WebP header, or null if the bytes aren't WebP. Header-only; does not decode. */
export function readWebpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") return null;

  switch (ascii(12, 4)) {
    case "VP8 ": // lossy: frame tag (3), start code 9d 01 2a, then 14-bit width/height
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
    case "VP8L": {
      if (b[20] !== 0x2f) return null;
      const bits = (b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)) >>> 0;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    case "VP8X": // extended: 24-bit canvas width-1 / height-1
      return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    default:
      return null;
  }
}
```

`src/worker/captions.ts`:
```ts
import { badRequest } from "./http";

export const MAX_CAPTION = 280;

export function normalizeCaption(s: string): string | null {
  const t = s.trim();
  if (t === "") return null;
  if ([...t].length > MAX_CAPTION) throw badRequest(`Caption must be ${MAX_CAPTION} characters or fewer`);
  return t;
}
```

`src/worker/routes/upload.ts`:
```ts
import { parseTakenAt } from "../../shared/time";
import { maxBytesFor, scaledHeight, selectWidths } from "../../shared/widths";
import { normalizeCaption } from "../captions";
import type { App, Deps } from "../env";
import { badRequest, HttpError } from "../http";
import { findByFingerprint, insertPhoto } from "../photos";
import { getProject } from "../projects";
import { ulid } from "../ulid";
import { imageKey } from "../urls";
import { readWebpSize } from "../webp";

const DAY_MS = 24 * 60 * 60 * 1000;
const FINGERPRINT = /^[0-9a-f]{64}$/;

export function registerUpload(app: App, deps: Deps): void {
  app.post("/api/admin/photos", async (c) => {
    const form = await c.req.raw.formData().catch(() => {
      throw badRequest("Expected multipart/form-data");
    });
    const field = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : null;
    };

    const slug = field("project");
    if (!slug) throw badRequest("project is required");
    const project = await getProject(c.env.DB, slug);
    if (!project) throw new HttpError(404, "unknown_project", "No such project");

    const fingerprint = field("fingerprint");
    if (!fingerprint || !FINGERPRINT.test(fingerprint)) throw badRequest("fingerprint must be 64 lowercase hex characters");

    const taken = parseTakenAt(field("takenAt") ?? "");
    if (!taken) throw badRequest("takenAt must be ISO 8601 with a time zone offset");
    const now = deps.now();
    if (taken.ms > now + DAY_MS) throw badRequest("takenAt is in the future");

    const caption = normalizeCaption(field("caption") ?? "");

    const width = Number(field("width"));
    const height = Number(field("height"));
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw badRequest("width and height must be positive integers");
    }
    const widths = selectWidths(width);
    if (widths[widths.length - 1] !== width) throw badRequest("width must be 480, 960, 1920, or an original narrower than 480");

    const expectedFields = new Set(widths.map((w) => `w${w}`));
    for (const key of form.keys()) {
      if (/^w\d+$/.test(key) && !expectedFields.has(key)) throw badRequest(`Unexpected file ${key}`);
    }

    const existing = await findByFingerprint(c.env.DB, slug, fingerprint);
    if (existing) return c.json({ id: existing.id, duplicate: true }, 200);

    const files: { width: number; bytes: Uint8Array }[] = [];
    for (const w of widths) {
      const file = form.get(`w${w}`);
      if (!(file instanceof File)) throw badRequest(`Missing file w${w}`);
      if (file.size > maxBytesFor(w)) throw new HttpError(413, "too_large", `w${w} is ${file.size} bytes; the limit is ${maxBytesFor(w)}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const size = readWebpSize(bytes);
      if (!size) throw badRequest(`w${w} is not a WebP image`);
      const expectedHeight = w === width ? height : scaledHeight(w, width, height);
      if (size.width !== w || Math.abs(size.height - expectedHeight) > 1) {
        throw badRequest(`w${w} is ${size.width}×${size.height}; expected ${w}×${expectedHeight}`);
      }
      files.push({ width: w, bytes });
    }

    const id = ulid(now);
    const keys = files.map((f) => imageKey(slug, id, f.width));
    try {
      await Promise.all(files.map((f, i) => c.env.PHOTOS.put(keys[i]!, f.bytes, { httpMetadata: { contentType: "image/webp" } })));
      await insertPhoto(c.env.DB, {
        id,
        projectSlug: slug,
        takenAt: taken.takenAt,
        takenUtc: taken.takenUtc,
        uploadedAt: new Date(now).toISOString(),
        uploadedBy: c.var.email,
        caption,
        width,
        height,
        widths,
        fingerprint,
      });
    } catch (err) {
      await c.env.PHOTOS.delete(keys);
      const dup = await findByFingerprint(c.env.DB, slug, fingerprint);
      if (dup) return c.json({ id: dup.id, duplicate: true }, 200);
      throw err;
    }
    return c.json({ id }, 201);
  });
}
```

Register in `src/worker/app.ts`:
```ts
import { registerUpload } from "./routes/upload";

  registerUpload(app, deps);
```

- [ ] **Step 5: Run tests**

Run: `npm run test:worker && npm run typecheck`
Expected: all PASS; no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/worker test/worker
git commit -m "feat: photo upload with WebP validation, dedupe and R2 cleanup"
```

---

### Task 6: Admin list, edit, hide and delete with cache purge

**Files:**
- Create: `src/worker/purge.ts`, `src/worker/routes/admin.ts`
- Modify: `src/worker/app.ts` (register admin routes; remove `whoami`), `test/worker/helpers.ts` (purge fake), `test/worker/access.test.ts` (use `/api/admin/projects` instead of `whoami`)
- Test: `test/worker/admin.test.ts`

**Interfaces:**
- Consumes: Task 4 repository functions; `normalizeCaption` (Task 5); `ProjectSummary`, `FeedPage`, `AdminPhoto` (Task 2).
- Produces:
  - `purgeUrls(fetchFn, env, urls: string[]): Promise<boolean>`
  - `GET /api/admin/projects` → `ProjectSummary[]`
  - `GET /api/admin/photos?project=&cursor=` → `FeedPage<AdminPhoto>`
  - `PATCH /api/admin/photos/:id` `{ caption?: string | null, hidden?: boolean }` → `AdminPhoto`
  - `DELETE /api/admin/photos/:id` → `204` | `200 { purged: false }`
  - Harness option `purge?: "ok" | "fail"` (default `"ok"`).

- [ ] **Step 1: Extend the harness's fake upstream**

In `test/worker/helpers.ts`, add `purge?: "ok" | "fail"` to `HarnessOptions` and this branch to `upstream` before the `unmocked` fallback:
```ts
    if (req.url.startsWith("https://api.cloudflare.com/")) {
      return opts.purge === "fail"
        ? Response.json({ success: false, errors: [{ code: 1001, message: "simulated" }] }, { status: 400 })
        : Response.json({ success: true });
    }
```

- [ ] **Step 2: Move the auth tests off `whoami`**

In `test/worker/access.test.ts`, replace every `/api/admin/whoami` with `/api/admin/projects`. Change the two assertions that read the body: the "valid token" test becomes `expect(res.status).toBe(200)`, and the DEV_AUTH_EMAIL test keeps only the status assertions (`401` remote, `200` localhost).

- [ ] **Step 3: Write the failing tests**

`test/worker/admin.test.ts`:
```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
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
    const slug = await seedProject();
    const id = await seedWithObjects(slug);
    const res = await harness({ env: { CF_PURGE_TOKEN: "t" }, purge: "fail" }).admin(`/api/admin/photos/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purged: false });
    expect(await listKeys(`${slug}/`)).toEqual([]);
  });

  it("reports purged:false without calling the API when no purge token is set", async () => {
    const slug = await seedProject();
    const id = await seedWithObjects(slug);
    const h = harness();
    const res = await h.admin(`/api/admin/photos/${id}`, { method: "DELETE" });
    expect(await res.json()).toEqual({ purged: false });
    expect(h.fetchCalls.some((r) => r.url.startsWith("https://api.cloudflare.com/"))).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run --config vitest.worker.config.ts test/worker/admin.test.ts test/worker/access.test.ts`
Expected: FAIL — admin routes 404.

- [ ] **Step 5: Implement**

`src/worker/purge.ts`:
```ts
import type { Env } from "./env";

/** Purges URLs from Cloudflare's cache (incl. Cache API entries). Never throws; false = not purged. */
export async function purgeUrls(fetchFn: typeof fetch, env: Env, urls: string[]): Promise<boolean> {
  if (!env.CF_PURGE_TOKEN) {
    console.warn("CF_PURGE_TOKEN not set; skipping cache purge");
    return false;
  }
  try {
    const res = await fetchFn(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CF_PURGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: urls }),
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
    if (res.ok && body?.success) return true;
    console.error("Cache purge failed", res.status, JSON.stringify(body));
    return false;
  } catch (err) {
    console.error("Cache purge failed", err);
    return false;
  }
}
```

`src/worker/routes/admin.ts`:
```ts
import { decodeCursor } from "../../shared/cursor";
import type { AdminPhoto, FeedPage, ProjectSummary } from "../../shared/types";
import { normalizeCaption } from "../captions";
import type { App, Deps } from "../env";
import { badRequest, HttpError } from "../http";
import { deletePhotoRow, getPhoto, listPhotos, photoWidths, toAdminPhoto, updatePhoto } from "../photos";
import { getProject, listProjects } from "../projects";
import { purgeUrls } from "../purge";
import { feedUrl, imageKey, imageUrl } from "../urls";

const photoNotFound = () => new HttpError(404, "not_found", "No such photo");

function parsePatch(body: unknown): { caption?: string | null; hidden?: boolean } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest("Expected a JSON object");
  const b = body as Record<string, unknown>;
  const patch: { caption?: string | null; hidden?: boolean } = {};
  if ("caption" in b) {
    if (b.caption === null) patch.caption = null;
    else if (typeof b.caption === "string") patch.caption = normalizeCaption(b.caption);
    else throw badRequest("caption must be a string or null");
  }
  if ("hidden" in b) {
    if (typeof b.hidden !== "boolean") throw badRequest("hidden must be true or false");
    patch.hidden = b.hidden;
  }
  if (patch.caption === undefined && patch.hidden === undefined) throw badRequest("Nothing to update");
  return patch;
}

export function registerAdmin(app: App, deps: Deps): void {
  app.get("/api/admin/projects", async (c) => {
    const rows = await listProjects(c.env.DB);
    return c.json(rows.map((p): ProjectSummary => ({ slug: p.slug, name: p.name, siteUrl: p.site_url })));
  });

  app.get("/api/admin/photos", async (c) => {
    const slug = c.req.query("project");
    if (!slug) throw badRequest("project is required");
    const project = await getProject(c.env.DB, slug);
    if (!project) throw new HttpError(404, "unknown_project", "No such project");
    const cursorParam = c.req.query("cursor");
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) throw new HttpError(400, "bad_cursor", "Invalid cursor");
    const { rows, nextCursor } = await listPhotos(c.env.DB, { project: slug, cursor, includeHidden: true });
    const body: FeedPage<AdminPhoto> = {
      project: { slug, name: project.name },
      photos: rows.map((r) => toAdminPhoto(r, c.env.PUBLIC_BASE_URL)),
      nextCursor,
    };
    return c.json(body);
  });

  app.patch("/api/admin/photos/:id", async (c) => {
    const patch = parsePatch(await c.req.json().catch(() => null));
    const row = await getPhoto(c.env.DB, c.req.param("id"));
    if (!row) throw photoNotFound();
    await updatePhoto(c.env.DB, row.id, patch);
    const updated = await getPhoto(c.env.DB, row.id);
    if (!updated) throw photoNotFound();
    return c.json(toAdminPhoto(updated, c.env.PUBLIC_BASE_URL));
  });

  app.delete("/api/admin/photos/:id", async (c) => {
    const row = await getPhoto(c.env.DB, c.req.param("id"));
    if (!row) throw photoNotFound();
    const widths = photoWidths(row);
    const base = c.env.PUBLIC_BASE_URL;
    await deletePhotoRow(c.env.DB, row.id);
    await c.env.PHOTOS.delete(widths.map((w) => imageKey(row.project_slug, row.id, w)));
    const purged = await purgeUrls(deps.fetch, c.env, [
      ...widths.map((w) => imageUrl(base, row.project_slug, row.id, w)),
      feedUrl(base, row.project_slug),
    ]);
    return purged ? c.body(null, 204) : c.json({ purged: false }, 200);
  });
}
```

In `src/worker/app.ts`: delete the `whoami` route, then:
```ts
import { registerAdmin } from "./routes/admin";

  registerAdmin(app, deps);
```

- [ ] **Step 6: Run tests**

Run: `npm run test:worker && npm run typecheck`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/worker test/worker
git commit -m "feat: admin photo list, edit, hide and delete with cache purge"
```

---

### Task 7: Operator scripts — `project:add` and `cleanup:orphans`

**Files:**
- Create: `scripts/lib/project-args.ts`, `scripts/lib/orphans.ts`, `scripts/project-add.ts`, `scripts/cleanup-orphans.ts`
- Test: `test/unit/project-args.test.ts`, `test/unit/orphans.test.ts`

**Interfaces:**
- Produces:
  - `type Target = "local" | "staging" | "production"`
  - `parseProjectArgs(argv: string[]): ProjectInput` (`{ target, slug, name, siteUrl, origins }`, throws `Error` with a user-facing message)
  - `sqlString(s): string`, `projectInsertSql(p, createdAt): string`, `wranglerD1Args(target): string[]`
  - `findOrphans(objects: StoredObject[], photoIds: Set<string>, now: number): { orphans: string[]; unrecognised: string[]; recent: number }`, `GRACE_MS`
  - Task 9's `scripts/seed-e2e.ts` reuses `sqlString` and `projectInsertSql`.

- [ ] **Step 1: Write the failing tests**

`test/unit/project-args.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseProjectArgs, projectInsertSql, wranglerD1Args } from "../../scripts/lib/project-args.ts";

describe("parseProjectArgs", () => {
  it("parses the spec's form", () => {
    expect(
      parseProjectArgs(["--env", "staging", "birken-lofts", "Birken Lofts", "https://birkenlofts.com/progress/", "https://birkenlofts.com", "http://localhost:3000"]),
    ).toEqual({
      target: "staging",
      slug: "birken-lofts",
      name: "Birken Lofts",
      siteUrl: "https://birkenlofts.com/progress/",
      origins: ["https://birkenlofts.com", "http://localhost:3000"],
    });
  });

  it.each([
    [["birken-lofts", "B", "https://b.com/", "https://b.com"], /--env is required/],
    [["--env", "prod", "birken-lofts", "B", "https://b.com/", "https://b.com"], /--env must be/],
    [["--env", "local", "Birken_Lofts", "B", "https://b.com/", "https://b.com"], /slug/],
    [["--env", "local", "birken-lofts", " ", "https://b.com/", "https://b.com"], /name/],
    [["--env", "local", "birken-lofts", "B", "birkenlofts.com", "https://b.com"], /site_url/],
    [["--env", "local", "birken-lofts", "B", "https://b.com/"], /at least one origin/],
    [["--env", "local", "birken-lofts", "B", "https://b.com/", "https://b.com/"], /not an origin/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseProjectArgs(argv)).toThrow(message);
  });
});

describe("projectInsertSql", () => {
  it("escapes quotes in every literal", () => {
    const sql = projectInsertSql(
      { slug: "ohare", name: "O'Hare Lofts", siteUrl: "https://o.com/p/", origins: ["https://o.com"] },
      "2026-10-06T00:00:00.000Z",
    );
    expect(sql).toBe(
      `INSERT INTO projects (slug, name, site_url, allowed_origins, created_at) VALUES ('ohare', 'O''Hare Lofts', 'https://o.com/p/', '["https://o.com"]', '2026-10-06T00:00:00.000Z');`,
    );
  });
});

describe("wranglerD1Args", () => {
  it("targets the right database", () => {
    expect(wranglerD1Args("local")).toEqual(["d1", "execute", "progress-photos", "--local"]);
    expect(wranglerD1Args("staging")).toEqual(["d1", "execute", "progress-photos-staging", "--remote", "--env", "staging"]);
    expect(wranglerD1Args("production")).toEqual(["d1", "execute", "progress-photos", "--remote"]);
  });
});
```

`test/unit/orphans.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { findOrphans, GRACE_MS } from "../../scripts/lib/orphans.ts";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const old = new Date(NOW - GRACE_MS - 1).toISOString();
const ID_A = "01J9Z3K5Q8W2E4R6T8Y0V2X4Z6";
const ID_B = "01J9Z3K5Q8W2E4R6T8Y0V2X4Z7";

describe("findOrphans", () => {
  it("returns old keys with no matching row", () => {
    const r = findOrphans(
      [
        { key: `birken-lofts/${ID_A}-480w.webp`, uploaded: old },
        { key: `birken-lofts/${ID_B}-480w.webp`, uploaded: old },
      ],
      new Set([ID_A]),
      NOW,
    );
    expect(r).toEqual({ orphans: [`birken-lofts/${ID_B}-480w.webp`], unrecognised: [], recent: 0 });
  });

  it("skips objects younger than the grace period (upload may be in flight)", () => {
    const r = findOrphans([{ key: `birken-lofts/${ID_B}-480w.webp`, uploaded: new Date(NOW - 60_000).toISOString() }], new Set(), NOW);
    expect(r).toEqual({ orphans: [], unrecognised: [], recent: 1 });
  });

  it("treats an unparseable timestamp as recent and never deletes unrecognised keys", () => {
    const r = findOrphans(
      [
        { key: `birken-lofts/${ID_B}-480w.webp`, uploaded: "?" },
        { key: "notes.txt", uploaded: old },
      ],
      new Set(),
      NOW,
    );
    expect(r).toEqual({ orphans: [], unrecognised: ["notes.txt"], recent: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `scripts/lib/*` not found.

- [ ] **Step 3: Implement the libraries**

`scripts/lib/project-args.ts`:
```ts
export type Target = "local" | "staging" | "production";

export interface ProjectInput {
  target: Target;
  slug: string;
  name: string;
  siteUrl: string;
  origins: string[];
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseProjectArgs(argv: string[]): ProjectInput {
  const args = [...argv];
  const i = args.indexOf("--env");
  if (i < 0) throw new Error("--env is required (local, staging or production)");
  const target = args[i + 1];
  if (target !== "local" && target !== "staging" && target !== "production") throw new Error("--env must be local, staging or production");
  args.splice(i, 2);

  const [slug, name, siteUrl, ...origins] = args;
  if (!slug || !SLUG.test(slug)) throw new Error("slug must be lowercase words joined by hyphens, e.g. birken-lofts");
  if (!name || !name.trim()) throw new Error("name is required");
  if (!siteUrl || !isHttpUrl(siteUrl)) throw new Error("site_url must be an http(s) URL");
  if (origins.length === 0) throw new Error("at least one origin is required");
  for (const o of origins) {
    if (!isHttpUrl(o) || new URL(o).origin !== o) throw new Error(`"${o}" is not an origin (scheme://host[:port], no path or trailing slash)`);
  }
  return { target, slug, name: name.trim(), siteUrl, origins };
}

export function sqlString(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

export function projectInsertSql(p: Omit<ProjectInput, "target">, createdAt: string): string {
  return `INSERT INTO projects (slug, name, site_url, allowed_origins, created_at) VALUES (${sqlString(p.slug)}, ${sqlString(p.name)}, ${sqlString(p.siteUrl)}, ${sqlString(JSON.stringify(p.origins))}, ${sqlString(createdAt)});`;
}

export function wranglerD1Args(target: Target): string[] {
  if (target === "local") return ["d1", "execute", "progress-photos", "--local"];
  if (target === "staging") return ["d1", "execute", "progress-photos-staging", "--remote", "--env", "staging"];
  return ["d1", "execute", "progress-photos", "--remote"];
}
```

`scripts/lib/orphans.ts`:
```ts
export interface StoredObject {
  key: string;
  uploaded: string;
}

/** An upload writes R2 before D1; anything this young may still be mid-upload. */
export const GRACE_MS = 60 * 60 * 1000;

const KEY = /^[a-z0-9-]+\/([0-9A-HJKMNP-TV-Z]{26})-\d+w\.webp$/;

export function findOrphans(objects: StoredObject[], photoIds: Set<string>, now: number) {
  const orphans: string[] = [];
  const unrecognised: string[] = [];
  let recent = 0;
  for (const o of objects) {
    const m = KEY.exec(o.key);
    if (!m) {
      unrecognised.push(o.key);
      continue;
    }
    if (photoIds.has(m[1]!)) continue;
    const age = now - Date.parse(o.uploaded);
    if (!(age >= GRACE_MS)) {
      recent++;
      continue;
    }
    orphans.push(o.key);
  }
  return { orphans, unrecognised, recent };
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test:unit`
Expected: all PASS.

- [ ] **Step 5: Write the CLI entry points**

`scripts/project-add.ts`:
```ts
// npm run project:add -- --env <local|staging|production> <slug> "<name>" <site_url> <origin>...
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProjectArgs, projectInsertSql, wranglerD1Args } from "./lib/project-args.ts";

let input;
try {
  input = parseProjectArgs(process.argv.slice(2));
} catch (err) {
  console.error((err as Error).message);
  console.error('Usage: npm run project:add -- --env <local|staging|production> <slug> "<name>" <site_url> <origin>...');
  process.exit(1);
}

const file = join(mkdtempSync(join(tmpdir(), "project-add-")), "insert.sql");
writeFileSync(file, projectInsertSql(input, new Date().toISOString()));
execFileSync("npx", ["wrangler", ...wranglerD1Args(input.target), "--file", file], { stdio: "inherit" });
console.log(`Added project ${input.slug} (${input.target}).`);
```

`scripts/cleanup-orphans.ts`:
```ts
// npm run cleanup:orphans -- --env <staging|production>
// Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (R2 read + D1 read + R2 write).
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { findOrphans, type StoredObject } from "./lib/orphans.ts";

const envFlag = process.argv.indexOf("--env");
const target = envFlag >= 0 ? process.argv[envFlag + 1] : undefined;
if (target !== "staging" && target !== "production") {
  console.error("Usage: npm run cleanup:orphans -- --env <staging|production>");
  process.exit(1);
}
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) {
  console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.");
  process.exit(1);
}
const bucket = target === "staging" ? "progress-photos-staging" : "progress-photos";
const database = target === "staging" ? "progress-photos-staging" : "progress-photos";
const envArgs = target === "staging" ? ["--env", "staging"] : [];

// https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/
async function listObjects(): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  let cursor = "";
  do {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${bucket}/objects`);
    url.searchParams.set("per_page", "1000");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as {
      success?: boolean;
      errors?: unknown;
      result?: { key: string; last_modified: string }[];
      result_info?: { cursor?: string; is_truncated?: boolean };
    };
    if (!res.ok || !body.success || !Array.isArray(body.result)) {
      throw new Error(`R2 list failed (${res.status}): ${JSON.stringify(body.errors ?? body)}`);
    }
    for (const o of body.result) out.push({ key: o.key, uploaded: o.last_modified });
    cursor = body.result_info?.is_truncated ? (body.result_info.cursor ?? "") : "";
  } while (cursor);
  return out;
}

function photoIds(): Set<string> {
  const raw = execFileSync("npx", ["wrangler", "d1", "execute", database, "--remote", ...envArgs, "--json", "--command", "SELECT id FROM photos"], {
    encoding: "utf8",
  });
  const [result] = JSON.parse(raw) as [{ results: { id: string }[] }];
  return new Set(result.results.map((r) => r.id));
}

const objects = await listObjects();
const { orphans, unrecognised, recent } = findOrphans(objects, photoIds(), Date.now());
console.log(`${objects.length} objects; ${orphans.length} orphaned; ${recent} too recent to judge; ${unrecognised.length} unrecognised.`);
for (const k of unrecognised) console.log(`  unrecognised (left alone): ${k}`);
if (orphans.length === 0) process.exit(0);
for (const k of orphans) console.log(`  orphan: ${k}`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`Delete ${orphans.length} objects from ${bucket}? Type "delete" to confirm: `);
rl.close();
if (answer.trim() !== "delete") {
  console.log("Nothing deleted.");
  process.exit(0);
}
for (const key of orphans) {
  execFileSync("npx", ["wrangler", "r2", "object", "delete", `${bucket}/${key}`, "--remote", ...envArgs], { stdio: "inherit" });
}
console.log(`Deleted ${orphans.length} objects.`);
```

- [ ] **Step 6: Smoke-test `project:add` locally**

Run:
```bash
npx wrangler d1 migrations apply progress-photos --local
npm run project:add -- --env local demo "O'Hare Demo" https://example.com/progress/ https://example.com
npx wrangler d1 execute progress-photos --local --command "SELECT slug, name, allowed_origins FROM projects"
```
Expected: one row `demo | O'Hare Demo | ["https://example.com"]`. (`cleanup:orphans` needs a real account; it is exercised in Task 13.)

- [ ] **Step 7: Commit**

```bash
git add scripts test/unit
git commit -m "feat: project:add and cleanup:orphans scripts"
```

---

### Task 8: The `<progress-feed>` embed

**Files:**
- Create: `src/embed/days.ts`, `src/embed/styles.ts`, `src/embed/viewer.ts`, `src/embed/progress-feed.ts`
- Create: `vite.embed.config.ts`, `vite.config.ts` (minimal for now; Task 11 fills in the app), `src/app/index.html` (placeholder), `src/app/public/_headers`
- Create: `scripts/check-embed-size.ts`, `scripts/embed-release.ts`
- Test: `test/unit/days.test.ts` (browser behavior is covered in Task 9)

**Interfaces:**
- Consumes: `FeedPage`, `FeedPhoto` (Task 2); `srcsetAttr`, `smallestSrc`, `largestSrc` (Task 2); feed API (Task 4).
- Produces:
  - `dayKey(takenAt): string` (`"YYYY-MM-DD"` in the photo's own offset), `formatDay(key, locale?): string`
  - `<progress-feed project="slug">` custom element, `class ProgressFeed` with public `loadMore(): Promise<void>`
  - Shadow DOM classes Task 9 tests select on: `.day`, `.day-heading`, `.grid`, `.photo`, `.open` (button), `.caption`, `.status`, `.retry`, `.end`, `.overlay`, `.viewer-img`, `.viewer-caption`, `.close`, `.prev`, `.next`
  - `dist/app/embed.js`; `src/app/public/embed/<version>.js` via `npm run embed:release`

- [ ] **Step 1: Write the failing test**

`test/unit/days.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { dayKey, formatDay } from "../../src/embed/days";

describe("days", () => {
  it("groups by the date where the photo was taken, not the viewer's zone", () => {
    expect(dayKey("2026-10-06T23:30:00-05:00")).toBe("2026-10-06");
    expect(dayKey("2026-10-07T00:10:00+09:00")).toBe("2026-10-07");
  });

  it("formats in the requested locale without shifting the day", () => {
    expect(formatDay("2026-10-06", "en-US")).toBe("October 6, 2026");
    expect(formatDay("2026-10-06", "de-DE")).toBe("6. Oktober 2026");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --config vitest.unit.config.ts test/unit/days.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `days.ts` and `styles.ts`**

`src/embed/days.ts`:
```ts
/** Calendar day at the site where the photo was taken (from the offset in takenAt). */
export function dayKey(takenAt: string): string {
  return takenAt.slice(0, 10);
}

export function formatDay(key: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
}
```

`src/embed/styles.ts`:
```ts
export const STYLES = `
:host { display: block; background: var(--pf-bg, transparent); color: var(--pf-text, currentColor); font-family: var(--pf-font, inherit); }
* { box-sizing: border-box; }
.day { margin: 0 0 calc(var(--pf-gap, 8px) * 3); }
.day-heading { font-family: var(--pf-heading-font, inherit); text-transform: var(--pf-heading-transform, none); font-size: 1.125em; margin: 0 0 var(--pf-gap, 8px); }
.grid { display: grid; gap: var(--pf-gap, 8px); grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--pf-columns-min, 280px)), 1fr)); }
.photo { margin: 0; }
.open { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }
.open:focus-visible { outline: 2px solid var(--pf-accent, currentColor); outline-offset: 2px; }
.open img { display: block; width: 100%; height: auto; border-radius: var(--pf-radius, 0); }
.caption { margin-top: 4px; font-size: .9em; color: var(--pf-muted, color-mix(in srgb, currentColor 60%, transparent)); }
.status { padding: 16px 0; text-align: center; color: var(--pf-muted, color-mix(in srgb, currentColor 60%, transparent)); }
.retry { margin-left: 8px; font: inherit; color: var(--pf-accent, currentColor); background: none; border: 1px solid currentColor; border-radius: var(--pf-radius, 0); padding: 4px 12px; cursor: pointer; }
.sentinel { height: 1px; }
.overlay { position: fixed; inset: 0; z-index: 2147483000; background: var(--pf-overlay-bg, rgba(0,0,0,.92)); color: #fff; display: flex; align-items: center; justify-content: center; touch-action: pan-y; }
.overlay[hidden] { display: none; }
.overlay figure { margin: 0; max-width: 100vw; max-height: 100vh; display: flex; flex-direction: column; align-items: center; }
.viewer-img { max-width: 100vw; max-height: calc(100vh - 64px); width: auto; height: auto; object-fit: contain; }
.viewer-caption { padding: 8px 16px; text-align: center; }
.overlay button { position: absolute; font: inherit; font-size: 32px; line-height: 1; color: #fff; background: rgba(0,0,0,.4); border: 0; width: 48px; height: 48px; cursor: pointer; }
.overlay button:disabled { opacity: .3; cursor: default; }
.overlay button:focus-visible { outline: 2px solid #fff; }
.close { top: 8px; right: 8px; }
.prev { left: 8px; top: 50%; transform: translateY(-50%); }
.next { right: 8px; top: 50%; transform: translateY(-50%); }
`;
```

- [ ] **Step 4: Implement the viewer and element**

`src/embed/viewer.ts`:
```ts
import { largestSrc, srcsetAttr } from "../shared/srcset";
import type { FeedPhoto } from "../shared/types";

export interface ViewerSource {
  count(): number;
  photo(i: number): FeedPhoto | undefined;
  hasMore(): boolean;
  loadMore(): Promise<void>;
  opener(i: number): HTMLElement | undefined;
}

const SWIPE_PX = 50;

function button(cls: string, label: string, text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.setAttribute("aria-label", label);
  b.textContent = text;
  return b;
}

export class Viewer {
  readonly element = document.createElement("div");
  #img = document.createElement("img");
  #caption = document.createElement("figcaption");
  #close = button("close", "Close", "✕");
  #prev = button("prev", "Previous photo", "‹");
  #next = button("next", "Next photo", "›");
  #index = -1;
  #startX: number | null = null;
  #savedOverflow = "";
  readonly root: ShadowRoot;
  readonly src: ViewerSource;

  constructor(root: ShadowRoot, src: ViewerSource) {
    this.root = root;
    this.src = src;
    const el = this.element;
    el.className = "overlay";
    el.hidden = true;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Photo viewer");
    this.#img.className = "viewer-img";
    this.#caption.className = "viewer-caption";
    const figure = document.createElement("figure");
    figure.append(this.#img, this.#caption);
    el.append(figure, this.#prev, this.#next, this.#close);

    this.#close.addEventListener("click", () => this.close());
    this.#prev.addEventListener("click", () => void this.step(-1));
    this.#next.addEventListener("click", () => void this.step(1));
    el.addEventListener("click", (e) => {
      if (e.target === el) this.close();
    });
    el.addEventListener("keydown", (e) => this.#onKey(e));
    el.addEventListener("pointerdown", (e) => (this.#startX = e.clientX));
    el.addEventListener("pointerup", (e) => {
      if (this.#startX === null) return;
      const dx = e.clientX - this.#startX;
      this.#startX = null;
      if (Math.abs(dx) > SWIPE_PX) void this.step(dx < 0 ? 1 : -1);
    });
  }

  get isOpen(): boolean {
    return this.#index >= 0;
  }

  open(i: number): void {
    this.#index = i;
    this.element.hidden = false;
    this.#savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    this.#render();
    this.#close.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    const i = this.#index;
    this.#index = -1;
    this.element.hidden = true;
    document.documentElement.style.overflow = this.#savedOverflow;
    this.src.opener(i)?.focus();
  }

  async step(delta: 1 | -1): Promise<void> {
    const n = this.#index + delta;
    if (!this.isOpen || n < 0) return;
    if (n >= this.src.count()) {
      if (!this.src.hasMore()) return;
      await this.src.loadMore();
      if (!this.isOpen || n >= this.src.count()) return;
    }
    this.#index = n;
    this.#render();
  }

  #render(): void {
    const p = this.src.photo(this.#index);
    if (!p) return;
    const img = this.#img;
    img.removeAttribute("srcset");
    img.width = p.width;
    img.height = p.height;
    img.alt = p.caption ?? "Construction progress photo";
    img.sizes = "100vw";
    img.srcset = srcsetAttr(p.srcset);
    img.src = largestSrc(p.srcset);
    this.#caption.textContent = p.caption ?? "";
    this.#prev.disabled = this.#index === 0;
    this.#next.disabled = this.#index >= this.src.count() - 1 && !this.src.hasMore();
  }

  #onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      void this.step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      void this.step(-1);
    } else if (e.key === "Tab") {
      const focusable = [this.#prev, this.#next, this.#close].filter((b) => !b.disabled);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = this.root.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first?.focus();
      } else if (!focusable.includes(active as HTMLButtonElement)) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
}
```
(Fields are assigned explicitly rather than via constructor parameter properties because `tsconfig.app.json` sets `erasableSyntaxOnly`.)

`src/embed/progress-feed.ts`:
```ts
import { smallestSrc, srcsetAttr } from "../shared/srcset";
import type { FeedPage, FeedPhoto } from "../shared/types";
import { dayKey, formatDay } from "./days";
import { STYLES } from "./styles";
import { Viewer } from "./viewer";

const API_BASE = new URL(import.meta.url).origin;
const SIZES = "(min-width: 1200px) 400px, (min-width: 640px) 50vw, 100vw";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export class ProgressFeed extends HTMLElement {
  #shadow = this.attachShadow({ mode: "open" });
  #days = el("div", "days");
  #status = el("div", "status");
  #sentinel = el("div", "sentinel");
  #photos: FeedPhoto[] = [];
  #buttons: HTMLButtonElement[] = [];
  #lastDay: { key: string; grid: HTMLElement } | null = null;
  #cursor: string | null = null;
  #started = false;
  #loading = false;
  #done = false;
  #failed = false;
  #sentinelVisible = false;
  #observer = new IntersectionObserver(
    (entries) => {
      this.#sentinelVisible = entries.some((e) => e.isIntersecting);
      if (this.#sentinelVisible && !this.#failed) void this.loadMore();
    },
    { rootMargin: "800px 0px" },
  );
  #viewer = new Viewer(this.#shadow, {
    count: () => this.#photos.length,
    photo: (i) => this.#photos[i],
    hasMore: () => !this.#done,
    loadMore: () => this.loadMore(),
    opener: (i) => this.#buttons[i],
  });

  connectedCallback(): void {
    if (!this.#started) {
      this.#started = true;
      this.#status.setAttribute("role", "status");
      const style = document.createElement("style");
      style.textContent = STYLES;
      this.#shadow.append(style, this.#days, this.#status, this.#sentinel, this.#viewer.element);
      void this.loadMore();
    }
    this.#observer.observe(this.#sentinel);
  }

  disconnectedCallback(): void {
    this.#observer.disconnect();
  }

  async loadMore(): Promise<void> {
    if (this.#loading || this.#done) return;
    const project = this.getAttribute("project");
    if (!project) {
      this.#showError();
      return;
    }
    this.#loading = true;
    this.#failed = false;
    this.#setStatus("Loading photos…");
    try {
      const url = new URL(`/api/feed/${encodeURIComponent(project)}`, API_BASE);
      if (this.#cursor) url.searchParams.set("cursor", this.#cursor);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as FeedPage;
      for (const p of page.photos) this.#append(p);
      this.#cursor = page.nextCursor;
      this.#done = page.nextCursor === null;
      this.#loading = false;
      if (this.#done) this.#setStatus(this.#photos.length === 0 ? "No photos yet." : "That's the beginning", this.#photos.length > 0);
      else this.#setStatus("");
    } catch {
      this.#loading = false;
      this.#failed = true;
      this.#showError();
      return;
    }
    if (!this.#done && this.#sentinelVisible) void this.loadMore();
  }

  #setStatus(text: string, isEnd = false): void {
    this.#status.className = isEnd ? "status end" : "status";
    this.#status.textContent = text;
  }

  #showError(): void {
    const retry = el("button", "retry");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => void this.loadMore());
    this.#status.className = "status error";
    this.#status.replaceChildren("Couldn't load photos", retry);
  }

  #append(p: FeedPhoto): void {
    const key = dayKey(p.takenAt);
    if (this.#lastDay?.key !== key) {
      const section = el("section", "day");
      const heading = el("h2", "day-heading");
      heading.textContent = formatDay(key);
      const grid = el("div", "grid");
      section.append(heading, grid);
      this.#days.append(section);
      this.#lastDay = { key, grid };
    }
    const index = this.#photos.length;
    this.#photos.push(p);

    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.width = p.width;
    img.height = p.height;
    img.alt = p.caption ?? "Construction progress photo";
    img.sizes = SIZES;
    img.srcset = srcsetAttr(p.srcset);
    img.src = smallestSrc(p.srcset);

    const open = el("button", "open");
    open.type = "button";
    open.append(img);
    open.addEventListener("click", () => this.#viewer.open(index));
    this.#buttons.push(open);

    const figure = el("figure", "photo");
    figure.append(open);
    if (p.caption) {
      const cap = el("figcaption", "caption");
      cap.textContent = p.caption;
      figure.append(cap);
    }
    this.#lastDay.grid.append(figure);
  }
}

if (!customElements.get("progress-feed")) customElements.define("progress-feed", ProgressFeed);
```

- [ ] **Step 5: Build configuration and headers**

`vite.config.ts` (Task 11 adds to this):
```ts
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/app",
  publicDir: "public",
  build: { outDir: "../../dist/app", emptyOutDir: true, target: "es2022" },
});
```

`src/app/index.html` (placeholder replaced in Task 11):
```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Progress Photos</title></head><body></body></html>
```

`vite.embed.config.ts`:
```ts
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist/app",
    emptyOutDir: false,
    target: "es2022",
    lib: { entry: "src/embed/progress-feed.ts", formats: ["es"], fileName: () => "embed.js" },
  },
});
```

`src/app/public/_headers`:
```
/embed.js
  Cache-Control: public, max-age=300
  Access-Control-Allow-Origin: *
/embed/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *
```

`scripts/check-embed-size.ts`:
```ts
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const LIMIT = 15 * 1024;
const size = gzipSync(readFileSync("dist/app/embed.js")).length;
console.log(`embed.js: ${size} bytes gzipped (limit ${LIMIT})`);
if (size >= LIMIT) process.exit(1);
```

`scripts/embed-release.ts`:
```ts
// After `npm run build`: publish dist/app/embed.js as an immutable /embed/<version>.js and print the pinned tag.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
const built = readFileSync("dist/app/embed.js");
const dest = `src/app/public/embed/${version}.js`;

if (existsSync(dest)) {
  if (!readFileSync(dest).equals(built)) {
    console.error(`${dest} already exists with different content. Bump "version" in package.json, rebuild, and run again.`);
    process.exit(1);
  }
} else {
  mkdirSync("src/app/public/embed", { recursive: true });
  writeFileSync(dest, built);
}
mkdirSync("dist/app/embed", { recursive: true });
copyFileSync(dest, `dist/app/embed/${version}.js`);

const integrity = `sha384-${createHash("sha384").update(built).digest("base64")}`;
console.log(`Commit ${dest}, then embed with:\n`);
console.log(`<script type="module" src="https://progress.monroeresidential.com/embed/${version}.js" integrity="${integrity}" crossorigin="anonymous"></script>`);
```

- [ ] **Step 6: Build, check size, run unit tests**

Run: `npm run test:unit && npm run build && node scripts/check-embed-size.ts && npm run typecheck`
Expected: tests PASS; `dist/app/embed.js` and `dist/app/_headers` exist; size line well under 15360; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/embed src/app vite.config.ts vite.embed.config.ts scripts test/unit
git commit -m "feat: <progress-feed> embed with infinite scroll, day groups and viewer"
```

---

### Task 9: Browser tests for the embed (Playwright against `wrangler dev`)

**Files:**
- Create: `scripts/lib/png.ts`, `scripts/seed-e2e.ts`, `playwright.config.ts`, `test/e2e/host.ts`, `test/e2e/embed.spec.ts`

**Interfaces:**
- Consumes: `sqlString`, `projectInsertSql` (Task 7); the built `dist/app` (Task 8); the `.day`, `.open`, `.status`, `.overlay`… classes (Task 8).
- Produces:
  - `solidPng(width, height, rgb): Buffer` (Task 11's icons reuse it)
  - Seeded local projects: `e2e-feed` (60 photos over 5 days, one markup caption), `e2e-empty`, `e2e-upload` — all allowing origin `http://host.test`
  - `openHost(page, { project, style?, fallback?, delayImages? })`

- [ ] **Step 1: PNG helper and seed script**

`scripts/lib/png.ts`:
```ts
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

export function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
```

`scripts/seed-e2e.ts`:
```ts
// Fresh local D1 for Playwright: schema + fixed projects/photos. Run by `npm run e2e:server`.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { projectInsertSql, sqlString } from "./lib/project-args.ts";

const PERSIST = ".wrangler/e2e";
rmSync(PERSIST, { recursive: true, force: true });
mkdirSync(PERSIST, { recursive: true });

const ORIGINS = ["http://host.test"];
const now = new Date().toISOString();
const lines = [
  projectInsertSql({ slug: "e2e-feed", name: "E2E Feed", siteUrl: "http://host.test/progress/", origins: ORIGINS }, now),
  projectInsertSql({ slug: "e2e-empty", name: "E2E Empty", siteUrl: "http://host.test/progress/", origins: ORIGINS }, now),
  projectInsertSql({ slug: "e2e-upload", name: "E2E Upload", siteUrl: "http://host.test/progress/", origins: ORIGINS }, now),
];

// 60 photos: 12 per day on Sep 26–30, 2026, newest first gives pages of 24/24/12.
const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
for (let n = 0; n < 60; n++) {
  const day = 30 - Math.floor(n / 12);
  const hour = 8 + (n % 12);
  const takenAt = `2026-09-${day}T${String(hour).padStart(2, "0")}:00:00-05:00`;
  const id = `01J9E2E00000000000000000${ULID_CHARS[Math.floor(n / 32)]}${ULID_CHARS[n % 32]}`;
  // n = 11 is the newest photo, so its caption is the first one rendered.
  const caption = n === 11 ? `<img src=x onerror="window.__xss=1">` : n % 5 === 0 ? `Caption ${n}` : null;
  lines.push(
    `INSERT INTO photos (id, project_slug, taken_at, taken_utc, uploaded_at, uploaded_by, caption, width, height, widths, fingerprint, hidden) VALUES (` +
      [id, "e2e-feed", takenAt, new Date(takenAt).toISOString(), now, "seed@example.com"].map(sqlString).join(", ") +
      `, ${caption === null ? "NULL" : sqlString(caption)}, 1920, 1440, '[480,960,1920]', ${sqlString(n.toString(16).padStart(64, "0"))}, 0);`,
  );
}

writeFileSync(`${PERSIST}/seed.sql`, lines.join("\n"));
const d1 = ["wrangler", "d1", "execute", "progress-photos", "--local", "--persist-to", PERSIST, "--file"];
execFileSync("npx", [...d1, "migrations/0001_init.sql"], { stdio: "inherit" });
execFileSync("npx", [...d1, `${PERSIST}/seed.sql`], { stdio: "inherit" });
```

- [ ] **Step 2: Playwright config and host-page helper**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:8787", trace: "retain-on-failure" },
  webServer: {
    command: "npm run e2e:server",
    url: "http://localhost:8787/embed.js",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "iphone", use: { ...devices["iPhone 15"] } },
  ],
});
```

`test/e2e/host.ts`:
```ts
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
```

- [ ] **Step 3: Write the browser tests**

`test/e2e/embed.spec.ts`:
```ts
import { expect, test } from "@playwright/test";
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
    await page.mouse.wheel(0, 4000);
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

test("viewer: open, arrow keys, Escape, focus returns", async ({ page }) => {
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
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(overlay.locator("button:focus")).toHaveCount(1); // focus stays inside the viewer
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await expect(second).toBeFocused();
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
```

- [ ] **Step 4: Run the browser tests**

Run: `npx playwright install chromium webkit && npm run test:e2e`
Expected: all tests PASS in both `chromium` and `iphone` (WebKit) projects. If `embed.js is cacheable…` fails on headers, confirm `dist/app/_headers` exists after `npm run build` (Vite copies `src/app/public/`).

- [ ] **Step 5: Commit**

```bash
git add scripts playwright.config.ts test/e2e
git commit -m "test: Playwright coverage for the embed against wrangler dev"
```

---

### Task 10: Upload-app core — JPEG metadata, image pipeline, API client

**Files:**
- Create: `src/app/lib/jpeg-meta.ts`, `src/app/lib/process.ts`, `src/app/api.ts`
- Modify: `vite.config.ts` (exclude `@jsquash/webp` from dep optimization)
- Test: `test/unit/jpeg-fixture.ts`, `test/unit/jpeg-meta.test.ts`, `test/unit/api.test.ts`

**Interfaces:**
- Consumes: `selectWidths`, `scaledHeight`, `maxBytesFor` (Task 2); `exifToIso`, `toOffsetIso` (Task 2); `ProjectSummary`, `FeedPage`, `AdminPhoto`, `ApiErrorBody` (Task 2).
- Produces:
  - `readJpegMeta(buf: ArrayBuffer): JpegMeta | null` (`{ width, height, orientation, dateTimeOriginal, offsetTimeOriginal }`), `orientedSize(w, h, orientation)`
  - `processPhoto(file: File): Promise<Processed>` (`{ fingerprint, takenAt, width, height, variants: { width, blob }[] }`), `makeThumb(file): Promise<string | null>`, `class UnreadablePhotoError`
  - `class ApiError extends Error { status; code }` (code `"signin_required"` when the Access session has expired), `interpretProbe(res): "signin" | "ok"`, `probeSession()`, `api.projects()`, `api.photos(project, cursor?)`, `api.patch(id, body)`, `api.remove(id)`, `uploadPhoto(project, processed, caption, onProgress)`, `errorMessage(err): string`

- [ ] **Step 1: Write the JPEG fixture builder**

`test/unit/jpeg-fixture.ts`:
```ts
/** Builds a minimal JPEG: SOI, optional APP1/Exif (IFD0 orientation + Exif IFD dates), SOF0, SOS. */
export function fakeJpeg(o: {
  width: number;
  height: number;
  orientation?: number;
  dateTimeOriginal?: string;
  offsetTimeOriginal?: string;
  bigEndian?: boolean;
}): ArrayBuffer {
  const le = !o.bigEndian;
  const t: number[] = [];
  const u16 = (v: number) => (le ? t.push(v & 0xff, v >> 8) : t.push(v >> 8, v & 0xff));
  const u32 = (v: number) =>
    le ? t.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff) : t.push((v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);

  const hasExifIfd = o.dateTimeOriginal !== undefined || o.offsetTimeOriginal !== undefined;
  const n0 = (o.orientation !== undefined ? 1 : 0) + (hasExifIfd ? 1 : 0);
  const n1 = (o.dateTimeOriginal !== undefined ? 1 : 0) + (o.offsetTimeOriginal !== undefined ? 1 : 0);
  const exifIfdAt = 8 + 2 + 12 * n0 + 4;
  const dataAt = exifIfdAt + 2 + 12 * n1 + 4;
  const dto = o.dateTimeOriginal !== undefined ? `${o.dateTimeOriginal}\0` : "";
  const ofs = o.offsetTimeOriginal !== undefined ? `${o.offsetTimeOriginal}\0` : "";

  t.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]));
  u16(42);
  u32(8);
  u16(n0);
  if (o.orientation !== undefined) {
    u16(0x0112); u16(3); u32(1); u16(o.orientation); u16(0);
  }
  if (hasExifIfd) {
    u16(0x8769); u16(4); u32(1); u32(exifIfdAt);
  }
  u32(0);
  if (hasExifIfd) {
    u16(n1);
    if (dto) { u16(0x9003); u16(2); u32(dto.length); u32(dataAt); }
    if (ofs) { u16(0x9011); u16(2); u32(ofs.length); u32(dataAt + dto.length); }
    u32(0);
    for (const ch of dto + ofs) t.push(ch.charCodeAt(0));
  }

  const bytes: number[] = [0xff, 0xd8];
  if (n0 > 0) {
    const len = 2 + 6 + t.length;
    bytes.push(0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...t);
  }
  bytes.push(0xff, 0xc0, 0x00, 0x11, 8, o.height >> 8, o.height & 0xff, o.width >> 8, o.width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  bytes.push(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9);
  return new Uint8Array(bytes).buffer;
}
```

- [ ] **Step 2: Write the failing tests**

`test/unit/jpeg-meta.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { orientedSize, readJpegMeta } from "../../src/app/lib/jpeg-meta";
import { fakeJpeg } from "./jpeg-fixture";

describe("readJpegMeta", () => {
  it("reads size, orientation and dates (little-endian EXIF)", () => {
    const meta = readJpegMeta(
      fakeJpeg({ width: 4032, height: 3024, orientation: 6, dateTimeOriginal: "2026:10:06 14:12:00", offsetTimeOriginal: "-05:00" }),
    );
    expect(meta).toEqual({ width: 4032, height: 3024, orientation: 6, dateTimeOriginal: "2026:10:06 14:12:00", offsetTimeOriginal: "-05:00" });
  });

  it("reads big-endian EXIF", () => {
    const meta = readJpegMeta(fakeJpeg({ width: 100, height: 50, orientation: 3, dateTimeOriginal: "2026:01:02 03:04:05", bigEndian: true }));
    expect(meta).toMatchObject({ orientation: 3, dateTimeOriginal: "2026:01:02 03:04:05", offsetTimeOriginal: null });
  });

  it("defaults when there is no EXIF", () => {
    expect(readJpegMeta(fakeJpeg({ width: 640, height: 480 }))).toEqual({
      width: 640, height: 480, orientation: 1, dateTimeOriginal: null, offsetTimeOriginal: null,
    });
  });

  it("returns null for non-JPEG bytes and truncated files", () => {
    expect(readJpegMeta(new TextEncoder().encode("\x89PNG....").buffer)).toBeNull();
    expect(readJpegMeta(fakeJpeg({ width: 640, height: 480 }).slice(0, 6))).toBeNull();
  });
});

describe("orientedSize", () => {
  it("swaps width and height for rotated orientations", () => {
    expect(orientedSize(4032, 3024, 1)).toEqual({ width: 4032, height: 3024 });
    expect(orientedSize(4032, 3024, 6)).toEqual({ width: 3024, height: 4032 });
    expect(orientedSize(4032, 3024, 8)).toEqual({ width: 3024, height: 4032 });
  });
});
```

`test/unit/api.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ApiError, errorMessage, interpretProbe } from "../../src/app/api";

describe("interpretProbe", () => {
  it("treats a redirect to the Access login or a 401 as an expired session", () => {
    expect(interpretProbe({ type: "opaqueredirect", status: 0 })).toBe("signin");
    expect(interpretProbe({ type: "basic", status: 401 })).toBe("signin");
    expect(interpretProbe({ type: "basic", status: 200 })).toBe("ok");
  });
});

describe("errorMessage", () => {
  it("tells the uploader to sign in again when the session expired", () => {
    expect(errorMessage(new ApiError(401, "signin_required", "x"))).toBe("Your sign-in expired. Reload the page to sign in again.");
    expect(errorMessage(new ApiError(400, "bad_request", "Caption too long"))).toBe("Caption too long");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:unit`
Expected: FAIL — `src/app/lib/jpeg-meta` and `src/app/api` not found.

- [ ] **Step 4: Implement**

`src/app/lib/jpeg-meta.ts`:
```ts
export interface JpegMeta {
  width: number;
  height: number;
  orientation: number;
  dateTimeOriginal: string | null;
  offsetTimeOriginal: string | null;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const ascii = (v: DataView, at: number, n: number) => {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(at + i));
  return s;
};

/** Size, EXIF orientation and capture time from a JPEG's headers. Null if it isn't a readable JPEG. */
export function readJpegMeta(buf: ArrayBuffer): JpegMeta | null {
  const v = new DataView(buf);
  try {
    if (v.getUint16(0) !== 0xffd8) return null;
    const meta: JpegMeta = { width: 0, height: 0, orientation: 1, dateTimeOriginal: null, offsetTimeOriginal: null };
    let o = 2;
    while (o + 4 <= v.byteLength) {
      if (v.getUint8(o) !== 0xff) return null;
      const marker = v.getUint8(o + 1);
      if (marker === 0xff) {
        o++;
        continue;
      }
      const len = v.getUint16(o + 2);
      if (marker === 0xe1 && len >= 8 && ascii(v, o + 4, 6) === "Exif\0\0") readExif(v, o + 10, meta);
      if (SOF.has(marker)) {
        meta.height = v.getUint16(o + 5);
        meta.width = v.getUint16(o + 7);
        return meta.width > 0 && meta.height > 0 ? meta : null;
      }
      if (marker === 0xda) return null;
      o += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

function readExif(v: DataView, t: number, meta: JpegMeta): void {
  try {
    const le = ascii(v, t, 2) === "II";
    const u16 = (p: number) => v.getUint16(t + p, le);
    const u32 = (p: number) => v.getUint32(t + p, le);
    const entries = (ifd: number) => {
      const map = new Map<number, number>();
      const n = u16(ifd);
      for (let i = 0; i < n; i++) map.set(u16(ifd + 2 + i * 12), ifd + 2 + i * 12);
      return map;
    };
    const str = (entry: number) => {
      const count = u32(entry + 4);
      const at = count > 4 ? u32(entry + 8) : entry + 8;
      return ascii(v, t + at, count).replace(/\0+$/, "");
    };

    const ifd0 = entries(u32(4));
    const ori = ifd0.get(0x0112);
    if (ori !== undefined) meta.orientation = u16(ori + 8);
    const exifPtr = ifd0.get(0x8769);
    if (exifPtr !== undefined) {
      const exif = entries(u32(exifPtr + 8));
      const dto = exif.get(0x9003);
      if (dto !== undefined) meta.dateTimeOriginal = str(dto);
      const ofs = exif.get(0x9011);
      if (ofs !== undefined) meta.offsetTimeOriginal = str(ofs);
    }
  } catch {
    // Corrupt EXIF: keep whatever was read; size still comes from SOF.
  }
}

/** EXIF orientations 5–8 rotate by 90°, so the upright image has width and height swapped. */
export function orientedSize(width: number, height: number, orientation: number) {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}
```

`src/app/lib/process.ts`:
```ts
import encodeWebp from "@jsquash/webp/encode";
import { exifToIso, toOffsetIso } from "../../shared/time";
import { maxBytesFor, scaledHeight, selectWidths } from "../../shared/widths";
import { orientedSize, readJpegMeta } from "./jpeg-meta";

export interface Processed {
  fingerprint: string;
  takenAt: string;
  width: number;
  height: number;
  variants: { width: number; blob: Blob }[];
}

export class UnreadablePhotoError extends Error {}

const QUALITIES = [80, 70, 60, 50];

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function decodeUpright(file: File, width: number, height: number): Promise<ImageBitmap> {
  const opts = { resizeQuality: "high", imageOrientation: "from-image" } as const;
  try {
    const bmp = await createImageBitmap(file, { ...opts, resizeWidth: width, resizeHeight: height });
    if (bmp.width === width && bmp.height === height) return bmp;
    bmp.close();
    // Browsers that resize before applying orientation need the raw (unrotated) target.
    const retry = await createImageBitmap(file, { ...opts, resizeWidth: height, resizeHeight: width });
    if (retry.width === width && retry.height === height) return retry;
    retry.close();
  } catch {
    // fall through
  }
  throw new UnreadablePhotoError("Can't read this photo");
}

async function encodeVariant(source: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new UnreadablePhotoError("Canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  let last: ArrayBuffer | null = null;
  for (const quality of QUALITIES) {
    last = await encodeWebp(pixels, { quality });
    if (last.byteLength <= maxBytesFor(width)) break;
  }
  return new Blob([last!], { type: "image/webp" });
}

/** Fingerprint, capture time and WebP variants for one photo. Call for one photo at a time. */
export async function processPhoto(file: File): Promise<Processed> {
  const buf = await file.arrayBuffer();
  const fingerprint = hex(await crypto.subtle.digest("SHA-256", buf));
  const meta = readJpegMeta(buf);
  const takenAt = (meta?.dateTimeOriginal && exifToIso(meta.dateTimeOriginal, meta.offsetTimeOriginal)) || toOffsetIso(new Date(file.lastModified));

  let upright: { width: number; height: number };
  if (meta) {
    upright = orientedSize(meta.width, meta.height, meta.orientation);
  } else {
    const probe = await createImageBitmap(file).catch(() => null);
    if (!probe) throw new UnreadablePhotoError("Can't read this photo");
    upright = { width: probe.width, height: probe.height };
    probe.close();
  }

  const widths = selectWidths(upright.width);
  const width = widths[widths.length - 1]!;
  const height = scaledHeight(width, upright.width, upright.height);
  const largest = await decodeUpright(file, width, height);
  try {
    const variants: Processed["variants"] = [];
    for (const w of widths) variants.push({ width: w, blob: await encodeVariant(largest, w, scaledHeight(w, width, height)) });
    return { fingerprint, takenAt, width, height, variants };
  } finally {
    largest.close();
  }
}

/** Small JPEG object URL for the review grid, decoded at thumbnail size to spare iOS memory. */
export async function makeThumb(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file, { resizeWidth: 240, resizeQuality: "medium", imageOrientation: "from-image" });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    return URL.createObjectURL(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 }));
  } catch {
    return null;
  }
}
```

`src/app/api.ts`:
```ts
import type { AdminPhoto, ApiErrorBody, FeedPage, ProjectSummary } from "../shared/types";
import type { Processed } from "./lib/process";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const signinRequired = () => new ApiError(401, "signin_required", "Sign-in expired");

/** Access answers an expired session with a redirect to its login page (or a 401). */
export function interpretProbe(res: { type: string; status: number }): "signin" | "ok" {
  return res.type === "opaqueredirect" || res.status === 401 ? "signin" : "ok";
}

export async function probeSession(): Promise<"signin" | "ok" | "unreachable"> {
  try {
    return interpretProbe(await fetch("/api/admin/projects", { redirect: "manual", cache: "no-store" }));
  } catch {
    return "unreachable";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, redirect: "manual" });
  } catch {
    throw new ApiError(0, "network", "Network error — check your connection and retry");
  }
  if (interpretProbe(res) === "signin") throw signinRequired();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error ?? "http_error", body?.message ?? `HTTP ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  projects: () => request<ProjectSummary[]>("/api/admin/projects"),
  photos: (project: string, cursor?: string) =>
    request<FeedPage<AdminPhoto>>(`/api/admin/photos?project=${encodeURIComponent(project)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  patch: (id: string, body: { caption?: string | null; hidden?: boolean }) =>
    request<AdminPhoto>(`/api/admin/photos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  remove: (id: string) => request<{ purged: false } | undefined>(`/api/admin/photos/${id}`, { method: "DELETE" }),
};

/** XHR rather than fetch so the UI gets upload progress. */
export function uploadPhoto(
  project: string,
  p: Processed,
  caption: string,
  onProgress: (fraction: number) => void,
): Promise<{ id: string; duplicate?: boolean }> {
  const form = new FormData();
  form.set("project", project);
  form.set("fingerprint", p.fingerprint);
  form.set("takenAt", p.takenAt);
  if (caption) form.set("caption", caption);
  form.set("width", String(p.width));
  form.set("height", String(p.height));
  for (const v of p.variants) form.set(`w${v.width}`, v.blob, `${v.width}.webp`);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/photos");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON (e.g. an Access login page)
      }
      if (xhr.status === 200 || xhr.status === 201) {
        if (body && typeof body === "object" && "id" in body) resolve(body as { id: string; duplicate?: boolean });
        else reject(signinRequired());
      } else if (xhr.status === 401) {
        reject(signinRequired());
      } else {
        const e = body as ApiErrorBody | null;
        reject(new ApiError(xhr.status, e?.error ?? "http_error", e?.message ?? `HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      void probeSession().then((s) =>
        reject(s === "signin" ? signinRequired() : new ApiError(0, "network", "Network error — check your connection and retry")),
      );
    };
    xhr.send(form);
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "signin_required") return "Your sign-in expired. Reload the page to sign in again.";
  return err instanceof Error ? err.message : String(err);
}
```

In `vite.config.ts`, add inside `defineConfig({...})`:
```ts
  optimizeDeps: { exclude: ["@jsquash/webp"] },
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm run test:unit && npm run typecheck`
Expected: all PASS; no type errors. (`processPhoto` and `uploadPhoto` run in a browser; Task 11's Playwright test exercises them end to end.)

- [ ] **Step 6: Commit**

```bash
git add src/app vite.config.ts test/unit
git commit -m "feat: upload-app image pipeline (EXIF, WASM WebP) and API client"
```

---

### Task 11: Upload-app UI (PWA) with an end-to-end upload test

**Files:**
- Create: `src/app/index.html` (replace placeholder), `src/app/style.css`, `src/app/main.ts`, `src/app/dom.ts`, `src/app/upload.ts`, `src/app/manage.ts`, `src/app/public/manifest.webmanifest`, `scripts/make-icons.ts`, `src/app/public/icons/{icon-192.png,icon-512.png,apple-touch-icon.png}` (generated)
- Modify: `vite.config.ts` (dev proxy)
- Test: `test/e2e/upload.spec.ts`

**Interfaces:**
- Consumes: `api`, `uploadPhoto`, `ApiError`, `errorMessage` (Task 10); `processPhoto`, `makeThumb`, `UnreadablePhotoError` (Task 10); `smallestSrc` (Task 2); `solidPng` (Task 9).
- Produces: the PWA at `/`. Accessible names the e2e test relies on: select labelled "Project"; tabs "Upload" / "Manage" (`role="tab"`); button "Add photos"; text field "Caption for this batch"; button "Upload"; per-photo status text; link "View on site"; in Manage, text fields labelled "Caption" and buttons "Save", "Hide"/"Unhide", "Delete".

- [ ] **Step 1: Write the failing e2e test**

`test/e2e/upload.spec.ts`:
```ts
import { expect, test, type Page } from "@playwright/test";

test.skip(({ browserName }) => browserName !== "chromium", "upload flow runs once, in Chromium");

async function makeJpeg(page: Page, seed: string): Promise<Buffer> {
  const b64 = await page.evaluate(async (text) => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 900;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#a33";
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = "#fff";
    ctx.font = "48px sans-serif";
    ctx.fillText(text, 40, 100);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.9));
    let s = "";
    for (const x of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(x);
    return btoa(s);
  }, seed);
  return Buffer.from(b64, "base64");
}

test("uploads a photo, flags a re-upload as duplicate, and manages it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Project").selectOption("e2e-upload");
  const jpeg = await makeJpeg(page, `photo ${Date.now()}`);
  const pick = page.locator('input[type="file"]');

  await pick.setInputFiles({ name: "site.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await page.getByLabel("Caption for this batch").fill("<b>E2E</b> slab pour");
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.locator(".status-text").first()).toHaveText("Done", { timeout: 60_000 });
  await expect(page.getByRole("link", { name: "View on site" })).toHaveAttribute("href", "http://host.test/progress/");

  await pick.setInputFiles({ name: "site-again.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.locator(".status-text").last()).toHaveText("Duplicate (already uploaded)", { timeout: 60_000 });

  // The stored 960w variant is a real WebP the Worker accepted.
  const feed = await (await page.request.get("/api/feed/e2e-upload")).json();
  expect(feed.photos).toHaveLength(1);
  expect(feed.photos[0]).toMatchObject({ caption: "<b>E2E</b> slab pour", width: 960, height: 720 });
  const img = await page.request.get(feed.photos[0].srcset["960"]);
  expect(img.headers()["content-type"]).toBe("image/webp");
  expect((await img.body()).subarray(8, 12).toString("ascii")).toBe("WEBP");

  await page.getByRole("tab", { name: "Manage" }).click();
  const caption = page.getByRole("textbox", { name: "Caption" }).first();
  await expect(caption).toHaveValue("<b>E2E</b> slab pour");
  await caption.fill("Edited caption");
  await page.getByRole("button", { name: "Save" }).first().click();
  await page.getByRole("button", { name: "Hide" }).first().click();
  await expect(page.getByRole("button", { name: "Unhide" }).first()).toBeVisible();
  // Check via the admin list: the public feed is edge-cached for 60 s, so it may still show the photo.
  const admin = await (await page.request.get("/api/admin/photos?project=e2e-upload")).json();
  expect(admin.photos[0]).toMatchObject({ caption: "Edited caption", hidden: true });

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByText("No photos yet.")).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:e2e -- test/e2e/upload.spec.ts --project chromium`
Expected: FAIL — no element labelled "Project".

- [ ] **Step 3: Icons, manifest and HTML**

`scripts/make-icons.ts`:
```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { solidPng } from "./lib/png.ts";

const BRAND: [number, number, number] = [0x1d, 0x3b, 0x2a];
mkdirSync("src/app/public/icons", { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]] as const) {
  writeFileSync(`src/app/public/icons/${name}`, solidPng(size, size, BRAND));
}
console.log("Wrote src/app/public/icons/*");
```
Run: `npm run icons` and commit the generated PNGs.

`src/app/public/manifest.webmanifest`:
```json
{
  "name": "Progress Photos",
  "short_name": "Progress",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1d3b2a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

`src/app/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#1d3b2a" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Progress" />
    <!-- use-credentials: the manifest sits behind Access, which needs the session cookie -->
    <link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <title>Progress Photos</title>
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="./main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: DOM helper, styles and the two tabs**

`src/app/dom.ts`:
```ts
type Child = Node | string | null | undefined | false;

/** Tiny element builder. Strings become text nodes, so content is never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}
```

`src/app/style.css`:
```css
:root { --brand: #1d3b2a; --muted: #6b7280; --danger: #b42318; color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; }
body { margin: 0; padding: env(safe-area-inset-top) 16px calc(env(safe-area-inset-bottom) + 24px); background: Canvas; color: CanvasText; }
header { display: flex; flex-direction: column; gap: 12px; padding: 16px 0; }
label.field { display: flex; flex-direction: column; gap: 4px; font-size: 14px; color: var(--muted); }
select, input[type="text"] { font: inherit; font-size: 16px; padding: 10px; border: 1px solid #c9ccd1; border-radius: 8px; background: Canvas; color: CanvasText; }
button { font: inherit; font-size: 16px; padding: 10px 14px; border-radius: 8px; border: 1px solid #c9ccd1; background: Canvas; color: CanvasText; }
button.primary { background: var(--brand); color: #fff; border-color: var(--brand); width: 100%; padding: 14px; }
button.add { width: 100%; padding: 14px; border-style: dashed; }
button:disabled { opacity: .5; }
.tabs { display: flex; gap: 8px; }
.tabs [role="tab"] { flex: 1; }
.tabs [aria-selected="true"] { background: var(--brand); color: #fff; border-color: var(--brand); }
section { display: flex; flex-direction: column; gap: 12px; }
ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.item { display: grid; grid-template-columns: 80px 1fr; gap: 10px; align-items: start; }
.item img, .card img { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; background: #e5e7eb; }
.item .meta, .card .meta { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.status-text { font-size: 14px; }
.status-text.error { color: var(--danger); }
progress { width: 100%; height: 6px; }
.card { display: grid; grid-template-columns: 80px 1fr; gap: 10px; }
.card.hidden-photo img { opacity: .4; }
.card .row { display: flex; gap: 6px; flex-wrap: wrap; }
.muted { color: var(--muted); font-size: 14px; }
.summary a { color: var(--brand); font-weight: 600; }
```

`src/app/upload.ts`:
```ts
import type { ProjectSummary } from "../shared/types";
import { ApiError, errorMessage, uploadPhoto } from "./api";
import { h } from "./dom";
import { makeThumb, processPhoto, UnreadablePhotoError, type Processed } from "./lib/process";

type Status = "ready" | "working" | "done" | "duplicate" | "unreadable" | "failed" | "signin";

const LABEL: Record<Status, string> = {
  ready: "Ready",
  working: "Uploading…",
  done: "Done",
  duplicate: "Duplicate (already uploaded)",
  unreadable: "Can't read this photo",
  failed: "Failed",
  signin: "Sign-in expired — reload to sign in",
};

interface Item {
  file: File;
  status: Status;
  processed?: Processed;
  li: HTMLLIElement;
  thumb: HTMLImageElement;
  caption: HTMLInputElement;
  statusText: HTMLSpanElement;
  progress: HTMLProgressElement;
  retry: HTMLButtonElement;
  remove: HTMLButtonElement;
}

export function mountUpload(container: HTMLElement, getProject: () => ProjectSummary): void {
  const items: Item[] = [];
  let running = false;

  const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: () => void addFiles() });
  const batchCaption = h("input", { type: "text", maxLength: 280, placeholder: "Optional" });
  const list = h("ul");
  const uploadBtn = h("button", { class: "primary", disabled: true, onclick: () => void runQueue() }, "Upload");
  const summary = h("p", { class: "summary" });

  container.replaceChildren(
    h("button", { class: "add", onclick: () => fileInput.click() }, "Add photos"),
    fileInput,
    h("label", { class: "field" }, "Caption for this batch", batchCaption),
    list,
    uploadBtn,
    summary,
  );

  window.addEventListener("beforeunload", (e) => {
    if (items.some((i) => i.status === "ready" || i.status === "working")) e.preventDefault();
  });

  function refresh(): void {
    uploadBtn.disabled = running || !items.some((i) => i.status === "ready");
  }

  function setStatus(item: Item, status: Status, detail?: string): void {
    item.status = status;
    item.statusText.textContent = detail ? `${LABEL[status]} — ${detail}` : LABEL[status];
    item.statusText.className = status === "failed" || status === "unreadable" || status === "signin" ? "status-text error" : "status-text";
    item.progress.hidden = status !== "working";
    item.retry.hidden = status !== "failed";
    item.remove.hidden = status !== "ready";
    refresh();
  }

  async function addFiles(): Promise<void> {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    summary.textContent = "";
    const added = files.map((file) => {
      const item = {
        file,
        status: "ready",
        thumb: h("img", { alt: "" }),
        caption: h("input", { type: "text", maxLength: 280, placeholder: "Caption (overrides batch)", "aria-label": "Photo caption" }),
        statusText: h("span", { class: "status-text" }),
        progress: h("progress", { max: 1, value: 0, hidden: true }),
        retry: h("button", { hidden: true }, "Retry"),
        remove: h("button", {}, "Remove"),
      } as Omit<Item, "li"> as Item;
      item.li = h("li", { class: "item" }, item.thumb, h("div", { class: "meta" }, item.caption, item.statusText, item.progress, h("div", {}, item.retry, item.remove)));
      item.retry.addEventListener("click", () => {
        setStatus(item, "ready");
        void runQueue();
      });
      item.remove.addEventListener("click", () => {
        items.splice(items.indexOf(item), 1);
        item.li.remove();
        refresh();
      });
      setStatus(item, "ready");
      list.append(item.li);
      return item;
    });
    items.push(...added);
    refresh();
    for (const item of added) {
      const url = await makeThumb(item.file); // one at a time keeps iOS memory down
      if (url) item.thumb.src = url;
    }
  }

  async function uploadOne(item: Item, project: ProjectSummary): Promise<void> {
    setStatus(item, "working");
    item.progress.value = 0;
    try {
      item.processed ??= await processPhoto(item.file);
      const caption = item.caption.value.trim() || batchCaption.value.trim();
      const res = await uploadPhoto(project.slug, item.processed, caption, (f) => (item.progress.value = f));
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
    refresh();
    const project = getProject();
    let next: Item | undefined;
    while ((next = items.find((i) => i.status === "ready"))) await uploadOne(next, project);
    running = false;
    refresh();
    const published = items.filter((i) => i.status === "done" || i.status === "duplicate").length;
    summary.replaceChildren(`${published} of ${items.length} published. `, h("a", { href: project.siteUrl, target: "_blank", rel: "noopener" }, "View on site"));
  }
}
```

`src/app/manage.ts`:
```ts
import { smallestSrc } from "../shared/srcset";
import type { AdminPhoto, ProjectSummary } from "../shared/types";
import { api, errorMessage } from "./api";
import { h } from "./dom";

export function mountManage(container: HTMLElement, getProject: () => ProjectSummary): { reload(): void } {
  const list = h("ul");
  const status = h("p", { class: "muted", role: "status" });
  const more = h("button", { hidden: true, onclick: () => void load(false) }, "Load more");
  container.replaceChildren(list, status, more);
  let cursor: string | null = null;
  let generation = 0;

  async function load(reset: boolean): Promise<void> {
    const mine = reset ? ++generation : generation;
    if (reset) {
      list.replaceChildren();
      cursor = null;
    }
    more.hidden = true;
    status.textContent = "Loading…";
    try {
      const page = await api.photos(getProject().slug, cursor ?? undefined);
      if (mine !== generation) return;
      for (const p of page.photos) list.append(card(p));
      cursor = page.nextCursor;
      more.hidden = cursor === null;
      status.textContent = list.childElementCount === 0 ? "No photos yet." : "";
    } catch (err) {
      if (mine === generation) status.textContent = errorMessage(err);
    }
  }

  function card(initial: AdminPhoto): HTMLLIElement {
    let photo = initial;
    const caption = h("input", { type: "text", value: photo.caption ?? "", maxLength: 280, "aria-label": "Caption" });
    const note = h("span", { class: "muted" });
    const li = h("li", { class: photo.hidden ? "card hidden-photo" : "card" });
    const hide = h("button", {}, photo.hidden ? "Unhide" : "Hide");

    async function act(fn: () => Promise<void>): Promise<void> {
      note.textContent = "";
      try {
        await fn();
      } catch (err) {
        note.textContent = errorMessage(err);
      }
    }

    const save = h("button", {
      onclick: () =>
        act(async () => {
          photo = await api.patch(photo.id, { caption: caption.value.trim() || null });
          caption.value = photo.caption ?? "";
          note.textContent = "Saved";
        }),
    }, "Save");
    hide.addEventListener("click", () =>
      act(async () => {
        photo = await api.patch(photo.id, { hidden: !photo.hidden });
        li.className = photo.hidden ? "card hidden-photo" : "card";
        hide.textContent = photo.hidden ? "Unhide" : "Hide";
      }),
    );
    const del = h("button", {
      onclick: () =>
        act(async () => {
          if (!confirm("Delete this photo? This can't be undone.")) return;
          const res = await api.remove(photo.id);
          li.remove();
          if (res?.purged === false) status.textContent = "Deleted. Cached copies may take a minute to disappear.";
          if (list.childElementCount === 0 && cursor === null) status.textContent = "No photos yet.";
        }),
    }, "Delete");

    li.append(
      h("img", { src: smallestSrc(photo.srcset), alt: "", loading: "lazy" }),
      h("div", { class: "meta" }, h("span", { class: "muted" }, new Date(photo.takenAt).toLocaleString()), caption, h("div", { class: "row" }, save, hide, del), note),
    );
    return li;
  }

  return { reload: () => void load(true) };
}
```

`src/app/main.ts`:
```ts
import "./style.css";
import type { ProjectSummary } from "../shared/types";
import { api, errorMessage } from "./api";
import { h } from "./dom";
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
  root.replaceChildren(h("p", { class: "muted" }, "Loading projects…"));
  let projects: ProjectSummary[];
  try {
    projects = await api.projects();
  } catch (err) {
    root.replaceChildren(h("p", {}, errorMessage(err)), h("button", { onclick: () => location.reload() }, "Reload"));
    return;
  }
  if (projects.length === 0) {
    root.replaceChildren(h("p", {}, "No projects yet. Add one with npm run project:add."));
    return;
  }

  let current = projects.find((p) => p.slug === remembered()) ?? projects[0]!;
  const picker = h(
    "select",
    {
      id: "project",
      onchange: () => {
        current = projects.find((p) => p.slug === picker.value)!;
        remember(current.slug);
        if (!managePane.hidden) manage.reload();
      },
    },
    ...projects.map((p) => h("option", { value: p.slug, selected: p.slug === current.slug }, p.name)),
  );

  const uploadPane = h("section", { role: "tabpanel" });
  const managePane = h("section", { role: "tabpanel", hidden: true });
  mountUpload(uploadPane, () => current);
  const manage = mountManage(managePane, () => current);

  const uploadTab = h("button", { role: "tab", "aria-selected": "true" }, "Upload");
  const manageTab = h("button", { role: "tab", "aria-selected": "false" }, "Manage");
  const select = (showManage: boolean) => {
    uploadPane.hidden = showManage;
    managePane.hidden = !showManage;
    uploadTab.setAttribute("aria-selected", String(!showManage));
    manageTab.setAttribute("aria-selected", String(showManage));
    if (showManage) manage.reload();
  };
  uploadTab.addEventListener("click", () => select(false));
  manageTab.addEventListener("click", () => select(true));

  root.replaceChildren(
    h("header", {}, h("label", { class: "field", for: "project" }, "Project", picker), h("div", { class: "tabs", role: "tablist" }, uploadTab, manageTab)),
    uploadPane,
    managePane,
  );
}

void start();
```
(`h("label", { for: "project" })` sets the attribute because `for` is not an `HTMLLabelElement` property — `htmlFor` is — so `getByLabel("Project")` resolves via both nesting and `for`.)

In `vite.config.ts`, add a dev proxy so `npm run dev:app` (Vite HMR) talks to a running `wrangler dev`:
```ts
  server: { proxy: { "/api": "http://localhost:8787", "/img": "http://localhost:8787" } },
```

- [ ] **Step 5: Run the e2e suite**

Run: `npm run test:e2e`
Expected: all embed tests and the upload test PASS. If the upload stays at "Uploading…" and the console shows a WASM fetch 404, check that `dist/app/assets/*.wasm` was emitted — `@jsquash/webp` loads it via `new URL(…, import.meta.url)`, which Vite rewrites only when the package is excluded from `optimizeDeps`.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/app scripts/make-icons.ts vite.config.ts test/e2e
git commit -m "feat: upload PWA with upload and manage tabs"
```

---

### Task 12: CI, deploy workflows and operator docs

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy-production.yml`, `README.md`, `docs/iphone-checklist.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: all npm scripts above.
- Produces: GitHub Actions that test every push, deploy staging on `main`, and deploy production on manual dispatch. Required repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

- [ ] **Step 1: CI with staging deploy**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build && node scripts/check-embed-size.ts
      - run: npx playwright install --with-deps chromium webkit
      - run: npm run test:e2e
        env: { CI: "true" }
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: test-results }

  deploy-staging:
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: staging
    concurrency: deploy-staging
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run build
      - run: npx wrangler d1 migrations apply progress-photos-staging --remote --env staging
      - run: npx wrangler deploy --env staging
```

`.github/workflows/deploy-production.yml`:
```yaml
name: Deploy production
on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    concurrency: deploy-production
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run typecheck && npm test
      - run: npm run build && node scripts/check-embed-size.ts
      - run: npx wrangler d1 migrations apply progress-photos --remote
      - run: npx wrangler deploy
```

- [ ] **Step 2: README**

`README.md`:
````markdown
# Progress Photos

One shared service for construction progress photos across Monroe Residential / 3FC developments: an upload web app for the person on site, and a `<progress-feed>` element each project website embeds. Design: `docs/specs/2026-10-06-progress-photos-design.md`.

## Embed on a project site

```html
<script type="module" src="https://progress.monroeresidential.com/embed.js"></script>
<progress-feed project="birken-lofts">
  <p>Construction photos need JavaScript.</p>
</progress-feed>
```

Theme it with the `--pf-*` custom properties on `progress-feed` (see the spec). To pin a version with SRI, run `npm run build && npm run embed:release`, commit the new `src/app/public/embed/<version>.js`, deploy, and use the printed `<script … integrity=…>` tag. Bump `version` in `package.json` before each new release. Keep the feed API backward compatible — pinned embeds keep calling it.

## Add a project

```bash
npm run project:add -- --env production birken-lofts "Birken Lofts" https://birkenlofts.com/progress/ https://birkenlofts.com
npm run project:add -- --env staging    birken-lofts "Birken Lofts" https://birkenlofts.com/progress/ https://birkenlofts.com http://localhost:3000
```

## Add an uploader

Edit the Access policy on the "Progress Photos" Access application (Zero Trust → Access → Applications). No code change.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # set DEV_AUTH_EMAIL; only honored on localhost
npm run db:migrate:local
npm run project:add -- --env local demo "Demo" http://localhost:5173/ http://localhost:5173
npm run dev                      # http://localhost:8787
```

Tests: `npm test` (unit + Worker), `npm run test:e2e` (Playwright; seeds its own local DB).

## One-time Cloudflare setup

1. `npx wrangler login`
2. `npx wrangler d1 create progress-photos` and `npx wrangler d1 create progress-photos-staging`; put the IDs in `wrangler.jsonc`.
3. `npx wrangler r2 bucket create progress-photos` and `npx wrangler r2 bucket create progress-photos-staging`.
4. Zero Trust → Access → Applications → add a self-hosted app for `progress.monroeresidential.com` (and another for `progress-staging.…`) with an Allow policy for the uploaders' emails. Add **Bypass** policies (Everyone) for the paths `/api/feed/*`, `/img/*`, `/embed.js`, `/embed/*` — create these as separate Access applications on those paths so the bypass takes precedence. Copy each app's **AUD tag** and the team domain into `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc`.
5. Put the `monroeresidential.com` zone ID in `CF_ZONE_ID`. Create an API token with **Zone → Cache Purge** on that zone and run `npx wrangler secret put CF_PURGE_TOKEN` (and again with `--env staging`).
6. GitHub repo secrets: `CLOUDFLARE_API_TOKEN` (Workers Scripts edit, D1 edit, R2 edit, Workers Custom Domains edit) and `CLOUDFLARE_ACCOUNT_ID`.
7. Pushing to `main` deploys staging; run the "Deploy production" workflow to deploy production.

## Orphaned images

If a Worker crash leaves R2 objects without a D1 row: `CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run cleanup:orphans -- --env production`. It lists first, skips anything under an hour old, and asks before deleting.
````

- [ ] **Step 3: Manual iPhone checklist**

`docs/iphone-checklist.md`:
```markdown
# Manual iPhone checklist (staging, before each production deploy that touches the upload app or embed)

Run on a real iPhone in Safari against https://progress-staging.monroeresidential.com.

- [ ] Add to Home Screen; the icon opens full-screen with no Safari chrome.
- [ ] Sign in through Access; the project list loads.
- [ ] Camera capture of a new photo uploads; status shows "Done".
- [ ] A HEIC photo from the library uploads (Safari hands the page a JPEG).
- [ ] A 48 MP ProRAW/HEIF photo uploads without the tab reloading.
- [ ] A Live Photo uploads as a still.
- [ ] A **portrait** photo appears upright in the feed and viewer.
- [ ] A 10-photo batch over cellular completes; each item shows its own status.
- [ ] Airplane mode mid-batch: the in-flight photo shows "Failed" with Retry; later ones continue failing cleanly; turn the network back on, Retry succeeds.
- [ ] Re-select an already-uploaded photo: "Duplicate (already uploaded)".
- [ ] Leave the app until the Access session expires (or sign out in another tab), then upload: status reads "Sign-in expired — reload to sign in".
- [ ] Download a 1920w file from the feed and check it has no GPS/EXIF (e.g. `exiftool`).
- [ ] The photo's date heading matches the day it was taken on site.
- [ ] Manage tab: edit caption, hide (gone from the feed within ~60 s), unhide, delete (images 404 within seconds).
```

- [ ] **Step 4: Update CLAUDE.md**

Append to the Commands section:
```markdown
- Deploys: push to `main` → staging (`.github/workflows/ci.yml`); production is the manual "Deploy production" workflow. Real iPhone checks: `docs/iphone-checklist.md`.
```
And add under "Invariants that span multiple parts":
```markdown
- **`taken_utc` orders, `taken_at` displays.** Sorting/cursors use the UTC column; day headings use the date in `taken_at`'s own offset.
- **The app is built by `createApp(deps)`** with injected `fetch` (JWKS, purge), `cache` and `now`; Worker tests call `app.fetch` directly via `test/worker/helpers.ts#harness` rather than `SELF`.
- **Feed cache key = purge URL = `feedUrl(PUBLIC_BASE_URL, slug, cursor)`.** Change one and you break delete-time purging.
- **Pinned embeds (`/embed/<version>.js`) keep calling `/api/feed`**, so the feed response shape must stay backward compatible.
```

- [ ] **Step 5: Verify and commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.
```bash
git add .github README.md docs/iphone-checklist.md CLAUDE.md
git commit -m "ci: test on push, deploy staging on main, production on dispatch; operator docs"
```

---

### Task 13: Provision Cloudflare and ship staging (human-in-the-loop)

> These steps create real resources in the Cloudflare account and change Access policy. **Confirm with the user before each one**; some need the dashboard and must be done by them.

**Files:**
- Modify: `wrangler.jsonc` (real database IDs, AUD tags, team domain, zone ID)

- [ ] **Step 1:** README setup steps 1–3 (login, create D1 and R2 for both environments). Paste the D1 IDs into `wrangler.jsonc`.
- [ ] **Step 2:** README step 4 — the user creates the Access applications and bypass paths in the dashboard and gives back the team domain and AUD tags. Fill them in `wrangler.jsonc`. Initial allowlist: the user's own email only.
- [ ] **Step 3:** README step 5 — zone ID into `wrangler.jsonc`; the user creates the purge token; run `npx wrangler secret put CF_PURGE_TOKEN --env staging`.
- [ ] **Step 4:** README step 6 — the user adds the GitHub secrets.
- [ ] **Step 5:** Commit `wrangler.jsonc`, push to `main`, watch the CI run deploy staging (`gh run watch`).
- [ ] **Step 6:** Seed staging: `npm run project:add -- --env staging birken-lofts "Birken Lofts" https://birkenlofts.com/progress/ https://birkenlofts.com http://localhost:3000`
- [ ] **Step 7:** Verify, with output:
  - `curl -sI https://progress-staging.monroeresidential.com/embed.js` → `200`, `access-control-allow-origin: *`, `cache-control: public, max-age=300`.
  - `curl -s https://progress-staging.monroeresidential.com/api/feed/birken-lofts` → `{"project":{"slug":"birken-lofts",…},"photos":[],"nextCursor":null}`.
  - `curl -s -o /dev/null -w "%{http_code}" -X POST https://progress-staging.monroeresidential.com/api/admin/photos` → a redirect to Access (302) or `401`, never `400`/`201`.
- [ ] **Step 8:** The user runs `docs/iphone-checklist.md` on staging. Then delete the test photos from the Manage tab and run `npm run cleanup:orphans -- --env staging` (expect 0 orphans).
- [ ] **Step 9:** Production: `npx wrangler secret put CF_PURGE_TOKEN`, run the "Deploy production" workflow, seed `birken-lofts` with `--env production` (no localhost origin), repeat Step 7 against production.
- [ ] **Step 10:** Hand off the Birken Lofts site change (separate repo, per the spec): `app/progress/page.tsx` with the pinned `<script>` from `npm run embed:release`, `<progress-feed project="birken-lofts">` themed with the site tokens, nav entry, and `app/sitemap.ts` entry.
