import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:8787", trace: "retain-on-failure" },
  webServer: {
    command: "npm run e2e:server",
    url: "http://localhost:8787/embed.js",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The fake http://host.test page is "public" and fetches from loopback; Chrome's Local/Private Network
        // Access checks would block that, which real hosts (https site -> public API) never hit.
        launchOptions: { args: ["--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessForWorkers,BlockInsecurePrivateNetworkRequests"] },
      },
    },
    { name: "iphone", use: { ...devices["iPhone 15"] } },
  ],
});
