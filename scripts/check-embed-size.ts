import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const LIMIT = 15 * 1024;
const size = gzipSync(readFileSync("dist/app/embed.js")).length;
console.log(`embed.js: ${size} bytes gzipped (limit ${LIMIT})`);
if (size >= LIMIT) process.exit(1);
