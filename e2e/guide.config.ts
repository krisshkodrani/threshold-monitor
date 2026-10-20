import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "architecture-guide.spec.ts",
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  webServer: {
    command: "pnpm --filter @app/architecture-guide dev --host 127.0.0.1",
    url: "http://127.0.0.1:5175",
    reuseExistingServer: !process.env.CI,
  },
});
