import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        main: "./src/worker/index.ts",
        wrangler: { configPath: "./wrangler.jsonc" },
        // The pool bundles an older workerd than wrangler; cap the date it can run.
        miniflare: { compatibilityDate: "2026-08-22", bindings: { TEST_MIGRATIONS: migrations } },
      }),
    ],
    test: {
      include: ["test/worker/**/*.test.ts"],
      setupFiles: ["./test/worker/setup.ts"],
    },
  };
});
