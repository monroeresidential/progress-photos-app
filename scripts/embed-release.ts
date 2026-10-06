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
