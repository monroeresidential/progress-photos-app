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
