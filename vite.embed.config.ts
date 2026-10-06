import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist/app",
    emptyOutDir: false,
    target: "es2022",
    lib: { entry: "src/embed/progress-feed.ts", formats: ["es"], fileName: () => "embed.js" },
  },
});
