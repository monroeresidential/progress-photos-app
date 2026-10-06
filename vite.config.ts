import { defineConfig } from "vite";

export default defineConfig({
  root: "src/app",
  publicDir: "public",
  build: { outDir: "../../dist/app", emptyOutDir: true, target: "es2022" },
});
