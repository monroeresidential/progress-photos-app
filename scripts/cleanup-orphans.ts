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
