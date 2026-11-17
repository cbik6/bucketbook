import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a real, freshly created install (see
 * scripts/e2e.sh), because the main flow starts with the first-run wizard.
 * Set E2E_BASE_URL to point at another running instance.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  // The dev VM is low on memory; give pages longer to appear before failing.
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
