import { defineConfig, devices } from "@playwright/test";

// The production build, served the way it runs in Docker: the relay (both
// apps and /ws on one port) and the sensor agent. Run `pnpm build` first
// (`pnpm test:e2e` from the repository root does both).
const PORT = 8090;

export default defineConfig({
  testDir: ".",
  testIgnore: "architecture-guide.spec.ts",
  // One relay with one shared alert store: tests must not run at the same time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The relay and the sensor; Playwright waits for the relay's health check.
    command: "node start-backend.mjs",
    url: `http://127.0.0.1:${PORT}/healthz`,
    // A fresh in-memory database for each run, with the demo users. The
    // sensor sends 10 readings each second with a fixed seed.
    env: {
      PORT: String(PORT),
      LOG_LEVEL: "error",
      DATABASE_PATH: ":memory:",
      DEMO_USERS: "true",
      SENSOR_TOKEN: "e2e-sensor-token-not-secret",
      RELAY_URL: `ws://127.0.0.1:${PORT}/ws`,
      SENSOR_RATE_HZ: "10",
      SENSOR_SEED: "7",
    },
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
