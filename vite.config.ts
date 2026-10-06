import { defineConfig } from "vite";

export default defineConfig({
  root: "src/app",
  server: { proxy: { "/api": "http://localhost:8787", "/img": "http://localhost:8787" } },
  publicDir: "public",
  optimizeDeps: { exclude: ["@jsquash/webp"] },
  build: { outDir: "../../dist/app", emptyOutDir: true, target: "es2022" },
});
