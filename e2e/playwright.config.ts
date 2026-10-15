import { defineConfig, devices } from "@playwright/test";

// The production build, served the way it runs in Docker: one process, one
// port, both apps and /ws on the same origin. Run `pnpm build` first
// (`pnpm test:e2e` from the repository root does both).
const PORT = 8090;

export default defineConfig({
  testDir: ".",
  fullyParallel: false, // one relay, one shared alert store
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node ../server/dist/index.js",
    url: `http://127.0.0.1:${PORT}/healthz`,
    // A fresh in-memory database for each run, with the demo users.
    env: {
      PORT: String(PORT),
      LOG_LEVEL: "error",
      DATABASE_PATH: ":memory:",
      DEMO_USERS: "true",
    },
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
