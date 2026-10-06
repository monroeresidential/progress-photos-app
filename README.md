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

Notes:

- `wrangler dev` rewrites the request host to the route pattern, so `dev` and `e2e:server` pass `--local-upstream localhost:8787`. That is what makes the localhost-only `DEV_AUTH_EMAIL` bypass work; keep the flag if you change those scripts.
- `compatibility_date` in `wrangler.jsonc` is pinned to `2026-08-22`, the newest date the workerd bundled with `@cloudflare/vitest-pool-workers` supports. Don't raise it past what the test pool supports.
- The Playwright `chromium` project launches with `--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessForWorkers,BlockInsecurePrivateNetworkRequests`. Without it the fake `http://host.test` page can't load the embed script from localhost.

## One-time Cloudflare setup

1. `npx wrangler login`
2. `npx wrangler d1 create progress-photos` and `npx wrangler d1 create progress-photos-staging`; put the IDs in `wrangler.jsonc`.
3. `npx wrangler r2 bucket create progress-photos` and `npx wrangler r2 bucket create progress-photos-staging`.
4. Zero Trust → Access → Applications → add a self-hosted app for `progress.monroeresidential.com` (and another for `progress-staging.…`) with an Allow policy for the uploaders' emails. Add **Bypass** policies (Everyone) for the paths `/api/feed/*`, `/img/*`, `/embed.js`, `/embed/*` — create these as separate Access applications on those paths so the bypass takes precedence. Copy each app's **AUD tag** and the team domain into `ACCESS_AUD` / `ACCESS_TEAM_DOMAIN` in `wrangler.jsonc`. Both must be non-empty: with either empty, `/api/admin/*` returns 500 `auth_misconfigured` (fails closed).
5. Put the `monroeresidential.com` zone ID in `CF_ZONE_ID`. Create an API token with **Zone → Cache Purge** on that zone and run `npx wrangler secret put CF_PURGE_TOKEN` (and again with `--env staging`). Run before the first deploy, Wrangler offers to create the Worker; accept, or run this after the first CI deploy.
6. GitHub repo secrets: `CLOUDFLARE_API_TOKEN` (Workers Scripts edit, D1 edit, R2 edit, Workers Custom Domains edit) and `CLOUDFLARE_ACCOUNT_ID`.
7. In GitHub, create environments `staging` and `production` (Settings → Environments); add required reviewers to `production`.
8. Pushing to `main` deploys staging; run the "Deploy production" workflow to deploy production.

## Orphaned images

If a Worker crash leaves R2 objects without a D1 row: `CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run cleanup:orphans -- --env production`. It lists first, skips anything under an hour old, and asks before deleting.
