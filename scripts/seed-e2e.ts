// Fresh local D1 for Playwright: schema + fixed projects/photos. Run by `npm run e2e:server`.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
  projectInsertSql({ slug: "e2e-manage", name: "E2E Manage", siteUrl: "http://host.test/progress/", origins: ORIGINS }, now),
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
for (const m of readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort()) {
  execFileSync("npx", [...d1, `migrations/${m}`], { stdio: "inherit" });
}
execFileSync("npx", [...d1, `${PERSIST}/seed.sql`], { stdio: "inherit" });
