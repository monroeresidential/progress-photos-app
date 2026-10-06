import { mkdirSync, writeFileSync } from "node:fs";
import { solidPng } from "./lib/png.ts";

const BRAND: [number, number, number] = [0x1d, 0x3b, 0x2a];
mkdirSync("src/app/public/icons", { recursive: true });
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]] as const) {
  writeFileSync(`src/app/public/icons/${name}`, solidPng(size, size, BRAND));
}
console.log("Wrote src/app/public/icons/*");
