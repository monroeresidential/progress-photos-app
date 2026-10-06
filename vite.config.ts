import { defineConfig } from "vite";

export default defineConfig({
  root: "src/app",
  publicDir: "public",
  optimizeDeps: { exclude: ["@jsquash/webp"] },
  build: { outDir: "../../dist/app", emptyOutDir: true, target: "es2022" },
});
